// UniFi clients → Devices tab (printers and other gear, not the bloat), how each device's
// address is assigned (DHCP / reservation / static), and a gateway's VPNs. Fixtures are
// shaped like stat/sta, rest/user and networkconf records from live consoles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ipAssignment, classifyClient, clientOf, clientsFrom, clientFields, vpnsFrom, mergeVpns, vpnCredentials, planDevice,
} from '../../src/lib/unifi.js';

const networks = [
  { id: 'n1', ipv4Configuration: { hostIpAddress: '10.3.1.1', prefixLength: 24, dhcpConfiguration: { mode: 'SERVER', ipAddressRange: { start: '10.3.1.30', stop: '10.3.1.240' } } } },
  { id: 'n2', ipv4Configuration: { hostIpAddress: '10.60.21.1', prefixLength: 24, dhcpConfiguration: { mode: 'NONE' } } },
];

test('how an address is assigned: reservation, inside the DHCP range, or static', () => {
  assert.equal(ipAssignment('10.3.1.10', { fixed: true }, networks), 'reservation');
  assert.equal(ipAssignment('10.3.1.145', {}, networks), 'dhcp');
  assert.equal(ipAssignment('10.3.1.11', {}, networks), 'static');        // below the range start
  assert.equal(ipAssignment('10.3.1.250', {}, networks), 'static');       // above the range end
  assert.equal(ipAssignment('10.60.21.4', {}, networks), 'static');       // DHCP off on that network
  assert.equal(ipAssignment('192.168.9.9', {}, networks), null);          // not a network this gateway serves
  assert.equal(ipAssignment('', {}, networks), null);
});

test('clients are sorted into what is worth documenting and what is bloat', () => {
  const kind = (c) => classifyClient(c).kind;
  assert.equal(kind({ hostname: 'KM127211', oui: 'KYOCERA Document Solutions Inc.' }), 'printer');
  assert.equal(kind({ hostname: 'HPF2311C', oui: 'HP Inc.' }), 'printer');
  assert.equal(kind({ hostname: 'LW Print Server', oui: 'KCodes Corporation' }), 'printer');
  assert.equal(kind({ oui: 'Canon Inc.' }), 'printer');                    // no hostname — the MAC vendor says enough
  assert.equal(kind({ oui: 'SHARP Corporation' }), 'printer');
  assert.equal(kind({ oui: 'Hewlett Packard' }), 'printer');               // HP with no hostname: a printer, not a PC
  assert.equal(kind({ oui: 'QNAP Systems, Inc.' }), 'nas');
  assert.equal(kind({ mac: '52:54:00:bc:83:b7' }), 'server');              // a virtual machine
  assert.equal(kind({ oui: 'Sanyo Denki Co., Ltd.' }), 'power');           // a UPS
  assert.equal(kind({ hostname: 'HOYWKS0008', oui: 'Dell Inc.' }), 'computer');
  assert.equal(kind({ hostname: 'SIP-T46U', oui: 'Yealink(Xiamen) Network Technology Co.,Ltd.' }), 'voip');
  assert.equal(kind({ hostname: 'iPhone' }), 'mobile');
  assert.equal(kind({ hostname: 'LGwebOSTV' }), 'tv');
  assert.equal(kind({ hostname: 'DIRECTV-H24-6B820095', oui: 'Samsung Electronics Co.,Ltd' }), 'tv');
  assert.equal(kind({ oui: 'Vizio, Inc' }), 'tv');
  assert.equal(kind({ oui: 'Hangzhou Hikvision Digital Technology Co.,Ltd.' }), 'camera');
  assert.equal(kind({ name: 'Back Door', hostname: 'back-door', last_connection_network_name: 'Cameras' }), 'camera');
  assert.equal(kind({ hostname: 'uvc-g6-turret' }), 'unifi');
  assert.equal(kind({ hostname: 'hydrawise-db6a', dev_cat: 130 }), 'iot');

  const printer = classifyClient({ hostname: 'KM127211', oui: 'KYOCERA Document Solutions Inc.' });
  assert.deepEqual([printer.portal_type, printer.important, printer.hidden], ['printer', true, false]);
  const pc = classifyClient({ hostname: 'HOYWKS0008', oui: 'Dell Inc.' });
  assert.deepEqual([pc.portal_type, pc.important, pc.hidden], ['workstation', false, false]);   // offered, not pre-ticked
  const tv = classifyClient({ hostname: 'LGwebOSTV' });
  assert.deepEqual([tv.portal_type, tv.hidden], [null, true]);                                 // never a Devices-tab record
});

test('online clients plus offline reservations, one per MAC, each labelled', () => {
  const online = [
    { mac: '00:17:c8:12:72:11', hostname: 'KM127211', oui: 'KYOCERA Document Solutions Inc.', ip: '10.3.1.10', use_fixedip: true, fixed_ip: '10.3.1.10', is_wired: true },
    { mac: 'aa:bb:cc:00:00:01', hostname: 'iPhone', ip: '10.3.1.41' },
  ];
  const known = [
    { mac: '00:17:c8:12:72:11', hostname: 'KM127211', use_fixedip: true, fixed_ip: '10.3.1.10' },          // already online
    { mac: 'de:ad:be:ef:00:01', hostname: 'Old Printer', oui: 'Brother Industries', use_fixedip: true, fixed_ip: '10.3.1.20', last_seen: 1792907151 },
    { mac: 'de:ad:be:ef:00:02', hostname: 'random-guest', last_ip: '10.3.1.99' },                           // offline, nothing reserved → dropped
  ];
  const list = clientsFrom(online, known, networks);
  assert.deepEqual(list.map(c => c.name), ['iPhone', 'KM127211', 'Old Printer']);
  const km = list.find(c => c.name === 'KM127211');
  assert.deepEqual([km.ip_assignment, km.online, km.mac], ['reservation', true, '00:17:C8:12:72:11']);
  const old = list.find(c => c.name === 'Old Printer');
  assert.deepEqual([old.online, old.ip, old.kind], [false, '10.3.1.20', 'printer']);

  const f = clientFields(clientOf(online[0], networks, { online: true }));
  assert.deepEqual(f, { device_type: 'printer', label: 'KM127211', computer_name: '', manufacturer: 'Kyocera',
    ip_address: '10.3.1.10', ip_assignment: 'reservation', mac_address: '00:17:C8:12:72:11', mac_note: 'Wired', other_macs: [], addresses: [{ mac: '00:17:C8:12:72:11', ip: '10.3.1.10', ip_assignment: 'reservation' }],
    note_line: 'Manufacturer: KYOCERA Document Solutions Inc. (from its MAC address)', note_key: 'Kyocera' });
});

test('an existing printer gets its IP label; a changed one is kept and offered', () => {
  const fields = { device_type: 'printer', label: 'KM127211', ip_address: '10.3.1.10', ip_assignment: 'reservation', mac_address: '00:17:C8:12:72:11' };
  let plan = planDevice({ label: 'Front copier', ip_address: '10.3.1.10' }, fields);
  assert.equal(plan.updates.ip_assignment, 'reservation');
  assert.equal(plan.updates.label, undefined);                              // the name typed in the Portal stays
  plan = planDevice({ label: 'Front copier', ip_address: '10.3.1.10', ip_assignment: 'dhcp', mac_address: '00:17:c8:12:72:11' }, fields);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.differs.map(c => [c.field, c.from, c.to]), [['ip_assignment', 'dhcp', 'reservation']]);
});

const networkconf = [
  { _id: 'wg1', external_id: 'ext-wg', purpose: 'remote-user-vpn', vpn_type: 'wireguard-server', name: 'VPN Server', ip_subnet: '192.168.2.1/24', local_port: 51820, enabled: true },
  { _id: 's2s', external_id: 'ext-s2s', purpose: 'site-vpn', vpn_type: 'ipsec-vpn', name: 'Northwind Site-to-Site', ipsec_peer_ip: '216.51.137.234',
    ipsec_local_ip: '216.248.78.24', remote_vpn_subnets: ['10.127.60.0/24'], ipsec_key_exchange: 'ikev1', ipsec_ike_encryption: 'aes256',
    ipsec_ike_hash: 'sha256', ipsec_ike_dh_group: 14, ipsec_esp_encryption: 'aes256', ipsec_esp_hash: 'sha256', ipsec_pfs: true, enabled: true },
  { _id: 'lan', purpose: 'corporate', name: 'Default' },
];

test('a gateway\'s VPNs are documented — settings and users, never a key', () => {
  const v = vpnsFrom(networkconf, { wg1: [{ name: "Mandy's Windows Laptop", interface_ip: '192.168.2.3' }] });
  assert.equal(v.length, 2);
  assert.deepEqual([v[0].type, v[0].subnet, v[0].port, v[0].users], ['WireGuard server', '192.168.2.0/24', '51820', "Mandy's Windows Laptop (192.168.2.3)"]);
  assert.deepEqual([v[1].type, v[1].peer, v[1].local, v[1].remote_subnets], ['Site-to-site IPsec', '216.51.137.234', '216.248.78.24', '10.127.60.0/24']);
  assert.equal(v[1].details, 'IKE ikev1 aes256/sha256 DH14 · ESP aes256/sha256 PFS');
  assert.equal(JSON.stringify(v).includes('psk'), false);
});

test('re-importing VPNs keeps notes typed on them and hand-entered VPNs', () => {
  const imported = vpnsFrom(networkconf);
  const existing = [{ ...imported[0], notes: 'users connect from home only' }, { type: 'SSL VPN', name: 'Old SonicWall VPN' }];
  const merged = mergeVpns(existing, imported);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].notes, 'users connect from home only');
  assert.equal(merged[2].name, 'Old SonicWall VPN');
});

test('a site-to-site key becomes an encrypted credential in the VPN section', () => {
  const [c] = vpnCredentials([{ external_id: 'ext-s2s', name: 'Northwind Site-to-Site', vpn_type: 'ipsec-vpn', ipsec_peer_ip: '216.51.137.234', psk: 'abc123' }, { name: 'empty', psk: '' }]);
  assert.deepEqual([c.key, c.label, c.password, c.section], ['ext-s2s', 'Northwind Site-to-Site — pre-shared key', 'abc123', 'VPN']);
  assert.equal(c.notes, 'Site-to-site IPsec · peer 216.51.137.234');
});
