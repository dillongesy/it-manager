import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, Save, AlertTriangle, RotateCcw } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { useRefreshBranding, BRANDING_DEFAULTS } from '../../contexts/BrandingContext.jsx';
import { applyBrandTheme, contrastRatio } from '../../lib/brandTheme.js';

// Admin → Branding: names, colors, print header details and images. Saved settings
// apply to everyone immediately and are pushed to the Field App over the bridge.

const TEXT_FIELDS = [
  { key: 'companyName',  label: 'Company name', required: true },
  { key: 'productName',  label: 'App name', hint: 'Header, login page and browser tab.', required: true },
  { key: 'fieldAppName', label: 'Field App name', hint: 'What the mobile field app is called.' },
  { key: 'tagline',      label: 'Login tagline', hint: 'Optional line under the app name on the login page.' },
];
const PRINT_FIELDS = [
  { key: 'address', label: 'Address' },
  { key: 'phone',   label: 'Phone' },
  { key: 'email',   label: 'Email' },
  { key: 'website', label: 'Website' },
];

const ASSET_HINTS = {
  logo:             'Square mark for the sidebar and small spots. PNG or SVG, at least 128×128.',
  logo_full:        'Full lockup for the login page and the top of printed work orders / PDFs.',
  favicon:          'Browser-tab icon. Square PNG, ICO or SVG (32×32 or larger).',
  login_background: 'Optional photo behind the login form. Large JPEG/WebP; it is darkened for legibility.',
};

function AssetCard({ kind, label, url, maxBytes, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file) => {
    if (!file) return;
    if (file.size > maxBytes) { setError(`Must be under ${Math.round(maxBytes / 1024)} KB.`); return; }
    setBusy(true); setError('');
    try { onChanged(await adminApi.uploadAsset(kind, file)); }
    catch (err) { setError(err.response?.data?.error ?? 'Upload failed.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async () => {
    if (!confirm(`Remove the ${label.toLowerCase()}?`)) return;
    setBusy(true); setError('');
    try { onChanged(await adminApi.deleteAsset(kind)); }
    catch (err) { setError(err.response?.data?.error ?? 'Could not remove.'); }
    finally { setBusy(false); }
  };

  const wide = kind === 'login_background' || kind === 'logo_full';
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <p className="text-gray-200 text-sm font-medium">{label}</p>
        <p className="text-gray-500 text-xs mt-0.5">{ASSET_HINTS[kind]}</p>
      </div>
      <div className={`rounded-md border border-dashed border-surface-500 bg-surface-900 flex items-center justify-center overflow-hidden ${wide ? 'h-28' : 'h-20'}`}>
        {url
          ? <img src={url} alt="" className={kind === 'login_background' ? 'w-full h-full object-cover' : 'max-h-full max-w-full object-contain p-2'} />
          : <span className="text-gray-600 text-xs">None — using the default</span>}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <input ref={input} type="file" className="hidden" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico"
          onChange={e => upload(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-secondary text-sm flex items-center gap-2">
          <ImagePlus size={14} /> {busy ? 'Working…' : url ? 'Replace' : 'Add image'}
        </button>
        {url && <button type="button" disabled={busy} onClick={remove} className="btn-ghost text-sm text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 rounded-md border border-surface-500 bg-surface-700 cursor-pointer p-1" />
        <input className="input font-mono uppercase" value={value} maxLength={7}
          onChange={e => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} />
      </div>
      {hint && <p className="text-gray-600 text-xs mt-1">{hint}</p>}
    </div>
  );
}

export function Branding() {
  const qc = useQueryClient();
  const refreshBranding = useRefreshBranding();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'branding'], queryFn: adminApi.branding });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  // Live preview of colors while editing; revert to the saved ones on leave.
  useEffect(() => {
    if (form && /^#[0-9A-F]{6}$/i.test(form.primaryColor) && /^#[0-9A-F]{6}$/i.test(form.accentColor)) applyBrandTheme(form);
  }, [form?.primaryColor, form?.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const saved = qc.getQueryData(['branding']); if (saved) applyBrandTheme(saved); }, [qc]);

  if (isLoading || !form) return <p className="text-gray-500 text-sm">Loading…</p>;

  const set = (k) => (v) => { setMsg(null); setForm(f => ({ ...f, [k]: typeof v === 'string' ? v : v.target.value })); };

  const onAssets = (updated) => {
    qc.setQueryData(['admin', 'branding'], (d) => ({ ...d, ...updated }));
    setForm(f => ({ ...f, assets: updated.assets }));
    refreshBranding(updated);
    if (updated.fieldSync && !updated.fieldSync.ok) setMsg({ warn: `Saved. The Field App could not be updated yet (${updated.fieldSync.error}); it retries on next start.` });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body = Object.fromEntries([...TEXT_FIELDS, ...PRINT_FIELDS].map(f => [f.key, form[f.key] ?? '']));
      Object.assign(body, { primaryColor: form.primaryColor, accentColor: form.accentColor, printFooter: form.printFooter ?? '' });
      const updated = await adminApi.saveBranding(body);
      qc.setQueryData(['admin', 'branding'], (d) => ({ ...d, ...updated }));
      setForm(f => ({ ...f, ...updated }));
      refreshBranding(updated);
      setMsg(updated.fieldSync && !updated.fieldSync.ok
        ? { warn: `Saved. The Field App could not be updated yet (${updated.fieldSync.error}).` }
        : { ok: 'Saved — applied everywhere, including the Field App.' });
    } catch (err) {
      setMsg({ error: err.response?.data?.error ?? 'Could not save.' });
    } finally { setBusy(false); }
  };

  const contrast = contrastRatio(form.primaryColor, '#FFFFFF');
  const lowContrast = contrast != null && contrast < 3 && contrastRatio(form.primaryColor, '#111111') < 3;

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-200">Names</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {TEXT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">{f.label}</label>
                <input className="input" value={form[f.key] ?? ''} onChange={set(f.key)} required={f.required} />
                {f.hint && <p className="text-gray-600 text-xs mt-1">{f.hint}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-200">Colors</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <ColorField label="Primary color" value={form.primaryColor} onChange={set('primaryColor')} hint="Buttons, highlights, active navigation." />
            <ColorField label="Accent color" value={form.accentColor} onChange={set('accentColor')} hint="Links and secondary highlights (darkened automatically in light mode)." />
          </div>
          {lowContrast && (
            <p className="flex items-center gap-2 text-amber-400 text-xs"><AlertTriangle size={13} /> This primary color is hard to read text on. Pick a darker or more saturated shade.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 card p-3">
            <span className="text-xs text-gray-500">Preview:</span>
            <button type="button" className="btn-primary text-sm">Primary button</button>
            <span className="text-accent text-sm underline">Accent link</span>
            <span className="badge bg-brand/20 text-brand">Badge</span>
            <button type="button" className="btn-ghost text-xs flex items-center gap-1 ml-auto"
              onClick={() => setForm(f => ({ ...f, primaryColor: BRANDING_DEFAULTS.primaryColor, accentColor: BRANDING_DEFAULTS.accentColor }))}>
              <RotateCcw size={12} /> Defaults
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-200">Print & PDF header</h2>
          <p className="text-gray-500 text-xs">Shown with the full logo at the top of printed work orders and customer exports.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {PRINT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">{f.label}</label>
                <input className="input" value={form[f.key] ?? ''} onChange={set(f.key)} />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Footer text</label>
            <textarea className="input min-h-20" value={form.printFooter ?? ''} onChange={set('printFooter')}
              placeholder="e.g. payment terms, license number, thank-you note" />
          </div>
        </section>

        {msg && (
          <p className={`text-sm rounded-sm p-2 ${msg.error ? 'text-red-400 bg-red-900/20' : msg.warn ? 'text-amber-400 bg-amber-900/30' : 'text-green-400 bg-green-900/30'}`}>
            {msg.error || msg.warn || msg.ok}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2"><Save size={14} /> {busy ? 'Saving…' : 'Save branding'}</button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-200">Images</h2>
        <p className="text-gray-500 text-xs">Uploads save immediately. PNG, JPEG, GIF, WebP, ICO or SVG (SVGs with scripts are refused).</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {(data.assetKinds ?? []).map(a => (
            <AssetCard key={a.kind} kind={a.kind} label={a.label} maxBytes={a.maxBytes} url={form.assets?.[a.kind]} onChanged={onAssets} />
          ))}
        </div>
      </section>
    </div>
  );
}
