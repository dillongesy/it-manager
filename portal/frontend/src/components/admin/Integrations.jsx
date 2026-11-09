import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CheckCircle2, CircleDashed, Info, Lock, Save } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { PasswordInput } from '../ui/PasswordInput.jsx';

// Admin → Integrations. Each external system has an on/off switch and its settings.
// Secret fields are write-only: the server only says
// whether one is stored, and leaving the box blank keeps it.

function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50
        ${checked ? 'bg-brand' : 'bg-surface-500'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function IntegrationCard({ item }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState({});           // only fields the admin touched
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const valueOf = (f) => (f.key in draft ? draft[f.key] : f.secret ? '' : item.values[f.key] ?? '');
  const set = (k) => (e) => { setSaved(false); setDraft(d => ({ ...d, [k]: e.target.value })); };

  const save = async (patch) => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const updated = await adminApi.saveIntegration(item.id, patch);
      qc.setQueryData(['admin', 'integrations'], (list = []) => list.map(i => (i.id === item.id ? updated : i)));
      qc.invalidateQueries({ queryKey: ['integrations', 'status'] });
      setDraft({});
      setSaved(true);
      return true;
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not save.');
      return false;
    } finally { setBusy(false); }
  };

  const toggle = async (on) => {
    // Turning on with unsaved edits saves them together; missing fields open the form.
    const ok = await save({ enabled: on, values: draft });
    if (!ok && on) setOpen(true);
  };

  const basic = item.fields.filter(f => !f.advanced);
  const advanced = item.fields.filter(f => f.advanced);

  const renderField = (f) => (
    <div key={f.key}>
      <label className="block text-sm font-medium text-gray-400 mb-1.5">
        {f.label}{f.required && <span className="text-gray-600"> *</span>}
        {f.secret && item.values[f.key]?.set && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-400 font-normal"><Lock size={11} /> stored</span>
        )}
      </label>
      {f.secret ? (
        <PasswordInput value={valueOf(f)} onChange={set(f.key)}
          placeholder={item.values[f.key]?.set ? 'Leave blank to keep the stored value' : (f.placeholder ?? '')} />
      ) : (
        <input className="input" value={valueOf(f)} onChange={set(f.key)}
          placeholder={f.placeholder ?? (f.default ? `Default: ${f.default}` : '')} autoComplete="off" />
      )}
      {f.help && <p className="text-gray-600 text-xs mt-1">{f.help}</p>}
    </div>
  );

  return (
    <div className="card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {open ? <ChevronDown size={16} className="text-gray-500 shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-gray-100 font-medium">{item.label}</span>
              {item.enabled && item.complete
                ? <span className="badge bg-green-900 text-green-300 gap-1"><CheckCircle2 size={11} /> On</span>
                : item.complete
                  ? <span className="badge bg-surface-600 text-gray-400">Off</span>
                  : <span className="badge bg-surface-600 text-gray-500 gap-1"><CircleDashed size={11} /> Not set up</span>}
            </div>
            <p className="text-xs text-gray-500 truncate">{item.summary}</p>
          </div>
        </button>
        <Toggle checked={item.enabled} disabled={busy} onChange={toggle} />
      </div>

      {open && (
        <div className="border-t border-surface-600 px-4 py-4 space-y-4">
          {item.help && (
            <div className="flex gap-2 text-xs text-gray-400 bg-surface-700 rounded-md p-3">
              <Info size={14} className="shrink-0 mt-0.5 text-gray-500" /> <span>{item.help}</span>
            </div>
          )}
          {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}
          <div className="grid sm:grid-cols-2 gap-3">{basic.map(renderField)}</div>
          {advanced.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowAdvanced(s => !s)} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Advanced
              </button>
              {showAdvanced && <div className="grid sm:grid-cols-2 gap-3 mt-3">{advanced.map(renderField)}</div>}
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            {saved && !dirty && <span className="text-xs text-green-400">Saved — active immediately.</span>}
            {dirty && <button type="button" className="btn-ghost text-sm" onClick={() => setDraft({})}>Discard</button>}
            <button type="button" disabled={busy || !dirty} onClick={() => save({ values: draft })} className="btn-primary text-sm flex items-center gap-2">
              <Save size={14} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Integrations() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['admin', 'integrations'], queryFn: adminApi.integrations });
  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error) return <p className="text-red-400 text-sm">Could not load integrations.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        Connect the outside systems you use. Credentials are stored encrypted with this server's master key,
        are never sent back to the browser, and take effect as soon as you save. Integrations that are off
        stay hidden from everyone.
      </p>
      {data.map(item => <IntegrationCard key={item.id} item={item} />)}
    </div>
  );
}
