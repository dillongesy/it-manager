import api from './client.js';

export const customersApi = {
  list:   (params)           => api.get('/customers', { params }),
  get:    (id)               => api.get(`/customers/${id}`),
  create: (data)             => api.post('/customers', data),
  update: (id, data)         => api.patch(`/customers/${id}`, data),
  remove: (id)               => api.delete(`/customers/${id}`),

  locations: {
    create: (cid, data)      => api.post(`/customers/${cid}/locations`, data),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/locations/${id}`, data),
    remove: (cid, id)        => api.delete(`/customers/${cid}/locations/${id}`),
  },

  contacts: {
    reorder: (cid, ids)      => api.post(`/customers/${cid}/contacts/reorder`, { ids }),
  },

  rates: {
    reorder: (cid, ids)      => api.post(`/customers/${cid}/rates/reorder`, { ids }),
  },

  devices: {
    list:   (cid)            => api.get(`/customers/${cid}/devices`),
    create: (cid, data)      => api.post(`/customers/${cid}/devices`, data),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/devices/${id}`, data),
    remove: (cid, id)        => api.delete(`/customers/${cid}/devices/${id}`),
    reveal: (cid, id, field) => api.post(`/customers/${cid}/devices/${id}/reveal`, { field }),
    reorder:      (cid, ids)   => api.post(`/customers/${cid}/devices/reorder`, { ids }),
    reorderTypes: (cid, types) => api.post(`/customers/${cid}/devices/types/reorder`, { types }),
    suggest: (cid, field, type, q) =>
      api.get(`/customers/${cid}/devices/suggestions`, { params: { field, type, q } }),
  },

  credentials: {
    list:   (cid)            => api.get(`/customers/${cid}/credentials`),
    create: (cid, data)      => api.post(`/customers/${cid}/credentials`, data),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/credentials/${id}`, data),
    remove: (cid, id)        => api.delete(`/customers/${cid}/credentials/${id}`),
    reveal: (cid, id)        => api.post(`/customers/${cid}/credentials/${id}/reveal`),
    revealCustom: (cid, id, index) => api.post(`/customers/${cid}/credentials/${id}/custom/${index}/reveal`),
    move:        (cid, id, direction)        => api.post(`/customers/${cid}/credentials/${id}/move`, { direction }),
    moveSection: (cid, category, direction)  => api.post(`/customers/${cid}/credentials/sections/move`, { category, direction }),
    reorder:         (cid, ids)        => api.post(`/customers/${cid}/credentials/reorder`, { ids }),
    reorderSections: (cid, categories) => api.post(`/customers/${cid}/credentials/sections/reorder`, { categories }),
    renameSection:   (cid, from, to)   => api.post(`/customers/${cid}/credentials/sections/rename`, { from, to }),
    sectionSuggestions: (cid)          => api.get(`/customers/${cid}/credentials/sections/suggestions`),
  },

  cameras: {
    list:   (cid)            => api.get(`/customers/${cid}/cameras`),
    create: (cid, data)      => api.post(`/customers/${cid}/cameras`, data),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/cameras/${id}`, data),
    remove: (cid, id)        => api.delete(`/customers/${cid}/cameras/${id}`),
    reveal: (cid, id)        => api.post(`/customers/${cid}/cameras/${id}/reveal`),
    shared: {
      list:   (cid, camId)              => api.get(`/customers/${cid}/cameras/${camId}/shared`),
      create: (cid, camId, data)        => api.post(`/customers/${cid}/cameras/${camId}/shared`, data),
      update: (cid, camId, id, data)    => api.patch(`/customers/${cid}/cameras/${camId}/shared/${id}`, data),
      remove: (cid, camId, id)          => api.delete(`/customers/${cid}/cameras/${camId}/shared/${id}`),
      reveal: (cid, camId, id)          => api.post(`/customers/${cid}/cameras/${camId}/shared/${id}/reveal`),
    },
    // The individual cameras on a system (camId = the NVR/DVR system).
    cams: {
      list:    (cid, camId)             => api.get(`/customers/${cid}/cameras/${camId}/cameras`),
      create:  (cid, camId, data)       => api.post(`/customers/${cid}/cameras/${camId}/cameras`, data),
      update:  (cid, camId, id, data)   => api.patch(`/customers/${cid}/cameras/${camId}/cameras/${id}`, data),
      remove:  (cid, camId, id)         => api.delete(`/customers/${cid}/cameras/${camId}/cameras/${id}`),
      reveal:  (cid, camId, id)         => api.post(`/customers/${cid}/cameras/${camId}/cameras/${id}/reveal`),
      reorder: (cid, camId, ids)        => api.post(`/customers/${cid}/cameras/${camId}/cameras/reorder`, { ids }),
    },
  },

  guides: {
    list:   (cid)            => api.get(`/customers/${cid}/guides`),
    get:    (cid, id)        => api.get(`/customers/${cid}/guides/${id}`),
    create: (cid, data)      => api.post(`/customers/${cid}/guides`, data),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/guides/${id}`, data),
    remove: (cid, id)        => api.delete(`/customers/${cid}/guides/${id}`),
  },

  files: {
    list:   (cid, kind)      => api.get(`/customers/${cid}/files`, { params: kind ? { kind } : undefined }),
    upload: (cid, formData)  => api.post(`/customers/${cid}/files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    update: (cid, id, data)  => api.patch(`/customers/${cid}/files/${id}`, data),
    renameCategory: (cid, kind, from, to) => api.post(`/customers/${cid}/files/categories/rename`, { kind, from, to }),
    download: (cid, id)      => api.get(`/customers/${cid}/files/${id}/download`, { responseType: 'blob' }),
    view:     (cid, id)      => api.get(`/customers/${cid}/files/${id}/download`, { params: { inline: 1 }, responseType: 'blob' }),
    remove: (cid, id)        => api.delete(`/customers/${cid}/files/${id}`),
  },


  licenses: {
    list:      (cid)               => api.get(`/customers/${cid}/licenses`),
    create:    (cid, data)         => api.post(`/customers/${cid}/licenses`, data),
    update:    (cid, id, data)     => api.patch(`/customers/${cid}/licenses/${id}`, data),
    remove:    (cid, id)           => api.delete(`/customers/${cid}/licenses/${id}`),
    revealKey: (cid, id, keyId)    => api.post(`/customers/${cid}/licenses/${id}/keys/${keyId}/reveal`),
  },

  recurringCharges: {
    list:   (cid)          => api.get(`/customers/${cid}/recurring-charges`),
    create: (cid, data)    => api.post(`/customers/${cid}/recurring-charges`, data),
    update: (cid, id, data)=> api.patch(`/customers/${cid}/recurring-charges/${id}`, data),
    remove: (cid, id)      => api.delete(`/customers/${cid}/recurring-charges/${id}`),
  },

  export: {
    // Provider handoff workbook (.xlsx) — admin-only, re-auth via password. Returns a blob.
    provider: (cid, password) =>
      api.post(`/customers/${cid}/export/provider`, { password }, { responseType: 'blob' }),
  },
};
