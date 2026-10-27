import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post } from '../../lib/api.js';

const P = '/payroll';

export const useRuleSets = () =>
  useQuery({
    queryKey: ['payroll', 'rules'],
    queryFn: () => get(`${P}/rules`),
  });
export const useRuns = (params) =>
  useQuery({
    queryKey: ['payroll', 'runs', params],
    queryFn: () => get(`${P}/runs`, params),
  });
export const useRun = (id) =>
  useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: () => get(`${P}/runs/${id}`),
  });
export const useEntries = (id, params) =>
  useQuery({
    queryKey: ['payroll', 'entries', id, params],
    queryFn: () => get(`${P}/runs/${id}/entries`, params),
    placeholderData: keepPreviousData,
  });
export const useAdjustments = (id) =>
  useQuery({
    queryKey: ['payroll', 'adjustments', id],
    queryFn: () => get(`${P}/runs/${id}/adjustments`),
  });
export const useSalaries = (params) =>
  useQuery({
    queryKey: ['payroll', 'salaries', params],
    queryFn: () => api(`${P}/salaries`, { query: params }),
    placeholderData: keepPreviousData,
  });
export const useEmployeeSalary = (employeeId) =>
  useQuery({
    queryKey: ['payroll', 'salary', employeeId],
    queryFn: () => get(employeeId === 'me' ? `${P}/salaries/me` : `${P}/salaries/${employeeId}`),
  });
export const usePayslips = (params, enabled = true) =>
  useQuery({
    queryKey: ['payroll', 'payslips', params],
    queryFn: () => get(`${P}/payslips`, params),
    enabled,
  });
export const usePayslip = (id) =>
  useQuery({
    queryKey: ['payroll', 'payslip', id],
    queryFn: () => get(`${P}/payslips/${id}`),
    enabled: Boolean(id),
  });
export const useMonthReport = (month) =>
  useQuery({
    queryKey: ['payroll', 'report', month],
    queryFn: () => get(`${P}/reports/summary`, { month }),
    placeholderData: keepPreviousData,
  });
export const useHistoryReport = (from, to) =>
  useQuery({
    queryKey: ['payroll', 'history', from, to],
    queryFn: () => get(`${P}/reports/history`, { from, to }),
  });

export const previewSalary = (body) => post(`${P}/salaries/preview`, body);

export function usePayrollMutations() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['payroll'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const m = (mutationFn) => ({ mutationFn, onSuccess });
  return {
    createRules: useMutation(m((body) => post(`${P}/rules`, body))),
    updateRules: useMutation(m(({ id, ...body }) => patch(`${P}/rules/${id}`, body))),
    activateRules: useMutation(m((id) => post(`${P}/rules/${id}/activate`))),
    verifyRules: useMutation(m(({ id, reference }) => post(`${P}/rules/${id}/verify`, { reference }))),
    addRevision: useMutation(m(({ employeeId, ...body }) => post(`${P}/salaries/${employeeId}/revisions`, body))),
    deleteRevision: useMutation(m(({ employeeId, revisionId }) => del(`${P}/salaries/${employeeId}/revisions/${revisionId}`))),
    createRun: useMutation(m((body) => post(`${P}/runs`, body))),
    calculate: useMutation(m((id) => post(`${P}/runs/${id}/calculate`))),
    transition: useMutation(m(({ id, action, note }) => post(`${P}/runs/${id}/${action}`, { note }))),
    addAdjustment: useMutation(m(({ runId, ...body }) => post(`${P}/runs/${runId}/adjustments`, body))),
    removeAdjustment: useMutation(m(({ runId, id }) => del(`${P}/runs/${runId}/adjustments/${id}`))),
    importTds: useMutation(m(({ runId, rows }) => post(`${P}/runs/${runId}/tds-import`, { rows }))),
  };
}
