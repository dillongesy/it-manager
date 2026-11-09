import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Server, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import api from '../../api/client.js';
import { RevealSecrets } from './RevealSecrets.jsx';
import { Storage } from './Storage.jsx';

export function Security() {
  return (
    <div className="space-y-6">
      <section className="card p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><ShieldCheck size={16} /> Recovery secrets</h2>
        <RevealSecrets />
      </section>
      <section className="card p-5 space-y-2 text-sm text-gray-400">
        <h2 className="text-base font-semibold text-gray-200">How this server is protected</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Each service runs in its own container on its own private network. The databases have no route to the internet or to each other.</li>
          <li>The Field App's database is reachable only by the Field API. The Portal reaches the Field App only through the Field API's service endpoints — never the reverse.</li>
          <li>Stored credentials and integration secrets are encrypted (AES-256-GCM) with the master key generated on first boot.</li>
          <li>The host firewall (set up by install.sh) only lets the LAN reach the Portal.</li>
        </ul>
      </section>
    </div>
  );
}

export function System() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['admin', 'system'], queryFn: adminApi.system });
  const [fieldMsg, setFieldMsg] = useState(null);

  const createFieldLogin = async () => {
    setFieldMsg(null);
    try {
      await api.post('/admin/system/field-admin');
      setFieldMsg({ ok: 'Your Field App admin login was created (same username and password).' });
    } catch (err) {
      setFieldMsg({ error: err.response?.data?.error ?? 'Could not create the Field App login.' });
    }
  };

  if (isLoading || !data) return <p className="text-gray-500 text-sm">Loading…</p>;
  const f = data.field;
  return (
    <div className="space-y-4">
      <section className="card p-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2"><Server size={16} /> Server</h2>
          <button onClick={() => refetch()} className="btn-ghost text-xs flex items-center gap-1"><RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh</button>
        </div>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
          <dt className="text-gray-500">Version</dt><dd className="text-gray-200 font-mono">{data.version}</dd>
          <dt className="text-gray-500">Field App bridge</dt>
          <dd className="flex items-center gap-1.5">
            {f.reachable
              ? <><CheckCircle2 size={14} className="text-green-400" /> <span className="text-gray-200">Connected</span></>
              : <><XCircle size={14} className="text-red-400" /> <span className="text-gray-200">{f.configured ? `Unreachable — ${f.error ?? ''}` : 'Not configured'}</span></>}
          </dd>
        </dl>
        <p className="text-gray-500 text-xs">Updates: on the server run <code className="font-mono text-gray-300">./update.sh</code> (pulls new images and restarts; database migrations run automatically).</p>
      </section>

      <Storage />

      <section className="card p-5 space-y-3 text-sm">
        <h2 className="text-base font-semibold text-gray-200">Field App admin</h2>
        <p className="text-gray-400">The setup wizard creates your login on the Field App too. If that failed (for example the Field App was still starting), create it here. It only works while the Field App has no users.</p>
        {fieldMsg && <p className={`rounded-sm p-2 ${fieldMsg.error ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/30'}`}>{fieldMsg.error || fieldMsg.ok}</p>}
        <button className="btn-secondary text-sm" disabled={!f.reachable} onClick={createFieldLogin}>Create my Field App login</button>
      </section>
    </div>
  );
}
