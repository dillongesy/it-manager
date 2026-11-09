import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use(cfg => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let refreshing = false, queue = [];

api.interceptors.response.use(r => r, async err => {
  const orig = err.config;
  if (err.response?.status !== 401 || orig._retried) return Promise.reject(err);
  if (orig.url === '/auth/refresh' || orig.url === '/auth/login') return Promise.reject(err);
  if (refreshing) return new Promise((res, rej) => queue.push({ res, rej, config: orig }));

  refreshing = true; orig._retried = true;
  try {
    const { data } = await api.post('/auth/refresh');
    tokenStore.set(data.accessToken);
    queue.forEach(({ res, config: c }) => { c.headers.Authorization = `Bearer ${data.accessToken}`; res(api(c)); });
    queue = [];
    orig.headers.Authorization = `Bearer ${data.accessToken}`;
    return api(orig);
  } catch {
    queue.forEach(({ rej }) => rej(new Error('Session expired.')));
    queue = []; tokenStore.clear();
    window.dispatchEvent(new CustomEvent('app:session-expired'));
    return Promise.reject(err);
  } finally { refreshing = false; }
});

export const tokenStore = { _t: null, get() { return this._t; }, set(t) { this._t = t; }, clear() { this._t = null; } };
export default api;
