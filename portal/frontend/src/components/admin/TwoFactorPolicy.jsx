import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { adminApi } from '../../api/admin.js';

// Admin → Security: two-factor authentication policy, set separately for each app.

const OPTIONS = [
  { value: 'off', label: 'Off', hint: 'Not used. Codes are not asked for, even from users who set it up.' },
  { value: 'optional', label: 'Optional', hint: 'Each user can turn it on for their own account.' },
  { value: 'required', label: 'Required', hint: 'Everyone must set it up at their next sign-in.' },
];

function PolicyPicker({ name, label, value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-gray-200 font-medium mb-1">{label}</legend>
      {OPTIONS.map(o => (
        <label key={o.value} className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name={name} className="mt-1" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="text-gray-200">{o.label}</span>
            <span className="block text-xs text-gray-500">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function TwoFactorPolicy() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'security'], queryFn: adminApi.security });
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!data?.mfa) return null;
  const policy = draft ?? data.mfa;
  const dirty = draft && (draft.portal !== data.mfa.portal || draft.field !== data.mfa.field);

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await adminApi.saveMfaPolicy(policy);
      qc.setQueryData(['admin', 'security'], { ...data, mfa: result.mfa });
      setDraft(null);
      setMessage(result.fieldSync?.ok === false
        ? { warn: `Saved. The Field App could not be updated yet (${result.fieldSync.error}); it is retried when the Portal restarts.` }
        : { ok: 'Saved.' });
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'Could not save.' });
    } finally { setBusy(false); }
  };

  return (
    <section className="card p-5 space-y-4 text-sm">
      <div>
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><Smartphone size={16} /> Two-factor authentication</h2>
        <p className="text-gray-400 mt-1">
          A code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) in
          addition to the password. Set separately for each app. Reset a user who lost their phone from their account
          (Users &amp; roles for the Portal, Staff in the Field App).
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <PolicyPicker name="mfa-portal" label="Portal" value={policy.portal} onChange={v => setDraft({ ...policy, portal: v })} />
        <PolicyPicker name="mfa-field" label="Field App" value={policy.field} onChange={v => setDraft({ ...policy, field: v })} />
      </div>
      {message && (
        <p className={`rounded-sm p-2 ${message.error ? 'text-red-400 bg-red-900/20' : message.warn ? 'text-amber-400 bg-amber-900/20' : 'text-green-400 bg-green-900/30'}`}>
          {message.error || message.warn || message.ok}
        </p>
      )}
      <button type="button" className="btn-primary text-sm" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </section>
  );
}
