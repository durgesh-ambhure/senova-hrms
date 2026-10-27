import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError, validationError } from '../errors.js';

const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Detects the real type from the file's content; the client's claimed type is not trusted.
 * DOCX (a zip) is only recognized when `allowDocx` and the archive contains a Word document part.
 */
export function sniffMimeType(buffer, { allowDocx = false } = {}) {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b))?.mime;
  if (match) return match;
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (allowDocx && isZip && buffer.includes('[Content_Types].xml') && buffer.includes('word/document.xml')) return DOCX_MIME;
  return null;
}

export function sanitizeFileName(name) {
  const base = String(name ?? 'file')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim();
  return (base || 'file').slice(-150);
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 2048 },
});

/** Single-file upload in field "file", validated by size and content signature. */
export const singleDocumentUpload = documentUpload();

export function documentUpload({ allowDocx = false } = {}) {
  return (req, res, next) =>
  parser.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'PAYLOAD_TOO_LARGE', `Files must be ${env.MAX_UPLOAD_MB} MB or smaller`));
      return next(validationError([{ in: 'body', path: 'file', message: 'Upload exactly one file in the "file" field' }]));
    }
    if (err) return next(err);
    if (!req.file) return next(validationError([{ in: 'body', path: 'file', message: 'Choose a file to upload' }]));
    const mime = sniffMimeType(req.file.buffer, { allowDocx });
    if (!mime) return next(validationError([{ in: 'body', path: 'file', message: allowDocx ? 'Only PDF, Word (.docx), JPEG and PNG files are accepted' : 'Only PDF, JPEG and PNG files are accepted' }]));
    req.file.detectedMimeType = mime;
    req.file.safeName = sanitizeFileName(req.file.originalname);
    return next();
  });
}
