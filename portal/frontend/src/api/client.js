import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Attach access token from memory to every request
api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, try a silent token refresh then retry the original request once
let isRefreshing = false;
let refreshQueue = [];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status !== 401 || original._retried) {
      return Promise.reject(error);
    }

    if (original.url === '/auth/refresh' || original.url === '/auth/login') {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject, config: original });
      });
    }

    isRefreshing = true;
    original._retried = true;

    try {
      const { data } = await api.post('/auth/refresh');
      tokenStore.set(data.accessToken);

      refreshQueue.forEach(({ resolve, config }) => {
        config.headers.Authorization = `Bearer ${data.accessToken}`;
        resolve(api(config));
      });
      refreshQueue = [];

      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch {
      refreshQueue.forEach(({ reject }) => reject(new Error('Session expired.')));
      refreshQueue = [];
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent('app:session-expired'));
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  }
);

// In-memory token store — never touches localStorage
export const tokenStore = {
  _token: null,
  get() { return this._token; },
  set(t) { this._token = t; },
  clear() { this._token = null; },
};

export default api;
