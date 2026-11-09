import { useQuery } from '@tanstack/react-query';
import { integrationsApi } from '../api/integrations.js';

// Which integrations are switched on AND configured (Admin → Integrations).
// Import / sync menu entries for anything else stay hidden. While loading, nothing
// is shown rather than flashing buttons that then disappear.
export function useIntegrations() {
  const { data } = useQuery({
    queryKey: ['integrations', 'status'],
    queryFn: () => integrationsApi.status().then(r => r.data),
    staleTime: 5 * 60_000,
  });
  return data ?? {};
}
