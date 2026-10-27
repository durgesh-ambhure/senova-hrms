/**
 * OpenAPI 3.1 description of the API. Served at /api/docs (Swagger UI) and /api/docs.json when
 * ENABLE_API_DOCS is on (default outside production). Extend this alongside each module.
 */
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const dataOf = (schema) => json({ type: 'object', properties: { data: schema } });
const listOf = (schema) =>
  json({ type: 'object', properties: { data: { type: 'array', items: schema }, meta: ref('PageMeta') } });

const errors = {
  401: { description: 'Not signed in', content: json(ref('Error')) },
  403: { description: 'Missing permission or CSRF token', content: json(ref('Error')) },
  422: { description: 'Validation failed', content: json(ref('Error')) },
};
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Field name, prefix with - for descending' },
  { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const body = (schema) => ({ required: true, content: json(schema) });
const obj = { type: 'object', additionalProperties: true };
const op = (tag, summary, { params = [], requestBody, status = 200 } = {}) => ({
  tags: [tag],
  summary,
  ...(params.length ? { parameters: params } : {}),
  ...(requestBody ? { requestBody: body(requestBody) } : {}),
  responses: { [status]: { description: 'OK' }, 404: { description: 'Not found or outside your access scope' }, ...errors },
});

const phase2Paths = {
  '/departments': {
    get: op('Organization', 'List departments (any signed-in user)', { params: [{ name: 'includeArchived', in: 'query', schema: { type: 'boolean' } }] }),
    post: op('Organization', 'Create a department (organization:manage)', { requestBody: obj, status: 201 }),
  },
  '/departments/{id}': { patch: op('Organization', 'Update or archive a department', { params: [idParam], requestBody: obj }) },
  '/designations': {
    get: op('Organization', 'List designations (any signed-in user)'),
    post: op('Organization', 'Create a designation (organization:manage)', { requestBody: obj, status: 201 }),
  },
  '/designations/{id}': { patch: op('Organization', 'Update or archive a designation', { params: [idParam], requestBody: obj }) },
  '/employees': {
    get: op('Employees', 'Directory — all employees (employees:read:all) or own team (employees:read:team)', {
      params: [
        ...pageParams,
        ...['department', 'designation', 'employmentType', 'status', 'manager', 'includeArchived'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
      ],
    }),
    post: op('Employees', 'Create an employee; code is generated (employees:manage)', { requestBody: obj, status: 201 }),
  },
  '/employees/me': {
    get: op('Employees', 'Own profile (self:profile)'),
    patch: op('Employees', 'Update own contact details and emergency contact', { requestBody: obj }),
  },
  '/employees/{id}': {
    get: op('Employees', 'Profile — full for HR/self, limited for managers', { params: [idParam] }),
    patch: op('Employees', 'Edit profile and employment details (employees:manage)', { params: [idParam], requestBody: obj }),
  },
  '/employees/{id}/history': { get: op('Employees', 'Employment history', { params: [idParam] }) },
  '/employees/{id}/lifecycle': {
    post: op('Employees', 'activate | start_notice | withdraw_notice | exit', { params: [idParam], requestBody: obj }),
  },
  '/employees/{id}/probation': { post: op('Employees', 'Confirm or extend probation', { params: [idParam], requestBody: obj }) },
  '/employees/{id}/archive': { post: op('Employees', 'Archive an exited / not-joined employee', { params: [idParam] }) },
  '/employees/{id}/restore': { post: op('Employees', 'Restore an archived employee', { params: [idParam] }) },
  '/employees/{id}/account': { post: op('Employees', 'Invite a linked login (employees:manage + users:manage)', { params: [idParam], status: 201 }) },
  '/employees/{id}/sensitive': {
    get: op('Employees', 'Bank / PAN / Aadhaar-last-4 / UAN, masked unless reveal=true (audited)', {
      params: [idParam, { name: 'reveal', in: 'query', schema: { type: 'boolean' } }],
    }),
    put: op('Employees', 'Update bank and identity details (encrypted at rest)', { params: [idParam], requestBody: obj }),
  },
  '/documents': {
    get: op('Documents', 'List an employee’s documents (HR or the employee)', { params: [{ name: 'employee', in: 'query', required: true, schema: { type: 'string' } }] }),
    post: {
      tags: ['Documents'],
      summary: 'Upload a PDF/JPEG/PNG (type checked by content; size-limited)',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file', 'employeeId', 'category'],
              properties: { file: { type: 'string', format: 'binary' }, employeeId: { type: 'string' }, category: { type: 'string' }, title: { type: 'string' }, onboardingTaskId: { type: 'string' } },
            },
          },
        },
      },
      responses: { 201: { description: 'Uploaded' }, 413: { description: 'Too large' }, ...errors },
    },
  },
  '/documents/{id}/download': { get: op('Documents', 'Download (audited)', { params: [idParam] }) },
  '/documents/{id}/review': { post: op('Documents', 'Verify or reject (documents:manage; not your own)', { params: [idParam], requestBody: obj }) },
  '/documents/{id}': { delete: op('Documents', 'Remove a document (soft delete)', { params: [idParam], status: 204 }) },
  '/onboarding/templates': {
    get: op('Onboarding', 'Checklist templates (onboarding:manage)'),
    post: op('Onboarding', 'Create a checklist template', { requestBody: obj, status: 201 }),
  },
  '/onboarding/templates/{id}': { patch: op('Onboarding', 'Update a checklist template', { params: [idParam], requestBody: obj }) },
  '/onboarding/overview': { get: op('Onboarding', 'Progress per employee (onboarding:manage)') },
  '/onboarding/my-tasks': { get: op('Onboarding', 'Tasks assigned to me (as employee or manager)') },
  '/onboarding/employees/{id}/tasks': {
    get: op('Onboarding', 'An employee’s checklist (HR, the employee, their manager)', { params: [idParam] }),
    post: op('Onboarding', 'Add an ad-hoc task', { params: [idParam], requestBody: obj, status: 201 }),
  },
  '/onboarding/employees/{id}/start': { post: op('Onboarding', 'Start a checklist template for an employee', { params: [idParam], requestBody: obj, status: 201 }) },
  '/onboarding/tasks/{id}/complete': { post: op('Onboarding', 'Complete a task (assignee or HR)', { params: [idParam], requestBody: obj }) },
  '/onboarding/tasks/{id}/waive': { post: op('Onboarding', 'Waive a task (HR)', { params: [idParam], requestBody: obj }) },
  '/onboarding/tasks/{id}/reopen': { post: op('Onboarding', 'Reopen a task (HR)', { params: [idParam], requestBody: obj }) },
};

const q = (name, required = false) => ({ name, in: 'query', required, schema: { type: 'string' } });
const phase3Paths = {
  '/company/policies': { patch: op('Company', 'Attendance / leave policies (company:manage, or attendance:manage / leave:manage for their group)', { requestBody: obj }) },
  '/holidays': {
    get: op('Holidays', 'Holiday calendar (any signed-in user)', { params: [q('year'), q('location')] }),
    post: op('Holidays', 'Add a holiday (organization:manage)', { requestBody: obj, status: 201 }),
  },
  '/holidays/{id}': {
    patch: op('Holidays', 'Edit a future holiday', { params: [idParam], requestBody: obj }),
    delete: op('Holidays', 'Remove a future holiday', { params: [idParam], status: 204 }),
  },
  '/shifts': {
    get: op('Attendance', 'Shifts / work schedules'),
    post: op('Attendance', 'Create a shift (attendance:manage)', { requestBody: obj, status: 201 }),
  },
  '/shifts/{id}': { patch: op('Attendance', 'Update or archive a shift', { params: [idParam], requestBody: obj }) },
  '/attendance/me/today': { get: op('Attendance', 'My attendance state now (self:attendance)') },
  '/attendance/check-in': { post: op('Attendance', 'Check in (one per attendance date)', { status: 201 }) },
  '/attendance/check-out': { post: op('Attendance', 'Check out the open record') },
  '/attendance/breaks/start': { post: op('Attendance', 'Start a break') },
  '/attendance/breaks/end': { post: op('Attendance', 'End the current break') },
  '/attendance/records': { get: op('Attendance', 'Daily records (own / team / all)', { params: [q('employee'), q('from', true), q('to', true)] }) },
  '/attendance/summary': { get: op('Attendance', 'Monthly summary in half-day units (feeds payroll)', { params: [q('employee'), q('month', true)] }) },
  '/attendance/team/today': { get: op('Attendance', 'Who is in today (team or company)') },
  '/attendance/corrections': {
    get: op('Attendance', 'Correction requests (mine | approvals)', { params: [q('scope'), q('status')] }),
    post: op('Attendance', 'Request a missing-punch correction', { requestBody: obj, status: 201 }),
  },
  '/attendance/corrections/{id}/review': { post: op('Attendance', 'Approve or reject (reporting manager or HR; never your own)', { params: [idParam], requestBody: obj }) },
  '/attendance/corrections/{id}/cancel': { post: op('Attendance', 'Withdraw your pending correction', { params: [idParam] }) },
  '/leave/types': {
    get: op('Leave', 'Leave types'),
    post: op('Leave', 'Create a leave type (leave:manage)', { requestBody: obj, status: 201 }),
  },
  '/leave/types/{id}': { patch: op('Leave', 'Update a leave type', { params: [idParam], requestBody: obj }) },
  '/leave/balances': { get: op('Leave', 'Balances in half-day units (own / team / all)', { params: [q('employee'), q('year')] }) },
  '/leave/balances/adjust': { post: op('Leave', 'Manual adjustment with reason (leave:manage; not your own)', { requestBody: obj }) },
  '/leave/requests': {
    get: op('Leave', 'Requests (mine | approvals | all)', { params: [q('scope'), q('status'), q('employee'), q('from'), q('to')] }),
    post: op('Leave', 'Apply for leave', { requestBody: obj, status: 201 }),
  },
  '/leave/requests/preview': { post: op('Leave', 'Dry run: days charged and balance', { requestBody: obj }) },
  '/leave/requests/{id}': { get: op('Leave', 'A leave request', { params: [idParam] }) },
  '/leave/requests/{id}/decision': { post: op('Leave', 'Approve or reject (manager of the team or HR)', { params: [idParam], requestBody: obj }) },
  '/leave/requests/{id}/cancel': { post: op('Leave', 'Cancel (pending) or request cancellation (approved)', { params: [idParam], requestBody: obj }) },
  '/leave/requests/{id}/cancellation-decision': { post: op('Leave', 'Approve or reject a cancellation request', { params: [idParam], requestBody: obj }) },
  '/timesheets/projects': {
    get: op('Timesheets', 'Projects'),
    post: op('Timesheets', 'Create a project (timesheets:manage)', { requestBody: obj, status: 201 }),
  },
  '/timesheets/projects/{id}': { patch: op('Timesheets', 'Update or archive a project', { params: [idParam], requestBody: obj }) },
  '/timesheets/mine/{weekStart}': {
    get: op('Timesheets', 'My week (Monday date)', { params: [{ name: 'weekStart', in: 'path', required: true, schema: { type: 'string', format: 'date' } }] }),
    put: op('Timesheets', 'Save my week (draft or rejected only)', { params: [{ name: 'weekStart', in: 'path', required: true, schema: { type: 'string', format: 'date' } }], requestBody: obj }),
  },
  '/timesheets/mine/{weekStart}/submit': { post: op('Timesheets', 'Submit my week for approval', { params: [{ name: 'weekStart', in: 'path', required: true, schema: { type: 'string', format: 'date' } }] }) },
  '/timesheets': { get: op('Timesheets', 'Timesheets (mine | approvals | all)', { params: [q('scope'), q('status'), q('employee'), q('from'), q('to')] }) },
  '/timesheets/{id}': { get: op('Timesheets', 'A timesheet', { params: [idParam] }) },
  '/timesheets/{id}/decision': { post: op('Timesheets', 'Approve or reject with comment', { params: [idParam], requestBody: obj }) },
  '/timesheets/report': { get: op('Timesheets', 'Hours by employee and project', { params: [q('from', true), q('to', true), q('employee'), q('project'), q('status')] }) },
};

const fileId = { name: 'fileId', in: 'path', required: true, schema: { type: 'string' } };
const phase4Paths = {
  '/recruitment/jobs': {
    get: op('Recruitment', 'Job openings (staff: all; hiring managers: their own)', { params: [q('status'), q('department'), q('search')] }),
    post: op('Recruitment', 'Create a job opening (recruitment:jobs:manage)', { requestBody: obj, status: 201 }),
  },
  '/recruitment/jobs/{id}': {
    get: op('Recruitment', 'Job opening with pipeline counts', { params: [idParam] }),
    patch: op('Recruitment', 'Update a job / change status', { params: [idParam], requestBody: obj }),
  },
  '/recruitment/candidates': {
    get: op('Recruitment', 'Candidates (recruiters)', { params: [q('search'), q('skill'), q('source'), q('job'), q('stage')] }),
    post: op('Recruitment', 'Add a candidate; 409 DUPLICATE_CANDIDATE on email/phone match', { requestBody: obj, status: 201 }),
  },
  '/recruitment/candidates/duplicates': { get: op('Recruitment', 'Possible duplicates by email / phone', { params: [q('email'), q('phone')] }) },
  '/recruitment/candidates/{id}': {
    get: op('Recruitment', 'Candidate: full for recruiters, limited for interviewers / hiring managers', { params: [idParam] }),
    patch: op('Recruitment', 'Update a candidate', { params: [idParam], requestBody: obj }),
  },
  '/recruitment/candidates/{id}/applications': { get: op('Recruitment', 'Applications of a candidate', { params: [idParam] }) },
  '/recruitment/candidates/{id}/activity': { get: op('Recruitment', 'Activity history', { params: [idParam] }) },
  '/recruitment/candidates/{id}/notes': { post: op('Recruitment', 'Add a note', { params: [idParam], requestBody: obj, status: 201 }) },
  '/recruitment/candidates/{id}/files': { post: op('Recruitment', 'Upload a resume (PDF/DOCX/JPEG/PNG, content-checked)', { params: [idParam], status: 201 }) },
  '/recruitment/candidates/{id}/files/{fileId}': {
    get: op('Recruitment', 'Download a file (audited)', { params: [idParam, fileId] }),
    delete: op('Recruitment', 'Remove a file', { params: [idParam, fileId], status: 204 }),
  },
  '/recruitment/applications': {
    get: op('Recruitment', 'Pipeline (recruiters: all; hiring managers: their jobs)', { params: [q('job'), q('stage'), q('search')] }),
    post: op('Recruitment', 'Apply a candidate to an open job', { requestBody: obj, status: 201 }),
  },
  '/recruitment/applications/{id}': { get: op('Recruitment', 'An application', { params: [idParam] }) },
  '/recruitment/applications/{id}/move': { post: op('Recruitment', 'Move stage (validated transitions; reason required to reject)', { params: [idParam], requestBody: obj }) },
  '/recruitment/applications/{id}/offers': { post: op('Recruitment', 'Prepare an offer (selected candidates)', { params: [idParam], requestBody: obj, status: 201 }) },
  '/recruitment/applications/{id}/hire': { post: op('Recruitment', 'Convert to employee (accepted offer; recruitment:hire + employees:manage)', { params: [idParam], requestBody: obj, status: 201 }) },
  '/recruitment/interviews': {
    get: op('Recruitment', 'Interviews (mine | all in scope)', { params: [q('scope'), q('application'), q('candidate'), q('from'), q('to')] }),
    post: op('Recruitment', 'Schedule (shortlisted/interview stage; no double booking)', { requestBody: obj, status: 201 }),
  },
  '/recruitment/interviews/{id}': {
    get: op('Recruitment', 'An interview (colleagues feedback hidden until you submit yours)', { params: [idParam] }),
    patch: op('Recruitment', 'Reschedule / cancel / complete', { params: [idParam], requestBody: obj }),
  },
  '/recruitment/interviews/{id}/feedback': { post: op('Recruitment', 'Submit feedback (assigned interviewers)', { params: [idParam], requestBody: obj }) },
  '/recruitment/offers': { get: op('Recruitment', 'Offers (offer managers / approvers)', { params: [q('status'), q('application'), q('candidate')] }) },
  '/recruitment/offers/{id}': {
    get: op('Recruitment', 'An offer', { params: [idParam] }),
    patch: op('Recruitment', 'Edit a draft / rejected offer', { params: [idParam], requestBody: obj }),
  },
  ...Object.fromEntries(['submit', 'approve', 'reject', 'send', 'accept', 'decline', 'withdraw'].map((a) => [`/recruitment/offers/{id}/${a}`, { post: op('Recruitment', `Offer: ${a}`, { params: [idParam], requestBody: obj }) }])),
};

const phase5Paths = {
  '/payroll/rules': {
    get: op('Payroll', 'Payroll rule set versions'),
    post: op('Payroll', 'Create a draft rule set (payroll:rules:manage)', { requestBody: obj, status: 201 }),
  },
  '/payroll/rules/{id}': { patch: op('Payroll', 'Edit a draft rule set', { params: [idParam], requestBody: obj }) },
  '/payroll/rules/{id}/activate': { post: op('Payroll', 'Activate a draft (immutable afterwards)', { params: [idParam] }) },
  '/payroll/rules/{id}/verify': { post: op('Payroll', 'Record professional verification (payroll:finalize)', { params: [idParam], requestBody: obj }) },
  '/payroll/salaries': { get: op('Payroll', 'Employees and current CTC', { params: [q('search'), q('department'), q('missing')] }) },
  '/payroll/salaries/preview': { post: op('Payroll', 'Preview the monthly breakdown of a CTC', { requestBody: obj }) },
  '/payroll/salaries/me': { get: op('Payroll', 'My salary history (self:payslips)') },
  '/payroll/salaries/{employeeId}': { get: op('Payroll', 'Salary revisions for an employee', { params: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }] }) },
  '/payroll/salaries/{employeeId}/revisions': { post: op('Payroll', 'Add an effective-dated revision (back-dated revisions produce arrears)', { params: [{ name: 'employeeId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: obj, status: 201 }) },
  '/payroll/runs': {
    get: op('Payroll', 'Payroll runs', { params: [q('month'), q('status'), q('year')] }),
    post: op('Payroll', 'Create a regular or supplementary run (payroll:process)', { requestBody: obj, status: 201 }),
  },
  '/payroll/runs/{id}': { get: op('Payroll', 'A payroll run', { params: [idParam] }) },
  '/payroll/runs/{id}/calculate': { post: op('Payroll', '(Re)calculate all entries', { params: [idParam] }) },
  '/payroll/runs/{id}/entries': { get: op('Payroll', 'Employee entries with line breakdown and inputs', { params: [idParam, q('search'), q('issues')] }) },
  '/payroll/runs/{id}/adjustments': {
    get: op('Payroll', 'TDS and one-off adjustments', { params: [idParam] }),
    post: op('Payroll', 'Add TDS / earning / deduction (run goes back to draft)', { params: [idParam], requestBody: obj, status: 201 }),
  },
  '/payroll/runs/{id}/tds-import': { post: op('Payroll', 'Import TDS by employee code', { params: [idParam], requestBody: obj }) },
  ...Object.fromEntries(['submit', 'return', 'approve', 'finalize', 'cancel'].map((a) => [`/payroll/runs/{id}/${a}`, { post: op('Payroll', `Run: ${a}`, { params: [idParam], requestBody: obj }) }])),
  '/payroll/runs/{id}/register.csv': { get: op('Payroll', 'Payroll register CSV', { params: [idParam] }) },
  '/payroll/runs/{id}/bank-advice.csv': { get: op('Payroll', 'Bank advice CSV (finalized; needs sensitive access; audited)', { params: [idParam] }) },
  '/payroll/payslips': { get: op('Payroll', 'Payslips (own, or all with payslips:read:all)', { params: [q('employee'), q('month'), q('year')] }) },
  '/payroll/payslips/{id}': { get: op('Payroll', 'A payslip snapshot', { params: [idParam] }) },
  '/payroll/payslips/{id}/pdf': { get: op('Payroll', 'Payslip PDF (audited)', { params: [idParam] }) },
  '/payroll/reports/summary': { get: op('Payroll', 'Month summary by component and department', { params: [q('month', true)] }) },
  '/payroll/reports/history': { get: op('Payroll', 'Monthly payroll history', { params: [q('from', true), q('to', true)] }) },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Senova HRMS API',
    version: '1.0.0',
    description:
      'Session-cookie authentication. Call `GET /auth/csrf` (or use the token returned by login) and send it as `X-CSRF-Token` on every non-GET request.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'senova.sid' },
      csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
              requestId: { type: 'string' },
            },
          },
        },
      },
      PageMeta: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          roles: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['invited', 'active', 'disabled'] },
          employee: { type: ['string', 'null'] },
          lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Session: {
        type: 'object',
        properties: { user: ref('User'), permissions: { type: 'array', items: { type: 'string' } }, csrfToken: { type: 'string' } },
      },
      Role: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          permissions: { type: 'array', items: { type: 'string' } },
          isSystem: { type: 'boolean' },
          editable: { type: 'boolean' },
          userCount: { type: 'integer' },
        },
      },
      Company: { type: 'object', additionalProperties: true },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          actorName: { type: ['string', 'null'] },
          action: { type: 'string' },
          entityType: { type: 'string' },
          entityId: { type: ['string', 'null'] },
          summary: { type: 'string' },
          changes: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ session: [], csrf: [] }],
  paths: {
    '/health': { get: { tags: ['Health'], summary: 'Liveness probe', security: [], responses: { 200: { description: 'OK' } } } },
    '/health/ready': {
      get: { tags: ['Health'], summary: 'Readiness probe (database)', security: [], responses: { 200: { description: 'Ready' }, 503: { description: 'Unavailable' } } },
    },
    '/auth/csrf': { get: { tags: ['Auth'], summary: 'Get the CSRF token for this session', security: [], responses: { 200: { description: 'Token' } } } },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in',
        security: [{ csrf: [] }],
        requestBody: body({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }),
        responses: { 200: { description: 'Signed in', content: dataOf(ref('Session')) }, 401: errors[401], 423: { description: 'Account locked' }, 429: { description: 'Rate limited' } },
      },
    },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Sign out and destroy the session', responses: { 204: { description: 'Signed out' } } } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user and effective permissions', responses: { 200: { description: 'OK', content: dataOf(ref('Session')) }, 401: errors[401] } } },
    '/auth/forgot-password': {
      post: { tags: ['Auth'], summary: 'Request a password-reset email (always 200)', security: [{ csrf: [] }], requestBody: body({ type: 'object', properties: { email: { type: 'string' } } }), responses: { 200: { description: 'Accepted' } } },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Set a new password with a reset or invitation token',
        security: [{ csrf: [] }],
        requestBody: body({ type: 'object', properties: { token: { type: 'string' }, password: { type: 'string', minLength: 12 } } }),
        responses: { 200: { description: 'Password set' }, 400: { description: 'Invalid or expired token' }, 422: errors[422] },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change own password (signs out other sessions)',
        requestBody: body({ type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } } }),
        responses: { 204: { description: 'Changed' }, ...errors },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List user accounts (users:read)',
        parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'role', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'OK', content: listOf(ref('User')) }, ...errors },
      },
      post: {
        tags: ['Users'],
        summary: 'Invite a user (users:manage)',
        requestBody: body({ type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } } } }),
        responses: { 201: { description: 'Created', content: dataOf(ref('User')) }, 409: { description: 'Email exists' }, ...errors },
      },
    },
    '/users/{id}': {
      get: { tags: ['Users'], summary: 'Get a user (users:read)', parameters: [idParam], responses: { 200: { description: 'OK', content: dataOf(ref('User')) }, 404: { description: 'Not found' }, ...errors } },
      patch: {
        tags: ['Users'],
        summary: 'Update name, roles or status (users:manage)',
        parameters: [idParam],
        requestBody: body({ type: 'object', properties: { name: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['active', 'disabled'] } } }),
        responses: { 200: { description: 'OK', content: dataOf(ref('User')) }, 409: { description: 'Would remove last Super Admin' }, ...errors },
      },
    },
    '/users/{id}/resend-invite': { post: { tags: ['Users'], summary: 'Re-send invitation', parameters: [idParam], responses: { 204: { description: 'Sent' }, ...errors } } },
    '/users/{id}/send-reset-link': { post: { tags: ['Users'], summary: 'Email a password-reset link', parameters: [idParam], responses: { 204: { description: 'Sent' }, ...errors } } },
    '/users/{id}/revoke-sessions': { post: { tags: ['Users'], summary: 'Sign the user out everywhere', parameters: [idParam], responses: { 204: { description: 'Revoked' }, ...errors } } },
    '/roles': {
      get: { tags: ['Roles'], summary: 'List roles (roles:read)', responses: { 200: { description: 'OK', content: dataOf({ type: 'array', items: ref('Role') }) }, ...errors } },
      post: { tags: ['Roles'], summary: 'Create a custom role (roles:manage)', requestBody: body(ref('Role')), responses: { 201: { description: 'Created' }, ...errors } },
    },
    '/roles/permissions': { get: { tags: ['Roles'], summary: 'Permission catalog', responses: { 200: { description: 'OK' }, ...errors } } },
    '/roles/{key}': {
      patch: { tags: ['Roles'], summary: 'Update a role (not super_admin)', parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }], requestBody: body(ref('Role')), responses: { 200: { description: 'OK' }, ...errors } },
      delete: { tags: ['Roles'], summary: 'Delete an unused custom role', parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Deleted' }, ...errors } },
    },
    '/company': {
      get: { tags: ['Company'], summary: 'Company settings (company:read)', responses: { 200: { description: 'OK', content: dataOf(ref('Company')) }, ...errors } },
      patch: { tags: ['Company'], summary: 'Update company settings (company:manage)', requestBody: body(ref('Company')), responses: { 200: { description: 'OK' }, ...errors } },
    },
    '/audit-logs': {
      get: {
        tags: ['Audit'],
        summary: 'Audit trail (audit:read)',
        parameters: [...pageParams, { name: 'entityType', in: 'query', schema: { type: 'string' } }, { name: 'action', in: 'query', schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }],
        responses: { 200: { description: 'OK', content: listOf(ref('AuditLog')) }, ...errors },
      },
    },
    '/dashboard/summary': { get: { tags: ['Dashboard'], summary: 'Permission-filtered dashboard widgets', responses: { 200: { description: 'OK' }, 401: errors[401] } } },
    ...phase2Paths,
    ...phase3Paths,
    ...phase4Paths,
    ...phase5Paths,
  },
};
