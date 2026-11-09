import api from './client.js';

// Camera-side job captures, pulled from the Field App over the one-way bridge.
// Promote turns a capture into a real Portal work order for billing.
export const fieldJobsApi = {
  status:  ()              => api.get('/field-jobs/status'),
  list:    (params)        => api.get('/field-jobs', { params }),
  get:     (id)            => api.get(`/field-jobs/${id}`),
  photo:   (id, photoId)   => api.get(`/field-jobs/${id}/photos/${photoId}`, { responseType: 'blob' }),
  promote: (id, data)      => api.post(`/field-jobs/${id}/promote`, data),
};
