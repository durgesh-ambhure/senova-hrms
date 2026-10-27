import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createSessionMiddleware } from './config/session.js';
import { createApiRouter } from './routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { openApiDocument } from './docs/openapi.js';
import { csrfProtection } from './shared/middleware/csrf.js';
import { apiLimiter } from './shared/middleware/rateLimiters.js';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler.js';

/** Builds the Express app. Requires an open Mongoose connection (used by the session store). */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CLIENT_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Log only what is needed to trace a request; headers carry cookies and personal data.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') },
    }),
  );

  app.use('/api/v1/health', healthRouter);

  if (env.ENABLE_API_DOCS) {
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApiDocument));
    app.get('/api/docs.json', (_req, res) => res.json(openApiDocument));
  }

  app.use('/api', apiLimiter);
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => {
    // API responses may contain personal data: never cache them.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', createSessionMiddleware());
  app.use('/api', csrfProtection);
  app.use('/api/v1', createApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
