// Normalize a user-entered link (firewall management URL, driver/mgmt link, etc.)
// into a safe absolute href.
//
// Two real-world problems these fields hit:
//
// 1. No scheme -- entered as a bare host or IP ("192.168.1.1", "firewall.local:4443").
//    Without a scheme the browser treats the href as RELATIVE, so clicking navigates
//    inside the Portal instead of opening the device.
//
// 2. Invisible characters -- a zero-width space, non-breaking space, BOM, soft hyphen,
//    or bidi mark pasted in with the URL (common when copied from email/PDF/chat). The
//    field LOOKS like "https://104.222.91.79" but the stored value carries a hidden
//    character. The browser strips it when you paste into the address bar (so copy ->
//    paste works), but follows the raw, broken value when you click the link (so the
//    link and even "open in new tab" silently fail). Plain .trim() does NOT remove
//    zero-width characters, so we strip them by code point.

// True for invisible / formatting code points that don't belong in a URL:
// C0 controls, DEL + C1, NBSP, soft hyphen, zero-width chars, bidi marks,
// line/paragraph separators, word joiner, and the BOM / zero-width no-break space.
function isInvisible(c) {
  return c <= 0x1f
    || (c >= 0x7f && c <= 0xa0)
    || c === 0xad
    || (c >= 0x200b && c <= 0x200f)
    || (c >= 0x2028 && c <= 0x202e)
    || c === 0x2060
    || (c >= 0x2066 && c <= 0x2069)
    || c === 0xfeff;
}

export function externalHref(url) {
  let t = '';
  for (const ch of String(url ?? '')) {
    if (!isInvisible(ch.codePointAt(0))) t += ch;
  }
  t = t.trim();
  if (!t) return t;
  if (!/^[a-zA-Z][\w+.-]*:\/\//.test(t)) t = `https://${t}`;
  // Normalize through the URL parser (matches what the browser does on paste); if it
  // won't parse, fall back to the cleaned string rather than break the link entirely.
  try { return new URL(t).href; } catch { return t; }
}
