// How every import (ConnectWise, UniFi) merges into what the Portal already has, so the
// two sources work the same way and never fight over a record:
//
//   fill    - a blank Portal field gets the source's value
//   add     - new list items (VLANs, IPs, shares, accounts), MACs and notes lines are added;
//             nothing is removed (change mode 'add': `to` is just what's added)
//   differs - a value the Portal already has that the source reports differently is KEPT.
//             The preview lists it ("kept: 192.168.0.134 · ConnectWise has 192.168.0.194"),
//             and it's only written when the person ticks "Also replace values that
//             changed" (take_newer) for that import.
//
// A plan is { updates, changes, newer, differs }: updates/changes are applied always,
// newer/differs only with take_newer.

export function planner() {
  const updates = {};
  const newer = {};
  const changes = [];
  const differs = [];
  return {
    updates, newer, changes, differs,
    /** An additive change (fill a blank, add to a list). */
    apply(field, value, from, to, mode = from == null ? 'fill' : 'update') {
      updates[field] = value;
      changes.push({ field, from, to, mode });
    },
    /** A different value the Portal keeps unless asked to replace it. */
    differ(field, value, from, to) {
      newer[field] = value;
      differs.push({ field, from, to, mode: 'update' });
    },
    result() { return { updates, changes, newer, differs }; },
  };
}

/** The columns an import writes. */
export const columnsFor = (plan, takeNewer = false) => (takeNewer ? { ...plan.updates, ...plan.newer } : { ...plan.updates });

/** What the import did, for the summary and the audit log (one entry per field). */
export function changesFor(plan, takeNewer = false) {
  if (!takeNewer || !plan.differs?.length) return plan.changes;
  const out = plan.changes.map(c => ({ ...c }));
  for (const d of plan.differs) {
    const same = out.find(c => c.field === d.field);
    if (same) same.to = `${same.to}; ${d.to}`;   // e.g. VLANs: "add VLAN 30; refresh VLAN 10"
    else out.push(d);
  }
  return out;
}
