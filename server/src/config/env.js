import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(8),
    CLIENT_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    APP_URL: z.url().default('http://localhost:5173'),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ENABLE_API_DOCS: bool.optional(),
    // 32-byte key (base64) for field-level encryption of bank and identity numbers.
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    // Private directory for uploaded documents (local storage driver). Never inside a web root.
    UPLOAD_DIR: z.string().default('.data/uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(25).default(10),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool.default(false),
    MAIL_FROM: z.string().default('Senova HRMS <no-reply@localhost>'),
  })
  .transform((env) => ({
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    ENABLE_API_DOCS: env.ENABLE_API_DOCS ?? env.NODE_ENV !== 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.isProduction && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required in production' });
    }
    if (env.isProduction && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Cookies must be secure in production' });
    }
  });

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Logger depends on env, so report directly and stop: the app must not start misconfigured.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env = load();
