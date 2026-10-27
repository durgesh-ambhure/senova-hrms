import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post } from '../../lib/api.js';

export const keys = {
  users: (params) => ['users', params],
  roles: ['roles'],
  permissions: ['roles', 'permissions'],
  company: ['company'],
  audit: (params) => ['audit-logs', params],
  dashboard: ['dashboard'],
};

const list = (path, params) => api(path, { query: params });

// Users
export const useUsers = (params) => useQuery({ queryKey: keys.users(params), queryFn: () => list('/users', params), placeholderData: keepPreviousData });

export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: keys.roles });
  };
  return {
    create: useMutation({ mutationFn: (body) => post('/users', body), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, ...body }) => patch(`/users/${id}`, body), onSuccess: invalidate }),
    resendInvite: useMutation({ mutationFn: (id) => post(`/users/${id}/resend-invite`) }),
    sendResetLink: useMutation({ mutationFn: (id) => post(`/users/${id}/send-reset-link`) }),
    revokeSessions: useMutation({ mutationFn: (id) => post(`/users/${id}/revoke-sessions`) }),
  };
}

// Roles
export const useRoles = (enabled = true) => useQuery({ queryKey: keys.roles, queryFn: () => get('/roles'), enabled });
export const usePermissionCatalog = () => useQuery({ queryKey: keys.permissions, queryFn: () => get('/roles/permissions'), staleTime: Infinity });

export function useRoleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.roles });
  return {
    create: useMutation({ mutationFn: (body) => post('/roles', body), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ key, ...body }) => patch(`/roles/${key}`, body), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (key) => del(`/roles/${key}`), onSuccess: invalidate }),
  };
}

// Company
export const useCompany = () => useQuery({ queryKey: keys.company, queryFn: () => get('/company') });
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => patch('/company', body), onSuccess: (data) => qc.setQueryData(keys.company, data) });
}

// Audit
export const useAuditLogs = (params) =>
  useQuery({ queryKey: keys.audit(params), queryFn: () => list('/audit-logs', params), placeholderData: keepPreviousData });

// Dashboard
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => get('/dashboard/summary') });
