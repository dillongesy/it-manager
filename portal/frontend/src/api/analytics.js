import api from './client.js';

export const analyticsApi = {
  // Weekly trends (last 8 weeks) + status snapshot, each with company + personal series.
  get: () => api.get('/analytics'),
};
