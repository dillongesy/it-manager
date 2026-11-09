// A device's MAC addresses: mac_address plus other_macs [{ mac, note }] (migration 062).
// Shared by every import so a machine seen on its wired port by one source and on Wi-Fi
// by another is still recognised as one device, and so an import only ever adds a MAC.

import { formatMac, macKey } from './connectwise.js';

const str = (v) => (v == null ? '' : String(v).trim());

/** other_macs cleaned up: valid addresses only, formatted, one entry per address. */
export function cleanOtherMacs(list, primary = '') {
  const seen = new Set([macKey(primary)].filter(Boolean));
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const k = macKey(typeof e === 'string' ? e : e?.mac);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ mac: formatMac(k), note: typeof e === 'string' ? '' : str(e?.note) });
  }
  return out;
}

/** Every MAC a Portal device is known by, as bare keys ("38FF59402F77"). */
export function deviceMacKeys(device) {
  return new Set([macKey(device?.mac_address), ...cleanOtherMacs(device?.other_macs).map(e => macKey(e.mac))].filter(Boolean));
}

/** True when the device is known by any of these MACs. */
export const hasAnyMac = (device, macs) => {
  const known = deviceMacKeys(device);
  return (macs ?? []).some(m => known.has(macKey(typeof m === 'string' ? m : m?.mac)));
};

/**
 * Add MACs to a device without replacing any: the first one fills a blank mac_address,
 * the rest that aren't already known go on other_macs.
 * @param incoming [{ mac, note }] — strongest first (the address the source considers primary)
 * @returns {{ mac_address?: string, other_macs?: object[], added: string[] }} only the columns that change
 */
export function addMacs(device, incoming) {
  const known = deviceMacKeys(device);
  const out = { added: [] };
  let primary = str(device?.mac_address);
  const others = cleanOtherMacs(device?.other_macs, primary);
  let changedOthers = false;
  for (const e of incoming ?? []) {
    const k = macKey(e?.mac);
    if (!k || known.has(k)) continue;
    known.add(k);
    const mac = formatMac(k);
    out.added.push(e.note ? `${mac} (${e.note})` : mac);
    if (!macKey(primary)) { primary = mac; out.mac_address = mac; continue; }
    others.push({ mac, note: str(e.note) });
    changedOthers = true;
  }
  if (changedOthers) out.other_macs = others;
  return out;
}

/**
 * The address a source reports for the device's own main MAC, to compare with the IP on
 * file. When the source only saw the device's other card (Wi-Fi vs the network port)
 * there's nothing to compare — both addresses are right — so this returns null.
 * @param addresses [{ mac, ip, ip_assignment }] — what the source saw, strongest first
 */
export function addressFor(device, addresses) {
  const seen = (addresses ?? []).filter(a => str(a?.ip));
  const main = macKey(device?.mac_address);
  if (!main) return seen[0] ?? null;
  return seen.find(a => macKey(a.mac) === main) ?? null;
}

export const otherMacsText =(list) => cleanOtherMacs(list).map(e => (e.note ? `${e.mac} (${e.note})` : e.mac)).join(', ');
