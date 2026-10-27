import { Router } from 'express';
import { getSummary } from './dashboard.service.js';
import { authenticate } from '../../shared/middleware/auth.js';
import { ok } from '../../shared/http.js';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', authenticate, async (req, res) => ok(res, await getSummary(req)));
