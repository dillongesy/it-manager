import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../api/admin.js';

// A log written by the host helper: 'install' (the installation) or 'update' (the last update).
export function HostLog({ name }) {
  const { data, isLoading } = useQuery({ queryKey: ['host-log', name], queryFn: () => adminApi.hostLog(name) });
  if (isLoading) return <p className="text-gray-500 text-xs">Loading…</p>;
  if (!data?.log) return <p className="text-gray-500 text-xs">No log on this server yet.</p>;
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-surface-900 border border-surface-600 p-3 text-xs text-gray-300 whitespace-pre-wrap break-all font-mono">
      {data.log}
    </pre>
  );
}
