import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { tokenStore } from '../api/client.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.post('/auth/refresh')
      .then(({ data }) => { tokenStore.set(data.accessToken); return api.get('/auth/me'); })
      .then(({ data }) => setUser(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('app:session-expired', h);
    return () => window.removeEventListener('app:session-expired', h);
  }, []);

  /** Finish signing in with a session from /auth/login, the 2FA step or 2FA enrollment. */
  const completeSession = useCallback((data) => {
    tokenStore.set(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  /**
   * Password step. Resolves to { user } when signed in, or { mfa, mfaToken } when a
   * second step is needed: mfa = 'verify' (enter a code) or 'enroll' (set up 2FA first).
   */
  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    if (data.mfa) return { mfa: data.mfa, mfaToken: data.mfaToken };
    return { user: completeSession(data) };
  }, [completeSession]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    tokenStore.clear(); setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, completeSession, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
