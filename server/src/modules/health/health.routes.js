import { Router } from 'express';
import mongoose from 'mongoose';
import { isDatabaseReady } from '../../db/connection.js';

export const healthRouter = Router();

/** Liveness: the process is up. */
healthRouter.get('/', (_req, res) => res.json({ data: { status: 'ok', uptime: Math.round(process.uptime()) } }));

/** Readiness: dependencies are reachable. Used by load balancers / orchestrators. */
healthRouter.get('/ready', async (_req, res) => {
  let database = 'down';
  if (isDatabaseReady()) {
    try {
      await mongoose.connection.db.admin().ping();
      database = 'up';
    } catch {
      database = 'down';
    }
  }
  const ready = database === 'up';
  res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'unavailable', database } });
});
