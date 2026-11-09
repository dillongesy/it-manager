/**
 * Format a raw string into a phone number.
 *
 * 10 digits:  (XXX) XXX-XXXX
 * >10 digits: +CC (XXX) XXX-XXXX  (extra leading digits become the country code)
 * <10 digits: partial progressive format - useful while the user is typing
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 3)  return `(${digits}`;
  if (digits.length <= 6)  return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  // >10 digits: last 10 are the local number, everything before is the country code
  const country = digits.slice(0, digits.length - 10);
  const local   = digits.slice(-10);
  return `+${country} (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}
