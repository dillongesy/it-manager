// English pluralization for UI labels - device type headings ("Switch" →
// "Switches") and free-typed unit labels on recurring charges ("3 seats").

// Words already entered in plural form are left alone. Unit labels are typed by
// hand, so plenty of existing charges already say "seats"/"licenses" - those must
// not become "seatss".
const alreadyPlural = (w) => /s$/i.test(w) && !/(ss|us|is)$/i.test(w);

// Pluralize `word`. Returns it unchanged when `count` is exactly 1.
export function pluralize(word, count = 2) {
  const w = (word ?? '').trim();
  if (!w || count === 1) return w;
  if (alreadyPlural(w)) return w;
  if (/(ch|sh|s|x|z)$/i.test(w)) return `${w}es`;          // switch → switches
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`; // entity → entities
  return `${w}s`;
}

// "3 seats" / "1 seat" - count plus its (optionally blank) unit label.
export function countLabel(count, unit) {
  const u = pluralize(unit, count);
  return u ? `${count} ${u}` : `${count}`;
}
