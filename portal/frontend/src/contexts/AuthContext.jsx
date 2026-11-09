import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { tokenStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, attempt a silent refresh to restore session from httpOnly cookie
  useEffect(() => {
    api.post('/auth/refresh')
      .then(({ data }) => {
        tokenStore.set(data.accessToken);
        return api.get('/auth/me');
      })
      .then(({ data }) => setUser(data))
      .catch(() => { /* no valid session */ })
      .finally(() => setLoading(false));
  }, []);

  // Listen for session expiry events from the axios interceptor
  useEffect(() => {
    const handle = () => setUser(null);
    window.addEventListener('app:session-expired', handle);
    return () => window.removeEventListener('app:session-expired', handle);
  }, []);

  const login = useCallback(async (username, password) => {
    let data;
    try {
      ({ data } = await api.post('/auth/login', { username, password }));
    } catch (err) {
      // Retry once on a transient network/proxy error (no HTTP response) such as a
      // dropped keep-alive socket. Real auth failures carry err.response and rethrow.
      if (err.response) throw err;
      ({ data } = await api.post('/auth/login', { username, password }));
    }
    tokenStore.set(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* best effort */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
