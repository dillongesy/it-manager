import { Router } from 'express';
import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp } from '../middleware/audit.js';
import { isOutlookConfigured, calendarEvents, getEvent, updateEvent, createEvent, deleteEvent, OutlookError } from '../lib/outlook-client.js';
import {
  normalizeEvents, normalizeEvent, eventPatch, eventCreate, endSeriesBefore, recurrenceText, recurrenceSpec, utcIso,
} from '../lib/outlook.js';

//   GET    /api/outlook/events?start=<ISO>&end=<ISO>[&refresh=1]
//     The shared Outlook calendar's events in that range for the Tasks schedule, repeating
//     events expanded - each with the techs it's for (user_ids), and task_id when it's the event
//     "Add to Outlook" made for a task (the schedule shows the task instead). Always 200
//     { configured, events, error? }, so an Outlook problem shows as a note, not a broken page.
//   GET    /api/outlook/events/:id   - one event with its description and reminder, plus its series
//                                      (pattern in words and as repeat settings) if it repeats
//   POST   /api/outlook/events       - a new event made in the Portal (fields: eventCreate in lib/outlook.js)
//   PATCH  /api/outlook/events/:id   - edit it. { scope: 'occurrence' | 'series', etag, ...fields (eventPatch) }
//   DELETE /api/outlook/events/:id?scope=occurrence|following|series[&etag=]
//     occurrence - just this one; following - this and every later one (the series ends the day
//     before); series - every one. A single event ignores the scope.
// Everything that changes Outlook is audited as entity outlook_event. Events are never turned
// into tasks; events a task put there are changed through the task. Private events are view-only.

const MAX_SPAN = 62 * 86_400_000;
export const outlookRouter = Router();

const techs = () => query(`SELECT id, full_name FROM users WHERE is_active AND role <> 'biller'`).then(r => r.rows);
const zone = () => config.outlook.timeZone;
const notConfigured = (res) => res.status(503).json({ error: 'The Outlook calendar is not configured.' });
const tNum = (n) => `T-${String(n).padStart(5, '0')}`;

/** Event id → task, for the events tasks put on the calendar (empty before migration 063 runs). */
async function taskLinks(ids) {
  if (!ids.length) return new Map();
  try {
    const { rows } = await query('SELECT id, number, outlook_event_id FROM tasks WHERE outlook_event_id = ANY($1)', [ids]);
    return new Map(rows.map(r => [r.outlook_event_id, r]));
  } catch { return new Map(); }
}

const outlookError = (res, err) => res.status(err.status && err.status < 600 ? err.status : 502).json({ error: err.message });
const audit = (req, action, name, changes = null) => logAudit({
  userId: req.user.sub, userName: req.user.fullName, action, entityType: 'outlook_event', entityId: null, entityName: name, changes, ipAddress: getClientIp(req),
});

/** An event the Portal may change: not private, not a task's own. Returns an error response or null. */
async function guard(res, raw) {
  if (normalizeEvent(raw)?.private) return res.status(403).json({ error: 'That event is private — change it in Outlook.' });
  const link = (await taskLinks([raw.id])).get(raw.id);
  if (link) return res.status(409).json({ error: `That event belongs to task ${tNum(link.number)} — change the task instead.` });
  return null;
}

outlookRouter.get('/events', requireAuth, async (req, res, next) => {
  if (!isOutlookConfigured()) return res.json({ configured: false, events: [] });
  const start = new Date(String(req.query.start ?? ''));
  const end = new Date(String(req.query.end ?? ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'start and end must be dates, with end after start.' });
  }
  if (end - start > MAX_SPAN) return res.status(400).json({ error: 'Ask for at most about two months at a time.' });
  try {
    const [raw, users] = await Promise.all([calendarEvents(start.toISOString(), end.toISOString(), req.query.refresh === '1'), techs()]);
    const events = normalizeEvents(raw, users);
    const links = await taskLinks(events.map(e => e.id));
    for (const e of events) if (links.has(e.id)) e.task_id = links.get(e.id).id;
    res.json({ configured: true, events });
  } catch (err) {
    if (err instanceof OutlookError) return res.json({ configured: true, events: [], error: err.message });
    next(err);
  }
});

/** The editable side of a raw event (a private one shows no description). */
function detailOf(raw, users) {
  const ev = normalizeEvent(raw, users) ?? { id: raw.id, title: raw.subject ?? '', private: false };
  return {
    ...ev,
    notes: ev.private ? null : String(raw.body?.content ?? '').replace(/\r\n/g, '\n').trim(),
    categories: ev.private ? [] : raw.categories ?? [],
    reminder_minutes: raw.isReminderOn ? raw.reminderMinutesBeforeStart ?? 15 : null,
  };
}

outlookRouter.get('/events/:id', requireAuth, async (req, res, next) => {
  if (!isOutlookConfigured()) return notConfigured(res);
  try {
    const users = await techs();
    const raw = await getEvent(req.params.id);
    const event = detailOf(raw, users);
    let series = null;
    if (raw.seriesMasterId) {
      const master = await getEvent(raw.seriesMasterId);
      series = { ...detailOf(master, users), recurrence_text: recurrenceText(master.recurrence), repeat: recurrenceSpec(master.recurrence) };
    }
    const link = (await taskLinks([raw.id])).get(raw.id);
    res.json({ event, series, task_id: link?.id ?? null, time_zone: zone() });
  } catch (err) {
    if (err instanceof OutlookError) return outlookError(res, err);
    next(err);
  }
});

outlookRouter.post('/events', requireAuth, async (req, res, next) => {
  if (!isOutlookConfigured()) return notConfigured(res);
  try {
    const plan = eventCreate(req.body ?? {}, { zone: zone(), users: await techs() });
    if (!plan.ok) return res.status(400).json({ error: plan.error });
    const created = await createEvent(plan.event);
    await audit(req, 'CREATE', `${plan.event.subject}${plan.event.recurrence ? ' (repeating)' : ''}`, {
      start: { to: plan.event.start.dateTime }, end: { to: plan.event.end.dateTime }, ...(plan.event.recurrence ? { repeat: { to: recurrenceText(plan.event.recurrence) } } : {}),
    });
    res.status(201).json({ id: created?.id ?? null });
  } catch (err) {
    if (err instanceof OutlookError) return outlookError(res, err);
    next(err);
  }
});

const AUDIT_FIELDS = { subject: 'title', showAs: 'show as', categories: 'tech', isAllDay: 'all day', location: 'location', start: 'start', end: 'end', recurrence: 'repeat', isReminderOn: 'reminder', reminderMinutesBeforeStart: 'reminder minutes' };
const shown = (k, v) => (k === 'location' ? v?.displayName ?? ''
  : k === 'start' || k === 'end' ? (v?.dateTime ? `${v.dateTime} ${v.timeZone ?? ''}`.trim() : utcIso(v))
    : k === 'recurrence' ? recurrenceText(v) : v);

outlookRouter.patch('/events/:id', requireAuth, async (req, res, next) => {
  if (!isOutlookConfigured()) return notConfigured(res);
  const body = req.body ?? {};
  const series = body.scope === 'series';
  try {
    const users = await techs();
    const raw = await getEvent(req.params.id);
    if (await guard(res, raw)) return;
    if (series && !raw.seriesMasterId) return res.status(400).json({ error: "That event doesn't repeat." });

    const target = series ? await getEvent(raw.seriesMasterId) : raw;
    const plan = eventPatch(body, target, { zone: zone(), users, series });
    if (!plan.ok) return res.status(400).json({ error: plan.error });
    // The etag the browser saw guards a single event; a series edit is checked against the series as just read.
    await updateEvent(target.id, plan.patch, series ? target['@odata.etag'] : (body.etag || raw['@odata.etag']));

    const changes = {};
    for (const [k, v] of Object.entries(plan.patch)) {
      if (k === 'body') { changes.notes = { changed: true }; continue; }
      changes[AUDIT_FIELDS[k] ?? k] = { from: shown(k, target[k]) ?? null, to: shown(k, v) };
    }
    await audit(req, 'UPDATE', `${target.subject ?? 'Outlook event'}${series ? ' (whole series)' : raw.seriesMasterId ? ' (one occurrence)' : ''}`, changes);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof OutlookError) return outlookError(res, err);
    next(err);
  }
});

outlookRouter.delete('/events/:id', requireAuth, async (req, res, next) => {
  if (!isOutlookConfigured()) return notConfigured(res);
  const scope = ['occurrence', 'following', 'series'].includes(req.query.scope) ? req.query.scope : 'occurrence';
  try {
    const raw = await getEvent(req.params.id);
    if (await guard(res, raw)) return;
    const when = utcIso(raw.start);
    if (!raw.seriesMasterId || scope === 'occurrence') {
      // A single event, or one occurrence (Outlook keeps the rest of the series).
      await deleteEvent(raw.id);
      await audit(req, 'DELETE', `${raw.subject ?? 'Outlook event'}${raw.seriesMasterId ? ' (one occurrence)' : ''}`, { start: { from: when } });
      return res.json({ ok: true });
    }
    const master = await getEvent(raw.seriesMasterId);
    const plan = scope === 'following' ? endSeriesBefore(master, raw, zone()) : { ok: true, deleteSeries: true };
    if (!plan.ok) return res.status(400).json({ error: plan.error });
    if (plan.deleteSeries) {
      await deleteEvent(master.id);
      await audit(req, 'DELETE', `${master.subject ?? 'Outlook event'} (whole series)`, { repeat: { from: recurrenceText(master.recurrence) } });
    } else {
      await updateEvent(master.id, plan.patch, master['@odata.etag']);
      await audit(req, 'UPDATE', `${master.subject ?? 'Outlook event'} (this and following deleted)`, {
        repeat: { from: recurrenceText(master.recurrence), to: recurrenceText(plan.patch.recurrence) },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof OutlookError) return outlookError(res, err);
    next(err);
  }
});
