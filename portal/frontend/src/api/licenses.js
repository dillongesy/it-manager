import api from './client.js';

export const licensesApi = {
  // Non-auto-renewing licenses needing manual renewal, soonest expiration first.
  // Default matches the backend's; 50 was low enough to hide real renewals once
  // every customer has licenses.
  expiring: (limit) => api.get('/licenses/expiring', { params: { limit } }),
  // Auto-renewing subscriptions with their computed next renewal date, soonest first.
  renewals: (limit) => api.get('/licenses/renewals', { params: { limit } }),
};
