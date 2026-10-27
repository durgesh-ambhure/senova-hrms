import request from 'supertest';
import { describe, expect, it } from 'vitest';
import handler from './index.js';

describe('Vercel entry point', () => {
  it('serves the API through the serverless handler', async () => {
    const health = await request(handler).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe('ok');
    const csrf = await request(handler).get('/api/v1/auth/csrf');
    expect(csrf.status).toBe(200);
    expect(csrf.body.data.csrfToken).toBeTruthy();
    expect((await request(handler).get('/api/v1/nope')).status).toBe(404);
  });
});
