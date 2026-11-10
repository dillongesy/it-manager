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
    let data;
    try {
      ({ data } = await api.post('/auth/login', { username, password }));
    } catch (err) {
      // Retry once on a transient network/proxy error (no HTTP response) such as a
      // dropped keep-alive socket. Real auth failures carry err.response and rethrow.
      if (err.response) throw err;
      ({ data } = await api.post('/auth/login', { username, password }));
    }
    if (data.mfa) return { mfa: data.mfa, mfaToken: data.mfaToken };
    return { user: completeSession(data) };
  }, [completeSession]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* best effort */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, completeSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
