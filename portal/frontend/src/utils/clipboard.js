// Copy text to the clipboard, with a fallback for non-secure contexts.
//
// `navigator.clipboard` only exists in secure contexts (HTTPS or localhost). The Portal
// is often reached over plain HTTP on the LAN (e.g. http://192.168.x.x), where
// `navigator.clipboard` is undefined and the modern call silently throws. In that case
// we fall back to a hidden <textarea> + document.execCommand('copy'), which works on HTTP.
// Returns true on success.
export async function copyText(text) {
  if (text == null) return false;
  const str = String(text);

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch { /* fall through to legacy path */ }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
