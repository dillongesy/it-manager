import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, CheckCircle2, XCircle } from 'lucide-react';
import { adminApi } from '../../api/admin.js';
import api from '../../api/client.js';
import { Storage } from './Storage.jsx';
import { TwoFactorPolicy } from './TwoFactorPolicy.jsx';
import { HostSettings } from './HostSettings.jsx';
import { OfficeNetwork } from './OfficeNetwork.jsx';
import { ServiceMap } from './ServiceMap.jsx';
import { RefreshButton } from './RefreshButton.jsx';

export function Security() {
  return (
    <div className="space-y-6">
      <TwoFactorPolicy />
      <section className="card p-5 space-y-3 text-sm text-gray-400">
        <h2 className="text-base font-semibold text-gray-200">How this server is protected</h2>
        <ServiceMap />
        <p>Stored credentials and integration secrets are encrypted (AES-256-GCM) with the master key generated on first boot.</p>
      </section>
    </div>
  );
}

export function System() {
  const query = useQuery({ queryKey: ['admin', 'system'], queryFn: adminApi.system });
  const { data, isLoading } = query;
  const [fieldMsg, setFieldMsg] = useState(null);
  const createFieldLogin = async () => {
    setFieldMsg(null);
    try {
      await api.post('/admin/system/field-admin');
      setFieldMsg({ ok: 'Your Field App login was created (same username and password).' });
      query.refetch();
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
          <RefreshButton query={query} />
        </div>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
          <dt className="text-gray-500">Version</dt><dd className="text-gray-200 font-mono">{data.version}</dd>
          <dt className="text-gray-500">Field App</dt>
          <dd className="flex items-center gap-1.5">
            {f.reachable
              ? <><CheckCircle2 size={14} className="text-green-400" /> <span className="text-gray-200">Connected</span></>
              : <><XCircle size={14} className="text-red-400" /> <span className="text-gray-200">{f.configured ? `Not connected${f.error ? ` (${f.error})` : ''}` : 'Not configured'}</span></>}
          </dd>
        </dl>
        {f.reachable && f.hasUsers === false && (
          <p className="text-amber-300 text-xs flex flex-wrap items-center gap-2">
            The Field App has no login yet.
            <button type="button" className="underline" onClick={createFieldLogin}>Create my Field App login</button>
          </p>
        )}
        {fieldMsg && <p className={`text-xs ${fieldMsg.error ? 'text-red-400' : 'text-green-400'}`}>{fieldMsg.error || fieldMsg.ok}</p>}
      </section>

      <OfficeNetwork />

      <HostSettings />

      <Storage />
    </div>
  );
}
