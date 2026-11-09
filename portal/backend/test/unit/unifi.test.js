// UniFi → Devices tab (gateway as a firewall with WAN / VLANs / rules), switches, APs,
// and Protect cameras. Fixtures are shaped like what api.ui.com returned for live
// consoles on 2026-10-26.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf, classify, deviceOf, deviceFields, consoleUrl, portCountFrom,
  wanFrom, prefixToMask, networkAddress, vlansFrom, internalIpsFrom, mergeVlans,
  rulesFrom, mergeRules, planDevice, findDeviceMatch,
  cameraFields, cameraTypeFrom, planCamera, findCameraMatch, systemFields, findSystemMatch, isPublicIpv4,
  WIFI_SECTION, wifiCredential, findWifiMatch, planWifi,
} from '../../src/lib/unifi.js';

const rawHost = {
  id: '58D61F6AA6090000000009B26CFD000000000A3B830B0000000069398A88:1827617672',
  ipAddress: '104.222.91.35',
  owner: true,
  reportedState: {
    name: 'Huebner Funeral Home', hostname: 'Huebner-Funeral-Home', state: 'connected', version: '5.1.132',
    mac: '58D61F6AA609',
    hardware: { name: 'UniFi Dream Machine Pro', shortname: 'UDMPRO', mac: '58D61F6AA609' },
    controllers: [{ name: 'network', version: '10.6.109', state: 'active' }, { name: 'protect', version: '', state: 'inactive' }],
    wans: [{ ipv4: '104.222.91.35', plugged: true, type: 'WAN' }, { plugged: false, type: 'WAN2' }],
  },
};
const host = hostOf(rawHost);
const sm = (o) => ({ productLine: 'network', status: 'online', isConsole: false, version: '7.5.15', ...o });

test('a console record reads cleanly', () => {
  assert.equal(host.name, 'Huebner Funeral Home');
  assert.equal(host.model, 'UniFi Dream Machine Pro');
  assert.equal(host.owner, true);
  assert.equal(host.online, true);
  assert.equal(host.network, '10.6.109');
  assert.equal(host.protect, null);                    // installed but inactive
  assert.equal(host.mac, '58D61F6AA609');
});

test('devices are classified the way the Portal files them', () => {
  const kind = (o) => classify(sm(o));
  assert.equal(kind({ model: 'UDM Pro', shortname: 'UDMPRO', isConsole: true }), 'gateway');
  assert.equal(kind({ model: 'UCG Ultra', shortname: 'UDRULT', isConsole: true }), 'gateway');
  assert.equal(kind({ model: 'UDR7', shortname: 'UDR7' }), 'gateway');
  assert.equal(kind({ model: 'USW Pro 48 PoE', shortname: 'USWPRO48P' }), 'switch');
  assert.equal(kind({ model: 'US 8 60W', shortname: 'US8P60' }), 'switch');
  assert.equal(kind({ model: 'USW Flex Mini', shortname: 'USMINI' }), 'switch');
  assert.equal(kind({ model: 'U6+', shortname: 'UAPL6' }), 'other');
  assert.equal(kind({ model: 'UCK G2 Plus', shortname: 'UCKP', isConsole: true }), 'console');
  assert.equal(kind({ model: 'UNAS 2', shortname: 'UNAS2B' }), 'nas');
  assert.equal(kind({ productLine: 'protect', model: 'UNVR Instant', isConsole: true }), 'nvr');
  assert.equal(kind({ productLine: 'protect', model: 'G6 Turret' }), 'camera');
  assert.equal(kind({ productLine: 'protect', model: 'ONVIF IPC-2X4G-DM' }), 'camera');
  assert.equal(kind({ productLine: 'protect', model: 'Viewport' }), 'protect_other');
});

test('gateway → firewall fields, with the console link and UniFi serial (= MAC)', () => {
  const dev = deviceOf(sm({ id: '58D61F6AA609', mac: '58D61F6AA609', name: 'Huebner Funeral Home', model: 'UDM Pro', shortname: 'UDMPRO', isConsole: true, version: '5.1.33', ip: '104.222.91.35' }), host);
  assert.equal(dev.portal_type, 'firewall');
  const f = deviceFields(dev, { external_ips: ['104.222.91.35'], wan_gateway: '104.222.91.1' });
  assert.equal(f.manufacturer, 'Ubiquiti');
  assert.equal(f.serial_number, '58D61F6AA609');
  assert.equal(f.mac_address, '58:D6:1F:6A:A6:09');
  assert.equal(f.firmware_version, '5.1.33');
  assert.deepEqual(f.external_ips, ['104.222.91.35']);
  assert.equal(f.ip_address, undefined);               // a firewall's public IP lives in external IPs
  assert.ok(f.driver_url.startsWith('https://unifi.ui.com/consoles/58D61F6AA609'));
  assert.ok(f.driver_url.includes(':1827617672/'));     // console IDs keep their colon
});

test('switch fields include ports from the model name', () => {
  assert.equal(portCountFrom('USW Pro 48 PoE'), 48);
  assert.equal(portCountFrom('US 16 PoE 150W'), 16);
  assert.equal(portCountFrom('USW Flex Mini'), null);
  const f = deviceFields(deviceOf(sm({ id: '74ACB912BA81', mac: '74ACB912BA81', name: 'Basement', model: 'US 16 PoE 150W', ip: '10.3.1.4' }), host));
  assert.equal(f.device_type, 'switch');
  assert.equal(f.port_count, 16);
  assert.equal(f.ip_address, '10.3.1.4');
  assert.equal(f.managed_switch, true);
});

test('WAN: static settings from the primary WAN, every public address in external IPs', () => {
  const networkconf = [
    { purpose: 'corporate', name: 'Default' },
    { purpose: 'wan', name: 'Internet 1', wan_failover_priority: 1, wan_type: 'static', wan_ip: '104.222.91.35', wan_netmask: '255.255.255.0',
      wan_gateway: '104.222.91.1', wan_dns_preference: 'manual', wan_dns1: '207.177.9.198', wan_dns2: '207.177.9.197', wan_ip_aliases: ['104.222.91.36/24'] },
    { purpose: 'wan', name: 'Internet 2', wan_failover_priority: 2, wan_type: 'dhcp' },
  ];
  const w = wanFrom(networkconf, host);
  assert.deepEqual(w.external_ips, ['104.222.91.35', '104.222.91.36']);
  assert.equal(w.wan_subnet_mask, '255.255.255.0');
  assert.equal(w.wan_gateway, '104.222.91.1');
  assert.equal(w.wan_dns, '207.177.9.198, 207.177.9.197');
  assert.deepEqual(w.wans.map(x => x.type), ['static', 'dhcp']);
});

test('WAN behind an ISP modem: no static settings, the console\'s public IP is still recorded', () => {
  const behind = { ...host, public_ip: '206.127.189.33', wans: [{ ipv4: '10.8.31.119', plugged: true }] };
  const w = wanFrom([{ purpose: 'wan', name: 'Internet 1', wan_type: 'dhcp' }], behind);
  assert.deepEqual(w.external_ips, ['206.127.189.33']);  // the private modem-side address is left out
  assert.equal(w.wan_gateway, '');
  assert.equal(isPublicIpv4('100.64.1.1'), false);       // CGNAT isn't public
});

test('subnet math', () => {
  assert.equal(prefixToMask(24), '255.255.255.0');
  assert.equal(prefixToMask(27), '255.255.255.224');
  assert.equal(prefixToMask(0), '0.0.0.0');
  assert.equal(prefixToMask(33), '');
  assert.equal(networkAddress('10.3.2.1', 24), '10.3.2.0');
  assert.equal(networkAddress('192.168.15.130', 25), '192.168.15.128');
});

const networks = [
  { id: 'n1', name: 'Default', vlanId: 1, management: 'GATEWAY', default: true, enabled: true, isolationEnabled: false,
    ipv4Configuration: { hostIpAddress: '10.3.1.1', prefixLength: 24, dhcpConfiguration: { mode: 'SERVER', ipAddressRange: { start: '10.3.1.30', stop: '10.3.1.240' } } } },
  { id: 'n3', name: 'Guest-WiFi', vlanId: 3, management: 'GATEWAY', default: false, enabled: true, isolationEnabled: true,
    ipv4Configuration: { hostIpAddress: '10.3.3.1', prefixLength: 24, dhcpConfiguration: { mode: 'SERVER', ipAddressRange: { start: '10.3.3.50', stop: '10.3.3.254' }, dnsServerIpAddressesOverride: ['8.8.8.8', '8.8.4.4'] } } },
];
const wifi = [
  { name: 'Huebner', enabled: true, network: { type: 'NATIVE' }, securityConfiguration: { type: 'WPA2_PERSONAL' } },
  { name: 'Huebner-Guest', enabled: true, network: { type: 'SPECIFIC', networkId: 'n3' }, securityConfiguration: { type: 'OPEN' } },
];

test('networks become the Portal\'s VLAN entries, with their WiFi noted', () => {
  const v = vlansFrom(networks, wifi);
  assert.deepEqual(v.map(x => x.vlan_id), ['1', '3']);
  assert.equal(v[0].ip_group, '10.3.1.0/24');
  assert.equal(v[0].gateway, '10.3.1.1');
  assert.equal(v[0].subnet_mask, '255.255.255.0');
  assert.equal(v[0].dhcp_range, '10.3.1.30 - 10.3.1.240');
  assert.equal(v[0].notes, 'WiFi: Huebner');
  assert.equal(v[1].client_isolation, true);
  assert.equal(v[1].dns, '8.8.8.8, 8.8.4.4');
  assert.equal(v[1].notes, 'WiFi: Huebner-Guest (open)');
  assert.equal(v[1].source, 'unifi');
  assert.equal(v[1].external_id, 'n3');
  assert.deepEqual(internalIpsFrom(networks), ['10.3.1.1', '10.3.3.1']);
});

test('merging VLANs keeps what people typed by hand and never deletes', () => {
  const existing = [
    { id: 'x', vlan_id: '1', name: 'LAN', ip_group: '', notes: 'printers on .200+', static_ranges: '.200-.250', static_devices: [{ name: 'Copier', ip: '10.3.1.200' }] },
    { id: 'y', vlan_id: '99', name: 'Old cameras' },
  ];
  const { vlans, added, updated } = mergeVlans(existing, vlansFrom(networks, wifi));
  const v1 = vlans.find(v => v.vlan_id === '1');
  assert.equal(v1.id, 'x');                             // same entry, now linked
  assert.equal(v1.external_id, 'n1');
  assert.equal(v1.name, 'Default');                     // network facts refreshed
  assert.equal(v1.ip_group, '10.3.1.0/24');
  assert.equal(v1.notes, 'printers on .200+');          // hand notes kept
  assert.equal(v1.static_ranges, '.200-.250');
  assert.equal(v1.static_devices[0].name, 'Copier');
  assert.ok(vlans.find(v => v.vlan_id === '99'));       // Portal-only VLAN stays
  assert.equal(added.length, 1);                        // VLAN 3 is new
  assert.ok(vlans.find(v => v.vlan_id === '3').id);     // new entries get an ID for drag-reorder
  assert.equal(updated.length, 1);
  // Running it again changes nothing.
  const again = mergeVlans(vlans, vlansFrom(networks, wifi));
  assert.deepEqual([again.added.length, again.updated.length], [0, 0]);
});

const zones = [{ id: 'zi', name: 'Internal' }, { id: 'ze', name: 'External' }, { id: 'zv', name: 'Vpn' }];
const policies = [
  { id: 'p0', name: 'Allow All Traffic', index: 2147483647, action: { type: 'ALLOW' }, source: { zoneId: 'zi' }, destination: { zoneId: 'zi' }, metadata: { origin: 'SYSTEM_DEFINED' } },
  { id: 'p2', name: 'Allow NVR -> Local', index: 10001, enabled: true, action: { type: 'ALLOW' },
    source: { zoneId: 'zi', trafficFilter: { type: 'IP_ADDRESS', ipAddressFilter: { type: 'IP_ADDRESSES', items: [{ type: 'IP_ADDRESS', value: '10.10.25.10' }] } } },
    destination: { zoneId: 'zi', trafficFilter: { type: 'NETWORK', networkFilter: { networkIds: ['n1'] } } }, metadata: { origin: 'USER_DEFINED' } },
  { id: 'p1', name: 'Block Guest from Guest', index: 10000, enabled: false, action: { type: 'BLOCK' },
    source: { zoneId: 'zi', trafficFilter: { type: 'NETWORK', networkFilter: { networkIds: ['n3'] } } },
    destination: { zoneId: 'zi', trafficFilter: { type: 'NETWORK', networkFilter: { networkIds: ['n3'] } } }, metadata: { origin: 'USER_DEFINED' } },
  { id: 'p3', name: 'Cams (Return)', index: 30000, action: { type: 'ALLOW' }, source: { zoneId: 'zv' }, destination: { zoneId: 'zi' }, metadata: { origin: 'DERIVED' } },
  { id: 'p4', name: 'Allow VPN cams', index: 10002, action: { type: 'ALLOW' },
    source: { zoneId: 'zv', trafficFilter: { type: 'IP_ADDRESS', ipAddressFilter: { items: [{ type: 'SUBNET', value: '10.60.21.0/24' }] },
      portFilter: { type: 'PORTS', items: [{ type: 'PORT_NUMBER', value: 443 }, { type: 'PORT_NUMBER', value: 554 }] } } },
    destination: { zoneId: 'zi' }, metadata: { origin: 'USER_DEFINED' } },
];

test('only rules people made become plain-English rules, in UniFi\'s order', () => {
  const rules = rulesFrom({
    policies, zones, networks,
    forwards: [{ _id: 'f1', name: 'NVR', enabled: true, proto: 'tcp', dst_port: '8443', fwd: '10.10.25.10', fwd_port: '443', src: 'any' }],
  });
  assert.deepEqual(rules.map(r => r.number), ['1', '2', '3', '4']);
  assert.equal(rules[0].text, 'Block Guest from Guest: Block Internal (Guest-WiFi) → Internal (Guest-WiFi) (disabled)');
  assert.equal(rules[1].text, 'Allow NVR -> Local: Allow Internal (10.10.25.10) → Internal (Default)');
  assert.equal(rules[2].text, 'Allow VPN cams: Allow Vpn (10.60.21.0/24, ports 443, 554) → Internal');
  assert.equal(rules[3].text, 'Port forward NVR: WAN TCP 8443 → 10.10.25.10:443');
  assert.ok(rules.every(r => r.source === 'unifi' && r.external_id));
  assert.equal(rules.some(r => /Allow All Traffic|Return/.test(r.text)), false);
});

test('legacy (pre-zone) firewall rules are described too', () => {
  const rules = rulesFrom({ networks, legacy: [{ _id: 'l1', name: 'Block IoT', ruleset: 'LAN_IN', rule_index: 2000, action: 'drop', enabled: true,
    src_networkconf_id: 'n3', dst_address: '10.3.1.0/24', protocol: 'all' }] });
  assert.equal(rules[0].text, 'Block IoT: Block LAN_IN Guest-WiFi → 10.3.1.0/24');
});

test('re-importing replaces the previous import\'s rules and keeps hand-typed ones', () => {
  const existing = [{ number: '1', text: 'old unifi rule', source: 'unifi' }, { number: '9', text: 'Customer wants RDP blocked' }];
  const merged = mergeRules(existing, [{ number: '1', text: 'new unifi rule', source: 'unifi' }]);
  assert.deepEqual(merged.map(r => r.text), ['new unifi rule', 'Customer wants RDP blocked']);
});

test('an existing firewall gets WAN / VLANs / rules added; curated names and values on file stay', () => {
  const device = { id: 'fw', label: 'Main firewall', model: 'UDM Pro', mac_address: '58-d6-1f-6a-a6-09', firmware_version: '4.0.6',
    external_ips: [], vlans: [], firewall_rules: [{ number: '1', text: 'Customer wants RDP blocked' }] };
  const fields = {
    label: 'Huebner Funeral Home', model: 'UDM Pro', manufacturer: 'Ubiquiti', mac_address: '58:D6:1F:6A:A6:09', firmware_version: '5.1.33',
    serial_number: '58D61F6AA609', external_ips: ['104.222.91.35'], wan_gateway: '104.222.91.1', wan_subnet_mask: '', vlans: vlansFrom(networks, wifi),
    firewall_rules: rulesFrom({ policies, zones, networks }),
  };
  const plan = planDevice(device, fields);
  const { updates, changes } = plan;
  const by = Object.fromEntries(changes.map(c => [c.field, c]));
  assert.equal(by.label, undefined);                    // "Main firewall" is kept
  assert.equal(by.mac_address, undefined);               // same MAC, different punctuation
  assert.equal(by.firmware_version, undefined);          // 4.0.6 on file is kept…
  assert.deepEqual(plan.differs.map(c => [c.field, c.from, c.to]), [['firmware_version', '4.0.6', '5.1.33']]);   // …and offered
  assert.equal(by.manufacturer.mode, 'fill');
  assert.equal(by.external_ips.to, '104.222.91.35');
  assert.equal(by.wan_subnet_mask, undefined);           // blank from UniFi never erases
  assert.equal(by.vlans.mode, 'add');
  assert.equal(updates.firewall_rules.length, 4);        // the hand-typed one, then 3 imported added after it
  assert.equal(updates.firewall_rules[0].text, 'Customer wants RDP blocked');
  // Applying the updates then planning again is a no-op.
  const after = planDevice({ ...device, ...updates }, fields);
  assert.deepEqual(after.changes, []);
  // UniFi renamed a VLAN and dropped a rule: the Portal keeps its copy until asked.
  const changedVlans = fields.vlans.map((v, i) => (i === 0 ? { ...v, name: 'Renamed' } : v));
  const later = planDevice({ ...device, ...updates }, { ...fields, vlans: changedVlans, firewall_rules: fields.firewall_rules.slice(1) });
  assert.deepEqual(later.changes, []);
  assert.deepEqual(later.differs.map(c => c.field).sort(), ['firewall_rules', 'firmware_version', 'vlans']);
  assert.equal(later.newer.vlans.find(v => v.external_id === changedVlans[0].external_id).name, 'Renamed');
  assert.equal(later.newer.firewall_rules.length, 3);    // 2 imported + the hand-typed one
});

test('matching: previous import → MAC → serial → name, never guessing a shared name', () => {
  const dev = { key: '74ACB912BA81', mac: '74:AC:B9:12:BA:81', name: 'Basement switch' };
  assert.equal(findDeviceMatch(dev, [{ id: 'a', unifi_device_id: '74ACB912BA81' }]).reason, 'previous import');
  assert.equal(findDeviceMatch(dev, [{ id: 'a', mac_address: '74-ac-b9-12-ba-81' }]).reason, 'MAC address');
  assert.equal(findDeviceMatch(dev, [{ id: 'a', serial_number: '74acb912ba81' }]).reason, 'serial number');
  assert.equal(findDeviceMatch(dev, [{ id: 'a', label: 'basement switch' }]).reason, 'name');
  assert.equal(findDeviceMatch(dev, [{ id: 'a', label: 'Basement switch' }, { id: 'b', label: 'Basement Switch' }]).ambiguous.length, 2);
  assert.equal(findDeviceMatch(dev, [{ id: 'a', unifi_device_id: '74ACB912BA81' }], new Set(['a'])).device, null);   // claimed already
});

test('cameras: make, model and type from the Protect model name', () => {
  const dev = (model) => ({ key: 'K', name: 'Front', model, ip: '192.168.1.50', mac: '8C:ED:E1:30:86:A6', serial: '8CEDE13086A6', firmware: '5.2.1' });
  const g6 = cameraFields(dev('G6 Turret'));
  assert.deepEqual([g6.manufacturer, g6.model, g6.camera_type, g6.serial_number], ['Ubiquiti', 'G6 Turret', 'Turret', '8CEDE13086A6']);
  const uv = cameraFields(dev('UNIVIEW IPC3614SR-ADF28KM-H'));
  assert.deepEqual([uv.manufacturer, uv.model, uv.serial_number], ['Uniview', 'IPC3614SR-ADF28KM-H', '']);
  const onvif = cameraFields(dev('ONVIF IPC-2X4G-DM'));
  assert.deepEqual([onvif.manufacturer, onvif.model], ['', 'IPC-2X4G-DM']);
  assert.equal(cameraTypeFrom('G6 PTZ'), 'PTZ');
  assert.equal(cameraTypeFrom('G3 Flex'), '');
});

test('camera merge: names typed on site stay, a new IP and firmware are kept and offered', () => {
  const { changes, differs } = planCamera(
    { name: 'Front door (NE corner)', model: 'G6 Turret', ip_address: '192.168.1.40', firmware: '5.1.0' },
    { name: 'Front', model: 'G6 Turret', manufacturer: 'Ubiquiti', ip_address: '192.168.1.50', firmware: '5.2.1', mac_address: '8C:ED:E1:30:86:A6' });
  const by = Object.fromEntries(changes.map(c => [c.field, c]));
  assert.equal(by.name, undefined);
  assert.equal(by.ip_address, undefined);
  assert.deepEqual(differs.map(c => [c.field, c.to]), [['ip_address', '192.168.1.50'], ['firmware', '5.2.1']]);
  assert.equal(by.manufacturer.mode, 'fill');
  assert.equal(by.mac_address.mode, 'fill');
  assert.equal(findCameraMatch({ key: 'K', mac: '8C:ED:E1:30:86:A6', name: 'Front' }, [{ id: 'c', mac_address: '8cede13086a6' }]).reason, 'MAC address');
});

test('the Protect console becomes the camera system; a re-import finds it again', () => {
  const nvrHost = hostOf({ ...rawHost, id: 'nvr-1', reportedState: { ...rawHost.reportedState, name: 'Schmitz House', mac: '8CEDE13086A6', hardware: { name: 'UniFi Network Video Recorder Instant', mac: '8CEDE13086A6' } } });
  const f = systemFields(nvrHost, { ip: '192.168.1.161' });
  assert.deepEqual(f, { label: 'Schmitz House', system_type: 'NVR', model: 'UniFi Network Video Recorder Instant', serial_number: '8CEDE13086A6', ip_address: '192.168.1.161' });
  assert.equal(findSystemMatch(nvrHost, [{ id: 's', unifi_host_id: 'nvr-1' }]).reason, 'previous import');
  assert.equal(findSystemMatch(nvrHost, [{ id: 's', serial_number: '8cede13086a6' }]).reason, 'serial number');
  assert.equal(findSystemMatch(nvrHost, [{ id: 's', label: 'Schmitz House' }]).system, null);   // a label alone isn't enough
});

test('the console link points at the console', () => {
  assert.equal(consoleUrl('ABC:123'), 'https://unifi.ui.com/consoles/ABC:123/network/default/dashboard');
});

// ─── WiFi → Credentials ──────────────────────────────────────────────────────

const networkconf = [{ _id: 'nc1', name: 'Default' }, { _id: 'nc3', name: 'Guest-WiFi', vlan: '3' }];
const wlan = (o = {}) => ({ id: 'w1', external_id: 'ext-1', name: 'Huebner', security: 'wpapsk', wpa_mode: 'wpa2', enabled: true,
  is_guest: false, hidden: false, networkconf_id: 'nc1', passphrase: 'secret-pass', ppsk: [], ...o });

test('an SSID becomes a WiFi credential with its password and plain-English notes', () => {
  const c = wifiCredential(wlan(), networkconf);
  assert.equal(WIFI_SECTION, 'WiFi');
  assert.equal(c.key, 'ext-1');
  assert.equal(c.label, 'Huebner');
  assert.equal(c.password, 'secret-pass');
  assert.equal(c.notes, 'WPA2 Personal · Network: Default');
  const guest = wifiCredential(wlan({ name: 'Huebner-Guest', security: 'open', is_guest: true, networkconf_id: 'nc3', passphrase: 'ignored' }), networkconf);
  assert.equal(guest.password, '');                                  // an open network has no password to store
  assert.equal(guest.notes, 'Open — no password · Network: VLAN 3 · Guest-WiFi · Guest network');
  const ppsk = wifiCredential(wlan({ ppsk: [{ networkconf_id: 'nc3', password: 'guest-key' }] }), networkconf);
  assert.deepEqual(ppsk.ppsk, [{ label: 'Private key (VLAN 3 · Guest-WiFi)', value: 'guest-key' }]);
});

test('WiFi matching: earlier import, else the same SSID name — never a guess between two', () => {
  const w = wifiCredential(wlan(), networkconf);
  assert.equal(findWifiMatch(w, [{ id: 'a', unifi_wifi_id: 'ext-1', label: 'Office WiFi' }]).reason, 'previous import');
  assert.equal(findWifiMatch(w, [{ id: 'a', label: 'huebner' }]).reason, 'SSID name');
  assert.equal(findWifiMatch(w, [{ id: 'a', label: 'Huebner' }, { id: 'b', label: 'Huebner' }]).ambiguous.length, 2);
  assert.equal(findWifiMatch(w, [{ id: 'a', label: 'Other' }]).credential, null);
});

test('WiFi merge: a blank password is filled, a changed one is offered, hand-typed names and notes stay, and no change text holds a password', () => {
  const w = wifiCredential(wlan(), networkconf);
  const fill = planWifi({ label: 'Huebner', has_password: false }, w, { passwordMatches: false });
  assert.equal(fill.updates.password, 'secret-pass');
  assert.equal(fill.updates.extra_notes, 'WPA2 Personal · Network: Default');
  const changed = planWifi({ label: 'Office WiFi', has_password: true, extra_notes: 'given to staff only' }, w, { passwordMatches: false });
  assert.equal(changed.updates.password, undefined);
  assert.equal(changed.newer.password, 'secret-pass');
  assert.equal(JSON.stringify(changed.differs).includes('secret-pass'), false);
  assert.equal(changed.updates.label, undefined);
  assert.equal(changed.updates.extra_notes, undefined);
  assert.equal(JSON.stringify(changed.changes).includes('secret-pass'), false);
  const same = planWifi({ label: 'Huebner', has_password: true, extra_notes: 'x' }, w, { passwordMatches: true });
  assert.deepEqual(same.changes, []);
});
