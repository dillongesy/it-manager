import { ChevronRight, Trash2 } from 'lucide-react';
import TechnicianPicker from './TechnicianPicker.jsx';
import LineItemsPicker from './LineItemsPicker.jsx';
import ServicesPicker from './ServicesPicker.jsx';
import Labeled from './Labeled.jsx';
import { dayHours, fmtHours, formatDayDate, parseHours } from '../utils/jobDays.js';
import { cadenceLabel } from '../utils/cadence.js';

/**
 * One day of a job - its date, crew (with per-technician hours), parts used,
 * services, work performed and notes. Each day becomes one section on the Portal
 * work order at import.
 *
 * Labor RATES are deliberately not here. The field app captures what happened;
 * the office sets what it's worth, per section, in the Portal.
 *
 * Collapsed by default so a five-day job is still a short page on a phone: the
 * header alone shows the date, the day's total hours and a one-line summary of
 * who was there and what was used.
 */
export default function DayCard({
  day, index, dayCount, expanded, onToggle, onChange, onRemove, editable = true,
}) {
  const hours = dayHours(day);
  const set = (patch) => onChange({ ...day, ...patch });

  const summary = [
    ...(day.technicians ?? []).map((t) => `${t.initials} ${fmtHours(parseHours(t.hours))}h`),
    (day.items ?? []).length ? `${day.items.length} part${day.items.length === 1 ? '' : 's'}` : null,
    (day.services ?? []).length ? `${day.services.length} service${day.services.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 p-4 text-left active:bg-surface-700 transition-colors"
      >
        <ChevronRight
          size={18}
          className={`text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-100 leading-tight">
            Day {index + 1}
            <span className="text-gray-500 font-normal"> · {formatDayDate(day.work_date)}</span>
          </div>
          {summary && <div className="text-xs text-gray-500 truncate mt-0.5">{summary}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold text-gray-100 leading-tight">{fmtHours(hours)}h</div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-4 space-y-4 border-t border-surface-600">
          {editable ? (
            <>
              <Labeled label="Date">
                <input
                  className="input" type="date"
                  value={day.work_date || ''}
                  onChange={(e) => set({ work_date: e.target.value })}
                />
              </Labeled>

              <Labeled label="Technicians & hours" hint="hours each person worked this day">
                <TechnicianPicker
                  value={day.technicians}
                  onChange={(technicians) => set({ technicians })}
                  withHours
                />
              </Labeled>

              <Labeled label="Hardware / parts used this day">
                <LineItemsPicker value={day.items} onChange={(items) => set({ items })} />
              </Labeled>

              <Labeled label="Services">
                <ServicesPicker value={day.services} onChange={(services) => set({ services })} />
              </Labeled>

              <Labeled label="Work performed">
                <textarea
                  className="input" rows={3}
                  value={day.description}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder="What got done this day"
                />
              </Labeled>

              <Labeled label="Notes for this day">
                <textarea
                  className="input" rows={2}
                  value={day.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  placeholder="Anything internally the office should know"
                />
              </Labeled>

              {dayCount > 1 && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="w-full flex items-center justify-center gap-2 text-brand text-sm py-3"
                >
                  <Trash2 size={16} />Remove Day {index + 1}
                </button>
              )}
            </>
          ) : (
            <ReadOnlyDay day={day} />
          )}
        </div>
      )}
    </div>
  );
}

function ReadOnlyDay({ day }) {
  const price = (p) => (p == null || p === '' ? null : `$${Number(p).toFixed(2)}`);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs uppercase text-gray-500 mb-1.5">Technicians</p>
        <TechnicianPicker value={day.technicians} withHours disabled onChange={() => {}} />
      </div>
      {day.items?.length > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-500 mb-1.5">Hardware / parts</p>
          <div className="space-y-1">
            {day.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{it.description}</span>
                <span className="text-gray-400 shrink-0">
                  ×{it.quantity}{price(it.unit_price) ? ` · ${price(it.unit_price)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {day.services?.length > 0 && (
        <div>
          <p className="text-xs uppercase text-gray-500 mb-1.5">Services</p>
          <div className="space-y-1">
            {day.services.map((sv, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {sv.description}
                  {sv.billing_type === 'recurring' && (
                    <span className="text-accent text-xs ml-1">({cadenceLabel(sv.recurrence, sv.recurrence_count)})</span>
                  )}
                </span>
                <span className="text-gray-400 shrink-0">
                  ×{sv.quantity}{price(sv.unit_price) ? ` · ${price(sv.unit_price)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {day.description && <Block label="Work performed" value={day.description} />}
      {day.notes && <Block label="Notes" value={day.notes} />}
    </div>
  );
}

function Block({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase text-gray-500 mb-1">{label}</p>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}
