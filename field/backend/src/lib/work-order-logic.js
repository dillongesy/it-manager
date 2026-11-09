// Pure, dependency-free work-order logic. Separate from the route handlers so it
// can be unit-tested without a database.

// --- Billing lifecycle (deprecated) ----------------------------------------------
// Field work orders are job captures; billing happens in the Portal. These values
// remain only for the `status` column on existing rows.
export const WO_STATUSES = ['draft', 'submitted', 'pending_billing', 'invoiced', 'paid'];
export const WO_TRANSITIONS = {
  submit:  { from: 'draft',           to: 'pending_billing', tsField: 'submitted_at' },
  invoice: { from: 'pending_billing', to: 'invoiced',        tsField: 'invoiced_at' },
  pay:     { from: 'invoiced',        to: 'paid',            tsField: 'paid_at' },
};

// --- Service cadences -----------------------------------------------------------
// A recurring service carries a base period plus an INTERVAL COUNT: how many of those
// periods pass between bills. Count 1 is the ordinary case and the default, so nothing
// captured before this existed changes. Only a YEARLY period may carry a count above 1
// ("every 3 years" - a domain registration, a multi-year cert); anything else is
// forced back to 1, because "every 2 quarters" reads worse than "semi-annual" and no
// label or import path is written for it.
//
// This deliberately mirrors the Portal's lib/cadence.js: the value crosses the bridge
// on import, so both sides have to agree on what is legal.
export const MAX_INTERVAL_COUNT = 50;

export const isAnnualCadence = (recurrence) => recurrence === 'annual' || recurrence === 'annually';

export function coerceIntervalCount(value, recurrence) {
  if (!isAnnualCadence(recurrence)) return 1;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_INTERVAL_COUNT);
}

// --- Capture lifecycle (current) ------------------------------------------------
// open -> ready -> imported. See migration 004.
export const CAPTURE_STATUSES = ['open', 'ready', 'imported'];

/** A capture is editable/deletable only while still 'open'. */
export function isEditable(captureStatus) {
  return captureStatus === 'open';
}
export function isDeletable(captureStatus) {
  return captureStatus === 'open';
}

/**
 * Validate a capture-status transition. Stock is decremented on open->ready and
 * returned on ready->open; 'imported' is a terminal, locked state set by the
 * Portal bridge only. Returns { ok } or { ok:false, error }.
 */
export function canTransitionCapture(from, to) {
  const allowed = { open: ['ready'], ready: ['open'], imported: [] };
  if (!CAPTURE_STATUSES.includes(to)) return { ok: false, error: `Unknown status '${to}'.` };
  if (!allowed[from]?.includes(to)) {
    return { ok: false, error: `Cannot move a '${from}' job to '${to}'.` };
  }
  return { ok: true };
}

/**
 * Normalize one technician entry into a DB row shape. A technician is EITHER a
 * linked user account ({ user_id }) OR free-typed ({ initials, name }). For a
 * linked user we store only user_id (name/initials come from the users table via
 * JOIN); for free-text we store the typed initials/name. Returns null for empty
 * entries so callers can skip them.
 */
export function normalizeTechnician(t) {
  if (!t) return null;
  const userId = t.user_id || null;
  const initials = (t.initials || '').toUpperCase().trim() || null;
  const name = t.name || t.full_name || null;
  if (!userId && !initials) return null;
  return {
    user_id: userId,
    initials: userId ? null : initials,
    name: userId ? null : name,
  };
}

/** Normalize + drop empties from a technician list. */
export function normalizeTechnicians(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeTechnician).filter(Boolean);
}

// --- Days (migration 006) -------------------------------------------------------
// A job is a list of days; each day carries its own date, crew (with per-tech
// hours), parts and services. A day maps 1:1 onto a Portal section. Labor rates
// are not captured here - the office sets them per section in the Portal.

/**
 * Hours parse leniently: a blank field counts as 0 rather than blocking a save,
 * so a tech can capture the crew now and fill in the split later. Negative and
 * non-numeric values collapse to null (stored blank, counted as 0).
 */
export function parseHours(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  // NUMERIC(6,2) - two decimals, and well under the column's range.
  return Math.min(Math.round(n * 100) / 100, 9999.99);
}

/** A day's hours is ALWAYS the sum of its technicians'; blanks count as 0. */
export function dayHours(day) {
  return (day?.technicians ?? []).reduce((sum, t) => sum + (parseHours(t?.hours) ?? 0), 0);
}

/** Total hours across every day of a job. */
export function totalHours(days) {
  return (days ?? []).reduce((sum, d) => sum + dayHours(d), 0);
}

/**
 * Per-technician totals across the whole job, e.g. [{ label:'DG', hours:7 }].
 * Used for the job summary and for the hours breakdown the Portal writes into
 * the imported section's internal notes.
 */
export function hoursByTechnician(days) {
  const totals = new Map();
  for (const day of days ?? []) {
    for (const t of day?.technicians ?? []) {
      const label = (t.initials || t.full_name || t.name || '').trim();
      if (!label) continue;
      totals.set(label, (totals.get(label) ?? 0) + (parseHours(t.hours) ?? 0));
    }
  }
  return [...totals].map(([label, hours]) => ({ label, hours }));
}

/**
 * Normalize one incoming day into a DB row shape + its nested children. Days with
 * nothing on them at all are dropped so an accidental "+ Add day" tap doesn't
 * persist an empty section. Returns null for such a day.
 */
export function normalizeDay(day, index = 0) {
  if (!day) return null;
  // Attach hours per raw entry BEFORE filtering - normalizeTechnicians drops
  // empties, so mapping by index afterwards would misalign the hours.
  const technicians = (day.technicians ?? [])
    .map((t) => {
      const row = normalizeTechnician(t);
      return row && { ...row, hours: parseHours(t.hours) };
    })
    .filter(Boolean);
  const items = (day.items ?? []).filter((it) => it?.description?.trim());
  const services = (day.services ?? []).filter((sv) => sv?.description?.trim());
  const description = day.description?.trim() || null;
  const notes = day.notes?.trim() || null;

  const empty = !technicians.length && !items.length && !services.length && !description && !notes;
  if (empty && !day.id && !day.work_date) return null;

  return {
    work_date: day.work_date || null,
    description,
    notes,
    sort_order: (index + 1) * 10,
    technicians,
    items,
    services,
  };
}

/** Normalize a whole day list, dropping empties and renumbering sort_order. */
export function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days
    .map((d, i) => normalizeDay(d, i))
    .filter(Boolean)
    .map((d, i) => ({ ...d, sort_order: (i + 1) * 10 }));
}
