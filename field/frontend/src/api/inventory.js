import api from './client.js';

export const inventoryApi = {
  list:       (params)       => api.get('/inventory', { params }),
  categories: ()             => api.get('/inventory/categories'),
  barcode:    (code)         => api.get(`/inventory/barcode/${encodeURIComponent(code)}`),
  get:        (id)           => api.get(`/inventory/${id}`),
  create:     (data)         => api.post('/inventory', data),
  update:     (id, data)     => api.patch(`/inventory/${id}`, data),
  receive:    (id, data)     => api.post(`/inventory/${id}/receive`, data),
  checkout:   (id, data)     => api.post(`/inventory/${id}/checkout`, data),
  adjust:     (id, data)     => api.post(`/inventory/${id}/adjust`, data),
  remove:     (id)           => api.delete(`/inventory/${id}`),
};
