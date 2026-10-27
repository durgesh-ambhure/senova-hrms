import pino from 'pino';
import { env } from './env.js';

// Anything that could carry credentials or personal financial data is redacted.
const redact = {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    '*.password',
    '*.currentPassword',
    '*.newPassword',
    '*.passwordHash',
    '*.token',
    '*.tokenHash',
    '*.bankAccountNumber',
    '*.ifsc',
    '*.pan',
    '*.aadhaar',
  ],
  censor: '[REDACTED]',
};

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact,
  base: { service: 'senova-api' },
  ...(env.isProduction || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }),
});
