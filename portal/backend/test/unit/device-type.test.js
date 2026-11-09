// Which Devices-tab type an imported device lands in. The failure this prevents: every
// printer and switch ConnectWise discovers arriving as "Network", because ConnectWise
// calls all discovered gear a "NetworkDevice".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDevice, brandType, categoryType } from '../../src/lib/device-type.js';

const discovered = (manufacturer, model, name = '', category = '') =>
  classifyDevice({ category, hint: 'NetworkDevice', os: '', manufacturer, model, name });

test('ConnectWise\'s own category decides first', () => {
  assert.equal(categoryType('PRINTER'), 'printer');
  assert.equal(categoryType('SWITCH'), 'switch');
  assert.equal(categoryType('LAYER_3_SWITCH'), 'switch');
  assert.equal(categoryType('FIREWALL'), 'firewall');
  assert.equal(categoryType('NETWORK_STORAGE'), 'nas');          // not "network"
  assert.equal(categoryType('AUDIO/VISUAL'), 'other');
  assert.equal(categoryType('INTELLIGENT_PLATFORM_MANAGEMENT_INTERFACE'), 'other');
  assert.equal(categoryType('TABLET'), 'other');
  assert.equal(categoryType('Desktop'), 'workstation');
  assert.equal(categoryType('Server'), 'server');
  assert.equal(discovered('HP', 'HP Something Unknown', 'x', 'PRINTER'), 'printer');
});

test('the devices that were landing in "Network" on a live MSP tenant', () => {
  // Make + model exactly as ConnectWise reported them, with the category taken away.
  const cases = [
    ['HP', 'HP Color LaserJet Pro MFP 4301', 'HPI0A1B2C', 'printer'],
    ['HP', 'HP OfficeJet Pro 8710', 'HP1A2B3C', 'printer'],
    ['HP', 'HP DesignJet Z6 44-in PS', 'NPIFD6689', 'printer'],
    ['Brother', 'Brother NC-9200h', 'BRN3C2AF46F222A', 'printer'],
    ['Brother', 'Brother Printer', 'BRN94DDF8E0CCAF', 'printer'],
    ['Epson', 'Epson WP-4520 Series', 'EPSON490DCC', 'printer'],
    ['Ricoh', 'Ricoh IM C400', 'IM C400', 'printer'],
    ['Kyocera', 'Kyocera Printing System', 'KM135EF1.local.', 'printer'],
    ['Sharp', 'Sharp BP-70C31', 'City of Lake City', 'printer'],
    ['Xerox', 'Xerox VersaLink C405', 'VersaLink C405', 'printer'],
    ['Zebra', 'Zebra ZT411', 'ZT411', 'printer'],
    ['Canon', 'Canon D1600 Series', 'D1600 Series', 'printer'],
    ['Dell', 'Dell B2360dn', 'ET0021B709FA20', 'printer'],
    ['HP', 'HP 2530-24G-PoE+ (J9773A)', 'HP-2530-24G-PoEP', 'switch'],
    ['HP', 'HP 1930 48G 4SFP/SFP+ (JL686B)', 'ArubaSwitch3-Top', 'switch'],
    ['Netgear', 'Netgear GS110TP smartSwitch', '3R75565N0047D', 'switch'],
    ['Netgear', 'Netgear FS728TPv2', '2F45425100011', 'switch'],
    ['Meraki', 'Meraki MX75', 'Device@192.168.50.1', 'firewall'],
    ['Synology', 'Synology DiskStation DS920+', 'LTCH22AC2202431', 'nas'],
    ['Buffalo', '', 'BD-NAS.local.', 'nas'],
    ['Samsung', 'Samsung Digital Television', 'Samsung.local.', 'other'],
    ['LG', 'LG OLED Television', 'Samsung 77 Living Room', 'other'],
    ['Google', 'Google Chromecast', 'x.local.', 'other'],
    ['Hikvision', 'Hikvision DS-7616NI-Q2/16P', 'DS-7616NI-Q2/16P 192.168.50.80', 'other'],
    ['Dell', 'Dell iDRAC', 'idrac-382HX04', 'other'],
    ['Samsung', 'Samsung Galaxy Tab E 8.0', 'Android.local.', 'other'],
  ];
  for (const [make, model, name, want] of cases) assert.equal(discovered(make, model, name), want, `${model || name}`);
});

test('other brands techs run into', () => {
  const cases = [
    // Printers
    ['Lexmark', 'Lexmark MS621', '', 'printer'], ['Konica Minolta', 'bizhub C360i', '', 'printer'],
    ['Canon', 'imageRUNNER ADVANCE DX C3826i', '', 'printer'], ['Toshiba', 'e-STUDIO 3015AC', '', 'printer'],
    ['', '', 'XRX9C934E5F1A2B', 'printer'], ['OKI', 'OKI C332', '', 'printer'], ['Brother', 'Brother MFC-L8900CDW', '', 'printer'],
    // Switches
    ['Aruba', 'Aruba 2930F-48G-PoE+-4SFP+ Switch (JL256A)', '', 'switch'], ['Aruba', 'Aruba 6100 24G Class4 PoE', '', 'switch'],
    ['Aruba', 'Aruba Instant On 1930 24G', '', 'switch'], ['HPE', 'HPE OfficeConnect 1820 24G', '', 'switch'],
    ['Cisco', 'Cisco SG350-28P', '', 'switch'], ['Cisco', 'Cisco CBS350-24P-4G', '', 'switch'], ['Cisco', 'Catalyst 9200L', '', 'switch'],
    ['Cisco', 'WS-C2960X-48FPD-L', '', 'switch'], ['Meraki', 'Meraki MS120-8LP', '', 'switch'],
    ['Ubiquiti', 'USW-24-PoE', '', 'switch'], ['TP-Link', 'TL-SG1008P', '', 'switch'], ['D-Link', 'DGS-1210-28P', '', 'switch'],
    ['Dell', 'Dell N1524P', '', 'switch'], ['Ruckus', 'ICX7150-24P', '', 'switch'], ['Juniper', 'EX2300-24P', '', 'switch'],
    ['Zyxel', 'GS1900-24HP', '', 'switch'], ['MikroTik', 'CRS326-24G-2S+', '', 'switch'],
    // Firewalls
    ['SonicWall', 'SonicWall TZ370', '', 'firewall'], ['SonicWall', 'NSa 2700', 'sonicwall-hq', 'firewall'],
    ['Fortinet', 'FortiGate 60F', '', 'firewall'], ['Fortinet', 'FG-40F', '', 'firewall'], ['WatchGuard', 'Firebox T45', '', 'firewall'],
    ['Sophos', 'Sophos XGS 2100', '', 'firewall'], ['Netgate', 'pfSense SG-2100', '', 'firewall'], ['Ubiquiti', 'UDM-Pro', '', 'firewall'],
    ['Cisco', 'Cisco ASA 5506-X', '', 'firewall'], ['Palo Alto Networks', 'PA-440', '', 'firewall'],
    // NAS
    ['QNAP', 'TS-464', '', 'nas'], ['Buffalo', 'TeraStation 5420', '', 'nas'], ['Netgear', 'ReadyNAS 214', '', 'nas'],
    // Network (APs, routers)
    ['SonicWall', 'SonicWave 231c', '', 'network'], ['Ubiquiti', 'UAP-AC-Pro', '', 'network'], ['Meraki', 'Meraki MR36', '', 'network'],
    ['Cisco', 'Aironet 2802i', '', 'network'], ['EnGenius', 'EAP1250', '', 'network'], ['Netgear', 'Nighthawk R7000', '', 'network'],
    // Other
    ['APC', 'Smart-UPS 1500', '', 'other'], ['Yealink', 'SIP-T46U', 'yealink', 'other'], ['Polycom', 'VVX 450', '', 'other'],
    ['HPE', 'iLO 5', 'ilo-server', 'other'], ['Axis', 'AXIS P3245-V', '', 'other'], ['Roku', 'Roku Ultra', '', 'other'],
  ];
  for (const [make, model, name, want] of cases) assert.equal(discovered(make, model, name), want, `${make} ${model}`);
});

test('computers stay computers — a brand word never turns a PC into a printer', () => {
  const agent = (hint, os, manufacturer, model, category = '') => classifyDevice({ category, hint, os, manufacturer, model, name: 'PC-01' });
  assert.equal(agent('Desktop', 'Windows 11 Pro', 'Dell', 'Dell OptiPlex 7090', 'Desktop'), 'workstation');
  assert.equal(agent('Desktop', 'Windows 11 Pro', 'HP', 'HP ProBook 450 G6', 'Desktop'), 'workstation');
  assert.equal(agent('Laptop', 'Windows 11 Pro', 'Lenovo', 'ThinkPad T14'), 'workstation');
  assert.equal(agent('Server', 'Windows Server 2022', 'Dell', 'Dell PowerEdge T550', 'Server'), 'server');
  assert.equal(agent('', 'Windows Server 2019', 'VMware', 'VMware7,1'), 'server');
  // …except a NAS that runs an OS with an agent on it.
  assert.equal(agent('Server', 'Windows Storage Server 2016', 'Buffalo', 'Buffalo TeraStation', 'Server'), 'nas');
});

test('the old endpoint-type words still work, and unknown gear is "network"', () => {
  assert.equal(classifyDevice({ hint: 'Network Switch' }), 'switch');
  assert.equal(classifyDevice({ hint: 'Firewall' }), 'firewall');
  assert.equal(classifyDevice({ hint: 'Printer' }), 'printer');
  assert.equal(classifyDevice({ hint: 'NetworkDevice', manufacturer: 'Acme', model: 'Widget 9000' }), 'network');
  assert.equal(classifyDevice({}), 'workstation');
  assert.equal(brandType({}), null);
});
