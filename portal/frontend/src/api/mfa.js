import api from './client.js';

// Two-factor authentication. Enrollment calls take an mfaToken while signing in
// (2FA required, not set up yet); signed-in users omit it.
export const mfaApi = {
  verify:        (mfaToken, code) => api.post('/auth/login/mfa', { mfaToken, code }).then(r => r.data),
  status:        () => api.get('/auth/mfa').then(r => r.data),
  enrollStart:   (mfaToken) => api.post('/auth/mfa/enroll/start', mfaToken ? { mfaToken } : {}).then(r => r.data),
  enrollConfirm: (code, mfaToken) => api.post('/auth/mfa/enroll/confirm', mfaToken ? { code, mfaToken } : { code }).then(r => r.data),
  recoveryCodes: (password) => api.post('/auth/mfa/recovery-codes', { password }).then(r => r.data),
  disable:       (password) => api.post('/auth/mfa/disable', { password }).then(r => r.data),
  resetUser:     (userId) => api.post(`/users/${userId}/mfa/reset`).then(r => r.data),
};
