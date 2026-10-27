import { Router } from 'express';
import { z } from 'zod';
import * as service from './document.service.js';
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUSES } from './document.model.js';
import { idParams, objectId } from '../users/user.validation.js';
import { authenticate, authorize } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { singleDocumentUpload } from '../../shared/middleware/upload.js';
import { created, noContent, ok } from '../../shared/http.js';

const listQuery = z.strictObject({ employee: objectId, status: z.enum(DOCUMENT_STATUSES).optional() });
const uploadBody = z.object({
  employeeId: objectId,
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().max(150).optional(),
  onboardingTaskId: objectId.optional(),
});
const reviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('verified'), reason: z.string().trim().max(500).optional() }),
  z.object({ decision: z.literal('rejected'), reason: z.string().trim().min(3, 'Tell the employee why').max(500) }),
]);

export const documentRouter = Router();
documentRouter.use(authenticate);

// Access to a specific employee's documents is decided in the service (HR or the employee).
documentRouter.get('/', validate({ query: listQuery }), async (req, res) => ok(res, await service.listDocuments(req, req.validatedQuery)));
documentRouter.post('/', singleDocumentUpload, validate({ body: uploadBody }), async (req, res) => created(res, await service.uploadDocument(req, req.body)));

documentRouter.get('/:id/download', validate({ params: idParams }), async (req, res) => {
  const { doc, stream } = await service.openDownload(req, req.params.id);
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Length', doc.size);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  stream.on('error', (err) => {
    req.log?.error({ err }, 'Document stream failed');
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
});

documentRouter.post('/:id/review', authorize('documents:manage'), validate({ params: idParams, body: reviewBody }), async (req, res) =>
  ok(res, await service.reviewDocument(req, req.params.id, req.body)),
);
documentRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await service.deleteDocument(req, req.params.id);
  return noContent(res);
});
