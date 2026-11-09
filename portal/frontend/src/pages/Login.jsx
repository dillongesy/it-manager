import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { Logo } from '../components/ui/Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { Eye, EyeOff, AlertCircle, Sun, Moon } from 'lucide-react';

export function Login() {
  const { login } = useAuth();
  const branding = useBranding();
  const bg = branding.assets.login_background;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4 bg-cover bg-center relative"
      style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>
      {bg && <div className="absolute inset-0 bg-black/45" aria-hidden="true" />}
      <button
        onClick={toggleTheme}
        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        className="absolute z-10 top-4 right-4 p-2 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-700 transition-colors"
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Logo variant="full" size={64} className="w-56 max-w-full mb-4" />
          <h1 className={`text-2xl font-bold tracking-tight ${bg ? 'text-white drop-shadow' : 'text-gray-100'}`}>{branding.productName}</h1>
          {branding.tagline && <p className={`text-sm mt-1 ${bg ? 'text-white/80' : 'text-gray-500'}`}>{branding.tagline}</p>}
        </div>

        {/* Card */}
        <div className="card p-6">
          <h2 className="text-gray-200 font-semibold text-lg mb-5">Sign in</h2>

          {error && (
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md px-3 py-2 text-sm mb-4">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Username
              </label>
              <input
                className="input"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder=""
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=""
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
