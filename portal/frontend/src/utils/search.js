// Deep client-side search for customer records. Flattens every meaningful string/number
// in an item (including nested JSONB like storage drives, VLANs, custom-field labels,
// license-key titles) into one lowercased blob, then matches all query terms (AND).
//
// Noise + secret keys are skipped: ids, foreign keys, timestamps, sort order, encrypted
// blobs (*_enc), and has_/is_ flags. Encrypted values never reach the client anyway —
// the server strips them and only returns labels/has_value — so this can't leak secrets.
const SKIP_KEY = /(^id$|_id$|_enc$|_at$|^has_|^is_|sort_order|created_by|updated_by|done_by|_localid$|stored_name|mime_type|size_bytes|proposal_status)/i;

export function searchableText(value, depth = 0) {
  if (value == null || depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(v => searchableText(v, depth + 1)).join(' ');
  if (typeof value === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEY.test(k)) continue;
      parts.push(searchableText(v, depth + 1));
    }
    return parts.join(' ');
  }
  return '';
}

// True when every whitespace-separated term in `query` appears somewhere in the item.
// Empty query matches everything.
export function matchesQuery(item, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const text = searchableText(item).toLowerCase();
  return q.split(/\s+/).every(term => text.includes(term));
}
