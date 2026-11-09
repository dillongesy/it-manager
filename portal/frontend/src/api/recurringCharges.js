import api from './client.js';

export const recurringChargesApi = {
  // Every active recurring charge across all customers (for the dashboard widget).
  active: () => api.get('/recurring-charges/active'),
};
