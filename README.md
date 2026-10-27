# Senova HRMS

**People. Purpose. Progress.**

Internal, single-company Human Resource Management System: employees and onboarding, attendance,
leave and timesheets, recruitment, and payroll — built as a React + Express + MongoDB modular
monolith.

> **Status: Phases 1–5 complete.** Foundation (auth, RBAC, administration, audit log, app shell),
> employee management, time & leave, recruitment, and payroll: versioned rule settings, effective-dated
> salary structures and revisions, monthly runs with a three-person approval chain, arrears,
> supplementary correction runs, payslip PDFs and payroll reports — see [Implementation status](#implementation-status).
> **Statutory figures in the seed are demo values**; they must be confirmed by your CA before any real payroll.
> Not production-ready yet; see the go-live checklist in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Tech stack

| Layer | Choice |
|---|---|
| Web | React 19, Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS 4, lucide icons |
| API | Node.js 22, Express 5, Zod validation, express-session + connect-mongo, Argon2id, helmet, express-rate-limit, pino |
| Data | MongoDB (replica set) with Mongoose |
| Tests | Vitest, Supertest, mongodb-memory-server, React Testing Library |
| Docs | OpenAPI 3.1 + Swagger UI at `/api/docs` (development) |

## Getting started (development)

Requirements: Node.js ≥ 20.19 (22 LTS recommended). MongoDB does **not** need to be installed.

```bash
npm install
cp server/.env.example server/.env       # then edit: SESSION_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
```

Then:

```bash
npm start             # database, API and web app together; Ctrl+C stops all three
npm run seed          # once, in a second terminal: system roles, company settings, demo data, the dev Super Admin
```

`npm start` runs the local MongoDB replica set on :27017 (data in `server/.data/mongo`; only when `MONGODB_URI`
points at it), waits for it, then the API on http://localhost:4000 (Swagger UI at /api/docs) and the web app on
http://localhost:5173 (proxies /api to the API), with labelled output. Anything already running on one of those ports is
reused. To run them separately instead: `npm run db:dev`, `npm run dev:server`, `npm run dev:client`.

Sign in at http://localhost:5173 with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The seed also creates demo
departments, checklists, 10 employees and one login per role (HR Admin, Manager, Employee, Payroll Admin,
Recruiter) on the same email domain, all using `SEED_ADMIN_PASSWORD` — `npm run seed` prints their emails. Without SMTP
configured, invitation and password-reset emails are printed in the API terminal — open the link
from there.

The first `npm test` / `npm run db:dev` downloads a MongoDB binary (~800 MB, cached afterwards).

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Database, API and web app together for development (see above) |
| `npm run lint` | ESLint for server and client |
| `npm test` | Server API/unit tests (in-memory replica set) and client component tests |
| `npm run build` | Production build of the web app → `client/dist` |
| `npm run check` | lint + test + build (what CI runs) |
| `node --env-file=.env scripts/create-admin.js "Name" email` | (in `server/`) invite the first Super Admin in any environment |

## Repository layout

```
server/src/modules/<feature>/   routes · controller · service · model · validation · policy · test
server/src/shared/              errors, responses, middleware (auth, CSRF, validation, rate limits), security
client/src/features/<feature>/  pages, query hooks, schemas
client/src/components/          ui/ design-system primitives, layout/ app shell
docs/                           ARCHITECTURE.md · DECISIONS.md · OPERATIONS.md
```

## Security model (summary)

* HttpOnly, SameSite=Lax session cookie; sessions stored server-side and invalidated on password
  change, role change, disable, or "sign out everywhere".
* CSRF synchronizer token on every state-changing request; strict CORS allowlist; helmet headers.
* Argon2id password hashing, account lockout and auth rate limits, generic login errors.
* Invitation-based onboarding of accounts — admins never set passwords.
* Server-side RBAC on every endpoint + record-level policies; anti-escalation rules; field
  allowlists (no mass assignment); strict query validation.
* Append-only audit log of sign-ins and administrative changes; secrets redacted from logs.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Implementation status

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: auth, sessions, RBAC, users, roles, company settings, audit log, app shell, dashboard, CI | ✅ Done |
| 2 | Departments, designations, employee directory & profiles, lifecycle & history, bank/identity, documents, onboarding/offboarding | ✅ Done |
| 3 | Shifts, holidays, attendance & corrections, leave types/balances/requests, timesheets & projects | ✅ Done |
| 4 | Job openings, candidates, pipeline, interviews & feedback, offers & approval, candidate → employee | ✅ Done |
| 5 | Payroll rules, salary structures & revisions, runs & approval chain, arrears, payslip PDFs, reports | ✅ Done (statutory values need CA confirmation) |
| 6 | Hardening, performance, backup drills, deployment | Planned |

Tests: 177 API/unit tests and 41 UI tests (`npm test`).

**Known limitations**

* No notifications centre yet (arrives with leave/approval workflows); the header omits the bell
  rather than showing a non-functional one.
* **Payroll statutory values are not verified.** The seed's PF/ESI/PT figures are demo examples. Finalizing
  a run requires a recorded verification (Payroll settings → Record verification) by someone with
  `payroll:finalize`; record one only after your CA has confirmed the figures (DECISIONS "To confirm").
* ESI eligibility is decided month by month from that month's gross; contribution-period continuation
  rules are not modelled. PF admin charges and gender-based PT exemptions are not modelled either.
* TDS is entered or imported per run (P7), never computed. Full & final settlement (including the
  gratuity payout at exit, leave encashment and notice recovery) is not built yet; exits are pro-rated only.
* Payroll reports cover finalized runs only (month summary, components, departments, 12-month history,
  register and bank-advice CSV). Statutory return files (ECR, ESI, PT challans, Form 16) are not generated.
* Nobody can create or delete a salary revision for their own employee record, regardless of permissions.
* Recruitment has no public careers page or email integration yet: recruiters add candidates, and offers
  are marked "sent" after being emailed outside the system. Offer letters are not generated as PDFs yet.
* Pipeline stages are fixed (applied → … → hired); stage names are not configurable yet (DECISIONS R2).
* Resumes stay attached to the candidate record after hiring; they are not copied into employee documents.
* Attendance is web check-in only: no IP/geo restriction or biometric import yet (DECISIONS A5).
* Leave accrual, carry-forward, sandwich rule, grace periods and day thresholds are configurable
  but their defaults are **placeholders** until DECISIONS A1–A12 are answered. The seed's leave
  types (CL 12 / SL 12 / EL 15 / LOP) are examples, not policy.
* The seed adds only India's three fixed-date national holidays; festival holidays must be entered.
* Comp-off accrual from weekend work isn't automated; HR records it as a balance adjustment.
* Documents are stored on the API server's local disk (`UPLOAD_DIR`). Production needs private object
  storage (DECISIONS E4); it plugs in behind the interface in `server/src/shared/storage.js`.
* Uploads are not virus-scanned yet (DECISIONS E8). They are size-limited, accepted only if the content
  is PDF/JPEG/PNG, and always served as downloads with a sandboxing CSP.
* Offer compensation is not copied into a salary structure on hire; Payroll Admin enters the joining salary.
* The employment-type list is fixed (DECISIONS E9).
* Nothing here claims statutory compliance: payroll applies the configured, versioned rule values as given.
* Document storage provider is undecided (DECISIONS E4).
