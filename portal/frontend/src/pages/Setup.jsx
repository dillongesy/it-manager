import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, KeyRound, Building2, UserCog } from 'lucide-react';
import { setupApi } from '../api/admin.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { Logo } from '../components/ui/Logo.jsx';
import { RevealSecrets } from '../components/admin/RevealSecrets.jsx';

// First-run wizard: claim the install (setup code from install.sh), name it, create
// the first admin (also created on the Field App), then the one-time secrets reveal.

function Step({ n, label, active, done }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${active ? 'text-gray-100' : 'text-gray-500'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold
        ${done ? 'bg-green-800 text-green-300' : active ? 'bg-brand text-on-brand' : 'bg-surface-600'}`}>
        {done ? <CheckCircle2 size={14} /> : n}
      </span>
      {label}
    </div>
  );
}

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-sm font-medium text-gray-400 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-gray-600 text-xs mt-1">{hint}</p>}
  </div>
);

export function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { login } = useAuth();
  const branding = useBranding();
  const { data: status, isLoading } = useQuery({ queryKey: ['setup', 'status'], queryFn: setupApi.status });

  const [step, setStep] = useState('account');       // account → secrets
  const [form, setForm] = useState({
    setupCode: '', companyName: '', productName: branding.productName || 'IT Manager',
    full_name: '', username: '', email: '', password: '', confirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldNote, setFieldNote] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (isLoading) return <div className="min-h-screen bg-surface-900" />;
  if (step === 'account' && status && !status.needsSetup) return <Navigate to="/login" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (form.password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    setBusy(true);
    try {
      const result = await setupApi.run({
        setupCode: form.setupCode,
        companyName: form.companyName,
        productName: form.productName,
        admin: { full_name: form.full_name, username: form.username, email: form.email, password: form.password },
      });
      if (result.field && !result.field.ok && !result.field.skipped) setFieldNote(result.field.error || 'unknown error');
      await login(form.username.trim().toLowerCase(), form.password);
      qc.invalidateQueries({ queryKey: ['branding'] });
      qc.setQueryData(['setup', 'status'], { ...status, needsSetup: false });
      setForm(f => ({ ...f, password: '', confirm: '', setupCode: '' }));
      setStep('secrets');
    } catch (err) {
      setError(err.response?.data?.error ?? 'Setup failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-surface-900 flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={40} />
          <div>
            <h1 className="text-gray-100 text-xl font-bold">Welcome — let's set up this server</h1>
            <p className="text-gray-500 text-sm">This page only appears once, on a brand-new install.</p>
          </div>
        </div>

        <div className="flex gap-6 mb-5">
          <Step n={1} label="Company & admin" active={step === 'account'} done={step !== 'account'} />
          <Step n={2} label="Recovery secrets" active={step === 'secrets'} />
        </div>

        <div className="card p-6">
          {step === 'account' && (
            <form onSubmit={submit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md px-3 py-2 text-sm">
                  <AlertCircle size={15} className="shrink-0" /> {error}
                </div>
              )}

              {status?.setupCodeRequired && (
                <section className="space-y-3">
                  <h2 className="text-gray-200 font-semibold flex items-center gap-2"><KeyRound size={16} /> Setup code</h2>
                  <Field label="Setup code" hint="Printed by install.sh. Lost it? On the server run: ./scripts/show-setup-code.sh">
                    <input className="input font-mono uppercase tracking-widest" value={form.setupCode} onChange={set('setupCode')}
                      required autoComplete="off" placeholder="XXXX-XXXX-XXXX" />
                  </Field>
                </section>
              )}

              <section className="space-y-3">
                <h2 className="text-gray-200 font-semibold flex items-center gap-2"><Building2 size={16} /> Your company</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Company name">
                    <input className="input" value={form.companyName} onChange={set('companyName')} required placeholder="Acme IT Services" />
                  </Field>
                  <Field label="App name" hint="Shown in the header and browser tab.">
                    <input className="input" value={form.productName} onChange={set('productName')} required />
                  </Field>
                </div>
                <p className="text-gray-600 text-xs">Logo, colors and the rest of the branding are in Admin → Branding afterwards.</p>
              </section>

              <section className="space-y-3">
                <h2 className="text-gray-200 font-semibold flex items-center gap-2"><UserCog size={16} /> First admin account</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Full name"><input className="input" value={form.full_name} onChange={set('full_name')} required /></Field>
                  <Field label="Username"><input className="input" value={form.username} onChange={set('username')} required autoComplete="username" /></Field>
                </div>
                <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Password" hint="At least 12 characters.">
                    <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={12} autoComplete="new-password" />
                  </Field>
                  <Field label="Confirm password">
                    <input className="input" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
                  </Field>
                </div>
                <p className="text-gray-600 text-xs">The same login is created on the Field App.</p>
              </section>

              <div className="flex justify-end">
                <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Setting up…' : 'Create admin & continue'}</button>
              </div>
            </form>
          )}

          {step === 'secrets' && (
            <div className="space-y-4">
              {fieldNote && (
                <p className="text-amber-400 text-sm bg-amber-900/30 rounded-sm p-2">
                  The Field App admin could not be created automatically ({fieldNote}). You can retry later from Admin → System.
                </p>
              )}
              <h2 className="text-gray-200 font-semibold">Save your recovery secrets</h2>
              <RevealSecrets onDone={() => navigate('/admin', { replace: true })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
