import api from './client.js';

export const setupApi = {
  status:     () => api.get('/setup/status').then(r => r.data),
  verifyCode: (setupCode) => api.post('/setup/verify-code', { setupCode }).then(r => r.data),
  run:        (body) => api.post('/setup', body).then(r => r.data),
};

export const adminApi = {
  integrations:    () => api.get('/admin/integrations').then(r => r.data),
  saveIntegration: (id, body) => api.put(`/admin/integrations/${id}`, body).then(r => r.data),

  branding:     () => api.get('/admin/branding').then(r => r.data),
  saveBranding: (body) => api.put('/admin/branding', body).then(r => r.data),
  uploadAsset:  (kind, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/admin/branding/assets/${kind}`, fd).then(r => r.data);
  },
  deleteAsset:  (kind) => api.delete(`/admin/branding/assets/${kind}`).then(r => r.data),

  security: () => api.get('/admin/security').then(r => r.data),
  reveal:   (password) => api.post('/admin/security/reveal', { password }).then(r => r.data),
  saveMfaPolicy: (body) => api.put('/admin/security/mfa', body).then(r => r.data),

  host:          () => api.get('/admin/host').then(r => r.data),
  saveUpdates:   (schedule) => api.put('/admin/host/updates', { schedule }).then(r => r.data),
  updateNow:     () => api.post('/admin/host/update-now').then(r => r.data),

  system:  () => api.get('/admin/system').then(r => r.data),
  storage: () => api.get('/admin/storage').then(r => r.data),

  billingRates:     () => api.get('/admin/billing-rates').then(r => r.data),
  saveBillingRates: (body) => api.put('/admin/billing-rates', body).then(r => r.data),
};
