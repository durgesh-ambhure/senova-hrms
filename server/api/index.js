/**
 * Vercel serverless entry point. Vercel routes every request here (see vercel.json); the Express
 * app is built once per warm instance, after the database connection is open, and reused.
 *
 * Modules are imported lazily so a configuration or startup failure becomes a clear 503 (naming the
 * missing settings, never their values) instead of an opaque FUNCTION_INVOCATION_FAILED crash.
 */
let ready = null;

function init() {
  ready ??= (async () => {
    const { default: mongoose } = await import('mongoose');
    const { env } = await import('../src/config/env.js');
    const { connectDatabase } = await import('../src/db/connection.js');
    const { ensureDefaultRoles } = await import('../src/modules/roles/role.service.js');
    const { createApp } = await import('../src/app.js');
    if (mongoose.connection.readyState !== 1) await connectDatabase(env.MONGODB_URI);
    await ensureDefaultRoles();
    return createApp();
  })().catch((err) => {
    ready = null; // let the next request retry, e.g. after a transient database outage
    throw err;
  });
  return ready;
}

function unavailable(res, code, message, details) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }));
}

export default async function handler(req, res) {
  let app;
  try {
    app = await init();
  } catch (err) {
    if (err.name === 'ConfigError') {
      return unavailable(res, 'SERVER_MISCONFIGURED', 'The server is missing required settings.', err.fields);
    }
    // Message only: driver errors can echo parts of the connection string.
    console.error('API failed to start:', err.name, err.code ?? '', err.message?.replace(/\/\/[^@\s]*@/g, '//<credentials>@'));
    const database = /Mongo|ECONNREFUSED|ENOTFOUND|querySrv|auth/i.test(`${err.name} ${err.message}`);
    return unavailable(res, database ? 'DATABASE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE', database ? 'The server could not connect to its database.' : 'The service is starting up or unavailable. Try again shortly.');
  }
  return app(req, res);
}
