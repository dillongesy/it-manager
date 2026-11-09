import api from './client.js';

// Field "work orders" are job captures. Billing happens in the Portal, which pulls
// 'ready' captures over the bridge. The only state changes here are ready/reopen.
export const fieldWOApi = {
  list:    (params)       => api.get('/work-orders', { params }),
  stats:   ()             => api.get('/work-orders/stats'),
  get:     (id)           => api.get(`/work-orders/${id}`),
  create:  (data)         => api.post('/work-orders', data),
  update:  (id, data)     => api.patch(`/work-orders/${id}`, data),
  remove:  (id)           => api.delete(`/work-orders/${id}`),
  ready:   (id)           => api.post(`/work-orders/${id}/ready`),
  reopen:  (id)           => api.post(`/work-orders/${id}/reopen`),
};

export const photosApi = {
  list:   (params)       => api.get('/photos', { params }),
  upload: (formData)     => api.post('/photos', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  view:   (id)           => `/api/photos/${id}/view`,
  remove: (id)           => api.delete(`/photos/${id}`),
};
