# Senova HRMS — Operations

## Environments

| | Development | Test (CI) | Production |
|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `production` |
| MongoDB | `npm run db:dev` (local replica set) | in-memory replica set (automatic) | Managed replica set (e.g. MongoDB Atlas) |
| Email | printed to the API console | captured in memory | SMTP (required — the API refuses to start without `SMTP_HOST`) |
| Cookies | `Secure` off (HTTP) | — | `Secure` on (refuses to start otherwise) |
| API docs | `/api/docs` | — | off unless `ENABLE_API_DOCS=true` |
| Seed data | `npm run seed` | per-test fixtures | never — the seed script refuses to run |

All configuration is validated at startup (`server/src/config/env.js`); a misconfigured API exits
with a list of problems instead of running insecurely.

## Production build and deployment

1. **Database** — MongoDB replica set (transactions are required). Enforce TLS, IP allowlisting /
   private networking, and a dedicated database user with `readWrite` on the Senova database only.
   Enable continuous backups.
2. **API** — Node.js ≥ 20.19 (22 LTS recommended):
   ```bash
   npm ci --omit=dev -w server
   NODE_ENV=production node server/src/server.js
   ```
   Provide environment variables through the platform's secret store, not a file in the image.
   Set `TRUST_PROXY` to the number of proxies in front of the API so rate limiting and audit IPs
   use the real client address.
3. **Web app** — `npm ci && npm run build` produces static files in `client/dist`. Serve them from
   the **same origin** as the API (reverse proxy `/api` → API), so the session cookie is
   first-party and `SameSite=Lax` applies. Configure the proxy to return `index.html` for unknown
   paths (SPA routing) and to add HSTS and a Content-Security-Policy for the static files.
4. **First administrator** — no seed in production. Run once:
   ```bash
   node --env-file=.env scripts/create-admin.js "Full Name" admin@company.com
   ```
   (from `server/`). The person receives an invitation link and sets their own password.
5. **Health checks** — liveness `GET /api/v1/health`, readiness `GET /api/v1/health/ready`
   (returns 503 when MongoDB is unreachable).

## Logging and monitoring

* Structured JSON logs (pino) to stdout in production; ship them to your log platform.
* Every request has an `X-Request-Id`, also returned in error bodies, so a user-reported error can
  be matched to the log line.
* Cookies, CSRF tokens, passwords, tokens and bank/identity fields are redacted; request headers
  are not logged at all.
* Error monitoring hook: unhandled errors are logged at `error` level in
  `server/src/shared/middleware/errorHandler.js` — attach Sentry/OpenTelemetry there.

## Backup and restore

Backups are only useful if restores are rehearsed. Minimum policy (adjust in `DECISIONS.md` X1):

* **Atlas**: enable Cloud Backup with point-in-time restore; daily snapshots retained ≥ 35 days,
  monthly ≥ 12 months.
* **Self-hosted**: nightly logical backup plus oplog-based point-in-time recovery.
  ```bash
  mongodump --uri="$MONGODB_URI" --gzip --archive=senova-$(date +%F).archive.gz
  mongorestore --uri="$RESTORE_URI" --gzip --archive=senova-YYYY-MM-DD.archive.gz --nsInclude='senova.*'
  ```
  Store archives encrypted, in a different account/region from the database.
* **Restore drill (quarterly)**: restore the latest backup into an isolated environment, start the
  API against it, verify `/health/ready`, sign in, spot-check record counts against production,
  and record the time taken. Never restore over production without a fresh backup first.
* Uploaded documents live in `UPLOAD_DIR` (local driver). Back that directory up together with the
  database, or move to private object storage with versioning (DECISIONS E4).
* **Back up `DATA_ENCRYPTION_KEY` separately and securely** (secret manager). A database backup without
  the key cannot reveal bank account or PAN numbers; losing the key loses them permanently.

## Database changes

Indexes are declared on the Mongoose schemas and built on startup (`autoIndex`). For large
collections in production, build new indexes ahead of a release with `createIndexes` during a
quiet period. Data migrations go in `server/scripts/migrations/` as idempotent, reviewed scripts
that are run explicitly — never implicitly on boot.

## Security checklist before go-live

- [ ] All `DECISIONS.md` items affecting payroll and attendance answered and configured.
- [ ] `SESSION_SECRET` ≥ 48 random bytes, unique per environment; rotation procedure documented.
- [ ] `DATA_ENCRYPTION_KEY` generated per environment, stored in a secret manager, and backed up.
- [ ] Private object storage configured for documents; upload virus scanning decided (DECISIONS E8).
- [ ] HTTPS everywhere; `COOKIE_SECURE=true`; HSTS on the web host.
- [ ] `CLIENT_ORIGINS` and `APP_URL` set to the production domain only.
- [ ] MongoDB: TLS, network restriction, least-privilege user, backups on, restore drill passed.
- [ ] `npm audit --omit=dev` clean of high/critical issues.
- [ ] Authorization review of every new endpoint (permission + record-level policy + tests).
- [ ] Penetration test or security review of authentication, payroll and document access.
