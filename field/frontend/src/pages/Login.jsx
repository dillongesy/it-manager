import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Logo } from '../components/Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

export default function Login() {
  const branding = useBranding();
  const bg = branding.assets.login_background;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/inventory';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 px-4 bg-cover bg-center relative"
      style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>
      {bg && <div className="absolute inset-0 bg-black/45" aria-hidden="true" />}
      <div className="absolute z-10 top-3 right-3 safe-top">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm relative">
        <div className="flex flex-col items-center mb-8">
          <Logo variant="full" size={64} className="w-52 max-w-full mb-4" />
          <h1 className={`text-2xl font-bold tracking-tight ${bg ? 'text-white drop-shadow' : 'text-gray-100'}`}>{branding.companyName} {branding.fieldAppName}</h1>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Username</label>
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" disabled={loading || !username || !password} className="btn-primary w-full">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
