# Senova HRMS — Architecture

Senova HRMS is a **single-company** internal HR system. There is one company configuration, one
application deployment and one MongoDB database. Multi-tenancy is intentionally out of scope.

## 1. Shape of the system

A **modular monolith** in an npm-workspaces repository:

```
senova/
├── server/                     Express 5 + Mongoose REST API (/api/v1)
│   ├── scripts/                seed.js, dev-db.js (local replica set without installing MongoDB)
│   ├── test/                   global test setup (in-memory replica set) and helpers
│   └── src/
│       ├── app.js              express app factory (middleware order lives here)
│       ├── server.js           process entry: connect DB, listen, graceful shutdown
│       ├── routes.js           mounts every module router under /api/v1
│       ├── config/             env validation (zod), logger (pino with redaction)
│       ├── db/                 connection + transaction helper
│       ├── docs/               OpenAPI document served by Swagger UI
│       ├── shared/             errors, response helpers, middleware, pagination, mailer, security
│       └── modules/<feature>/  <name>.routes | controller | service | model | validation | policy | test
├── client/                     React 19 + Vite SPA
│   └── src/
│       ├── app/                router, providers, query client
│       ├── components/ui/      design-system primitives (Button, Input, DataTable, Modal, Badge…)
│       ├── components/layout/  AppShell, Sidebar, Header, Breadcrumbs
│       ├── features/<feature>/ pages, hooks (TanStack Query), schemas (zod), components
│       ├── lib/                api client (CSRF + cookies), permissions, formatting
│       └── test/               test setup and render helpers
└── docs/                       this file, DECISIONS.md, OPERATIONS.md
```

Frontend features: `auth, dashboard, employees, onboarding, recruitment, attendance, leave,
timesheets, payroll, reports, settings`. Backend modules mirror these.

### Request flow (server)

```
Request → helmet/cors/body limits → pino-http (request id) → session → CSRF (unsafe methods)
        → authenticate → authorize(permission) → validate(zod) → controller → service → model → response
```

* Controllers are thin: they map HTTP ↔ service calls.
* Services own business rules, transactions and audit events.
* Policies (`*.policy.js`) own record-level decisions ("may this actor see *this* employee?").
* Every response is `{ data, meta? }`; every error is `{ error: { code, message, details? } }`.
  Internal error details never leave the server.

## 2. Authentication

* **Server-managed sessions** (`express-session` + `connect-mongo`), cookie `senova.sid`:
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, rolling expiry (default 8 h).
* Session ID is **regenerated on login** (fixation protection) and destroyed on logout.
* Each user has an `authVersion`. The session stores it; a password change/reset, disabling the
  account or an admin "sign out everywhere" increments it, invalidating every existing session.
* Passwords are hashed with **Argon2id**. Login does a dummy verify for unknown emails to blunt
  user enumeration via timing; responses are generic ("Invalid email or password").
* Account lock after 5 consecutive failures for 15 minutes, plus IP rate limiting on auth routes.
* **Password reset / invitation**: random 32-byte token, only its SHA-256 hash is stored,
  single-use, expiring (reset 30 min, invite 72 h), TTL-indexed. Using one revokes the others.
  New users are created *without* a password and receive an invite link — admins never know or
  set user passwords.
* **CSRF**: synchronizer token stored in the session, returned by `GET /auth/csrf` and on login,
  sent back by the SPA in `X-CSRF-Token` for every non-GET request.
* CORS allows only origins in `CLIENT_ORIGINS`, with credentials.

## 3. Authorization (RBAC + record-level policies)

Permissions are strings `resource:action[:scope]`, catalogued in
`server/src/modules/roles/permissions.js`. Roles are stored in MongoDB (seeded from code
defaults) and a user can hold several roles; effective permissions are the union.

| Role            | Default grant (summary)                                                                  |
|-----------------|-------------------------------------------------------------------------------------------|
| `super_admin`   | `*` — everything, including users, roles, company config and audit logs. Not editable.    |
| `hr_admin`      | employees (all), onboarding, recruitment, leave & attendance admin, HR reports            |
| `payroll_admin` | salary structures, payroll processing, payslips, payroll reports. **No `payroll:approve`** unless granted explicitly |
| `manager`       | team scope: employees, attendance, leave & timesheet approval, assigned interview feedback |
| `recruiter`     | jobs, candidates, applications, interviews, offers (not offer approval)                   |
| `employee`      | `self:*` — own profile, attendance, leave, timesheets, payslips, onboarding tasks         |

Rules enforced on the server:

* Every protected route declares the permission it needs (`authorize('users:manage')`).
* Scoped permissions (`:all`, `:team`, own) are resolved in policies against the actual record;
  IDs in URLs are never trusted (e.g. payslip of another employee → 404, not 403, to avoid probing).
* Anti-escalation: only a super admin can grant `super_admin`; an actor can only put permissions
  they hold into a role; users cannot change their own roles/status; the last active super admin
  cannot be disabled or demoted.
* Updates use explicit field allowlists per role (no mass assignment).
* The client hides menu items by permission for usability only.

## 4. Data model and relationships

```
users ──(0..1)── employees ──┬── departments, designations, reportingManager → employees
  │                          ├── documents (metadata; files in private object storage)
  │                          ├── onboardingTasks, employmentHistory events
  │                          ├── salaryStructures → salaryRevisions (effective-dated)
  │                          ├── attendanceRecords ← attendanceCorrectionRequests
  │                          ├── leaveBalances (employee × leaveType × year), leaveRequests
  │                          ├── timesheets → projects
  │                          └── payrollEntries ← payrollRuns (period, scope, state machine)
  │                                  └── payslips (immutable snapshot of a finalized entry)
  └── roles (by key), auditLogs.actor, notifications.recipient

jobOpenings ── applications ── candidates
                   ├── interviews (interviewers → users)
                   └── jobOffers ──(hired)──> employees.sourceApplication (conversion, once)
companySettings (singleton), holidays, leaveTypes, auditLogs (append-only)
```

Conventions: ObjectId references for independently queried entities, `timestamps` on every
schema plus `createdBy/updatedBy` where meaningful, controlled enums for statuses, unique indexes
on `users.email`, `employees.employeeCode` and `employees.workEmail` (normalized lower-case), no
unbounded arrays inside employee documents (history lives in its own collections), money stored as
**integer paise**, multi-document writes inside MongoDB transactions (a replica set is required —
Atlas, a self-hosted replica set, or `npm run db:dev` locally).

## 5. Employee data protection (Phase 2)

* **Three visibility levels**, decided per record in `employee.policy.js`: *full* (HR with
  `employees:read:all`, or the employee themself), *team* (managers, for direct and indirect reports,
  resolved with `$graphLookup` — work details only, no personal data), or nothing (404, so IDs can't be probed).
* **Bank account and PAN** live in `employeeSensitive`, AES-256-GCM encrypted with
  `DATA_ENCRYPTION_KEY`. Responses are masked unless `?reveal=true`, which is audited. Only the last four
  Aadhaar digits are ever stored. Audit entries record which fields changed, never their values.
* **Documents**: metadata in `documents`, bytes in private storage under random keys. Uploads are
  size-limited and accepted only if the file *content* is PDF/JPEG/PNG. Only HR (`documents:manage`) and
  the employee can list or download; downloads are audited and sent as attachments with
  `Content-Security-Policy: sandbox`. Nobody can verify their own documents.
* **Lifecycle** is an explicit state machine (`pre_joining → active → notice_period → exited`, plus
  withdrawing a resignation). Every change writes an `employmentEvents` row, and exiting disables the
  linked login. Records are archived, never hard-deleted. Employee codes come from a counter and are never reused.
* **Onboarding/offboarding**: starting a template copies its tasks to the employee, so later template edits
  don't rewrite history. Tasks are completed by their assignee (the employee, their manager, or HR). A task
  that needs a document can't be closed until one is uploaded, and rejecting that document reopens it.

## 6. Time and leave (Phase 3)

* **Time zones.** Shifts are wall-clock times in the company time zone; punches are UTC instants.
  `shared/dates.js` converts between them (DST-safe). Each punch belongs to an *attendance date*: the
  day its shift starts, so a 22:00–06:00 shift's 02:00 punch counts for the previous day.
* **Pure rules.** `attendance.rules.js` and `leave.rules.js` hold all calculations (late/early with grace,
  full/half/absent thresholds, overtime when enabled, leave slots, overlaps, accrual, carry-forward) with
  no database access, and are unit-tested exhaustively.
* **Shifts are snapshotted** onto each attendance record, so editing a shift never rewrites history.
* **No duplicates.** One attendance record per employee and date (unique index, so even concurrent
  check-ins can't double-punch); leave requests are checked for overlapping half days inside a transaction.
* **Half-day units.** Leave balances and attendance totals are integers where 1 day = 2 units; no floats.
  A balance is `opening + accrued + adjusted − used − pending`; pending requests hold their days.
* **Approvals** use one rule everywhere (`employees/team.js`): admins (`*:manage`) may approve anyone
  but themselves; managers with the team permission may approve their direct and indirect reports.
  Out-of-scope records return 404.
* **Payroll hand-off.** `buildMonthlySummary` produces per-day status and totals (present, paid/unpaid leave,
  absent, missing punches, late days) with links to the source leave requests. Payroll (Phase 5) will
  consume it and lock the records it used (`lockedAt`), which blocks later edits to those days.
* **Update schemas never apply defaults.** `shared/validation.js#updateSchemaFrom` derives PATCH schemas
  from create schemas with defaults stripped, because zod applies defaults inside `.partial()`, which would
  silently reset fields a client didn't send.
* **Role defaults.** System roles record which default permissions were applied (`defaultsApplied`), so
  permissions added in later releases reach existing databases once, and an admin's removals stick.

## 7. Recruitment (Phase 4)

* **Separate from employees.** Candidates, applications, interviews and offers live in their own
  collections. Only the hire step creates an employee, inside one transaction that also links the
  candidate and application. `employees.sourceApplication` is uniquely indexed, so a candidate can never
  be converted twice, even under concurrent requests.
* **Pipeline** stages and allowed moves are defined in `recruitment.rules.js` and enforced on the server.
  "offer" and "hired" are reached only through the offer workflow; rejecting needs a reason.
* **Duplicate detection** on exact email (always blocked) and the last 10 phone digits (blocked unless
  the recruiter confirms a different person).
* **Visibility.** Recruiters see everything. Interviewers and hiring managers get a *limited* candidate
  view (no contact details, compensation or activity log). Salary expectations and offer amounts need
  an offer permission. Interviewers only see colleagues' feedback after submitting their own.
* **Offers** follow `draft → pending_approval → approved → sent → accepted | declined`, plus withdraw.
  The approver needs `recruitment:offers:approve` and can never be the person who prepared the offer.
  Amounts are integer paise, parsed from rupee strings without floating-point maths.
* **Interviews** require interviewers whose role grants feedback permission. Overlapping slots for the
  same interviewer are rejected.

## 8. Payroll (Phase 5)

* **Rule sets** (`payrollRuleSets`) hold the salary template (Basic % of gross, HRA % of Basic), PF, ESI,
  PT slabs (with a February amount), gratuity provision % and the LOP absence switch. Versioned by
  `effectiveFrom` month; a version is immutable once active and edits create a new draft. A rule set must
  carry a recorded **verification** (who confirmed the figures and how) before any run using it can be finalized.
* **Salary structures**: `salaryRevisions` are effective-dated CTC records; `payroll.engine.js#salaryBreakdown`
  derives the monthly components (P3) — Special allowance is the remainder after Basic, HRA, fixed allowances
  and employer PF/ESI/gratuity, found by searching for the largest gross that fits the CTC (handling the ESI
  wage-limit cliff). `salaryStructures` caches the current revision per employee. Nobody edits their own salary.
* **Engine** (`payroll.engine.js`, pure functions, integer paise, BigInt multiply-divide, basis points):
  earnings per revision segment pro-rated by calendar days (P11); LOP at monthly ÷ calendar days (P2) from
  unpaid leave and (optionally) unexplained absence on past working days; PF capped at the ceiling unless
  `pfOnFullWage` (P4); ESI within the wage limit (P5); PT slab by gross (P6); TDS and other adjustments
  as entered (P7); gratuity as an employer line only (P8); exact paise per line, net rounded to the rupee
  with a ROUNDING line (P9).
* **Runs**: `draft → calculated → under_review → approved → finalized` (or `cancelled`). One live regular
  run per month (partial unique index). Transitions are server-side: submit/cancel need `payroll:process`;
  approve/return need `payroll:approve` and a different person from the preparer; finalize needs
  `payroll:finalize`, a third person, and verified rules (P10). Adding an adjustment after calculation
  sends the run back to `draft`, so approvers always see current numbers.
* **Arrears** (P12): each calculation recomputes earlier finalized months with current revisions and pays
  the difference against what was actually paid (regular entry plus earlier arrears) as ARR_* lines.
* **Finalization** reconciles totals, locks the month's attendance records, marks back-dated revisions
  settled, and writes **payslips** — immutable snapshots with financial-year YTD (P13). Leave applications,
  approvals, cancellations and attendance corrections touching a finalized month are refused; corrections
  go through a **supplementary run** (adjustments only) for that month.
* Payslip PDFs are rendered on request from the snapshot (pdfkit) and audited; employees see only their
  own (others get 404). Register and bank-advice CSVs guard against formula injection; bank advice needs
  `employees:sensitive:read` and is audited.
* Each entry stores the input snapshot (salary components, attendance/leave facts with source
  IDs), a line-by-line calculation breakdown and the **rule-set version** used.
* Generic engine (`components → gross → deductions → net`, integer paise, explicit rounding) is
  separate from jurisdiction rule packs (PF, ESI, PT, TDS, gratuity). Rule packs are configuration
  that must be verified by a qualified payroll professional — none are assumed correct by default.

## 9. Phase plan and status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Foundation: server, DB, auth, RBAC, users/roles/company settings, audit log, app shell, dashboard | **implemented** |
| 2 | Departments, designations, employee directory & profiles, documents, onboarding | **implemented** |
| 3 | Attendance, shifts, holidays, leave, timesheets | **implemented** |
| 4 | Recruitment / ATS and candidate → employee conversion | **implemented** |
| 5 | Payroll, payslips (PDF), reports, reconciliation | **implemented** (statutory values pending CA confirmation) |
| 6 | Hardening, performance, backup/restore drills, deployment | planned |
