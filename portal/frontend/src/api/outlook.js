import api from './client.js';

// The shared Outlook calendar (backend: routes/outlook.js). The list always answers
// { configured, events, error? }. Edits go straight to Outlook.
export const outlookApi = {
  events: (params)   => api.get('/outlook/events', { params }),
  get:    (id)       => api.get(`/outlook/events/${encodeURIComponent(id)}`),
  // { scope: 'occurrence' | 'series', etag, title, location, notes, show_as, assign_to,
  //   all_day + start/end (ISO) or start_date/end_date, or for a series start_time/end_time }
  update: (id, body) => api.patch(`/outlook/events/${encodeURIComponent(id)}`, body),
  // { title, all_day + start/end or start_date/end_date, repeat, reminder_minutes, assign_to, show_as, location, notes }
  create: (body)     => api.post('/outlook/events', body),
  // scope: 'occurrence' (just this one) | 'following' (this and later) | 'series' (all)
  remove: (id, { scope, etag } = {}) => api.delete(`/outlook/events/${encodeURIComponent(id)}`, { params: { scope, etag } }),
};
