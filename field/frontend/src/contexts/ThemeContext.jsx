import { createContext, useContext, useEffect, useState } from 'react';

// Light/dark theme, persisted to localStorage and applied via a `.light` class on
// <html>. The Field app DEFAULTS to light (techs work outdoors in the sun). An inline
// script in index.html applies the saved theme before paint; this provider keeps it in
// sync and exposes a toggle.
const ThemeContext = createContext(null);
const STORAGE_KEY = 'app-field-theme';

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
