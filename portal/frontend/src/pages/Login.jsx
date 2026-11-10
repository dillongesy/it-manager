import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { Logo } from '../components/ui/Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { TwoFactorSetup } from '../components/auth/TwoFactorSetup.jsx';
import { mfaApi } from '../api/mfa.js';
import { Eye, EyeOff, AlertCircle, Sun, Moon, ShieldCheck } from 'lucide-react';

// Sign-in: password, then (when two-factor authentication applies) a code from the
// authenticator app, or setting 2FA up when the administrator requires it.
export function Login() {
  const { login, completeSession } = useAuth();
  const branding = useBranding();
  const bg = branding.assets.login_background;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname ?? '/';

  const [step, setStep]         = useState('password');   // password | verify | enroll
  const [mfaToken, setMfaToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const signedIn = () => navigate(from, { replace: true });
  const restart = (message) => { setStep('password'); setCode(''); setMfaToken(''); setError(message ?? ''); };

  const submitPassword = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (result.mfa) {
        setMfaToken(result.mfaToken);
        setStep(result.mfa);
        setPassword('');
      } else {
        signedIn();
      }
    } catch (err) {
      setError(err.response?.data?.error ?? 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await mfaApi.verify(mfaToken, code);
      completeSession(data);
      signedIn();
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.error ?? 'That code is not valid.';
      if (status === 429 || (status === 401 && /expired/i.test(message))) restart(message);
      else setError(message);
    } finally {
      setLoading(false);
    }
  };

  const ErrorBox = error && (
    <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md px-3 py-2 text-sm mb-4">
      <AlertCircle size={15} className="shrink-0" />
      {error}
    </div>
  );

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
      <div className={`w-full relative ${step === 'enroll' ? 'max-w-lg' : 'max-w-sm'}`}>
        <div className="flex flex-col items-center mb-8">
          <Logo variant="full" size={64} className="w-56 max-w-full mb-4" />
          <h1 className={`text-2xl font-bold tracking-tight ${bg ? 'text-white drop-shadow' : 'text-gray-100'}`}>{branding.productName}</h1>
          {branding.tagline && <p className={`text-sm mt-1 ${bg ? 'text-white/80' : 'text-gray-500'}`}>{branding.tagline}</p>}
        </div>

        <div className="card p-6">
          {step === 'password' && (
            <>
              <h2 className="text-gray-200 font-semibold text-lg mb-5">Sign in</h2>
              {ErrorBox}
              <form onSubmit={submitPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Username</label>
                  <input className="input" type="text" autoComplete="username" autoFocus
                    value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
                  <div className="relative">
                    <input className="input pr-10" type={showPass ? 'text' : 'password'} autoComplete="current-password"
                      value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading || !username || !password}
                  className="btn-primary w-full mt-2 flex items-center justify-center gap-2">
                  {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          {step === 'verify' && (
            <>
              <h2 className="text-gray-200 font-semibold text-lg mb-2 flex items-center gap-2"><ShieldCheck size={18} /> Two-factor authentication</h2>
              <p className="text-gray-400 text-sm mb-5">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
              {ErrorBox}
              <form onSubmit={submitCode} className="space-y-4">
                <input className="input font-mono tracking-widest text-center text-lg" autoComplete="one-time-code" autoFocus
                  value={code} onChange={(e) => setCode(e.target.value)} required maxLength={14} aria-label="Code" />
                <button type="submit" disabled={loading || !code} className="btn-primary w-full">
                  {loading ? 'Checking…' : 'Verify'}
                </button>
                <button type="button" className="btn-ghost w-full text-sm" onClick={() => restart()}>Back to sign in</button>
              </form>
            </>
          )}

          {step === 'enroll' && (
            <>
              <h2 className="text-gray-200 font-semibold text-lg mb-2 flex items-center gap-2"><ShieldCheck size={18} /> Set up two-factor authentication</h2>
              <p className="text-gray-400 text-sm mb-5">Your administrator requires two-factor authentication. Set it up now to continue.</p>
              <TwoFactorSetup
                appName={branding.productName}
                start={() => mfaApi.enrollStart(mfaToken)}
                confirm={(c) => mfaApi.enrollConfirm(c, mfaToken)}
                onDone={(data) => { completeSession(data); signedIn(); }}
                doneLabel="Continue to the app"
              />
              <button type="button" className="btn-ghost w-full text-sm mt-3" onClick={() => restart()}>Back to sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
