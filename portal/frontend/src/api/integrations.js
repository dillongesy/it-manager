import api from './client.js';

const refreshParam = (refresh) => (refresh ? { refresh: 1 } : {});

// Outside systems the Portal reads from (all read-only on their side).
export const integrationsApi = {
  status: () => api.get('/integrations/status'),

  // Which ConnectWise site / UniFi console a customer is linked to.
  links:      (cid, provider) => api.get(`/customers/${cid}/integrations`, { params: provider ? { provider } : {} }),
  removeLink: (cid, linkId)   => api.delete(`/customers/${cid}/integrations/${linkId}`),

  // Remote buttons - { configured, links: { [deviceId]: { url, online, matched_by, … } }, error? }
  remoteLinks: (cid, refresh = false) => api.get(`/customers/${cid}/screenconnect/links`, { params: refreshParam(refresh) }),
  // Web UI buttons (Auvik Remote Browser) - { configured, links: { [deviceId]: { https_url, http_url, … } }, error? }
  webLinks:    (cid, refresh = false) => api.get(`/customers/${cid}/auvik/links`, { params: refreshParam(refresh) }),

  // Seat counts from a security vendor → the Billing tab (provider: 'threatlocker').
  // `accounts` is an array of vendor account IDs (one customer can be several ThreatLocker orgs).
  seatSync: {
    accounts: (provider, refresh = false) => api.get(`/seat-sync/${provider}/accounts`, { params: refreshParam(refresh) }),
    preview:  (cid, provider, accounts, refresh = false) =>
      api.get(`/customers/${cid}/seat-sync/${provider}/preview`, { params: { account: accounts.join(','), ...refreshParam(refresh) } }),
    apply:    (cid, provider, { accounts, keys, locationId, useCatalogPrice }) =>
      api.post(`/customers/${cid}/seat-sync/${provider}/apply`, {
        account: accounts.join(','), keys, location_id: locationId || null, use_catalog_price: !!useCatalogPrice,
      }),
  },

  dell: {
    plan:  (cid, refresh = false) => api.get(`/customers/${cid}/warranty/dell`, { params: refreshParam(refresh) }),
    apply: (cid, deviceIds)       => api.post(`/customers/${cid}/warranty/dell/apply`, { device_ids: deviceIds }),
  },

  unifi: {
    consoles: (refresh = false) => api.get('/unifi/consoles', { params: refreshParam(refresh) }),
    preview:  (cid, { hostId, siteId, cameraSystemId }, refresh = false) =>
      api.get(`/customers/${cid}/unifi/preview`, {
        params: { hostId, ...(siteId ? { siteId } : {}), ...(cameraSystemId ? { cameraSystemId } : {}), ...refreshParam(refresh) },
      }),
    import: (cid, { hostId, siteId, deviceKeys, clientKeys, cameraKeys, wifiKeys, cameraSystemId, locationId, moveExisting, takeNewer }) =>
      api.post(`/customers/${cid}/unifi/import`, {
        hostId, siteId: siteId || null, device_keys: deviceKeys, client_keys: clientKeys, camera_keys: cameraKeys, wifi_keys: wifiKeys,
        camera_system_id: cameraSystemId || null, location_id: locationId || null, move_existing: Boolean(moveExisting),
        take_newer: Boolean(takeNewer),
      }),
  },

  tdsynnex: {
    customers: (refresh = false) => api.get('/tdsynnex/customers', { params: refreshParam(refresh) }),
    preview:   (cid, customerNo, refresh = false) =>
      api.get(`/customers/${cid}/tdsynnex/preview`, { params: { customerNo, ...refreshParam(refresh) } }),
    import:    (cid, { customerNo, keys, locationId }) =>
      api.post(`/customers/${cid}/tdsynnex/import`, { customerNo, keys, location_id: locationId || null }),
  },
};
