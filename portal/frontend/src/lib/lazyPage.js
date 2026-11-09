import { lazy } from 'react';

// A page loaded on first visit: lazyPage(() => import('./pages/Tasks.jsx'), 'Tasks').
//
// After ./update.sh the old build's chunks are gone. A tab opened before the update
// still asks for the old file names, the import fails, and the page would go blank.
// Reload once instead: index.html is served no-cache, so the reload picks up the new
// build. The session flag stops a reload loop if the chunk is missing for another reason.
const FLAG = 'app-chunk-reload';

export function lazyPage(load, name) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(FLAG); } catch { /* storage blocked */ }
      return { default: mod[name] ?? mod.default };
    } catch (err) {
      // No storage = no loop guard, so don't auto-reload at all.
      let mayReload = false;
      try {
        mayReload = sessionStorage.getItem(FLAG) !== '1';
        if (mayReload) sessionStorage.setItem(FLAG, '1');
      } catch { mayReload = false; }
      if (mayReload) {
        window.location.reload();
        return new Promise(() => {});   // keep the fallback up until the reload happens
      }
      throw err;
    }
  });
}
