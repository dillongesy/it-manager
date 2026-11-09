import { config } from '../config/index.js';

/**
 * Thin client for the shared-inventory bridge. The Portal calls the Field App's
 * /api/service/* endpoints with the static service token. This is the ONE place
 * the Portal reaches into the Field App — strictly one-way, read + checkout only.
 */

export function isFieldConfigured() {
  return Boolean(config.fieldApi.url && config.fieldApi.token);
}

class FieldBridgeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(path, { method = 'GET', body } = {}) {
  if (!isFieldConfigured()) {
    throw new FieldBridgeError('The Field App bridge is not configured.', 503);
  }

  const base = config.fieldApi.url.replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-Service-Token': config.fieldApi.token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure — Field server unreachable.
    throw new FieldBridgeError('Could not reach the Field App inventory service.', 502);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new FieldBridgeError(data?.error || 'Field inventory request failed.', res.status);
  }
  return data;
}

// Like `call` but returns the raw fetch Response so the caller can stream the body
// (used to pipe field-job photo bytes straight through to the browser).
async function callRaw(path) {
  if (!isFieldConfigured()) {
    throw new FieldBridgeError('The Field App bridge is not configured.', 503);
  }
  const base = config.fieldApi.url.replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers: { 'X-Service-Token': config.fieldApi.token } });
  } catch {
    throw new FieldBridgeError('Could not reach the Field App.', 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = 'Field request failed.';
    try { msg = JSON.parse(text)?.error || msg; } catch {}
    throw new FieldBridgeError(msg, res.status);
  }
  return res;
}

export const fieldInventory = {
  list:       (params = {}) => call(`/api/service/inventory${toQuery(params)}`),
  categories: ()           => call('/api/service/inventory/categories'),
  get:        (id)         => call(`/api/service/inventory/${encodeURIComponent(id)}`),
  create:     (body)       => call('/api/service/inventory', { method: 'POST', body }),
  update:     (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  receive:    (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}/receive`, { method: 'POST', body }),
  adjust:     (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}/adjust`, { method: 'POST', body }),
  checkout:   (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}/checkout`, { method: 'POST', body }),
  return:     (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}/return`, { method: 'POST', body }),
  remove:     (id, body)   => call(`/api/service/inventory/${encodeURIComponent(id)}`, { method: 'DELETE', body }),
};

// Field job captures — Portal pulls "ready" captures, reads photo bytes, and marks
// a capture imported once it becomes a Portal work order. Strictly Portal→Field.
export const fieldJobs = {
  list:         (params = {})    => call(`/api/service/field-jobs${toQuery(params)}`),
  get:          (id)            => call(`/api/service/field-jobs/${encodeURIComponent(id)}`),
  photo:        (id, photoId)   => callRaw(`/api/service/field-jobs/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`),
  markImported: (id, body)      => call(`/api/service/field-jobs/${encodeURIComponent(id)}/imported`, { method: 'POST', body }),
};

export function toQuery(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// Platform plumbing over the same one-way bridge (Portal → Field):
//   branding  — the Portal is the single place branding is edited; it pushes a full
//               copy (settings + images) to the Field App, which only stores it.
//   bootstrap — the setup wizard creates the Field App's first admin with the same
//               login, so a fresh install needs no command-line seeding. The Field
//               side refuses once any real user exists.
export const fieldPlatform = {
  health:         ()     => call('/api/service/health'),
  pushBranding:   (body) => call('/api/service/branding', { method: 'PUT', body }),
  bootstrapAdmin: (body) => call('/api/service/bootstrap-admin', { method: 'POST', body }),
};
