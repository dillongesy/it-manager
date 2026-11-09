#!/usr/bin/env node
// Check the outside-system keys in .env — Dell, ScreenConnect, UniFi, TD SYNNEX, Auvik,
// ThreatLocker, Outlook — without touching the database or changing anything anywhere.
//
//   node scripts/integrations-check.js              → every configured integration
//   node scripts/integrations-check.js JDJFX53      → also look up that Dell service tag
//   node scripts/integrations-check.js --raw        → also print one raw record from Auvik /
//                                                     ThreatLocker (to confirm field names)
//
// Never prints a key, secret or token. (ConnectWise has its own: scripts/connectwise-probe.js)

import * as dell from '../src/lib/dell-client.js';
import { warrantyFromAsset } from '../src/lib/dell.js';
import * as sc from '../src/lib/screenconnect-client.js';
import * as unifi from '../src/lib/unifi-client.js';
import { hostOf, deviceOf } from '../src/lib/unifi.js';
import * as td from '../src/lib/tdsynnex-client.js';
import * as auvik from '../src/lib/auvik-client.js';
import { remoteBrowserUrl, apiBase } from '../src/lib/auvik.js';
import * as tl from '../src/lib/threatlocker-client.js';
import { orgOf } from '../src/lib/threatlocker.js';
import * as outlook from '../src/lib/outlook-client.js';
import { normalizeEvents } from '../src/lib/outlook.js';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const [tagArg] = args.filter(a => !a.startsWith('--'));
const showRaw = (label, v) => { if (raw) console.log(`   raw ${label}: ${JSON.stringify(v, null, 1)?.slice(0, 1500)}`); };
let failed = false;
const step = async (name, configured, fn) => {
  if (!configured) { console.log(`– ${name}: not configured (skipped)`); return; }
  try { console.log(`✓ ${name}: ${await fn()}`); }
  catch (e) { failed = true; console.log(`✗ ${name}: ${e.message}`); }
};

await step('Dell warranty', dell.isDellConfigured(), async () => {
  await dell._raw.bearer();
  if (!tagArg) return 'signed in (pass a service tag to test a lookup)';
  const found = await dell.lookup([tagArg]);
  const asset = found.values().next().value;
  if (!asset) return `signed in — Dell has no record of ${tagArg}`;
  const w = warrantyFromAsset(asset);
  return `${w.tag} ${w.product}: warranty until ${w.expires ?? '—'} (${w.coverage || 'no coverage name'})`;
});

await step('ScreenConnect', sc.isScreenConnectConfigured(), async () => {
  const sessions = await sc.sessions();
  const companies = new Set(sessions.map(s => s.company).filter(Boolean)).size;
  return `${sessions.length} machines (${sessions.filter(s => s.online).length} online) across ${companies} companies`;
});

await step('UniFi', unifi.isUnifiConfigured(), async () => {
  const hosts = (await unifi.hosts()).map(hostOf);
  const devices = (await unifi.deviceGroups()).flatMap(g => (g.devices ?? []).map(d => deviceOf(d)));
  const owned = hosts.filter(h => h.owner).length;
  return `${hosts.length} consoles (${owned} owned — full WAN/VLAN/firewall import; ${hosts.length - owned} shared — device list only), `
    + `${devices.filter(d => d.portal_type).length} network devices, ${devices.filter(d => d.kind === 'camera').length} cameras`;
});

await step('TD SYNNEX', td.isTdSynnexConfigured(), async () => {
  await td._raw.bearer();
  const customers = await td.customers();
  return `signed in — ${customers.length} customers on the account`;
});

await step('Auvik', auvik.isAuvikConfigured(), async () => {
  const tenants = await auvik.tenants();
  const devices = await auvik.devices();
  const sample = devices.find(d => /printer/i.test(d.type)) ?? devices[0];
  if (sample) {
    const link = remoteBrowserUrl({ domainPrefix: sample.domain_prefix, deviceId: sample.id, port: 443, region: auvik.region() });
    console.log(`   sample: ${sample.name} (${sample.type}) in ${sample.tenant_name} — Web UI link: ${link}`);
    console.log('   ↳ compare with the address Auvik opens for that device (Remote Management → Remote Browser → 443); they should match.');
  }
  // One site only — asking for every tenant at once is refused for any the user can't see.
  if (raw && sample) showRaw('device', (await auvik._raw.get(`${apiBase(auvik.region())}/inventory/device/info?tenants=${sample.tenant_id}`))?.data?.[0]);
  return `${tenants.length} sites, ${devices.length} devices`;
});

await step('ThreatLocker', tl.isThreatLockerConfigured(), async () => {
  const orgs = (await tl.organizations()).filter(o => !orgOf(o).is_msp);   // the MSP's own org isn't a customer
  showRaw('organization', orgs[0]);
  const first = orgs.map(orgOf).find(o => o.id);
  if (first && raw) showRaw('computer', (await tl.computers(first.id))[0]);
  return `${orgs.length} customer organizations`;
});


await step('Outlook calendar', outlook.isOutlookConfigured(), async () => {
  await outlook._raw.calendar();
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 14 * 86_400_000);
  const events = normalizeEvents(await outlook.calendarEvents(from.toISOString(), to.toISOString()), []);
  showRaw('event', events[0]);
  return `calendar found — ${events.length} events in the next two weeks`;
});

process.exit(failed ? 1 : 0);
