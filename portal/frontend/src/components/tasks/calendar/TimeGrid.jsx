import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Repeat, CheckCircle2, Lock } from 'lucide-react';
import { dayKey } from '../../../utils/tasks.js';
import { tint } from '../../../utils/tasks.js';
import { HOUR_PX, DAY_MINUTES, SNAP, clamp, snap, snapDown, minutesOf, timeLabel, layoutDay } from '../../../utils/calendar.js';
import { DropZone, DRAG_TYPE, DRAG_EVENT } from './shared.jsx';

// The day / week view: an all-day row over an hour-by-hour grid, like Outlook.
//   Click an item to open it. Drag it to move it (to another time or day, into the all-day row,
//   or - a task - onto "Not scheduled yet"); drag its bottom edge to change how long it is.
//   Drag across empty time to make something new there; a click makes an hour.
//   Items from "Not scheduled yet" or the month view can be dropped onto a time.
// On a touch screen dragging is off (the page scrolls instead): tap to open, tap empty time to add.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORK_START = 8 * 60;
const WORK_END = 17 * 60;
const toMin = (px) => (px / HOUR_PX) * 60;
const toPx = (min) => (min / 60) * HOUR_PX;

function GridItem({ item, layout, ghost = false, faded = false, onPointerDown, onResizeDown, onClick }) {
  const { col, cols } = layout ?? { col: 0, cols: 1 };
  const height = Math.max(toPx(item.end - item.start), 18);
  const short = height < 38;
  const c = item.color;
  return (
    <div data-entry
      role="button" tabIndex={0}
      onPointerDown={onPointerDown} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter') onClick?.(e); }}
      title={`${item.title}\n${timeLabel(item.start)} – ${timeLabel(item.end % DAY_MINUTES)}${item.sub ? `\n${item.sub}` : ''}${item.recurring ? '\nRepeats' : ''}`}
      style={{
        top: toPx(item.start), height,
        left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
        backgroundColor: item.dashed ? tint(c, ghost ? 0.25 : 0.08) : tint(c, item.done ? 0.07 : ghost ? 0.35 : 0.2),
        borderLeft: `3px solid ${c}`,
        ...(item.dashed ? { outline: `1px dashed ${tint(c, 0.8)}`, outlineOffset: '-1px' } : {}),
      }}
      className={`absolute rounded-md px-1.5 overflow-hidden text-left text-xs select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${short ? 'py-0' : 'py-1'} ${item.movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        ${ghost ? 'z-30 shadow-lg ring-1 ring-accent/60' : 'z-10 hover:z-20 hover:brightness-110'} ${faded ? 'opacity-30' : ''}
        ${item.done ? 'text-gray-500' : 'text-gray-100'}`}>
      <div className={`flex items-start gap-1 min-w-0 ${short ? 'leading-[18px]' : ''}`}>
        {item.done && <CheckCircle2 size={11} className="shrink-0 text-green-500 mt-[3px]" aria-label="Done" />}
        {item.kind === 'event' && !item.done && <CalendarDays size={11} className="shrink-0 mt-[3px]" style={{ color: c }} />}
        <span className={`font-medium ${short ? 'truncate' : 'line-clamp-2'} ${item.done ? 'line-through' : ''}`}>
          {short && <span className="text-gray-400 font-normal">{timeLabel(item.start)} </span>}{item.title}
        </span>
        {item.recurring && <Repeat size={10} className="shrink-0 mt-[3px] text-gray-400 ml-auto" aria-label="Repeats" />}
        {item.locked && <Lock size={10} className="shrink-0 mt-[3px] text-gray-400 ml-auto" aria-label="Private" />}
      </div>
      {!short && <div className="text-[11px] text-gray-400 truncate">{timeLabel(item.start)} – {timeLabel(item.end % DAY_MINUTES)}{item.who ? ` · ${item.who}` : ''}</div>}
      {!short && height >= 64 && item.sub && <div className="text-[11px] text-gray-500 truncate">{item.sub}</div>}
      {item.resizable && onResizeDown && (
        <div onPointerDown={onResizeDown} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-hidden="true" />
      )}
    </div>
  );
}

export function TimeGrid({
  days, today, items, allDay, allDayDrop, onPickDay, onOpen, onCreate, onMove, onResize, onUnschedule, onDropExternal, maxHeight,
}) {
  const scrollRef = useRef(null);
  const colsRef = useRef(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef('mouse');
  const [drag, setDrag] = useState(null);   // { mode: move|resize|create, item?, ox, oy, dayIdx, start, end, moved }
  const [now, setNow] = useState(() => new Date());
  const keys = days.map(dayKey);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  // Open on the working day (or earlier, if something starts before 7).
  useLayoutEffect(() => {
    const first = Math.min(7 * 60, ...items.map(i => i.start));
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, toPx(first) - 8);
  }, [keys.join()]);   // eslint-disable-line react-hooks/exhaustive-deps

  const geometry = () => {
    const r = colsRef.current.getBoundingClientRect();
    return { r, colW: r.width / days.length };
  };
  const dayAt = (x) => { const { r, colW } = geometry(); return clamp(Math.floor((x - r.left) / colW), 0, days.length - 1); };
  const minuteAt = (y) => { const { r } = geometry(); return clamp(toMin(y - r.top), 0, DAY_MINUTES); };

  // Pointer dragging (mouse / pen). Listeners live on the window while a drag is on.
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      setDrag(d => {
        if (!d) return d;
        const moved = d.moved || Math.abs(e.clientX - d.ox) + Math.abs(e.clientY - d.oy) > 4;
        const dy = toMin(e.clientY - d.oy);
        if (d.mode === 'move') {
          const len = d.item.end - d.item.start;
          const start = clamp(snap(d.item.start + dy), 0, DAY_MINUTES - len);
          return { ...d, moved, dayIdx: dayAt(e.clientX), start, end: start + len, x: e.clientX, y: e.clientY };
        }
        if (d.mode === 'resize') return { ...d, moved, end: clamp(snap(d.item.end + dy), d.item.start + SNAP, DAY_MINUTES) };
        // create
        const a = snapDown(minuteAt(d.oy)), b = snap(minuteAt(e.clientY));
        return { ...d, moved, start: Math.min(a, b), end: Math.max(Math.max(a, b), Math.min(a, b) + SNAP) };
      });
    };
    const up = (e) => {
      const d = drag;
      setDrag(null);
      if (!d) return;
      const latest = dragRef.current ?? d;
      if (!latest.moved) {
        if (latest.mode === 'create') onCreate?.({ dateKey: keys[latest.dayIdx], startMin: latest.start, endMin: Math.min(latest.start + 60, DAY_MINUTES) });
        return;   // a click on an item opens it via onClick
      }
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      if (latest.mode === 'create') { onCreate?.({ dateKey: keys[latest.dayIdx], startMin: latest.start, endMin: latest.end }); return; }
      if (latest.mode === 'resize') { if (latest.end !== latest.item.end) onResize?.(latest.item.entry, { dateKey: latest.item.dayKey, startMin: latest.item.start, endMin: latest.end }); return; }
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target?.closest('[data-unschedule]')) { onUnschedule?.(latest.item.entry); return; }
      const allDayCell = target?.closest('[data-allday]');
      if (allDayCell) { onMove?.(latest.item.entry, { dateKey: allDayCell.dataset.allday, allDay: true }); return; }
      if (keys[latest.dayIdx] !== latest.item.dayKey || latest.start !== latest.item.start) {
        onMove?.(latest.item.entry, { dateKey: keys[latest.dayIdx], startMin: latest.start, endMin: latest.end });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag?.mode, drag?.item?.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The window listeners read the newest drag state through this ref.
  const dragRef = useRef(null);
  dragRef.current = drag;

  const startDrag = (mode, item) => (e) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (mode !== 'create' && !(mode === 'move' ? item.movable : item.resizable)) return;
    if (mode === 'create' && e.target.closest('[data-entry]')) return;
    e.stopPropagation();
    if (mode !== 'move') e.preventDefault();
    const dayIdx = mode === 'create' ? dayAt(e.clientX) : keys.indexOf(item.dayKey);
    const start = mode === 'create' ? snapDown(minuteAt(e.clientY)) : item.start;
    setDrag({ mode, item, ox: e.clientX, oy: e.clientY, dayIdx, start, end: mode === 'create' ? start + SNAP : item.end, moved: false });
  };

  // Touch: a tap on empty time adds something there.
  const tapCreate = (dayIdx) => (e) => {
    if (lastPointer.current !== 'touch' || e.target.closest('[data-entry]')) return;
    onCreate?.({ dateKey: keys[dayIdx], startMin: snapDown(minuteAt(e.clientY), 30), endMin: Math.min(snapDown(minuteAt(e.clientY), 30) + 60, DAY_MINUTES) });
  };
  const open = (item) => () => { if (suppressClick.current) return; onOpen?.(item.entry); };

  const external = (dayIdx) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes(DRAG_EVENT)) e.preventDefault(); },
    onDrop: (e) => {
      e.preventDefault();
      const task = e.dataTransfer.getData(DRAG_TYPE);
      const event = e.dataTransfer.getData(DRAG_EVENT);
      const startMin = clamp(snapDown(minuteAt(e.clientY)), 0, DAY_MINUTES - SNAP);
      if (task || event) onDropExternal?.({ kind: task ? 'task' : 'event', id: task || event, dateKey: keys[dayIdx], startMin });
    },
  });

  const byDay = keys.map(k => items.filter(i => i.dayKey === k));
  const layouts = byDay.map(list => layoutDay(list.map(i => ({ key: i.key, start: i.start, end: i.end }))));
  const nowKey = dayKey(now);
  const cols = `3.75rem repeat(${days.length}, minmax(0, 1fr))`;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="card overflow-hidden select-none">
      {/* Day headings */}
      <div className="grid border-b border-surface-600" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d, i) => {
          const k = keys[i];
          return (
            <button key={k} type="button" onClick={() => onPickDay?.(d)} title="Open this day"
              className={`px-2 py-2 text-left border-l border-surface-700 hover:bg-surface-700/40 ${k === today ? 'text-accent' : 'text-gray-400'}`}>
              <span className="text-xs uppercase tracking-wide">{DAY_NAMES[d.getDay()]}</span>
              <span className={`ml-1.5 text-lg font-semibold ${k === today ? '' : 'text-gray-200'}`}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      {/* All-day row */}
      <div className="grid border-b border-surface-600" style={{ gridTemplateColumns: cols }}>
        <div className="text-[10px] text-gray-500 px-1.5 py-1.5 text-right leading-tight">All day</div>
        {keys.map(k => (
          <DropZone key={k} data-allday={k} {...(allDayDrop?.(k) ?? {})}
            className={`border-l border-surface-700 p-1 space-y-1 min-h-[2.25rem] max-h-32 overflow-y-auto ${k === today ? 'bg-accent/[0.03]' : ''}`}>
            {allDay?.(k)}
          </DropZone>
        ))}
      </div>

      {/* Hours */}
      <div ref={scrollRef} className="overflow-y-auto overscroll-contain" style={{ maxHeight: maxHeight ?? 'max(26rem, calc(100vh - 22rem))' }}>
        <div className="grid relative" style={{ gridTemplateColumns: '3.75rem minmax(0, 1fr)', height: toPx(DAY_MINUTES) }}>
          <div className="relative">
            {hours.map(h => (
              <div key={h} className="absolute right-1.5 text-[10px] text-gray-500 -translate-y-1/2" style={{ top: toPx(h * 60) }}>
                {h === 0 ? '' : timeLabel(h * 60).replace(':00', '')}
              </div>
            ))}
          </div>
          {/* A real box around the day columns, so a pointer's x / y can be turned into a day and a time */}
          <div ref={colsRef} className="grid relative h-full" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const k = keys[i];
              const list = byDay[i];
              return (
                <div key={k} data-day={k} {...external(i)}
                  onPointerDown={startDrag('create')} onClick={tapCreate(i)}
                  className="relative border-l border-surface-700"
                  style={{
                    backgroundImage: `linear-gradient(to bottom, rgb(var(--c-surface-700) / 0.55) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--c-surface-700) / 0.25) 1px, transparent 1px)`,
                    backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX / 2}px`,
                  }}>
                  {/* Outside working hours is shaded */}
                  <div className="absolute inset-x-0 top-0 bg-surface-900/30 pointer-events-none" style={{ height: toPx(WORK_START) }} />
                  <div className="absolute inset-x-0 bottom-0 bg-surface-900/30 pointer-events-none" style={{ top: toPx(WORK_END) }} />
                  {k === today && <div className="absolute inset-0 bg-accent/[0.025] pointer-events-none" />}
                  {list.map(item => (
                    <GridItem key={item.key} item={item} layout={layouts[i].get(item.key)}
                      faded={drag?.item?.key === item.key && drag.moved}
                      onPointerDown={startDrag('move', item)} onResizeDown={startDrag('resize', item)} onClick={open(item)} />
                  ))}
                  {/* The item being dragged, where it would land */}
                  {drag?.moved && drag.mode !== 'create' && drag.dayIdx === i && (
                    <GridItem ghost item={{ ...drag.item, start: drag.mode === 'move' ? drag.start : drag.item.start, end: drag.end }} />
                  )}
                  {drag?.mode === 'create' && drag.dayIdx === i && (
                    <div className="absolute inset-x-1 rounded-md bg-brand/25 border border-brand/60 z-30 text-[11px] text-gray-100 px-1.5 py-0.5 pointer-events-none"
                      style={{ top: toPx(drag.start), height: Math.max(toPx(drag.end - drag.start), 12) }}>
                      {timeLabel(drag.start)} – {timeLabel(drag.end % DAY_MINUTES)}
                    </div>
                  )}
                  {/* Now */}
                  {k === nowKey && (
                    <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: toPx(minutesOf(now)) }}>
                      <div className="h-0.5 bg-red-500" />
                      <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
