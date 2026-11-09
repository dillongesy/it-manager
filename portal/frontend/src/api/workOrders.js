import api from './client.js';

export const workOrdersApi = {
  list:    (params)       => api.get('/work-orders', { params }),
  stats:   ()             => api.get('/work-orders/stats'),
  // Count + dollar total per billing status across EVERY work order, so the
  // Billing Queue's summary cards don't depend on how many rows are loaded.
  queueSummary: ()        => api.get('/work-orders/queue-summary'),
  get:     (id)           => api.get(`/work-orders/${id}`),
  create:  (data)         => api.post('/work-orders', data),
  update:  (id, data)     => api.patch(`/work-orders/${id}`, data),
  remove:  (id)           => api.delete(`/work-orders/${id}`),
  submit:  (id)           => api.post(`/work-orders/${id}/submit`),
  resolveFollowup: (id)   => api.post(`/work-orders/${id}/resolve-followup`),
  invoice: (id)           => api.post(`/work-orders/${id}/invoice`),
  pay:     (id)           => api.post(`/work-orders/${id}/pay`),
  revertInvoice: (id)     => api.post(`/work-orders/${id}/revert-invoice`),
  revertPay:     (id)     => api.post(`/work-orders/${id}/revert-pay`),
  // Void a Pending Billing WO - out of the Billing Queue, kept on the Work Orders
  // list. `return_inventory` decides whether its linked parts go back on the shelf.
  void:    (id, { return_inventory = false, reason = '' } = {}) =>
    api.post(`/work-orders/${id}/void`, { return_inventory, reason }),
  unvoid:  (id)           => api.post(`/work-orders/${id}/unvoid`),
  setPrintedSubmitted: (id, value) => api.post(`/work-orders/${id}/printed-submitted`, { printed_submitted: value }),

  sections: {
    add:    (id, data)            => api.post(`/work-orders/${id}/sections`, data),
    update: (id, sectionId, data) => api.patch(`/work-orders/${id}/sections/${sectionId}`, data),
    remove: (id, sectionId)       => api.delete(`/work-orders/${id}/sections/${sectionId}`),
    addItem:    (id, sectionId, data) => api.post(`/work-orders/${id}/sections/${sectionId}/items`, data),
    addService: (id, sectionId, data) => api.post(`/work-orders/${id}/sections/${sectionId}/services`, data),
  },

  items: {
    update: (id, itemId, data)  => api.patch(`/work-orders/${id}/items/${itemId}`, data),
    remove: (id, itemId)        => api.delete(`/work-orders/${id}/items/${itemId}`),
  },

  services: {
    update: (id, serviceId, data) => api.patch(`/work-orders/${id}/services/${serviceId}`, data),
    remove: (id, serviceId)       => api.delete(`/work-orders/${id}/services/${serviceId}`),
  },

  woProposals: {
    create: (id, data)        => api.post(`/work-orders/${id}/wo-proposals`, data),
    update: (id, propId, data) => api.patch(`/work-orders/${id}/wo-proposals/${propId}`, data),
    remove: (id, propId)       => api.delete(`/work-orders/${id}/wo-proposals/${propId}`),
  },
};
