import api from './client.js';

// ConnectWise RMM machine import (read-only on the ConnectWise side).
export const connectWiseApi = {
  status:    ()                              => api.get('/connectwise/status'),
  companies: (refresh = false)               => api.get('/connectwise/companies', { params: refresh ? { refresh: 1 } : {} }),
  sites:     (companyId, refresh = false)    =>
    api.get(`/connectwise/companies/${encodeURIComponent(companyId)}/sites`, { params: refresh ? { refresh: 1 } : {} }),
  machines:  (cid, companyId, siteId, refresh = false) =>
    api.get(`/customers/${cid}/connectwise/machines`, { params: { companyId, siteId, ...(refresh ? { refresh: 1 } : {}) } }),
  import:    (cid, { companyId, siteId, endpointIds, locationId, moveExisting, takeNewer }) =>
    api.post(`/customers/${cid}/connectwise/import`, {
      companyId, siteId, endpoint_ids: endpointIds, location_id: locationId || null, move_existing: Boolean(moveExisting), take_newer: Boolean(takeNewer),
    }),
};
