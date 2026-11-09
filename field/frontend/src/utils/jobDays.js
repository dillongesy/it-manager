// Client-side mirror of the backend's day/hours rules (lib/work-order-logic.js).
// A job is a list of days; a day's hours is ALWAYS the sum of its technicians'
// hours, and a blank counts as 0 — so a tech can capture the crew now and fill in
// the split later without the form fighting them.

export function parseHours(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const dayHours = (day) =>
  (day?.technicians ?? []).reduce((sum, t) => sum + parseHours(t.hours), 0);

export const totalHours = (days) =>
  (days ?? []).reduce((sum, d) => sum + dayHours(d), 0);

/** Trim trailing zeros so 4.00 reads "4" and 2.50 reads "2.5". */
export const fmtHours = (h) => {
  const n = Number(h) || 0;
  return String(Math.round(n * 100) / 100);
};

/** Per-technician totals across the whole job → [{ label, name, hours }]. */
export function hoursByTechnician(days) {
  const totals = new Map();
  for (const day of days ?? []) {
    for (const t of day.technicians ?? []) {
      const label = (t.initials || t.full_name || '').trim();
      if (!label) continue;
      const prev = totals.get(label) ?? { label, name: t.full_name || null, hours: 0 };
      totals.set(label, { ...prev, hours: prev.hours + parseHours(t.hours) });
    }
  }
  return [...totals.values()];
}

// ─── Dates ──────────────────────────────────────────────────────────────────────
// Job dates are plain calendar days ('YYYY-MM-DD'). `new Date('2026-07-20')` parses
// as UTC midnight and renders as the 19th anywhere west of Greenwich, so build the
// Date from its parts instead.

export function toDateInput(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function localDate(value) {
  const iso = toDateInput(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Mon, Jul 20" — short enough for a day header on a phone. */
export function formatDayDate(value) {
  const d = localDate(value);
  if (!d) return 'No date';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Jul 20", or "Jul 20 – Jul 24" when a job spans days. */
export function formatDateRange(first, last) {
  const a = localDate(first);
  const b = localDate(last);
  if (!a) return '';
  const short = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!b || short(a) === short(b)) return short(a);
  return `${short(a)} – ${short(b)}`;
}

export const todayInput = () => toDateInput(new Date().toLocaleDateString('sv'));

/** The day after `value` (used to prefill the next day added to a job). */
export function nextDay(value) {
  const d = localDate(value);
  if (!d) return todayInput();
  d.setDate(d.getDate() + 1);
  return toDateInput(d.toLocaleDateString('sv'));
}

// ─── Day construction ───────────────────────────────────────────────────────────

export const blankDay = (work_date = todayInput()) => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  work_date,
  description: '',
  notes: '',
  technicians: [],
  items: [],
  services: [],
});

/**
 * The next day of a multi-day job is nearly always the same crew back on site the
 * following day, so prefill both — with hours cleared, since those are what's
 * actually new.
 */
export function dayAfter(prev) {
  if (!prev) return blankDay();
  return {
    ...blankDay(nextDay(prev.work_date)),
    technicians: (prev.technicians ?? []).map((t) => ({ ...t, hours: '' })),
  };
}

/** Server day → form day (stable `key` for React, strings for inputs). */
export function toFormDay(day) {
  return {
    key: day.id,
    id: day.id,
    work_date: toDateInput(day.work_date),
    description: day.description || '',
    notes: day.notes || '',
    technicians: (day.technicians ?? []).map((t) => ({
      user_id: t.user_id || null,
      initials: t.initials || '',
      full_name: t.full_name || null,
      hours: t.hours == null ? '' : String(Number(t.hours)),
    })),
    items: (day.items ?? []).map((it) => ({
      inventory_item_id: it.inventory_item_id,
      sku: it.sku,
      description: it.description || it.item_name,
      quantity: Number(it.quantity),
      unit_price: it.unit_price ?? '',
    })),
    services: (day.services ?? []).map((sv) => ({
      description: sv.description,
      quantity: Number(sv.quantity),
      unit_price: sv.unit_price ?? '',
      billing_type: sv.billing_type || 'one_time',
      recurrence: sv.recurrence || 'monthly',
      recurrence_count: sv.recurrence_count ?? 1,
    })),
  };
}
