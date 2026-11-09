import api from './client.js';

export const serviceCatalogApi = {
  list:   (params)   => api.get('/service-catalog', { params }),
  create: (data)     => api.post('/service-catalog', data),
  update: (id, data) => api.patch(`/service-catalog/${id}`, data),
  remove: (id)       => api.delete(`/service-catalog/${id}`),
  // Previously-entered values for a free-text field ('category' | 'unit_label'),
  // pooled across the catalog AND customer recurring charges.
  suggestions: (field, q) => api.get('/service-catalog/suggestions', { params: { field, q } }),
};
