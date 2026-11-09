import api from './client.js';

export const orderLogApi = {
  list:        (params)        => api.get('/order-log', { params }),
  get:         (id)            => api.get(`/order-log/${id}`),
  create:      (data)          => api.post('/order-log', data),
  update:      (id, data)      => api.patch(`/order-log/${id}`, data),
  remove:      (id)            => api.delete(`/order-log/${id}`),
  suggestions: (field, q)      => api.get('/order-log/suggestions', { params: { field, q } }),

  // Receive an order's matching lines into shared inventory: preview, then run.
  inventoryPlan:  (id)         => api.get(`/order-log/${id}/inventory-plan`),
  addToInventory: (id, links)  => api.post(`/order-log/${id}/add-to-inventory`, { links }),

  attachments: {
    list:     (id)         => api.get(`/order-log/${id}/attachments`),
    upload:   (id, fd)     => api.post(`/order-log/${id}/attachments`, fd),
    download: (id, attId)  => api.get(`/order-log/${id}/attachments/${attId}/download`, { responseType: 'blob' }),
    view:     (id, attId)  => api.get(`/order-log/${id}/attachments/${attId}/download`, { params: { inline: 1 }, responseType: 'blob' }),
    remove:   (id, attId)  => api.delete(`/order-log/${id}/attachments/${attId}`),
  },
};
