// ScreenConnect sessions → the Remote button on a device.
// The failure this prevents above all: a Remote button that opens ANOTHER customer's
// machine because two customers both have a PC called "FRONTDESK".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionOf, joinUrl, matchSessions } from '../../src/lib/screenconnect.js';

// Shaped like a real GetSessionsByFilter row (trimmed).
const raw = (o = {}) => ({
  SessionID: 'ac40f29b-feff-466d-b706-06978f27164d',
  SessionType: 2,
  Name: 'AARON10PC',
  GuestPublicKey: 'BgIAAACkAABSU0Ex…',
  CustomPropertyValues: ['Eich Werden Steger & Ahrendsen Law', 'Eich Werden Steger - Carroll', '', '', '2045278501', '2046302644', '', ''],
  GuestInfo: {
    MachineName: 'AARON10PC', MachineSerialNumber: 'JDJFX53', HardwareNetworkAddress: '8C:04:BA:A7:79:83',
    MachineManufacturerName: 'Dell Inc.', MachineModel: 'OptiPlex 3080', PrivateNetworkAddress: '192.168.33.31',
    WakeToken: '////////jAS6…', LastActivityTime: '2026-10-26T15:29:50Z',
  },
  ActiveConnections: [{ ProcessType: 2 }],
  IsEnded: false,
  ...o,
});
const session = (o = {}, g = {}) => sessionOf(raw({ ...o, GuestInfo: { ...raw().GuestInfo, ...g } }));

test('a session keeps only what the Portal needs — no keys or tokens', () => {
  const s = sessionOf(raw());
  assert.equal(s.id, 'ac40f29b-feff-466d-b706-06978f27164d');
  assert.equal(s.machine, 'AARON10PC');
  assert.equal(s.serial, 'JDJFX53');
  assert.equal(s.mac, '8C:04:BA:A7:79:83');
  assert.equal(s.company, 'Eich Werden Steger & Ahrendsen Law');
  assert.equal(s.online, true);
  assert.equal(JSON.stringify(s).includes('BgIAAA'), false);
  assert.equal(JSON.stringify(s).includes('jAS6'), false);
});

test('host-only connections do not make a machine "online"', () => {
  assert.equal(sessionOf(raw({ ActiveConnections: [{ ProcessType: 1 }] })).online, false);
});

test('placeholder serials are dropped so they can never match', () => {
  assert.equal(session({}, { MachineSerialNumber: 'To Be Filled By O.E.M.' }).serial, '');
  assert.equal(session({}, { MachineSerialNumber: 'System Serial Number' }).serial, '');
});

test('the join link is the one ScreenConnect\'s own Join button opens', () => {
  assert.equal(
    joinUrl('https://rmmus-advancedcommunicationservices.screenconnect.com/', 'All Machines', 'ac40f29b-feff-466d-b706-06978f27164d'),
    'https://rmmus-advancedcommunicationservices.screenconnect.com/Host#Access/All%20Machines//ac40f29b-feff-466d-b706-06978f27164d/Join'
  );
});

test('devices match by serial / service tag first, then MAC', () => {
  const sessions = [session(), session({ SessionID: 's2', Name: 'RECEPTION' }, { MachineName: 'RECEPTION', MachineSerialNumber: 'ABC9999', HardwareNetworkAddress: '00-11-22-33-44-55' })];
  const m = matchSessions([
    { id: 'd1', device_type: 'workstation', label: 'Aaron', service_tag: 'jdjfx53' },
    { id: 'd2', device_type: 'workstation', label: 'Front', mac_address: '00:11:22:33:44:55' },
  ], sessions);
  assert.equal(m.get('d1').session.id, 'ac40f29b-feff-466d-b706-06978f27164d');
  assert.equal(m.get('d1').reason, 'serial number');
  assert.equal(m.get('d2').session.id, 's2');
  assert.equal(m.get('d2').reason, 'MAC address');
});

test('a serial two machines share is never guessed between', () => {
  const sessions = [session({ SessionID: 'x1' }), session({ SessionID: 'x2' })];
  const m = matchSessions([{ id: 'd1', device_type: 'workstation', service_tag: 'JDJFX53' }], sessions);
  assert.equal(m.has('d1'), false);
});

test('a computer name only matches inside THIS customer\'s ScreenConnect company', () => {
  const sessions = [
    session({ SessionID: 'law-1' }),                                                                       // Eich Werden (serial JDJFX53)
    session({ SessionID: 'law-2', Name: 'FRONTDESK' }, { MachineName: 'FRONTDESK', MachineSerialNumber: '', HardwareNetworkAddress: '' }),
    session({ SessionID: 'dental-1', Name: 'FRONTDESK', CustomPropertyValues: ['Smith Dental', 'Main'] }, { MachineName: 'FRONTDESK', MachineSerialNumber: '', HardwareNetworkAddress: '' }),
  ];
  const lawDevices = [
    { id: 'a', device_type: 'workstation', service_tag: 'JDJFX53' },           // teaches us this customer = Eich Werden
    { id: 'b', device_type: 'workstation', computer_name: 'frontdesk' },
  ];
  const m = matchSessions(lawDevices, sessions, 'Some Law Firm');
  assert.equal(m.get('b').session.id, 'law-2');
  assert.equal(m.get('b').reason, 'computer name');

  // A customer with no serial/MAC matches and an unrelated name gets no name matches at all.
  const other = matchSessions([{ id: 'z', device_type: 'workstation', computer_name: 'FRONTDESK' }], sessions, 'Acme Plumbing');
  assert.equal(other.has('z'), false);
});

test('the customer\'s own name also scopes name matching (loosely: "Smith Dental, LLC")', () => {
  const sessions = [
    session({ SessionID: 'dental-1', Name: 'FRONTDESK', CustomPropertyValues: ['Smith Dental', 'Main'] }, { MachineName: 'FRONTDESK', MachineSerialNumber: '', HardwareNetworkAddress: '' }),
  ];
  const m = matchSessions([{ id: 'z', device_type: 'workstation', computer_name: 'FRONTDESK' }], sessions, 'Smith Dental, LLC');
  assert.equal(m.get('z').session.id, 'dental-1');
});

test('network gear is never matched by name, and ended sessions are ignored', () => {
  const sessions = [
    session({ SessionID: 'n1', Name: 'SWITCH1', CustomPropertyValues: ['Smith Dental'] }, { MachineName: 'SWITCH1', MachineSerialNumber: '', HardwareNetworkAddress: '' }),
    session({ SessionID: 'old', IsEnded: true }),
  ];
  const m = matchSessions([
    { id: 's', device_type: 'switch', label: 'SWITCH1' },
    { id: 'w', device_type: 'workstation', service_tag: 'JDJFX53' },
  ], sessions, 'Smith Dental');
  assert.equal(m.has('s'), false);
  assert.equal(m.has('w'), false);
});
