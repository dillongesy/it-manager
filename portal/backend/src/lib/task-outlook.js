import { query } from '../db/index.js';
import { config } from '../config/index.js';
import { isOutlookConfigured, createEvent, updateEvent, deleteEvent, OutlookError } from './outlook-client.js';
import { taskEvent, taskEventChanged } from './outlook.js';

// "Add to Outlook" on a task: an event on the shared calendar (at the task's time, or all-day) that the Portal owns and
// keeps in step - the task's date, time, length, title, customer, tech, priority, estimate or notes change it;
// taking the task off the schedule (or deleting it) removes it. Marking the task done leaves the
// event alone (the Portal crosses the task off on its side).

// The date comes back as text so the event's day never depends on how the driver turns a DATE into a JS Date.
const TASK_ROW = `SELECT t.*, to_char(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_day, to_char(t.scheduled_time, 'HH24:MI') AS scheduled_hm, c.name AS customer_name, au.full_name AS assigned_to_name
                    FROM tasks t
                    LEFT JOIN customers c ON c.id = t.customer_id
                    LEFT JOIN users au    ON au.id = t.assigned_to
                   WHERE t.id = $1`;
const zone = () => config.outlook.timeZone;
const taskRow = async (id) => (await query(TASK_ROW, [id])).rows[0];

async function create(task) {
  const ev = await createEvent(taskEvent(task, { zone: zone() }));
  if (!ev?.id) throw new OutlookError('Outlook did not return the new event.');
  await query('UPDATE tasks SET outlook_event_id = $2 WHERE id = $1', [task.id, ev.id]);
  return ev.id;
}

/** Put a task on the calendar (or rewrite its event if it's already there). Returns the event id. */
export async function addTaskToOutlook(taskId) {
  if (!isOutlookConfigured()) throw new OutlookError('The Outlook calendar is not configured.', 503);
  const task = await taskRow(taskId);
  if (!task) throw new OutlookError('Task not found.', 404);
  if (!task.scheduled_date) throw new OutlookError('Give the task a date first — the Outlook event goes on that day.', 400);
  if (!task.outlook_event_id) return create(task);
  try {
    await updateEvent(task.outlook_event_id, taskEvent(task, { zone: zone() }));
    return task.outlook_event_id;
  } catch (err) {
    if (err.status === 404) return create(task);   // someone deleted it in Outlook — put it back
    throw err;
  }
}

/** Take a task's event off the calendar. A missing event (deleted in Outlook) is fine. */
export async function removeTaskFromOutlook(task) {
  if (!task?.outlook_event_id) return false;
  try { await deleteEvent(task.outlook_event_id); }
  catch (err) { if (err.status !== 404) throw err; }
  await query('UPDATE tasks SET outlook_event_id = NULL WHERE id = $1', [task.id]);
  return true;
}

/**
 * After a task edit, keep its event in step. Returns what happened ('removed' | 'updated' |
 * 'recreated') or null when nothing needed doing. Throws OutlookError if Outlook refused.
 */
export async function syncTaskEvent(before, after) {
  if (!after?.outlook_event_id || !isOutlookConfigured()) return null;
  if (!after.scheduled_date) { await removeTaskFromOutlook(after); return 'removed'; }
  if (!taskEventChanged(before, after)) return null;
  const task = await taskRow(after.id);
  try {
    await updateEvent(after.outlook_event_id, taskEvent(task, { zone: zone() }));
    return 'updated';
  } catch (err) {
    if (err.status !== 404) throw err;
    await create(task);
    return 'recreated';
  }
}

/** A deleted task's event goes too - best effort; returns a warning string or null. */
export async function dropDeletedTaskEvent(eventId) {
  if (!eventId || !isOutlookConfigured()) return null;
  try { await deleteEvent(eventId); return null; }
  catch (err) { return err.status === 404 ? null : `The task was deleted, but its Outlook event couldn't be removed: ${err.message}`; }
}
