// A device with more than one MAC (network port + Wi-Fi), and imports that only ever add:
// the shared helpers, UniFi folding one machine's clients together and matching across
// ConnectWise/UniFi, and ConnectWise no longer swapping a MAC back and forth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMacs, cleanOtherMacs, deviceMacKeys } from '../../src/lib/device-macs.js';
import { clientOf, groupClients, clientFields, clientInsertFields, findDeviceMatch, planDevice } from '../../src/lib/unifi.js';
import { mergePlan, findMatch } from '../../src/lib/connectwise.js';

test('other MACs are cleaned, de-duplicated and never repeat the main one', () => {
  assert.deepEqual(cleanOtherMacs(['38ff59402f77', { mac: '38-FF-59-40-2F-77', note: 'x' }, { mac: 'junk' }, { mac: '50:2e:66:64:20:a3', note: ' Wired ' }], '50:2E:66:64:20:A3'),
    [{ mac: '38:FF:59:40:2F:77', note: '' }]);
  assert.deepEqual([...deviceMacKeys({ mac_address: '50:2E:66:64:20:A3', other_macs: [{ mac: '38:FF:59:40:2F:77' }] })], ['502E666420A3', '38FF59402F77']);
});

test('addMacs fills a blank main MAC, adds unknown ones to the list, and never replaces', () => {
  assert.deepEqual(addMacs({}, [{ mac: '50:2e:66:64:20:a3', note: 'Wired' }, { mac: '38:ff:59:40:2f:77', note: 'Wi-Fi' }]),
    { added: ['50:2E:66:64:20:A3 (Wired)', '38:FF:59:40:2F:77 (Wi-Fi)'], mac_address: '50:2E:66:64:20:A3', other_macs: [{ mac: '38:FF:59:40:2F:77', note: 'Wi-Fi' }] });
  // The Zion-SEC2 case: the device has the Wi-Fi MAC; UniFi now sees the wired one too.
  const r = addMacs({ mac_address: '38:FF:59:40:2F:77' }, [{ mac: '50:2E:66:64:20:A3', note: 'Wired' }, { mac: '38:FF:59:40:2F:77', note: 'Wi-Fi' }]);
  assert.equal(r.mac_address, undefined);
  assert.deepEqual(r.other_macs, [{ mac: '50:2E:66:64:20:A3', note: 'Wired' }]);
  assert.deepEqual(addMacs({ mac_address: '38:FF:59:40:2F:77', other_macs: [{ mac: '50:2E:66:64:20:A3' }] }, [{ mac: '502E666420A3' }]), { added: [] });
});

const zion = [
  clientOf({ mac: '50:2e:66:64:20:a3', hostname: 'Zion-SEC2', oui: 'Intel Corporate', ip: '192.168.0.194', is_wired: true }, [], { online: true }),
  clientOf({ mac: '38:ff:59:40:2f:77', hostname: 'Zion-SEC2', oui: 'Intel Corporate', ip: '192.168.0.134', is_wired: false }, [], { online: true }),
  clientOf({ mac: '00:0b:aa:2e:58:d9', oui: 'Aiphone co.,Ltd', ip: '192.168.0.9', is_wired: true }, [], { online: true }),
];

test('one machine on its network port and on Wi-Fi is one client with both MACs', () => {
  const rows = groupClients(zion, []);
  assert.equal(rows.length, 2);
  const z = rows.find(r => r.hostname === 'Zion-SEC2');
  assert.equal(z.key, '502E666420A3');                         // the wired, online one leads
  assert.deepEqual(z.macs.map(m => [m.mac, m.note]), [['50:2E:66:64:20:A3', 'Wired'], ['38:FF:59:40:2F:77', 'Wi-Fi']]);
  // Clients with different hostnames are folded when the Portal already has both MACs on one device.
  const split = [{ ...zion[0], hostname: '', names: [] }, zion[1]];
  assert.equal(groupClients(split, [{ id: 'd', mac_address: '50:2E:66:64:20:A3', other_macs: [{ mac: '38:FF:59:40:2F:77' }] }]).length, 1);
  assert.equal(groupClients(split, []).length, 2);
});

test('an unnamed gadget is labelled and noted with its maker', () => {
  const [aiphone] = groupClients(zion, []).filter(r => !r.hostname);
  assert.equal(aiphone.name, 'Aiphone · 00:0B:AA:2E:58:D9');
  const f = clientFields({ ...aiphone, portal_type: 'other' });
  assert.equal(f.manufacturer, 'Aiphone');
  assert.equal(f.note_line, 'Manufacturer: Aiphone co.,Ltd (from its MAC address)');
  assert.equal(clientInsertFields(f).notes, f.note_line);
  assert.equal('mac_note' in clientInsertFields(f), false);
  // Already imported (labelled by its MAC, no notes): the note is added, nothing replaced.
  const plan = planDevice({ label: '00:0B:AA:2E:58:D9', mac_address: '00:0B:AA:2E:58:D9', manufacturer: 'Aiphone', ip_address: '192.168.0.9' }, f);
  assert.deepEqual(plan.changes.map(c => c.field), ['notes']);
  assert.equal(plan.updates.notes, f.note_line);
  // Notes that already name the maker are left alone; other notes keep their text.
  assert.equal(planDevice({ mac_address: f.mac_address, notes: 'Aiphone master station, kitchen' }, f).updates.notes, undefined);
  assert.equal(planDevice({ mac_address: f.mac_address, notes: 'Lobby door' }, f).updates.notes, `Lobby door\n${f.note_line}`);
});

test('a client is only added to: no IP or MAC is replaced, and the other card\'s IP is no difference', () => {
  const [z] = groupClients(zion, []).filter(r => r.hostname);
  const f = clientFields({ ...z, portal_type: 'workstation' });
  const device = { id: 'd', label: 'Zion-SEC2', computer_name: 'ZION-SEC2', ip_address: '192.168.0.134', mac_address: '38:FF:59:40:2F:77', unifi_device_id: '502E666420A3' };
  const plan = planDevice(device, f);
  assert.deepEqual(plan.changes.map(c => [c.field, c.to]), [['other_macs', '50:2E:66:64:20:A3 (Wired)']]);
  assert.deepEqual(plan.differs, []);                          // .134 is the Wi-Fi card's address — still right
  // The device's own card at a new address: kept, but offered.
  const moved = planDevice({ ...device, ip_address: '192.168.0.120' }, f);
  assert.deepEqual(moved.differs.map(c => [c.field, c.from, c.to]), [['ip_address', '192.168.0.120', '192.168.0.134']]);
  assert.equal(plan.updates.ip_address, undefined);
  assert.equal(plan.updates.mac_address, undefined);
  assert.equal(f.note_line, '');                               // a computer's NIC maker isn't its maker
  // UniFi's own gear works the same way.
  const gear = planDevice({ ip_address: '10.0.0.2', mac_address: 'AA:AA:AA:AA:AA:AA' }, { ip_address: '10.0.0.3', mac_address: 'AA:AA:AA:AA:AA:AA' });
  assert.equal(gear.updates.ip_address, undefined);
  assert.equal(gear.newer.ip_address, '10.0.0.3');
});

test('UniFi finds a device ConnectWise imported: by any MAC, or by hostname without the domain', () => {
  const cw = { id: 'cw', label: 'Zion SEC2', computer_name: 'ZION-SEC2', mac_address: '50:2E:66:64:20:A3', rmm_endpoint_id: 'e1' };
  const other = { id: 'x', label: 'Front desk', computer_name: 'FRONT-01' };
  assert.equal(findDeviceMatch({ key: '38FF59402F77', macs: [{ mac: '38:FF:59:40:2F:77' }], names: ['zion-sec2.local'] }, [other, cw]).device.id, 'cw');
  assert.equal(findDeviceMatch({ key: '38FF59402F77', macs: [{ mac: '38:FF:59:40:2F:77' }], names: [] }, [other, { ...cw, other_macs: [{ mac: '38:FF:59:40:2F:77' }] }]).reason, 'MAC address');
  // A made-up label never matches by name.
  assert.equal(findDeviceMatch({ key: '000BAA2E58D9', names: [] }, [{ id: 'y', label: 'Aiphone · 00:0B:AA:2E:58:D9' }]).device, null);
});

test('ConnectWise adds a MAC instead of replacing it, and matches on any network card', () => {
  const device = { id: 'd', computer_name: 'ZION-SEC2', mac_address: '38:FF:59:40:2F:77' };
  const plan = mergePlan(device, { computer_name: 'ZION-SEC2', mac_address: '50:2E:66:64:20:A3' });
  assert.equal(plan.updates.mac_address, undefined);
  assert.deepEqual(plan.updates.other_macs, [{ mac: '50:2E:66:64:20:A3', note: '' }]);
  assert.deepEqual(mergePlan({ ...device, ...plan.updates }, { mac_address: '50:2E:66:64:20:A3' }).changes, []);
  const m = { machine_name: 'SOMETHING-ELSE', mac: '50:2E:66:64:20:A3', macs: ['50:2E:66:64:20:A3', '38:FF:59:40:2F:77'] };
  assert.equal(findMatch(m, [{ id: 'u', mac_address: '38:FF:59:40:2F:77', unifi_device_id: '38FF59402F77' }]).reason, 'MAC address');
});

test('ConnectWise and UniFi run back to back without fighting over a device', () => {
  // ConnectWise imported it by its network port; UniFi sees it on Wi-Fi under its hostname.
  const cwFields = { computer_name: 'ZION-SEC2', mac_address: '50:2E:66:64:20:A3', ip_address: '192.168.0.194', operating_system: 'Windows 11 Pro' };
  let device = { id: 'd', label: 'Zion-SEC2', ...cwFields, rmm_endpoint_id: 'e1' };
  const [wifiOnly] = groupClients([zion[1]], [device]);
  const uf = clientFields({ ...wifiOnly, portal_type: 'workstation' });
  assert.equal(findDeviceMatch({ key: wifiOnly.key, macs: wifiOnly.macs, names: wifiOnly.names }, [device]).device.id, 'd');
  const u = planDevice(device, uf);
  assert.deepEqual(u.differs, []);                             // the Wi-Fi IP isn't a conflict with the port's
  device = { ...device, ...u.updates };
  assert.deepEqual(device.other_macs, [{ mac: '38:FF:59:40:2F:77', note: 'Wi-Fi' }]);
  // ConnectWise again: nothing to add, nothing that differs.
  const c = mergePlan(device, cwFields);
  assert.deepEqual([c.changes, c.differs], [[], []]);
  // UniFi again: same.
  const again = planDevice(device, uf);
  assert.deepEqual([again.changes, again.differs], [[], []]);
});
