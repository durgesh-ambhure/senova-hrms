import { Router } from 'express';
import * as rules from './rules.service.js';
import * as salary from './salary.service.js';
import * as runs from './runs.service.js';
import * as payslips from './payslips.service.js';
import * as reports from './reports.service.js';
import * as v from './payroll.validation.js';
import { idParams, objectId } from '../users/user.validation.js';
import { ownEmployeeId } from '../employees/team.js';
import { authenticate, authorize, authorizeAny } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { created, noContent, ok } from '../../shared/http.js';
import { notFound } from '../../shared/errors.js';
import { z } from 'zod';

const readers = authorizeAny('payroll:read', 'payroll:process', 'payroll:approve', 'payroll:finalize');
const id = validate({ params: idParams });
const sendCsv = (res, { fileName, body }) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  // BOM so spreadsheet apps read UTF-8 names correctly.
  res.send(String.fromCharCode(0xfeff) + body);
};

export const payrollRouter = Router();
payrollRouter.use(authenticate);

// Rule settings (P3–P9): editable by payroll rule managers; verification is a finalizer's attestation.
payrollRouter.get('/rules', authorizeAny('payroll:read', 'payroll:rules:manage', 'payroll:finalize', 'payroll:salary:manage'), async (_req, res) => ok(res, await rules.listRuleSets()));
payrollRouter.post('/rules', authorize('payroll:rules:manage'), validate({ body: v.ruleSetBody }), async (req, res) => created(res, await rules.createDraft(req, req.body)));
payrollRouter.patch('/rules/:id', authorize('payroll:rules:manage'), validate({ params: idParams, body: v.ruleSetBody }), async (req, res) => ok(res, await rules.updateDraft(req, req.params.id, req.body)));
payrollRouter.post('/rules/:id/activate', authorize('payroll:rules:manage'), id, async (req, res) => ok(res, await rules.activate(req, req.params.id)));
payrollRouter.post('/rules/:id/verify', authorize('payroll:finalize'), validate({ params: idParams, body: v.verifyBody }), async (req, res) => ok(res, await rules.verify(req, req.params.id, req.body)));

// Salaries
payrollRouter.get('/salaries', authorizeAny('payroll:read', 'payroll:salary:manage'), validate({ query: v.salaryListQuery }), async (req, res) => {
  const { items, meta } = await salary.listSalaries(req, req.validatedQuery);
  return ok(res, items, meta);
});
payrollRouter.post('/salaries/preview', authorize('payroll:salary:manage'), validate({ body: v.previewBody }), async (req, res) => ok(res, await salary.previewBreakdown(req.body)));
payrollRouter.get('/salaries/me', authorize('self:payslips'), async (req, res) => {
  const me = ownEmployeeId(req);
  if (!me) throw notFound('No employee profile is linked to your account');
  return ok(res, await salary.getEmployeeSalary(req, me));
});
const empParams = validate({ params: z.object({ employeeId: objectId }) });
payrollRouter.get('/salaries/:employeeId', empParams, async (req, res) => ok(res, await salary.getEmployeeSalary(req, req.params.employeeId)));
payrollRouter.post('/salaries/:employeeId/revisions', authorize('payroll:salary:manage'), validate({ params: z.object({ employeeId: objectId }), body: v.revisionBody }), async (req, res) =>
  created(res, await salary.createRevision(req, req.params.employeeId, req.body)),
);
payrollRouter.delete('/salaries/:employeeId/revisions/:revisionId', authorize('payroll:salary:manage'), validate({ params: z.object({ employeeId: objectId, revisionId: objectId }) }), async (req, res) => {
  await salary.deleteRevision(req, req.params.employeeId, req.params.revisionId);
  return noContent(res);
});

// Runs
payrollRouter.get('/runs', readers, validate({ query: v.runListQuery }), async (req, res) => ok(res, await runs.listRuns(req.validatedQuery)));
payrollRouter.post('/runs', authorize('payroll:process'), validate({ body: v.runBody }), async (req, res) => created(res, await runs.createRun(req, req.body)));
payrollRouter.get('/runs/:id', readers, id, async (req, res) => ok(res, await runs.getRun(req, req.params.id)));
payrollRouter.post('/runs/:id/calculate', authorize('payroll:process'), id, async (req, res) => ok(res, await runs.calculateRun(req, req.params.id)));
payrollRouter.get('/runs/:id/entries', readers, validate({ params: idParams, query: v.entryListQuery }), async (req, res) => ok(res, await runs.listEntries(req, req.params.id, req.validatedQuery)));
payrollRouter.get('/runs/:id/entries/:entryId', readers, validate({ params: z.object({ id: objectId, entryId: objectId }) }), async (req, res) => ok(res, await runs.getEntry(req, req.params.id, req.params.entryId)));
payrollRouter.get('/runs/:id/adjustments', readers, id, async (req, res) => ok(res, await runs.listAdjustments(req.params.id)));
payrollRouter.post('/runs/:id/adjustments', authorize('payroll:process'), validate({ params: idParams, body: v.adjustmentBody }), async (req, res) => created(res, await runs.addAdjustment(req, req.params.id, req.body)));
payrollRouter.delete('/runs/:id/adjustments/:adjustmentId', authorize('payroll:process'), validate({ params: z.object({ id: objectId, adjustmentId: objectId }) }), async (req, res) => {
  await runs.removeAdjustment(req, req.params.id, req.params.adjustmentId);
  return noContent(res);
});
payrollRouter.post('/runs/:id/tds-import', authorize('payroll:process'), validate({ params: idParams, body: v.tdsImportBody }), async (req, res) => ok(res, await runs.importTds(req, req.params.id, req.body)));

const ACTION_PERMISSION = { submit: 'payroll:process', cancel: 'payroll:process', return: 'payroll:approve', approve: 'payroll:approve', finalize: 'payroll:finalize' };
for (const [action, permission] of Object.entries(ACTION_PERMISSION)) {
  payrollRouter.post(`/runs/:id/${action}`, authorize(permission), validate({ params: idParams, body: v.noteBody }), async (req, res) => ok(res, await runs.transitionRun(req, req.params.id, action, req.body)));
}
payrollRouter.get('/runs/:id/register.csv', readers, id, async (req, res) => sendCsv(res, await reports.registerCsv(req, req.params.id)));
payrollRouter.get('/runs/:id/bank-advice.csv', authorize('payroll:process', 'employees:sensitive:read'), id, async (req, res) => sendCsv(res, await reports.bankAdviceCsv(req, req.params.id)));

// Payslips: own (self:payslips) or everyone's (payslips:read:all), checked per record.
payrollRouter.get('/payslips', validate({ query: v.payslipListQuery }), async (req, res) => ok(res, await payslips.listPayslips(req, req.validatedQuery)));
payrollRouter.get('/payslips/:id', id, async (req, res) => ok(res, await payslips.getPayslip(req, req.params.id)));
payrollRouter.get('/payslips/:id/pdf', id, async (req, res) => {
  const { doc, fileName } = await payslips.renderPayslipPdf(req, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);
});

// Reports
payrollRouter.get('/reports/summary', authorizeAny('reports:payroll', 'payroll:read'), validate({ query: v.reportQuery }), async (req, res) => ok(res, await reports.monthSummary(req.validatedQuery)));
payrollRouter.get('/reports/history', authorizeAny('reports:payroll', 'payroll:read'), validate({ query: v.historyQuery }), async (req, res) => ok(res, await reports.history(req.validatedQuery)));
