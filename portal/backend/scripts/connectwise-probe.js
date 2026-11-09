#!/usr/bin/env node
// Check the ConnectWise RMM connection and show how the Portal reads a real device.
//
//   node scripts/connectwise-probe.js                       → first company / first site
//   node scripts/connectwise-probe.js "Smith Dental"        → that company (name contains)
//   node scripts/connectwise-probe.js "Smith Dental" "Main" → that company + site
//
// Read-only. Prints: sign-in result, companies, sites, which device-list request your
// tenant accepts, one device exactly as ConnectWise returns it (list summary, v2
// details, v1 details), and the fields the import would write. Use the output to
// confirm/adjust the field names in src/lib/connectwise.js — ConnectWise only publishes
// its response schemas behind a partner login.
//
// Never prints the client secret or the access token.

import * as cw from '../src/lib/connectwise-client.js';
import { companyOf, siteOf, sortByName, normalizeEndpoint, flattenDevice, deviceFieldsFromMachine } from '../src/lib/connectwise.js';
import { config } from '../src/config/index.js';

const [companyArg, siteArg] = process.argv.slice(2).map(s => s.toLowerCase());
const show = (label, v, max = 4000) => {
  const s = JSON.stringify(v, null, 2) ?? String(v);
  console.log(`\n── ${label} ──\n${s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more chars)` : s}`);
};

try {
  if (!cw.isConnectWiseConfigured()) {
    console.error('CONNECTWISE_CLIENT_ID / CONNECTWISE_CLIENT_SECRET are not set in portal/backend/.env');
    process.exit(1);
  }
  console.log(`Server: ${cw.baseUrlFor(config.connectWise.clientId, config.connectWise.baseUrl)}`);
  await cw._raw.bearer();
  console.log(`✓ Signed in — asset inventory (${cw.ASSET_SCOPE}): ${cw.hasAssetScope() ? 'yes' : 'NO — processor, installed RAM, disks, accounts and shares will be limited'}`);

  const rawCompanies = await cw.companies();
  const companies = sortByName(rawCompanies.map(companyOf).filter(c => c.id));
  console.log(`✓ ${companies.length} companies: ${companies.slice(0, 8).map(c => c.name).join(', ')}${companies.length > 8 ? ', …' : ''}`);

  const company = companyArg ? companies.find(c => c.name.toLowerCase().includes(companyArg)) : companies[0];
  if (!company) { console.error(`\nNo company matching "${companyArg}".`); process.exit(1); }

  const sites = sortByName((await cw.sites(company.id)).map(siteOf).filter(s => s.id));
  console.log(`✓ ${company.name}: ${sites.length} site(s): ${sites.map(s => s.name).join(', ')}`);
  const site = siteArg ? sites.find(s => s.name.toLowerCase().includes(siteArg)) : sites[0];
  if (!site) { console.error(`\nNo site matching "${siteArg}".`); process.exit(1); }

  const rows = await cw.siteEndpoints(company.id, site.id);
  console.log(`✓ ${company.name} › ${site.name}: ${rows.length} device(s)  [device list request: ${cw.deviceListShape()}]`);
  if (cw.lastDetailsNote()) console.log(`  ! v2 details: ${cw.lastDetailsNote()}`);
  if (cw.lastHardwareNote()) console.log(`  ! v1 details (hardware): ${cw.lastHardwareNote()}`);
  if (!rows.length) process.exit(0);

  const ctx = { companyId: company.id, companyName: company.name, siteId: site.id, siteName: site.name };
  const rec = rows[0];
  show('Raw device — list summary', rec.summary, 2000);
  show('Raw device — v2 details', rec.v2, 4000);
  show('Raw device — v1 asset inventory', rec.v1, 6000);
  show('Raw device — memory-usage', rec.memory, 1500);
  show('Raw device — disk-usage', rec.disks, 3000);
  const m = normalizeEndpoint(flattenDevice(rec), ctx);
  show('How the Portal reads it', m);
  show('Fields an import would write', deviceFieldsFromMachine(m));
  const blanks = Object.entries(m)
    .filter(([k, v]) => v === '' && !['public_ip', 'domain', 'company', 'site'].includes(k))
    .map(([k]) => k);
  if (blanks.length) {
    console.log(`\nBlank after mapping: ${blanks.join(', ')}`);
    console.log('If the raw output above has any of these under another name, that name needs adding to src/lib/connectwise.js.');
  }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
