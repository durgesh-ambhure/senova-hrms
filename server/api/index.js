/**
 * Vercel serverless entry point. Vercel routes every request here (see vercel.json); the Express
 * app is built once per warm instance, after the database connection is open, and reused.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { connectDatabase } from '../src/db/connection.js';
import { ensureDefaultRoles } from '../src/modules/roles/role.service.js';
import { createApp } from '../src/app.js';

let ready = null;

function init() {
  ready ??= (async () => {
    if (mongoose.connection.readyState !== 1) await connectDatabase(env.MONGODB_URI);
    await ensureDefaultRoles();
    return createApp();
  })().catch((err) => {
    ready = null; // let the next request retry, e.g. after a transient database outage
    throw err;
  });
  return ready;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await init();
  } catch (err) {
    logger.error({ err }, 'API failed to start');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is starting up or unavailable. Try again shortly.' } }));
    return;
  }
  return app(req, res);
}
