import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, X } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import { HostLog } from './HostLog.jsx';

// Admin → System: the office networks allowed to open the Portal (and the Field App on
// its office port), and optional local DNS names for the server. Applied by the host
// helper, which re-issues the certificates and restarts the web containers.

const CIDR = /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}\/([0-9]|[12][0-9]|3[0-2])$/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const split = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function ListEditor({ items, onChange, placeholder, max, valid, label }) {
  const set = (i, v) => onChange(items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="space-y-2">
      {items.map((value, i) => (
        <div key={i} className="flex gap-2">
          <input className={`input font-mono ${value && !valid.test(value.trim()) ? 'border-red-500' : ''}`}
            value={value} placeholder={placeholder} aria-label={`${label} ${i + 1}`}
            onChange={e => set(i, e.target.value)} />
          <button type="button" className="btn-ghost px-2" aria-label={`Remove ${label} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={() => onChange([...items, ''])}>
          <Plus size={12} /> Add {label}
        </button>
      )}
    </div>
  );
}

export function OfficeNetwork() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'host'], queryFn: adminApi.host });
  const [lan, setLan] = useState(null);
  const [names, setNames] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const savedLan = split(data?.host?.lanCidr);
  const savedNames = split(data?.portalNames).filter(n => n !== data?.host?.ip);

  useEffect(() => {
    if (data?.available && lan === null) { setLan(savedLan.length ? savedLan : ['']); setNames(savedNames); }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.available || lan === null) return null;

  const cleanLan = lan.map(s => s.trim()).filter(Boolean);
  const cleanNames = names.map(s => s.trim().toLowerCase()).filter(Boolean);
  const invalid = !cleanLan.length || !cleanLan.every(c => CIDR.test(c)) || !cleanNames.every(n => HOSTNAME.test(n));
  const unchanged = cleanLan.join(',') === savedLan.join(',') && cleanNames.join(',') === savedNames.join(',');
  const ip = data.host?.ip;
  const fieldPort = data.ports?.fieldLan;

  const save = async () => {
    const namesChanged = cleanNames.join(',') !== savedNames.join(',');
    if (!confirm(`Apply the new office network?\n\nThe Portal and the Field App's office address restart; this page reconnects in about 30 seconds.${namesChanged ? '\n\nThe server\'s certificate is re-issued for the new names. It is signed by the same certificate authority, so devices that already trust it keep working: there is nothing to install or remove.' : ''}`)) return;
    setBusy(true); setMessage(null);
    try {
      await adminApi.saveNetwork(cleanLan, cleanNames);
      setMessage({ ok: 'Saved. The web containers are restarting; refresh this page in about 30 seconds.' });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['admin', 'host'] });
        qc.invalidateQueries({ queryKey: ['host-log', 'network'] });
        setLan(null);
      }, 30_000);
    } catch (err) {
      setMessage({ error: err.response?.data?.error ?? 'The change was not applied.' });
    } finally { setBusy(false); }
  };

  return (
    <section className="card p-5 space-y-4 text-sm">
      <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><Network size={16} /> Office network</h2>

      <div className="space-y-2">
        <p className="text-gray-200 font-medium">Networks allowed to use the Portal</p>
        <p className="text-gray-500 text-xs">
          Address ranges of office computers, plus any VPN or second office (for example <code className="font-mono">192.168.1.0/24</code> or{' '}
          <code className="font-mono">10.8.0.0/24</code>). Everything else is refused. The same ranges may open the Field App on the office
          network. Your computer must stay inside one of them.
        </p>
        <ListEditor items={lan} onChange={setLan} placeholder="192.168.1.0/24" max={8} valid={CIDR} label="network" />
      </div>

      <div className="space-y-2">
        <p className="text-gray-200 font-medium">Local DNS names for the server (optional)</p>
        <p className="text-gray-500 text-xs">
          Only if your office DNS has a name for this server (for example <code className="font-mono">portal.office.lan</code>), so the
          certificate matches it. The IP address{ip ? <> (<span className="font-mono">{ip}</span>)</> : ''} always works.
        </p>
        <ListEditor items={names} onChange={setNames} placeholder="portal.office.lan" max={10} valid={HOSTNAME} label="name" />
      </div>

      <button type="button" className="btn-primary text-sm" disabled={busy || invalid || unchanged} onClick={save}>
        {busy ? 'Applying…' : 'Apply'}
      </button>

      {ip && fieldPort && (
        <p className="text-gray-400 text-xs border-t border-surface-600 pt-3">
          Field App on the office network, no proxy needed:{' '}
          <a className="font-mono text-brand-light hover:underline" href={`https://${ip}:${fieldPort}`} target="_blank" rel="noreferrer">
            https://{ip}:{fieldPort}
          </a>
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-gray-200 font-medium">Last network change log</summary>
        <div className="mt-2"><HostLog name="network" /></div>
      </details>

      {message && (
        <p className={`rounded-sm p-2 ${message.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>{message.error || message.ok}</p>
      )}
    </section>
  );
}
