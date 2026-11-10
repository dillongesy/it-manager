import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Logo } from '../components/Logo.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { TwoFactorSetup } from '../components/auth/TwoFactorSetup.jsx';
import { mfaApi } from '../api/mfa.js';

// Sign-in: password, then (when two-factor authentication applies) a code from the
// authenticator app, or setting 2FA up when the administrator requires it.
export default function Login() {
  const branding = useBranding();
  const bg = branding.assets.login_background;
  const appName = [branding.companyName, branding.fieldAppName].filter(Boolean).join(' ');
  const [step, setStep] = useState('password');   // password | verify | enroll
  const [mfaToken, setMfaToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, completeSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/inventory';

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
      setError(err.response?.data?.error || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      completeSession(await mfaApi.verify(mfaToken, code));
      signedIn();
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.error || 'That code is not valid.';
      if (status === 429 || (status === 401 && /expired/i.test(message))) restart(message);
      else setError(message);
    } finally {
      setLoading(false);
    }
  };

  const ErrorBox = error && (
    <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">{error}</div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 px-4 py-8 bg-cover bg-center relative"
      style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>
      {bg && <div className="absolute inset-0 bg-black/45" aria-hidden="true" />}
      <div className="absolute z-10 top-3 right-3 safe-top">
        <ThemeToggle />
      </div>
      <div className={`w-full relative ${step === 'enroll' ? 'max-w-lg' : 'max-w-sm'}`}>
        <div className="flex flex-col items-center mb-8">
          <Logo variant="full" size={64} className="w-52 max-w-full mb-4" />
          <h1 className={`text-2xl font-bold tracking-tight ${bg ? 'text-white drop-shadow' : 'text-gray-100'}`}>{appName}</h1>
        </div>

        {step === 'password' && (
          <form onSubmit={submitPassword} className="card p-6 space-y-4">
            {ErrorBox}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Username</label>
              <input className="input" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" autoCorrect="off" autoFocus required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" required />
            </div>
            <button type="submit" disabled={loading || !username || !password} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={submitCode} className="card p-6 space-y-4">
            <h2 className="text-gray-100 font-semibold text-lg flex items-center gap-2"><ShieldCheck size={18} /> Two-factor authentication</h2>
            <p className="text-gray-400 text-sm">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
            {ErrorBox}
            <input className="input font-mono tracking-widest text-center text-lg" autoComplete="one-time-code" inputMode="text"
              autoFocus value={code} onChange={(e) => setCode(e.target.value)} required maxLength={14} aria-label="Code" />
            <button type="submit" disabled={loading || !code} className="btn-primary w-full">{loading ? 'Checking…' : 'Verify'}</button>
            <button type="button" className="btn-ghost w-full text-sm" onClick={() => restart()}>Back to sign in</button>
          </form>
        )}

        {step === 'enroll' && (
          <div className="card p-6 space-y-4">
            <h2 className="text-gray-100 font-semibold text-lg flex items-center gap-2"><ShieldCheck size={18} /> Set up two-factor authentication</h2>
            <p className="text-gray-400 text-sm">Your administrator requires two-factor authentication. Set it up now to continue.</p>
            <TwoFactorSetup
              appName={appName}
              start={() => mfaApi.enrollStart(mfaToken)}
              confirm={(c) => mfaApi.enrollConfirm(c, mfaToken)}
              onDone={(data) => { completeSession(data); signedIn(); }}
              doneLabel="Continue to the app"
            />
            <button type="button" className="btn-ghost w-full text-sm" onClick={() => restart()}>Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
