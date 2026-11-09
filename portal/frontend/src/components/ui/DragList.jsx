import { useState, useRef, useEffect, useCallback } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Generic drag-to-reorder list using native HTML5 drag-and-drop (no dependency).
 *
 * items:      array of objects with a stable `id`
 * onReorder:  (reorderedItems) => void
 * renderItem: (item, handle) => JSX   - place `handle` wherever the grip should go
 *                                        (e.g. next to a heading).
 * itemClassName: optional classes for each row wrapper
 *
 * With a single item, the handle renders as an inert spacer (nothing to reorder).
 * Auto-scrolls the nearest scroll container when dragging near its top/bottom edge.
 */
export function DragList({ items, onReorder, renderItem, itemClassName = '' }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const scrollTimer = useRef(null);

  const single = items.length < 2;

  const stopScroll = useCallback(() => {
    if (scrollTimer.current) { cancelAnimationFrame(scrollTimer.current); scrollTimer.current = null; }
  }, []);

  // Edge auto-scroll while dragging near the top/bottom of the viewport.
  const onDragOverWindow = useCallback((e) => {
    const EDGE = 80;   // px from edge that triggers scroll
    const SPEED = 14;  // px per frame
    const y = e.clientY;
    const h = window.innerHeight;
    const dir = y < EDGE ? -1 : y > h - EDGE ? 1 : 0;

    stopScroll();
    if (dir === 0) return;
    const scroller = findScroller(e.target);
    const step = () => {
      if (scroller === window) window.scrollBy(0, dir * SPEED);
      else scroller.scrollTop += dir * SPEED;
      scrollTimer.current = requestAnimationFrame(step);
    };
    step();
  }, [stopScroll]);

  const reset = useCallback(() => { setDragId(null); setOverId(null); stopScroll(); }, [stopScroll]);

  // While a drag is active, listen globally so the red highlight + scroll always
  // clear - even if the pointer is released outside any list item.
  useEffect(() => {
    if (dragId == null) return;
    const onEnd = () => reset();
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    window.addEventListener('dragover', onDragOverWindow);
    return () => {
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
      window.removeEventListener('dragover', onDragOverWindow);
    };
  }, [dragId, onDragOverWindow, reset]);

  const onDrop = () => {
    if (dragId == null || overId == null || dragId === overId) { reset(); return; }
    const from = items.findIndex(i => i.id === dragId);
    const to   = items.findIndex(i => i.id === overId);
    if (from < 0 || to < 0) { reset(); return; }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
    reset();
  };

  return (
    <>
      {items.map(item => {
        const handle = single ? (
          <span className="inline-block w-[15px]" aria-hidden="true" />
        ) : (
          <span
            draggable
            onDragStart={(e) => { e.stopPropagation(); setDragId(item.id); }}
            onDragEnd={reset}
            className="inline-flex items-center cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300 shrink-0"
            title="Drag to reorder"
          >
            <GripVertical size={15} />
          </span>
        );

        return (
          <div
            key={item.id}
            onDragOver={(e) => { e.preventDefault(); if (!single && overId !== item.id) setOverId(item.id); }}
            onDrop={onDrop}
            className={`${itemClassName} ${
              overId === item.id && dragId !== item.id ? 'ring-2 ring-brand/60 rounded-lg' : ''
            } ${dragId === item.id ? 'opacity-40' : ''}`}
          >
            {renderItem(item, handle)}
          </div>
        );
      })}
    </>
  );
}

// Walk up to the nearest vertically-scrollable ancestor, else window.
function findScroller(el) {
  let node = el instanceof Element ? el : null;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}
