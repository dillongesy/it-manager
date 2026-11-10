import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, XCircle, Loader2, KeyRound, Building2, UserCog, Server,
  ShieldCheck, Globe, Download, ArrowRight,
} from 'lucide-react';
import { setupApi } from '../api/admin.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBranding } from '../contexts/BrandingContext.jsx';
import { Logo } from '../components/ui/Logo.jsx';
import { RevealSecrets } from '../components/admin/RevealSecrets.jsx';

// First-run setup wizard. Shown only on a new install, before any user exists.
//
//   start    services come up (live status, polled)
//   verify   setup code from the Portal API log
//   account  company and first admin
//   apply    the setup steps, with their results
//   secrets  one-time recovery secrets
//   finish   trust the certificate and publish the Field App

const STEPS = [
  { id: 'start', label: 'Start-up' },
  { id: 'verify', label: 'Verify' },
  { id: 'account', label: 'Company & admin' },
  { id: 'secrets', label: 'Recovery secrets' },
  { id: 'finish', label: 'Finish' },
];
const stepIndex = (id) => STEPS.findIndex(s => s.id === (id === 'apply' ? 'account' : id));

function StepBar({ current }) {
  const at = stepIndex(current);
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 mb-5">
      {STEPS.map((s, i) => (
        <li key={s.id} className={`flex items-center gap-2 text-sm ${i === at ? 'text-gray-100' : 'text-gray-500'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold
            ${i < at ? 'bg-green-800 text-green-300' : i === at ? 'bg-brand text-on-brand' : 'bg-surface-600'}`}>
            {i < at ? <CheckCircle2 size={14} /> : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** One line of a progress list: pending (spinner), ok, failed or waiting. */
function ProgressItem({ state, label, detail }) {
  const icon = {
    pending: <Loader2 size={16} className="animate-spin text-gray-400" />,
    ok: <CheckCircle2 size={16} className="text-green-400" />,
    failed: <XCircle size={16} className="text-red-400" />,
    waiting: <Loader2 size={16} className="animate-spin text-amber-400" />,
  }[state];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className={state === 'failed' ? 'text-red-300' : 'text-gray-200'}>{label}</span>
        {detail && <span className="block text-xs text-gray-500">{detail}</span>}
      </span>
    </li>
  );
}

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-sm font-medium text-gray-400 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-gray-500 text-xs mt-1">{hint}</p>}
  </div>
);

const ErrorBox = ({ children }) => (
  <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 rounded-md px-3 py-2 text-sm">
    <AlertCircle size={15} className="shrink-0" /> {children}
  </div>
);

// --- Step 1: services start ----------------------------------------------------

function StartStep({ status, error, onContinue }) {
  const portalUp = Boolean(status);
  const field = status?.services?.field;
  const fieldUp = Boolean(field?.reachable);

  useEffect(() => {
    if (portalUp && fieldUp) onContinue();
  }, [portalUp, fieldUp]); // eslint-disable-line react-hooks/exhaustive-deps

  let fieldState = 'pending';
  let fieldDetail = 'Waiting for the Portal first.';
  if (portalUp) {
    if (fieldUp) { fieldState = 'ok'; fieldDetail = null; }
    else if (field && !field.configured) { fieldState = 'failed'; fieldDetail = 'The Field App connection is not configured on this server.'; }
    else { fieldState = 'waiting'; fieldDetail = 'Starting. This can take a minute on first start.'; }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-gray-200 font-semibold flex items-center gap-2"><Server size={16} /> Starting the services</h2>
      <ul className="text-sm">
        <ProgressItem state="ok" label="Web server" detail="You are connected over HTTPS." />
        <ProgressItem
          state={portalUp ? 'ok' : 'waiting'}
          label="Portal and its database"
          detail={portalUp ? null : (error ? 'Starting. Database migrations run on first start.' : 'Checking…')}
        />
        <ProgressItem state={fieldState} label="Field App" detail={fieldDetail} />
      </ul>
      <div className="flex justify-end">
        <button type="button" className="btn-primary flex items-center gap-1.5" disabled={!portalUp} onClick={onContinue}>
          {fieldUp ? 'Continue' : 'Continue without waiting'} <ArrowRight size={14} />
        </button>
      </div>
      {portalUp && !fieldUp && (
        <p className="text-xs text-gray-500">
          If you continue now, the Field App login can be created later from Admin → System.
        </p>
      )}
    </div>
  );
}

// --- Step 2: setup code ----------------------------------------------------------

function VerifyStep({ required, code, setCode, onVerified }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!required) onVerified();
  }, [required]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await setupApi.verifyCode(code);
      onVerified();
    } catch (err) {
      setError(err.response?.data?.error ?? 'The code could not be checked.');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-gray-200 font-semibold flex items-center gap-2"><KeyRound size={16} /> Confirm it's your server</h2>
      <p className="text-sm text-gray-400">
        Enter the setup code from the Portal API's log. This proves you manage the server,
        so nobody else on the network can complete setup first.
      </p>
      <div className="rounded-md bg-surface-900 border border-surface-600 p-3 text-sm text-gray-400 space-y-1.5">
        <p><span className="text-gray-200">Portainer:</span> Containers → <code className="font-mono text-gray-300">itmanager-portal-api-1</code> → Logs</p>
        <p><span className="text-gray-200">Command line</span> (in the install folder): <code className="font-mono text-gray-300">docker compose logs portal-api</code></p>
        <p>The installer also prints it when it finishes.</p>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Field label="Setup code">
        <input className="input font-mono uppercase tracking-widest" value={code} onChange={e => setCode(e.target.value)}
          required autoComplete="off" placeholder="XXXX-XXXX-XXXX" autoFocus />
      </Field>
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Checking…' : 'Verify'}</button>
      </div>
    </form>
  );
}

// --- Step 3: company and admin ----------------------------------------------------

function AccountStep({ form, set, onSubmit, error }) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <ErrorBox>{error}</ErrorBox>}
      <section className="space-y-3">
        <h2 className="text-gray-200 font-semibold flex items-center gap-2"><Building2 size={16} /> Your company</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company name">
            <input className="input" value={form.companyName} onChange={set('companyName')} required placeholder="Northwind IT Services" />
          </Field>
          <Field label="App name" hint="Shown in the header and browser tab.">
            <input className="input" value={form.productName} onChange={set('productName')} required />
          </Field>
        </div>
        <p className="text-gray-500 text-xs">Logo, colors and the rest of the branding are in Admin → Branding.</p>
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
        <p className="text-gray-500 text-xs">The same login is created on the Field App.</p>
      </section>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary">Set up</button>
      </div>
    </form>
  );
}

// --- Step 4: applying ----------------------------------------------------------

const PLANNED = [
  { id: 'admin', label: 'Create the Portal admin account' },
  { id: 'company', label: 'Save company details' },
  { id: 'field-admin', label: 'Create the same login on the Field App' },
  { id: 'field-branding', label: 'Send company details to the Field App' },
  { id: 'signin', label: 'Sign in' },
];

function ApplyStep({ results, error, onBack, onContinue }) {
  const done = results && results.signin !== undefined;
  const failed = Object.values(results ?? {}).filter(r => r && !r.ok);
  return (
    <div className="space-y-4">
      <h2 className="text-gray-200 font-semibold flex items-center gap-2"><Server size={16} /> Setting up</h2>
      <ul className="text-sm">
        {PLANNED.filter(p => !results || results[p.id] !== null).map(p => {
          const r = results?.[p.id];
          const state = error && !r ? 'failed' : r === undefined ? 'pending' : r.ok ? 'ok' : 'failed';
          return <ProgressItem key={p.id} state={state} label={p.label} detail={r && !r.ok ? r.error : null} />;
        })}
      </ul>
      {error && (
        <>
          <ErrorBox>{error}</ErrorBox>
          <div className="flex justify-end"><button type="button" className="btn-secondary" onClick={onBack}>Back</button></div>
        </>
      )}
      {done && !error && (
        <>
          {failed.length > 0 && (
            <p className="text-amber-400 text-sm bg-amber-900/30 rounded-sm p-2">
              The Portal is set up. The Field App steps can be retried from Admin → System once the Field App is running.
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-primary flex items-center gap-1.5" onClick={onContinue}>Continue <ArrowRight size={14} /></button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Step 6: finish --------------------------------------------------------------

function FinishStep({ onDone }) {
  const host = window.location.hostname;
  return (
    <div className="space-y-6 text-sm text-gray-400">
      <section className="space-y-2">
        <h2 className="text-gray-200 font-semibold flex items-center gap-2"><ShieldCheck size={16} /> Trust this server's certificate</h2>
        <p>
          The Portal uses a certificate from this server's own certificate authority. Install it once as a trusted
          root on each computer and phone (by hand, Group Policy or MDM) to remove the browser warning.
        </p>
        <a href="/ca.crt" className="btn-secondary inline-flex items-center gap-1.5"><Download size={14} /> Download certificate</a>
      </section>

      <section className="space-y-2">
        <h2 className="text-gray-200 font-semibold flex items-center gap-2"><Globe size={16} /> Put the Field App online</h2>
        <p>The Field App is published through Nginx Proxy Manager, which can reach the Field App and nothing else.</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Point a DNS name (for example <code className="font-mono text-gray-300">field.example.com</code>) at your public IP address.</li>
          <li>On your router, forward TCP ports <strong className="text-gray-200">80 and 443</strong> to this server. Do not forward 8443 or 81.</li>
          <li>
            Open Nginx Proxy Manager at{' '}
            <a className="text-brand-light underline" href={`http://${host}:81`} target="_blank" rel="noreferrer">http://{host}:81</a>{' '}
            and create its admin account.
          </li>
          <li>
            Hosts → Proxy Hosts → Add Proxy Host: your domain, scheme <code className="font-mono text-gray-300">http</code>,
            forward hostname <code className="font-mono text-gray-300">field-web</code>, port <code className="font-mono text-gray-300">8080</code>,
            and turn on "Block Common Exploits".
          </li>
          <li>On the SSL tab: request a new Let's Encrypt certificate and turn on "Force SSL" and "HTTP/2 Support".</li>
        </ol>
        <p>Field App users sign in at that address with their Field App login. Your admin login works there too.</p>
      </section>

      <div className="flex justify-end">
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={onDone}>Go to the dashboard <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

// --- Wizard ---------------------------------------------------------------------

export function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { login } = useAuth();
  const branding = useBranding();
  const [step, setStep] = useState('start');
  const { data: status, error: statusError, isLoading } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: setupApi.status,
    retry: false,
    // Poll while waiting for the services to come up.
    refetchInterval: step === 'start' ? 2000 : false,
  });

  const [code, setCode] = useState('');
  const [form, setForm] = useState({
    companyName: '', productName: branding.productName || 'IT Manager',
    full_name: '', username: '', email: '', password: '', confirm: '',
  });
  const [formError, setFormError] = useState('');
  const [results, setResults] = useState(null);
  const [applyError, setApplyError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (isLoading && step === 'start' && !statusError) return <div className="min-h-screen bg-surface-900" />;
  if (status && !status.needsSetup && ['start', 'verify', 'account'].includes(step)) return <Navigate to="/login" replace />;

  const submitAccount = async (e) => {
    e.preventDefault();
    setFormError('');
    if (form.password !== form.confirm) { setFormError('Passwords do not match.'); return; }
    if (form.password.length < 12) { setFormError('Password must be at least 12 characters.'); return; }

    const fieldPlanned = status?.services?.field?.configured !== false;
    setResults(fieldPlanned ? {} : { 'field-admin': null, 'field-branding': null });
    setApplyError('');
    setStep('apply');
    try {
      const result = await setupApi.run({
        setupCode: code,
        companyName: form.companyName,
        productName: form.productName,
        admin: { full_name: form.full_name, username: form.username, email: form.email, password: form.password },
      });
      const byId = Object.fromEntries(result.steps.map(s => [s.id, s]));
      setResults(r => ({ ...r, ...byId, ...(byId['field-admin'] ? {} : { 'field-admin': null, 'field-branding': null }) }));
      try {
        await login(form.username.trim().toLowerCase(), form.password);
        setResults(r => ({ ...r, signin: { ok: true } }));
      } catch {
        setResults(r => ({ ...r, signin: { ok: false, error: 'Sign in from the login page with your new account.' } }));
      }
      qc.invalidateQueries({ queryKey: ['branding'] });
      qc.setQueryData(['setup', 'status'], { ...status, needsSetup: false });
      setForm(f => ({ ...f, password: '', confirm: '' }));
      setCode('');
    } catch (err) {
      setApplyError(err.response?.data?.error ?? 'Setup failed.');
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={40} />
          <div>
            <h1 className="text-gray-100 text-xl font-bold">Set up {branding.productName || 'IT Manager'}</h1>
            <p className="text-gray-500 text-sm">This page appears only once, on a new installation.</p>
          </div>
        </div>

        <StepBar current={step} />

        <div className="card p-6">
          {step === 'start' && <StartStep status={status} error={statusError} onContinue={() => setStep('verify')} />}
          {step === 'verify' && (
            <VerifyStep required={status?.setupCodeRequired !== false} code={code} setCode={setCode} onVerified={() => setStep('account')} />
          )}
          {step === 'account' && <AccountStep form={form} set={set} onSubmit={submitAccount} error={formError} />}
          {step === 'apply' && (
            <ApplyStep
              results={results}
              error={applyError}
              onBack={() => { setFormError(applyError); setStep(applyError.includes('code') ? 'verify' : 'account'); }}
              onContinue={() => setStep('secrets')}
            />
          )}
          {step === 'secrets' && (
            <div className="space-y-4">
              <h2 className="text-gray-200 font-semibold">Save your recovery secrets</h2>
              <RevealSecrets onDone={() => setStep('finish')} />
            </div>
          )}
          {step === 'finish' && <FinishStep onDone={() => navigate('/', { replace: true })} />}
        </div>
      </div>
    </div>
  );
}
