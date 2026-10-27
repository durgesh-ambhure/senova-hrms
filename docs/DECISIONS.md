# Decisions needed from the company

These choices change business behaviour. Until each is answered, the corresponding feature uses
the **provisional default** shown, is fully configurable, and must not be relied on for real pay.

Status legend: ⏳ open · ✅ decided

## Payroll (blocks Phase 5 sign-off)

Decided 26 Oct 2026. These fix **how the engine behaves**. Statutory rates, ceilings and slabs are
**not** decided here: they are stored as versioned, editable rule settings and must be confirmed by the
company's CA / payroll consultant before the first real run (see "To confirm" below).

| # | Question | Decision | Status |
|---|----------|----------|--------|
| P1 | Pay cycle and cut-off | Calendar month; attendance and leave cut-off at month end. Late changes flow into the next run as adjustments. Pay date: set per run | ✅ |
| P2 | Per-day rate for LOP / unpaid leave and absence | Monthly pay ÷ calendar days in that month (Feb ÷ 28/29, Oct ÷ 31) | ✅ |
| P3 | Salary structure | CTC-based template: Basic = % of fixed pay, HRA = % of Basic, employer PF/ESI included in CTC, Special allowance = balancing remainder. Percentages are company settings, versioned; per-employee overrides allowed | ✅ |
| P4 | Provident Fund | Registered. Employee and employer PF on PF wages **capped at the statutory ceiling**; employer share counted inside CTC. Contribution on higher wages only by explicit opt-in per employee | ✅ |
| P5 | ESI | Applies to employees whose gross wages are within the notified ESI limit; follows contribution-period eligibility rules | ✅ |
| P6 | Professional Tax | Maharashtra slabs (including the different February amount). Other states can be added as separate slab tables later | ✅ |
| P7 | TDS | Not computed in Senova. Payroll Admin enters or imports each employee's monthly TDS from the CA / tax tool; Senova records it on the run and payslip | ✅ |
| P8 | Gratuity | Inside CTC as an employer cost; not shown or deducted on monthly payslips. Payout handled at exit (full & final) | ✅ |
| P9 | Rounding | Every component computed in exact paise; only net pay rounded to the rupee (half-up), shown as a separate "rounding" line so totals reconcile | ✅ |
| P10 | Approval chain | Payroll Admin prepares → HR / Finance head approves (`payroll:approve`, never the preparer) → Super Admin finalizes (`payroll:finalize`). Three distinct people | ✅ |
| P11 | Mid-month joiners, leavers and salary revisions | Pro-rated by calendar days, split at the effective date | ✅ |
| P12 | Arrears | Calculated automatically from back-dated salary revisions as a separate "arrears" line, visible to the approver before the run is approved | ✅ |
| P13 | Payslip content | Earnings, deductions, net pay and **year-to-date totals** (financial year). No employer contributions, leave balance or bank/PAN details on the payslip | ✅ |

### To confirm with the CA / payroll consultant before go-live

These are configuration values, not code. Senova ships with none of them assumed correct.

- [ ] PF: wage ceiling, employee and employer percentages, the EPS / EPF split of the employer share, admin charges, and which components count as "PF wages" (including any effect of the new labour codes' definition of wages).
- [ ] ESI: wage limit, employee and employer percentages, and contribution-period rules.
- [ ] Maharashtra Professional Tax: current slabs, the February amount, and any gender-based exemptions.
- [ ] Salary template percentages for P3 (Basic % of fixed pay, HRA % of Basic), and whether the same template applies to interns and contract staff.
- [ ] Gratuity: the formula and eligibility used at exit.
- [ ] TDS import format (per-employee monthly amount) agreed with whoever computes tax.

Implementation notes (Phase 5): every item above is a field in **Payroll settings**, versioned. Finalizing
a run is refused until the rule set carries a recorded verification. Not modelled yet, to raise with the CA:
ESI contribution-period continuation (eligibility is evaluated monthly), PF admin charges, gender-based PT
exemptions, and full & final settlement.

## Attendance, leave, timesheets (blocks Phase 3 sign-off)

| # | Question | Provisional default | Status |
|---|----------|--------------------|--------|
| A1 | Standard shift(s), weekly offs (Sat/Sun? alternate Saturdays?) | 09:30–18:30, Sat & Sun off | ⏳ |
| A2 | Grace period for late arrival / early leaving; how many lates = half day? | 15 min grace; no automatic conversion | ⏳ |
| A3 | Minimum hours for full day / half day | ≥ 8 h full, ≥ 4 h half, else absent | ⏳ |
| A4 | Overtime: applicable? who is eligible? paid or comp-off? | Not applicable | ⏳ |
| A5 | Check-in method: web only? IP/geo restriction? biometric import later? | Web check-in, no restriction | ⏳ |
| A6 | Missing punch: deadline to request correction; who approves (manager, HR)? | 7 days; reporting manager, HR fallback | ⏳ |
| A7 | Leave types and annual quota (CL, SL, EL/PL, maternity, paternity, bereavement, comp-off, LOP) | CL 12, SL 12, EL 15 — placeholders only | ⏳ |
| A8 | Accrual: yearly upfront or monthly? carry-forward cap? encashment? probation restrictions? | Monthly accrual, no carry-forward, no encashment | ⏳ |
| A9 | Sandwich rule: weekends/holidays between leave days counted? | Not counted | ⏳ |
| A10 | Leave year: calendar year or financial year (Apr–Mar)? | Calendar year | ⏳ |
| A11 | Timesheets: daily or weekly? mandatory for whom? project list source? | Weekly, optional per employee | ⏳ |
| A12 | Leave/timesheet approval when the manager is absent: HR fallback or delegation? | HR Admin fallback | ⏳ |
| A13 | Leave accrual detail: does the joining month count in full? Credit monthly accrual at the start or the end of each month? | Joining month counts; credited at the start of each month | ⏳ |
| A14 | Optional (restricted) holidays: how many may an employee take, and are they a leave type? | Listed for information; take via a leave type | ⏳ |
| A15 | Comp-off for working on a weekly off or holiday: automatic credit, expiry? | Not automatic; HR adjusts the balance | ⏳ |
| A16 | Can approved past leave be cancelled after payroll for that month is finalized? | Not yet enforced (Phase 5 will lock it) | ⏳ |

## Employees and recruitment

| # | Question | Provisional default | Status |
|---|----------|--------------------|--------|
| E1 | Employee code format (e.g. `SEN-0001`) and whether codes are reused | `SEN-` + 4-digit sequence, never reused | ⏳ |
| E2 | Probation length and confirmation process | 6 months, manager confirms, HR approves | ⏳ |
| E3 | Which profile fields may employees edit themselves without approval? | Phone, personal email, current address, emergency contact | ⏳ |
| E4 | Document storage provider (S3, Azure Blob, GCS, on-prem) and retention period | Local private disk in dev only; provider required for production | ⏳ |
| E5 | Data retention after exit (profile, payroll, documents, rejected candidates) | Retain payroll 8 years; rejected candidates 1 year. Removed documents are soft-deleted and kept until a purge policy exists | ⏳ |
| E6 | Should managers confirm probation themselves, or only HR? | HR only (`employees:manage`) | ⏳ |
| E7 | Should employees see a company-wide directory (names, work email, department)? | No — own profile only | ⏳ |
| E8 | Virus scanning of uploaded documents (e.g. ClamAV or the storage provider's scanning)? | Not scanned; content type and size checked | ⏳ |
| E9 | Is a configurable list of employment types needed beyond full-time / part-time / contract / intern / consultant? | Fixed list | ⏳ |
| R1 | Offer approval: who approves, and is a compensation band check required? | HR Admin approves (never the preparer); no band check | ⏳ |
| R2 | Should pipeline stages be renamable or extendable (e.g. "Assignment", "Culture fit")? | Fixed stages | ⏳ |
| R3 | Public careers page / job-board integrations, or recruiter-entered candidates only? | Recruiter-entered | ⏳ |
| R4 | Offer letter template and e-signature, or letters sent outside Senova? | Sent outside; status recorded | ⏳ |
| R5 | Retention for rejected candidates and their resumes (consent, deletion on request) | Kept until a retention policy exists (see E5) | ⏳ |

## Platform

| # | Question | Provisional default | Status |
|---|----------|--------------------|--------|
| X1 | Hosting target (VM, container platform, PaaS) and MongoDB provider (Atlas?) | Docker image + MongoDB Atlas | ⏳ |
| X2 | Email provider for invites/resets (SMTP relay, SES, SendGrid…) | SMTP via `SMTP_*` env vars | ⏳ |
| X3 | SSO (Google Workspace / Microsoft Entra) instead of passwords? | Email + password | ⏳ |
| X4 | Company timezone | `Asia/Kolkata` | ⏳ |
