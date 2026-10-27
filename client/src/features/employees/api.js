import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post, put, upload } from '../../lib/api.js';

export const employeeKeys = {
  list: (params) => ['employees', 'list', params],
  detail: (id) => ['employees', 'detail', id],
  me: ['employees', 'me'],
  history: (id) => ['employees', 'history', id],
  sensitive: (id, reveal) => ['employees', 'sensitive', id, reveal],
  documents: (id) => ['documents', id],
  departments: ['departments'],
  designations: ['designations'],
};

// Organization lists (readable by everyone signed in)
export const useDepartments = (includeArchived = false) =>
  useQuery({ queryKey: [...employeeKeys.departments, includeArchived], queryFn: () => get('/departments', { includeArchived: includeArchived || undefined }) });
export const useDesignations = (includeArchived = false) =>
  useQuery({ queryKey: [...employeeKeys.designations, includeArchived], queryFn: () => get('/designations', { includeArchived: includeArchived || undefined }) });

export function useOrgMutations(kind) {
  const qc = useQueryClient();
  const base = kind === 'department' ? '/departments' : '/designations';
  const onSuccess = () => qc.invalidateQueries({ queryKey: kind === 'department' ? employeeKeys.departments : employeeKeys.designations });
  return {
    create: useMutation({ mutationFn: (body) => post(base, body), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...body }) => patch(`${base}/${id}`, body), onSuccess }),
  };
}

// Employees
export const useEmployees = (params, enabled = true) =>
  useQuery({ queryKey: employeeKeys.list(params), queryFn: () => api('/employees', { query: params }), placeholderData: keepPreviousData, enabled });

export const useEmployee = (id) => useQuery({ queryKey: employeeKeys.detail(id), queryFn: () => get(`/employees/${id}`), enabled: Boolean(id) });
export const useMyEmployee = () => useQuery({ queryKey: employeeKeys.me, queryFn: () => get('/employees/me') });
export const useEmployeeHistory = (id, enabled) => useQuery({ queryKey: employeeKeys.history(id), queryFn: () => get(`/employees/${id}/history`), enabled });
export const useSensitive = (id, reveal, enabled) =>
  useQuery({ queryKey: employeeKeys.sensitive(id, reveal), queryFn: () => get(`/employees/${id}/sensitive`, { reveal: reveal || undefined }), enabled, staleTime: 0, gcTime: 0 });

export function useEmployeeMutations(id) {
  const qc = useQueryClient();
  const refresh = (data) => {
    qc.invalidateQueries({ queryKey: ['employees'] });
    if (data?.id) qc.setQueryData(employeeKeys.detail(data.id), data);
  };
  return {
    create: useMutation({ mutationFn: (body) => post('/employees', body), onSuccess: refresh }),
    update: useMutation({ mutationFn: (body) => patch(`/employees/${id}`, body), onSuccess: refresh }),
    updateSelf: useMutation({ mutationFn: (body) => patch('/employees/me', body), onSuccess: refresh }),
    lifecycle: useMutation({ mutationFn: (body) => post(`/employees/${id}/lifecycle`, body), onSuccess: refresh }),
    probation: useMutation({ mutationFn: (body) => post(`/employees/${id}/probation`, body), onSuccess: refresh }),
    archive: useMutation({ mutationFn: () => post(`/employees/${id}/archive`), onSuccess: refresh }),
    restore: useMutation({ mutationFn: () => post(`/employees/${id}/restore`), onSuccess: refresh }),
    createAccount: useMutation({ mutationFn: () => post(`/employees/${id}/account`), onSuccess: () => qc.invalidateQueries({ queryKey: employeeKeys.detail(id) }) }),
    updateSensitive: useMutation({ mutationFn: (body) => put(`/employees/${id}/sensitive`, body), onSuccess: () => qc.removeQueries({ queryKey: ['employees', 'sensitive', id] }) }),
  };
}

// Documents
export const useDocuments = (employeeId) => useQuery({ queryKey: employeeKeys.documents(employeeId), queryFn: () => get('/documents', { employee: employeeId }), enabled: Boolean(employeeId) });

export function useDocumentMutations(employeeId) {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: employeeKeys.documents(employeeId) });
    qc.invalidateQueries({ queryKey: ['onboarding'] });
  };
  return {
    upload: useMutation({ mutationFn: (formData) => upload('/documents', formData), onSuccess }),
    review: useMutation({ mutationFn: ({ id, ...body }) => post(`/documents/${id}/review`, body), onSuccess }),
    remove: useMutation({ mutationFn: (id) => del(`/documents/${id}`), onSuccess }),
  };
}
