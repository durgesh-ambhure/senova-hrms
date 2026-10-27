import { describe, expect, it } from 'vitest';
import { createEmployeeRecord, signedInAsEmployee } from '../../../test/helpers.js';
import { sanitizeFileName, sniffMimeType } from '../../shared/middleware/upload.js';
import { EmployeeDocument } from './document.model.js';
import { AuditLog } from '../audit/auditLog.model.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);

const upload = (client, { employeeId, file = PDF, name = 'pan-card.pdf', category = 'identity', contentType = 'application/pdf', extra = {} }) => {
  let req = client.post('/api/v1/documents').field('employeeId', String(employeeId)).field('category', category);
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return req.attach('file', file, { filename: name, contentType });
};

describe('upload validation (unit)', () => {
  it('detects real file types from content', () => {
    expect(sniffMimeType(PDF)).toBe('application/pdf');
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(EXE)).toBeNull();
  });

  it('strips paths and control characters from file names', () => {
    expect(sanitizeFileName('..\\..\\etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('my "offer"\u0007<letter>.pdf')).toBe('my offerletter.pdf');
  });
});

describe('documents API', () => {
  it('lets an employee upload, list and download their own documents', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const res = await upload(me, { employeeId: employee._id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fileName: 'pan-card.pdf', mimeType: 'application/pdf', status: 'pending', size: PDF.length });
    expect(res.body.data).not.toHaveProperty('storageKey');

    const list = await me.get(`/api/v1/documents?employee=${employee._id}`);
    expect(list.body.data).toHaveLength(1);

    const dl = await me.get(`/api/v1/documents/${res.body.data.id}/download`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(dl.body, PDF)).toBe(0);
    expect(await AuditLog.exists({ action: 'document.downloaded' })).toBeTruthy();
  });

  it('rejects disguised executables, missing files and oversize uploads', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const fake = await upload(me, { employeeId: employee._id, file: EXE, name: 'cv.pdf' });
    expect(fake.status).toBe(422);
    expect(fake.body.error.details[0].message).toMatch(/PDF, JPEG and PNG/);

    const none = await me.post('/api/v1/documents').field('employeeId', String(employee._id)).field('category', 'identity');
    expect(none.status).toBe(422);

    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const tooBig = await upload(me, { employeeId: employee._id, file: big });
    expect(tooBig.status).toBe(413);
    expect(await EmployeeDocument.countDocuments({ employee: employee._id })).toBe(0);
  });

  it('blocks cross-employee upload, listing and download', async () => {
    const { client: me } = await signedInAsEmployee(['employee']);
    const { client: other, employee: otherEmp } = await signedInAsEmployee(['employee']);
    const doc = (await upload(other, { employeeId: otherEmp._id })).body.data;

    expect((await upload(me, { employeeId: otherEmp._id })).status).toBe(404);
    expect((await me.get(`/api/v1/documents?employee=${otherEmp._id}`)).status).toBe(404);
    expect((await me.get(`/api/v1/documents/${doc.id}/download`)).status).toBe(404);
    expect((await me.delete(`/api/v1/documents/${doc.id}`)).status).toBe(404);

    // Managers see the profile but not documents.
    const { client: mgr, employee: mgrEmp } = await signedInAsEmployee(['manager']);
    const report = await createEmployeeRecord({ reportingManager: mgrEmp._id });
    expect((await mgr.get(`/api/v1/documents?employee=${report._id}`)).status).toBe(404);
  });

  it('HR verifies or rejects documents, but never their own', async () => {
    const { client: me, employee } = await signedInAsEmployee(['employee']);
    const doc = (await upload(me, { employeeId: employee._id })).body.data;
    expect((await me.post(`/api/v1/documents/${doc.id}/review`).send({ decision: 'verified' })).status).toBe(403);

    const { client: hr, employee: hrEmp } = await signedInAsEmployee(['hr_admin']);
    const noReason = await hr.post(`/api/v1/documents/${doc.id}/review`).send({ decision: 'rejected' });
    expect(noReason.status).toBe(422);
    const verified = await hr.post(`/api/v1/documents/${doc.id}/review`).send({ decision: 'verified' });
    expect(verified.body.data).toMatchObject({ status: 'verified' });
    expect((await hr.post(`/api/v1/documents/${doc.id}/review`).send({ decision: 'verified' })).status).toBe(409);

    // An employee cannot delete a verified document; HR can.
    expect((await me.delete(`/api/v1/documents/${doc.id}`)).status).toBe(403);

    const own = (await upload(hr, { employeeId: hrEmp._id })).body.data;
    expect((await hr.post(`/api/v1/documents/${own.id}/review`).send({ decision: 'verified' })).status).toBe(403);
  });
});
