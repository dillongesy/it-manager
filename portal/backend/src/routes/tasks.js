import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { logAudit, getClientIp, diffChanges } from '../middleware/audit.js';
import { parsePaging, setTotalCount } from '../lib/pagination.js';
import { coerceDate } from '../lib/dates.js';
import { coerceTask, applyStatusRules, changeEvents, summarize, reorderRanks, STATUSES, KINDS, PRIORITIES } from '../lib/tasks.js';
import { addTaskToOutlook, removeTaskFromOutlook, syncTaskEvent, dropDeletedTaskEvent } from '../lib/task-outlook.js';
import { OutlookError } from '../lib/outlook-client.js';

// Tasks: the internal task list (migration 061), optionally linked to a customer.
//
//   GET    /api/tasks                       - list (filters below), X-Total-Count
//   GET    /api/tasks/summary               - the Overview: totals, workload, overdue, idle
//   GET    /api/tasks/:id                   - one task with its full notes and history
//   POST   /api/tasks                       - create
//   PATCH  /api/tasks/:id                   - edit (status / schedule / assignee changes go in the history)
//   POST   /api/tasks/reorder               - { ids } queue order
//   POST   /api/tasks/:id/comments          - { body }
//   DELETE /api/tasks/:id/comments/:eventId - the author (or an admin) only
//   POST   /api/tasks/:id/work-orders       - { work_order_id } record "added to WO-…" in the history
//   POST   /api/tasks/:id/outlook           - "Add to Outlook": put it on the shared calendar (needs a date)
//   DELETE /api/tasks/:id/outlook           - take it off the calendar
//   DELETE /api/tasks/:id
//
// A task on Outlook keeps its event in step (lib/task-outlook.js): edits rewrite it, clearing the
// date or deleting the task removes it. An Outlook failure never blocks the task change - it
// comes back as outlook_warning.
//
// Rules (status implications, flags, workload): lib/tasks.js.

const router = Router();

const tNum = (n) => `T-${String(n).padStart(5, '0')}`;
const uuidLike = (v) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));

const NOTES_TEXT = `TRIM(regexp_replace(replace(regexp_replace(COALESCE(t.notes, ''), '<[^>]+>', ' ', 'g'), '&nbsp;', ' '), '\\s+', ' ', 'g'))`;
const SELECT = `
  SELECT t.id, t.number, t.title, t.kind, t.status, t.waiting_on, t.priority, t.customer_id, t.location_id, t.assigned_to,
         t.scheduled_date, to_char(t.scheduled_time, 'HH24:MI') AS scheduled_time, t.duration_minutes, t.due_date, t.estimated_hours, t.rank,
         t.requested_by, t.requested_phone, t.requested_date, t.requested_time,
         t.status_changed_at, t.started_at, t.done_at, t.done_by, t.created_by, t.created_at, t.updated_at, t.outlook_event_id,
         (${NOTES_TEXT} <> '' OR t.notes LIKE '%<img%') AS has_notes,
         LEFT(${NOTES_TEXT}, 220) AS notes_preview,
         c.name AS customer_name,
         COALESCE(NULLIF(l.label, ''), NULLIF(l.business_name, ''), l.address) AS location_name,
         au.full_name AS assigned_to_name, cu.full_name AS created_by_name, du.full_name AS done_by_name,
         (SELECT COUNT(*)::int FROM task_events e WHERE e.task_id = t.id AND e.kind = 'comment') AS comment_count
    FROM tasks t
    LEFT JOIN customers c           ON c.id = t.customer_id
    LEFT JOIN customer_locations l  ON l.id = t.location_id
    LEFT JOIN users au              ON au.id = t.assigned_to
    LEFT JOIN users cu              ON cu.id = t.created_by
    LEFT JOIN users du              ON du.id = t.done_by`;

const PRIORITY_ORDER = `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;
const SORTS = {
  queue:     't.rank ASC, t.created_at ASC',
  priority:  `${PRIORITY_ORDER}, t.due_date ASC NULLS LAST, t.rank ASC`,
  due:       `t.due_date ASC NULLS LAST, ${PRIORITY_ORDER}, t.rank ASC`,
  scheduled: 't.scheduled_date ASC NULLS LAST, t.scheduled_time ASC NULLS FIRST, t.rank ASC',
  created:   't.created_at DESC',
  updated:   't.updated_at DESC',
  done:      't.done_at DESC NULLS LAST',
  customer:  'c.name ASC NULLS FIRST, t.rank ASC',
};

const audit = (req, action, task, extra = {}) => logAudit({
  userId: req.user.sub, userName: req.user.fullName, action, entityType: 'task', entityId: task.id,
  entityName: `${tNum(task.number)} — ${task.title}${extra.verb ? ` — ${extra.verb}` : ''}`, changes: extra.changes ?? null, ipAddress: getClientIp(req),
});

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await query('SELECT id, full_name FROM users WHERE id = ANY($1)', [list]);
  return new Map(rows.map(r => [r.id, r.full_name]));
}

async function addEvents(taskId, userId, events) {
  for (const e of events) {
    await query('INSERT INTO task_events (task_id, user_id, kind, body, data) VALUES ($1, $2, $3, $4, $5)',
      [taskId, userId, e.kind, e.body ?? null, e.data ? JSON.stringify(e.data) : null]);
  }
}

/** A customer / office the task points at must exist (and the office must be that customer's). */
async function checkLinks(values, current = {}) {
  const customerId = values.customer_id !== undefined ? values.customer_id : current.customer_id;
  if (values.customer_id) {
    if (!uuidLike(values.customer_id)) return 'Unknown customer.';
    const { rows } = await query('SELECT 1 FROM customers WHERE id = $1', [values.customer_id]);
    if (!rows[0]) return 'Unknown customer.';
  }
  // Moving a task to another customer drops its office (unless the request picked one);
  // internal tasks have no office at all.
  const customerChanged = values.customer_id !== undefined && values.customer_id !== (current.customer_id ?? null);
  if (customerChanged && values.location_id === undefined && current.location_id) values.location_id = null;
  if (!customerId && values.location_id) values.location_id = null;
  if (values.location_id) {
    const { rows } = await query('SELECT 1 FROM customer_locations WHERE id = $1 AND customer_id = $2', [values.location_id, customerId]);
    if (!rows[0]) return 'That office belongs to a different customer.';
  }
  if (values.assigned_to) {
    if (!uuidLike(values.assigned_to)) return 'Unknown technician.';
    const { rows } = await query('SELECT 1 FROM users WHERE id = $1', [values.assigned_to]);
    if (!rows[0]) return 'Unknown technician.';
  }
  for (const k of Object.keys(values)) if (values[k] === undefined) delete values[k];
  return null;
}

async function loadTask(id) {
  if (!uuidLike(id)) return null;
  const { rows } = await query(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

// GET /api/tasks
//   status     = active (default) | done | all | a comma list of statuses
//   assignedTo = <user id> | none        customerId = <customer id> | internal
//   kind, priority, q (title / notes / customer / caller / T-number)
//   scheduledFrom, scheduledTo (YYYY-MM-DD, the week calendar), unscheduled=1, doneSince
//   sort       = queue (default) | priority | due | scheduled | created | updated | done | customer
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };
    const { status = 'active', assignedTo, customerId, kind, priority, q, scheduledFrom, scheduledTo, doneSince } = req.query;

    if (status === 'active') where.push(`t.status <> 'done'`);
    else if (status !== 'all') {
      const list = String(status).split(',').filter(s => STATUSES.includes(s));
      if (!list.length) return res.status(400).json({ error: `Unknown status "${status}".` });
      add('t.status = ANY(?)', list);
    }
    if (assignedTo === 'none') where.push('t.assigned_to IS NULL');
    else if (assignedTo) { if (!uuidLike(assignedTo)) return res.json([]); add('t.assigned_to = ?', assignedTo); }
    if (customerId === 'internal') where.push('t.customer_id IS NULL');
    else if (customerId) { if (!uuidLike(customerId)) return res.json([]); add('t.customer_id = ?', customerId); }
    if (kind && KINDS.includes(kind)) add('t.kind = ?', kind);
    if (req.query.unscheduled === '1') where.push('t.scheduled_date IS NULL');
    if (priority && PRIORITIES.includes(priority)) add('t.priority = ?', priority);
    for (const [v, sql] of [[scheduledFrom, 't.scheduled_date >= ?'], [scheduledTo, 't.scheduled_date <= ?'], [doneSince, 't.done_at >= ?']]) {
      if (!v) continue;
      const d = coerceDate(v);
      if (!d.ok || !d.value) return res.status(400).json({ error: `Bad date "${v}".` });
      add(sql, d.value);
    }
    const term = String(q ?? '').trim();
    if (term) {
      const num = term.match(/^(?:t-?)?0*(\d{1,7})$/i);
      params.push(`%${term}%`);
      const like = `$${params.length}`;
      let sql = `(t.title ILIKE ${like} OR t.notes ILIKE ${like} OR c.name ILIKE ${like} OR t.requested_by ILIKE ${like}`;
      if (num) { params.push(Number(num[1])); sql += ` OR t.number = $${params.length}`; }
      where.push(`${sql})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = SORTS[req.query.sort] ? req.query.sort : (status === 'done' ? 'done' : 'queue');
    const { limit, offset } = parsePaging(req.query, { defaultLimit: 500, maxLimit: 1000 });
    const [{ rows }, { rows: count }] = await Promise.all([
      query(`${SELECT} ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ${limit} OFFSET ${offset}`, params),
      query(`SELECT COUNT(*)::int AS total FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id ${whereSql}`, params),
    ]);
    setTotalCount(res, count[0].total);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/tasks/summary - every active task plus the last two weeks' finished ones, summarized.
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const [{ rows: tasks }, { rows: users }] = await Promise.all([
      query(`${SELECT} WHERE t.status <> 'done' OR t.done_at >= NOW() - INTERVAL '14 days'`),
      query(`SELECT id, full_name FROM users WHERE is_active = true AND role <> 'biller' ORDER BY full_name`),
    ]);
    res.json(summarize(tasks, users));
  } catch (err) { next(err); }
});

// POST /api/tasks/reorder - { ids } in their new queue order.
router.post('/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(uuidLike) : [];
    if (ids.length < 2) return res.json({ ok: true });
    const { rows } = await query('SELECT id, rank FROM tasks WHERE id = ANY($1)', [ids]);
    const current = new Map(rows.map(r => [r.id, r.rank]));
    const plan = reorderRanks(ids.filter(id => current.has(id)), current);
    for (const { id, rank } of plan) await query('UPDATE tasks SET rank = $2 WHERE id = $1', [id, rank]);
    await logAudit({ userId: req.user.sub, userName: req.user.fullName, action: 'UPDATE', entityType: 'task', entityId: plan[0]?.id,
      entityName: `Task queue reordered (${plan.length} tasks)`, changes: { order: plan.map(p => p.id) }, ipAddress: getClientIp(req) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const task = await loadTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    const [{ rows: notes }, { rows: events }] = await Promise.all([
      query('SELECT notes FROM tasks WHERE id = $1', [task.id]),
      query(`SELECT e.id, e.kind, e.body, e.data, e.created_at, e.user_id, u.full_name AS user_name
               FROM task_events e LEFT JOIN users u ON u.id = e.user_id
              WHERE e.task_id = $1 ORDER BY e.created_at ASC`, [task.id]),
    ]);
    res.json({ ...task, notes: notes[0]?.notes ?? null, events });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const c = coerceTask(req.body ?? {});
    if (!c.ok) return res.status(400).json({ error: c.error });
    const linkError = await checkLinks(c.values);
    if (linkError) return res.status(400).json({ error: linkError });
    const values = applyStatusRules(null, c.values, { userId: req.user.sub });
    const { rows: r } = await query('SELECT COALESCE(MAX(rank), 0) + 10 AS next FROM tasks');
    const row = { ...values, rank: r[0].next, created_by: req.user.sub };
    const cols = Object.keys(row);
    const { rows } = await query(
      `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, number, title`,
      cols.map(k => row[k]));
    await addEvents(rows[0].id, req.user.sub, [{ kind: 'created' }]);
    await audit(req, 'CREATE', rows[0]);
    res.status(201).json(await loadTask(rows[0].id));
  } catch (err) { next(err); }
});

const AUDITED = ['title', 'kind', 'status', 'waiting_on', 'priority', 'customer_id', 'location_id', 'assigned_to',
  'scheduled_date', 'scheduled_time', 'duration_minutes', 'due_date', 'estimated_hours', 'requested_by', 'requested_phone', 'requested_date', 'requested_time'];

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    const { rows: found } = await query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    const before = found[0];
    if (!before) return res.status(404).json({ error: 'Task not found.' });
    const c = coerceTask(req.body ?? {}, { partial: true });
    if (!c.ok) return res.status(400).json({ error: c.error });
    const linkError = await checkLinks(c.values, before);
    if (linkError) return res.status(400).json({ error: linkError });
    const values = applyStatusRules(before, c.values, { userId: req.user.sub });
    if (!Object.keys(values).length) return res.json(await loadTask(before.id));
    values.updated_at = new Date();
    const cols = Object.keys(values);
    const { rows } = await query(
      `UPDATE tasks SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [before.id, ...cols.map(k => values[k])]);
    const after = rows[0];

    const events = changeEvents(before, after);
    let outlookWarning = null;
    try {
      if (await syncTaskEvent(before, after) === 'removed') events.push({ kind: 'outlook', data: { action: 'removed', reason: 'unscheduled' } });
    } catch (err) {
      outlookWarning = `Saved, but the Outlook event couldn't be updated: ${err.message}`;
    }
    const names = await userNames(events.filter(e => e.kind === 'assigned').flatMap(e => [e.data.from, e.data.to]));
    for (const e of events) if (e.kind === 'assigned') { e.data.from_name = names.get(e.data.from) ?? null; e.data.to_name = names.get(e.data.to) ?? null; }
    await addEvents(after.id, req.user.sub, events);

    const changes = diffChanges(before, after, AUDITED) ?? {};
    if ((before.notes ?? '') !== (after.notes ?? '')) changes.notes = { changed: true };
    const statusEvent = events.find(e => e.kind === 'status');
    await audit(req, 'UPDATE', after, { verb: statusEvent ? statusEvent.data.to.replace('_', ' ') : 'edited', changes: Object.keys(changes).length ? changes : null });
    res.json({ ...await loadTask(after.id), ...(outlookWarning ? { outlook_warning: outlookWarning } : {}) });
  } catch (err) { next(err); }
});

router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    if (body.length > 20000) return res.status(400).json({ error: 'That comment is too long.' });
    if (!uuidLike(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    const { rows: t } = await query('UPDATE tasks SET updated_at = NOW() WHERE id = $1 RETURNING id, number, title', [req.params.id]);
    if (!t[0]) return res.status(404).json({ error: 'Task not found.' });
    const { rows } = await query(
      `INSERT INTO task_events (task_id, user_id, kind, body) VALUES ($1, $2, 'comment', $3)
       RETURNING id, kind, body, data, created_at, user_id`, [t[0].id, req.user.sub, body]);
    await audit(req, 'UPDATE', t[0], { verb: 'commented' });
    res.status(201).json({ ...rows[0], user_name: req.user.fullName });
  } catch (err) { next(err); }
});

router.delete('/:id/comments/:eventId', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id) || !uuidLike(req.params.eventId)) return res.status(404).json({ error: 'Comment not found.' });
    const { rows } = await query(`SELECT e.user_id, t.id, t.number, t.title FROM task_events e JOIN tasks t ON t.id = e.task_id
                                   WHERE e.id = $1 AND e.task_id = $2 AND e.kind = 'comment'`, [req.params.eventId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Comment not found.' });
    if (rows[0].user_id !== req.user.sub && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the person who wrote a comment (or an admin) can delete it.' });
    await query('DELETE FROM task_events WHERE id = $1', [req.params.eventId]);
    await audit(req, 'UPDATE', rows[0], { verb: 'comment deleted' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/work-orders - record that the task went into a work order (the work
// order itself is created / extended by the work-orders routes).
router.post('/:id/work-orders', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id) || !uuidLike(req.body?.work_order_id)) return res.status(400).json({ error: 'work_order_id is required.' });
    const { rows: wo } = await query('SELECT id, number FROM work_orders WHERE id = $1', [req.body.work_order_id]);
    if (!wo[0]) return res.status(404).json({ error: 'Work order not found.' });
    const { rows: t } = await query('UPDATE tasks SET updated_at = NOW() WHERE id = $1 RETURNING id, number, title', [req.params.id]);
    if (!t[0]) return res.status(404).json({ error: 'Task not found.' });
    await addEvents(t[0].id, req.user.sub, [{ kind: 'work_order', data: { work_order_id: wo[0].id, number: wo[0].number } }]);
    await audit(req, 'UPDATE', t[0], { verb: `added to WO-${String(wo[0].number).padStart(5, '0')}` });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/outlook - put the task on the shared Outlook calendar (or refresh its event).
router.post('/:id/outlook', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    const { rows } = await query('SELECT id, number, title, outlook_event_id FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found.' });
    await addTaskToOutlook(rows[0].id);
    if (!rows[0].outlook_event_id) {
      await query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [rows[0].id]);
      await addEvents(rows[0].id, req.user.sub, [{ kind: 'outlook', data: { action: 'added' } }]);
      await audit(req, 'UPDATE', rows[0], { verb: 'added to the Outlook calendar' });
    }
    res.json(await loadTask(rows[0].id));
  } catch (err) {
    if (err instanceof OutlookError) return res.status(err.status < 600 ? err.status : 502).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/tasks/:id/outlook - take it off the calendar.
router.delete('/:id/outlook', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    const { rows } = await query('SELECT id, number, title, outlook_event_id FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found.' });
    if (await removeTaskFromOutlook(rows[0])) {
      await query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [rows[0].id]);
      await addEvents(rows[0].id, req.user.sub, [{ kind: 'outlook', data: { action: 'removed' } }]);
      await audit(req, 'UPDATE', rows[0], { verb: 'removed from the Outlook calendar' });
    }
    res.json(await loadTask(rows[0].id));
  } catch (err) {
    if (err instanceof OutlookError) return res.status(err.status < 600 ? err.status : 502).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!uuidLike(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    const { rows } = await query('DELETE FROM tasks WHERE id = $1 RETURNING id, number, title, outlook_event_id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found.' });
    await audit(req, 'DELETE', rows[0]);
    const warning = await dropDeletedTaskEvent(rows[0].outlook_event_id);
    res.json({ ok: true, ...(warning ? { outlook_warning: warning } : {}) });
  } catch (err) { next(err); }
});

export default router;
