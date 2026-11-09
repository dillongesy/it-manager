import api from './client.js';

// Tasks — the internal task list (replaced the Backlog and customer To-Dos). Backend: routes/tasks.js.
export const tasksApi = {
  list:          (params)           => api.get('/tasks', { params }),
  summary:       ()                 => api.get('/tasks/summary'),
  get:           (id)               => api.get(`/tasks/${id}`),
  create:        (data)             => api.post('/tasks', data),
  update:        (id, data)         => api.patch(`/tasks/${id}`, data),
  remove:        (id)               => api.delete(`/tasks/${id}`),
  reorder:       (ids)              => api.post('/tasks/reorder', { ids }),
  comment:       (id, body)         => api.post(`/tasks/${id}/comments`, { body }),
  removeComment: (id, eventId)      => api.delete(`/tasks/${id}/comments/${eventId}`),
  linkWorkOrder: (id, workOrderId)  => api.post(`/tasks/${id}/work-orders`, { work_order_id: workOrderId }),
  // "Add to Outlook": the task as an all-day event on the shared calendar, kept in step with it.
  addToOutlook:      (id)           => api.post(`/tasks/${id}/outlook`),
  removeFromOutlook: (id)           => api.delete(`/tasks/${id}/outlook`),
};
