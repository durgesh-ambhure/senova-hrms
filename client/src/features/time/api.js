import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post, put } from '../../lib/api.js';

/** Data hooks for attendance, shifts, holidays, policies, leave and timesheets. */

const invalidator = (qc, ...roots) => () => {
  for (const root of roots) qc.invalidateQueries({ queryKey: [root] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
};

// Attendance
export const useMyToday = () => useQuery({ queryKey: ['attendance', 'today'], queryFn: () => get('/attendance/me/today'), refetchInterval: 60_000 });
export const useMonthlySummary = (params, enabled = true) =>
  useQuery({ queryKey: ['attendance', 'summary', params], queryFn: () => get('/attendance/summary', params), enabled, placeholderData: keepPreviousData });
export const useTeamToday = (enabled = true) => useQuery({ queryKey: ['attendance', 'team-today'], queryFn: () => get('/attendance/team/today'), enabled, refetchInterval: 120_000 });
export const useCorrections = (params, enabled = true) => useQuery({ queryKey: ['attendance', 'corrections', params], queryFn: () => get('/attendance/corrections', params), enabled });

export function useAttendanceMutations() {
  const qc = useQueryClient();
  const onSuccess = invalidator(qc, 'attendance');
  return {
    checkIn: useMutation({ mutationFn: () => post('/attendance/check-in'), onSuccess }),
    checkOut: useMutation({ mutationFn: () => post('/attendance/check-out'), onSuccess }),
    startBreak: useMutation({ mutationFn: () => post('/attendance/breaks/start'), onSuccess }),
    endBreak: useMutation({ mutationFn: () => post('/attendance/breaks/end'), onSuccess }),
    requestCorrection: useMutation({ mutationFn: (body) => post('/attendance/corrections', body), onSuccess }),
    reviewCorrection: useMutation({ mutationFn: ({ id, ...body }) => post(`/attendance/corrections/${id}/review`, body), onSuccess }),
    cancelCorrection: useMutation({ mutationFn: (id) => post(`/attendance/corrections/${id}/cancel`), onSuccess }),
  };
}

// Shifts, holidays and policies
export const useShifts = (includeArchived = false) => useQuery({ queryKey: ['shifts', includeArchived], queryFn: () => get('/shifts', { includeArchived: includeArchived || undefined }) });
export function useShiftMutations() {
  const qc = useQueryClient();
  const onSuccess = invalidator(qc, 'shifts');
  return {
    create: useMutation({ mutationFn: (body) => post('/shifts', body), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...body }) => patch(`/shifts/${id}`, body), onSuccess }),
  };
}

export const useHolidays = (year) => useQuery({ queryKey: ['holidays', year], queryFn: () => get('/holidays', { year }) });
export function useHolidayMutations() {
  const qc = useQueryClient();
  const onSuccess = invalidator(qc, 'holidays', 'attendance');
  return {
    create: useMutation({ mutationFn: (body) => post('/holidays', body), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...body }) => patch(`/holidays/${id}`, body), onSuccess }),
    remove: useMutation({ mutationFn: (id) => del(`/holidays/${id}`), onSuccess }),
  };
}

export function useUpdatePolicies() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => patch('/company/policies', body), onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }) });
}

// Leave
export const useLeaveTypes = (includeArchived = false) => useQuery({ queryKey: ['leave', 'types', includeArchived], queryFn: () => get('/leave/types', { includeArchived: includeArchived || undefined }) });
export const useBalances = (params, enabled = true) => useQuery({ queryKey: ['leave', 'balances', params], queryFn: () => get('/leave/balances', params), enabled });
export const useLeaveRequests = (params, enabled = true) =>
  useQuery({ queryKey: ['leave', 'requests', params], queryFn: () => api('/leave/requests', { query: params }), enabled, placeholderData: keepPreviousData });

export function useLeaveMutations() {
  const qc = useQueryClient();
  const onSuccess = invalidator(qc, 'leave', 'attendance');
  return {
    createType: useMutation({ mutationFn: (body) => post('/leave/types', body), onSuccess }),
    updateType: useMutation({ mutationFn: ({ id, ...body }) => patch(`/leave/types/${id}`, body), onSuccess }),
    preview: useMutation({ mutationFn: (body) => post('/leave/requests/preview', body) }),
    apply: useMutation({ mutationFn: (body) => post('/leave/requests', body), onSuccess }),
    decide: useMutation({ mutationFn: ({ id, ...body }) => post(`/leave/requests/${id}/decision`, body), onSuccess }),
    cancel: useMutation({ mutationFn: ({ id, reason }) => post(`/leave/requests/${id}/cancel`, { reason }), onSuccess }),
    decideCancellation: useMutation({ mutationFn: ({ id, ...body }) => post(`/leave/requests/${id}/cancellation-decision`, body), onSuccess }),
    adjust: useMutation({ mutationFn: (body) => post('/leave/balances/adjust', body), onSuccess }),
  };
}

// Timesheets
export const useProjects = (includeArchived = false) => useQuery({ queryKey: ['timesheets', 'projects', includeArchived], queryFn: () => get('/timesheets/projects', { includeArchived: includeArchived || undefined }) });
export const useMyWeek = (weekStart) => useQuery({ queryKey: ['timesheets', 'mine', weekStart], queryFn: () => get(`/timesheets/mine/${weekStart}`) });
export const useTimesheets = (params, enabled = true) =>
  useQuery({ queryKey: ['timesheets', 'list', params], queryFn: () => api('/timesheets', { query: params }), enabled, placeholderData: keepPreviousData });
export const useTimesheetReport = (params, enabled = true) => useQuery({ queryKey: ['timesheets', 'report', params], queryFn: () => get('/timesheets/report', params), enabled });

export function useTimesheetMutations() {
  const qc = useQueryClient();
  const onSuccess = invalidator(qc, 'timesheets');
  return {
    save: useMutation({ mutationFn: ({ weekStart, entries }) => put(`/timesheets/mine/${weekStart}`, { entries }), onSuccess }),
    submit: useMutation({ mutationFn: (weekStart) => post(`/timesheets/mine/${weekStart}/submit`), onSuccess }),
    decide: useMutation({ mutationFn: ({ id, ...body }) => post(`/timesheets/${id}/decision`, body), onSuccess }),
    createProject: useMutation({ mutationFn: (body) => post('/timesheets/projects', body), onSuccess }),
    updateProject: useMutation({ mutationFn: ({ id, ...body }) => patch(`/timesheets/projects/${id}`, body), onSuccess }),
  };
}
