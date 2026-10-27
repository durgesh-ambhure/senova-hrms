import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, patch, post, upload } from '../../lib/api.js';

const R = '/recruitment';

export const useJobs = (params, enabled = true) => useQuery({ queryKey: ['recruitment', 'jobs', params], queryFn: () => api(`${R}/jobs`, { query: params }), placeholderData: keepPreviousData, enabled });
export const useJob = (id) => useQuery({ queryKey: ['recruitment', 'job', id], queryFn: () => get(`${R}/jobs/${id}`), enabled: Boolean(id) });
export const useCandidates = (params) => useQuery({ queryKey: ['recruitment', 'candidates', params], queryFn: () => api(`${R}/candidates`, { query: params }), placeholderData: keepPreviousData });
export const useCandidate = (id) => useQuery({ queryKey: ['recruitment', 'candidate', id], queryFn: () => get(`${R}/candidates/${id}`) });
export const useCandidateApplications = (id) => useQuery({ queryKey: ['recruitment', 'candidate-apps', id], queryFn: () => get(`${R}/candidates/${id}/applications`) });
export const useActivity = (id, enabled) => useQuery({ queryKey: ['recruitment', 'activity', id], queryFn: () => get(`${R}/candidates/${id}/activity`), enabled });
export const useApplications = (params, enabled = true) =>
  useQuery({ queryKey: ['recruitment', 'applications', params], queryFn: () => api(`${R}/applications`, { query: params }), placeholderData: keepPreviousData, enabled });
export const useInterviews = (params, enabled = true) => useQuery({ queryKey: ['recruitment', 'interviews', params], queryFn: () => get(`${R}/interviews`, params), enabled });
export const useInterviewers = (search, enabled = true) => useQuery({ queryKey: ['recruitment', 'interviewers', search], queryFn: () => get(`${R}/interviewers`, { search: search || undefined }), enabled });
export const useOffers = (params, enabled = true) => useQuery({ queryKey: ['recruitment', 'offers', params], queryFn: () => get(`${R}/offers`, params), enabled });

export const checkDuplicates = (params) => get(`${R}/candidates/duplicates`, params);

export function useRecruitmentMutations() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['recruitment'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const m = (mutationFn) => ({ mutationFn, onSuccess });
  return {
    createJob: useMutation(m((body) => post(`${R}/jobs`, body))),
    updateJob: useMutation(m(({ id, ...body }) => patch(`${R}/jobs/${id}`, body))),
    createCandidate: useMutation(m((body) => post(`${R}/candidates`, body))),
    updateCandidate: useMutation(m(({ id, ...body }) => patch(`${R}/candidates/${id}`, body))),
    addNote: useMutation(m(({ id, body }) => post(`${R}/candidates/${id}/notes`, { body }))),
    uploadFile: useMutation(m(({ id, form }) => upload(`${R}/candidates/${id}/files`, form))),
    apply: useMutation(m((body) => post(`${R}/applications`, body))),
    move: useMutation(m(({ id, ...body }) => post(`${R}/applications/${id}/move`, body))),
    schedule: useMutation(m((body) => post(`${R}/interviews`, body))),
    updateInterview: useMutation(m(({ id, ...body }) => patch(`${R}/interviews/${id}`, body))),
    feedback: useMutation(m(({ id, ...body }) => post(`${R}/interviews/${id}/feedback`, body))),
    createOffer: useMutation(m(({ applicationId, ...body }) => post(`${R}/applications/${applicationId}/offers`, body))),
    updateOffer: useMutation(m(({ id, ...body }) => patch(`${R}/offers/${id}`, body))),
    offerAction: useMutation(m(({ id, action, ...body }) => post(`${R}/offers/${id}/${action}`, body))),
    hire: useMutation(m(({ applicationId, ...body }) => post(`${R}/applications/${applicationId}/hire`, body))),
  };
}
