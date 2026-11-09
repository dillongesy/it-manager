import api from './client.js';

// Shared inventory — served by the Portal backend, which bridges to the Field App.
export const inventoryApi = {
  status:     ()         => api.get('/inventory/status'),
  list:       (params)   => api.get('/inventory', { params }),
  categories: ()         => api.get('/inventory/categories'),
  get:        (id)       => api.get(`/inventory/${id}`),
  create:     (data)     => api.post('/inventory', data),
  update:     (id, data) => api.patch(`/inventory/${id}`, data),
  receive:    (id, data) => api.post(`/inventory/${id}/receive`, data),
  adjust:     (id, data) => api.post(`/inventory/${id}/adjust`, data),
  checkout:   (id, data) => api.post(`/inventory/${id}/checkout`, data),
  remove:     (id)       => api.delete(`/inventory/${id}`),
};
