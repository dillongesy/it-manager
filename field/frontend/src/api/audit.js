import api from './client.js';

export const auditApi = {
  list: (params) => api.get('/audit', { params }),
};
