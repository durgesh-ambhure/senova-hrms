import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '../../lib/api.js';

export const onboardingKeys = {
  templates: ['onboarding', 'templates'],
  overview: (params) => ['onboarding', 'overview', params],
  myTasks: ['onboarding', 'my-tasks'],
  employeeTasks: (id) => ['onboarding', 'employee', id],
};

export const useTemplates = (enabled = true) => useQuery({ queryKey: onboardingKeys.templates, queryFn: () => get('/onboarding/templates'), enabled });
export const useOverview = (params, enabled = true) => useQuery({ queryKey: onboardingKeys.overview(params), queryFn: () => get('/onboarding/overview', params), enabled });
export const useMyTasks = () => useQuery({ queryKey: onboardingKeys.myTasks, queryFn: () => get('/onboarding/my-tasks') });
export const useEmployeeTasks = (id, enabled = true) =>
  useQuery({ queryKey: onboardingKeys.employeeTasks(id), queryFn: () => get(`/onboarding/employees/${id}/tasks`), enabled: Boolean(id) && enabled });

export function useOnboardingMutations() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['onboarding'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    createTemplate: useMutation({ mutationFn: (body) => post('/onboarding/templates', body), onSuccess }),
    updateTemplate: useMutation({ mutationFn: ({ id, ...body }) => patch(`/onboarding/templates/${id}`, body), onSuccess }),
    start: useMutation({ mutationFn: ({ employeeId, templateId }) => post(`/onboarding/employees/${employeeId}/start`, { templateId }), onSuccess }),
    addTask: useMutation({ mutationFn: ({ employeeId, ...body }) => post(`/onboarding/employees/${employeeId}/tasks`, body), onSuccess }),
    complete: useMutation({ mutationFn: ({ id, note }) => post(`/onboarding/tasks/${id}/complete`, { note }), onSuccess }),
    waive: useMutation({ mutationFn: ({ id, note }) => post(`/onboarding/tasks/${id}/waive`, { note }), onSuccess }),
    reopen: useMutation({ mutationFn: ({ id, note }) => post(`/onboarding/tasks/${id}/reopen`, { note }), onSuccess }),
  };
}
