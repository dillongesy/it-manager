// Minimal IPv4 CIDR matching (handles IPv4-mapped IPv6 addresses).
function toInt(ip) {
  const m = String(ip ?? '').replace(/^::ffff:/i, '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(p => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipInCidr(ip, cidr) {
  const [range, bitsStr] = String(cidr).split('/');
  const bits = Number(bitsStr ?? 32);
  const a = toInt(ip);
  const b = toInt(range);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
