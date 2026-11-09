import api from './client.js';

export const usersApi = {
  list:           (params)       => api.get('/users', { params }),
  create:         (data)         => api.post('/users', data),
  update:         (id, data)     => api.patch(`/users/${id}`, data),
  changePassword: (current_password, new_password) =>
    api.post('/users/me/password', { current_password, new_password }),
};
