// Pure logic for turning a Field App job capture into a Portal work order, kept
// out of the route so it can be unit-tested without a database or the bridge.
//
// A field job is a list of DAYS (Field migration 006). Each day carries its own
// date, crew with per-technician hours, parts and services - and becomes exactly
// one work_order_section here, since a section already has its own
// work_date/hours/description.
//
// Labor RATES are not part of the import. The field app records what happened;
// the biller sets what it's worth, per section, on the work order - every imported
// section inherits the work order's default rate and can be overridden there.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A day's hours is the sum of its technicians'; a blank counts as 0. */
export const sumDayHours = (day) =>
  (day?.technicians ?? []).reduce((sum, t) => sum + num(t.hours), 0);

/**
 * "DG 4, RM 2.5" - the per-technician split. The Portal stores one number per
 * section, so this breakdown is preserved as text in the section's internal notes
 * rather than being lost at the bridge. Returns '' when nobody logged hours.
 */
export function hoursBreakdown(day) {
  const parts = (day?.technicians ?? [])
    .map((t) => ({ label: (t.initials || t.full_name || '').trim(), hours: num(t.hours) }))
    .filter((t) => t.label && t.hours > 0)
    .map((t) => `${t.label} ${t.hours}`);
  return parts.join(', ');
}

/** Technician display names for a day, deduped, in order. */
export function dayTechnicianNames(day) {
  const seen = new Set();
  const names = [];
  for (const t of day?.technicians ?? []) {
    const name = (t.full_name || t.initials || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Internal notes for one imported section. The first section also carries the
 * job-level provenance (which capture, which field customer, the site address and
 * the whole-job notes) so the biller can trace it back.
 */
export function buildSectionNotes({ job, day, isFirst }) {
  const lines = [];
  if (isFirst) {
    lines.push(`Imported from Field Job #${job.number}`);
    if (job.customer_name) lines.push(`Field customer: ${job.customer_name}`);
    if (job.customer_address) lines.push(`Site: ${job.customer_address}`);
    if (job.notes) lines.push(`Job notes: ${job.notes}`);
  }
  const breakdown = hoursBreakdown(day);
  if (breakdown) lines.push(`Hours: ${breakdown}`);
  if (day.notes) lines.push(day.notes);
  return lines.join('\n') || null;
}

// --- Matching field crew to Portal user accounts ------------------------------
//
// The Field App has its own user table, so a camera tech who ALSO has a Portal login
// arrives here as a plain name string. Imported blind, that produced a duplicate on
// the work order: the Portal user sitting unselected in the technician picker, plus a
// free-text chip with the same person's name. These helpers collapse that - a field
// name that resolves to a Portal user is attached as the real linked user, and only
// genuinely unknown people (subcontractors, crew with no Portal account) stay free text.

const normalizeName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "Marty Bornhoft" → "mb". Empty when a name has no usable word characters. */
export function initialsOf(fullName) {
  return String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, '').charAt(0))
    .join('')
    .toLowerCase();
}

/**
 * Resolve one field-entered technician name against the Portal roster.
 * @param name   the field app's string ("Marty Bornhoft", "MB")
 * @param users  [{ id, full_name }] - active Portal users
 * @returns the matching user id, or null to keep it as free text.
 *
 * Two passes, deliberately in this order:
 *   1. Full name, case- and whitespace-insensitive. Unambiguous.
 *   2. Initials ("MB"), but ONLY when exactly one Portal user has them. Field techs
 *      often log themselves by initials, but "DG" could be two different people -
 *      and mis-attributing labor on a billable work order is worse than a free-text
 *      chip the biller can fix, so an ambiguous match stays free text.
 */
export function matchPortalUser(name, users = []) {
  const key = normalizeName(name);
  if (!key) return null;

  const byName = users.filter((u) => normalizeName(u.full_name) === key);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) return null;          // two users share a name — don't guess

  if (/^[a-z]{2,3}$/.test(key)) {
    const byInitials = users.filter((u) => initialsOf(u.full_name) === key);
    if (byInitials.length === 1) return byInitials[0].id;
  }
  return null;
}

/**
 * Split a day's crew into linked Portal users and free-text names.
 * Both lists are deduped: the same person logged twice (say once by name and once by
 * initials) becomes one technician, not two rows.
 * @returns {{ userIds: string[], freeNames: string[] }}
 */
export function splitTechnicians(day, users = []) {
  const userIds = [];
  const freeNames = [];
  const seenUsers = new Set();
  const seenNames = new Set();

  for (const name of dayTechnicianNames(day)) {
    const userId = matchPortalUser(name, users);
    if (userId) {
      if (seenUsers.has(userId)) continue;
      seenUsers.add(userId);
      userIds.push(userId);
    } else {
      const key = normalizeName(name);
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      freeNames.push(name);
    }
  }
  return { userIds, freeNames };
}

/**
 * Older captures (pre-006, or anything that somehow arrives flat) have no `days`
 * array. Fold them into a single day so the importer only ever handles one shape.
 */
export function jobDays(job) {
  if (Array.isArray(job?.days) && job.days.length) return job.days;
  return [{
    work_date: job?.work_date ?? null,
    description: job?.description ?? null,
    notes: null,
    technicians: job?.technicians ?? [],
    items: job?.items ?? [],
    services: job?.services ?? [],
    // A pre-006 capture's lump total has no per-tech split to reconstruct.
    legacy_hours: job?.hours ?? null,
  }];
}
