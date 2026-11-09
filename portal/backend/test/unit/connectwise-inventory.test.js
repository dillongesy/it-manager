// ConnectWise RMM asset inventory (platform.asset.read) → Portal device fields.
// Shapes as the live trial tenant returns them (2026-09-28); values made up.
// The failures this prevents: the Hyper-V adapter's IP landing as the PC's IP, a USB
// stick listed as a drive, disabled/built-in accounts cluttering the card, C$/ADMIN$
// listed as shares, and a v1 inventory record attached to the wrong machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEndpoint, flattenDevice, deviceFieldsFromMachine, mergePlan,
  localAccountsFrom, accountsText, sharesFrom, primaryNic,
} from '../../src/lib/connectwise.js';
import { pairInventory } from '../../src/lib/connectwise-client.js';

const ctx = { companyId: 'c1', companyName: 'Smith Dental', siteId: 's1', siteName: 'Main St' };

const v2 = { companyID: 'c1', siteID: 's1', endpointID: 'v2-100', platform: {
  deviceName: 'FRONT-01', friendlyName: 'FRONT-01', endpointType: 'Desktop', type: 'assetCollection',
  ipAddress: ['192.168.50.20', '172.25.64.1'], macAddress: ['00:15:5D:AB:55:63', '10:98:19:0A:0B:0C'],
  system: { product: 'Dell Inc.', model: 'Precision 3680', serialNumber: 'ABC1234', systemName: 'FRONT-01' },
  os: { product: 'Microsoft Windows 11 Pro' } } };

const v1 = {
  endpointID: 'v1-777', clientID: 'c1', siteID: 's1', friendlyName: 'FRONT-01', type: 'assetCollection',
  system: { product: 'Dell Inc.', model: 'Precision 3680', serialNumber: 'ABC1234', systemName: 'FRONT-01' },
  processors: [{ product: 'Intel(R) Core(TM) i9-14900', numberOfProcessors: 1, numberOfCores: 24 }],
  physicalMemory: [{ sizeBytes: 17179869184 }, { sizeBytes: 17179869184 }],
  drives: [
    { product: 'PNY CS900 500GB SSD', mediaType: 'Fixed hard disk media', interfaceType: 'IDE', sizeBytes: 500107862016,
      partitionData: [{ name: 'C:\\', mountPoint: 'C:\\' }, { fileSystem: 'NTFS' }] },
    { product: 'NVMe Samsung 1TB', mediaType: 'Fixed hard disk media', interfaceType: 'SCSI', sizeBytes: 1000204886016, partitionData: [] },
    { product: 'SanDisk Cruzer', mediaType: 'Removable Media', interfaceType: 'USB', sizeBytes: 32000000000, partitionData: [{ name: 'F:' }] },
  ],
  networks: [
    { product: 'Hyper-V Virtual Ethernet Adapter', ipEnabled: true, ipv4: '172.25.64.1', macAddress: '00:15:5D:AB:55:63', defaultIPGateway: '0.0.0.0' },
    { product: 'Intel Ethernet I219-LM', ipEnabled: true, ipv4: '192.168.50.20', macAddress: '10:98:19:0A:0B:0C', defaultIPGateway: '192.168.50.1' },
  ],
  users: [
    { username: 'Administrator', userType: 'Administrator', userDisabled: true },
    { username: 'DefaultAccount', userType: 'Guest', userDisabled: true },
    { username: 'WDAGUtilityAccount', userType: 'Guest', userDisabled: false },
    { username: 'zoe', userType: 'User', userDisabled: false },
    { username: 'Dana', userType: 'Administrator', userDisabled: false },
  ],
  shares: [
    { name: 'ADMIN$', path: 'C:\\WINDOWS', type: ['Disk Drive Admin'] },
    { name: 'IPC$', type: ['IPC Admin'] },
    { name: 'print$', path: 'C:\\WINDOWS\\system32\\spool\\drivers', type: ['Disk Drive'] },
    { name: 'Scans', path: 'C:\\Scans', userAccess: ['Everyone', 'BUILTIN\\Administrators'], type: ['Disk Drive'] },
  ],
};

const machine = () => normalizeEndpoint(flattenDevice({ summary: {}, v2, v1 }), ctx);

test('processor, installed RAM, physical disks, and the LAN card (not Hyper-V)', () => {
  const m = machine();
  assert.equal(m.processor, 'Intel Core i9-14900');
  assert.equal(m.ram, '32GB');                                  // 2 × 16GB installed
  assert.deepEqual(m.drives, [
    { label: 'C:', size: '500GB SSD (PNY CS900 500GB SSD)' },
    { label: 'Disk 2', size: '1TB NVMe SSD (NVMe Samsung 1TB)' },
  ]);                                                           // USB stick left out
  assert.equal(m.private_ip, '192.168.50.20');
  assert.equal(m.mac, '10:98:19:0A:0B:0C');
});

test('local accounts: enabled, non-built-in only, admins first', () => {
  assert.deepEqual(localAccountsFrom(v1.users), [{ username: 'Dana', admin: true }, { username: 'zoe', admin: false }]);
  assert.equal(accountsText(localAccountsFrom(v1.users)), 'Dana (admin), zoe');
  assert.deepEqual(localAccountsFrom(null), []);
});

test('shares: real ones only, as UNC paths with folder and access', () => {
  assert.deepEqual(sharesFrom(v1.shares, 'FRONT-01'), [
    { path: '\\\\FRONT-01\\Scans', note: 'C:\\Scans — access: Everyone, BUILTIN\\Administrators' },
  ]);
  assert.deepEqual(sharesFrom(null, 'X'), []);
});

test('the import writes shares and accounts on computers only', () => {
  const pc = deviceFieldsFromMachine(machine());
  assert.equal(pc.share_paths.length, 1);
  assert.equal(pc.local_accounts.length, 2);
  const sw = deviceFieldsFromMachine({ ...machine(), type_hint: 'Switch' });
  assert.deepEqual(sw.share_paths, []);
  assert.deepEqual(sw.local_accounts, []);
});

test('dual-socket servers say so', () => {
  const two = { ...v1, processors: [{ product: 'Intel(R) Xeon(R) Silver 4310 CPU @ 2.10GHz' }, { product: 'Intel(R) Xeon(R) Silver 4310 CPU @ 2.10GHz' }] };
  assert.equal(normalizeEndpoint(flattenDevice({ summary: {}, v2: null, v1: two }), ctx).processor, '2 × Intel Xeon Silver 4310');
});

test('primaryNic falls back to the first usable card when none has a gateway', () => {
  assert.deepEqual(primaryNic([{ ipEnabled: true, ipv4: '10.0.0.9', macAddress: 'AA' }]), { ipv4: '10.0.0.9', macAddress: 'AA' });
  assert.equal(primaryNic([{ ipEnabled: false, ipv4: '10.0.0.9' }]), null);
  assert.equal(primaryNic(null), null);
});

test('v1 records pair to v2 devices by serial, then name — never by a shared serial', () => {
  const recs = [
    { summary: { endpointID: 'v2-a' }, v2: { platform: { system: { serialNumber: 'ABC1234', systemName: 'FRONT-01' } } } },
    { summary: { endpointID: 'v2-b', deviceName: 'BACK-02' }, v2: null },
  ];
  const inv = [
    { endpointID: 'v1-1', system: { serialNumber: 'abc1234', systemName: 'renamed' } },
    { endpointID: 'v1-2', system: { serialNumber: 'ZZZ', systemName: 'BACK-02' } },
    { endpointID: 'v1-3', system: { serialNumber: 'QQQ', systemName: 'ELSEWHERE' } },
  ];
  const { pairs, unpaired } = pairInventory(recs, inv);
  assert.deepEqual(pairs.map(([r, v]) => [r.summary.endpointID, v.endpointID]), [['v2-a', 'v1-1'], ['v2-b', 'v1-2']]);
  assert.deepEqual(unpaired.map(v => v.endpointID), ['v1-3']);
  const dup = pairInventory([recs[0]], [{ system: { serialNumber: 'ABC1234' } }, { system: { serialNumber: 'ABC1234' } }]);
  assert.equal(dup.pairs.length, 0);
});

test('merge: accounts and shares are added to; dropping an old account is a take-newer change', () => {
  const fields = deviceFieldsFromMachine(machine());
  const plan = mergePlan({ local_accounts: [{ username: 'old', admin: false }], share_paths: [{ path: '\\\\X\\Mine', note: 'hand note' }] }, fields);
  assert.deepEqual(plan.updates.local_accounts, [{ username: 'old', admin: false }, { username: 'Dana', admin: true }, { username: 'zoe', admin: false }]);
  assert.deepEqual(plan.newer.local_accounts, [{ username: 'Dana', admin: true }, { username: 'zoe', admin: false }]);
  assert.deepEqual(plan.updates.share_paths.map(s => s.note), ['hand note', fields.share_paths[0].note]);   // the hand note stays, the new share is added
  assert.equal(mergePlan({ local_accounts: fields.local_accounts }, fields).updates.local_accounts, undefined);
  assert.equal(mergePlan({ share_paths: fields.share_paths }, fields).updates.share_paths, undefined);
  assert.equal(mergePlan({ share_paths: [] }, fields).updates.share_paths.length, 1);
});

test('merge: bare drive sizes from an older import are upgraded; hand notes are kept', () => {
  const to = [{ label: 'C:', size: '500GB SSD (PNY CS900 500GB SSD)' }];
  assert.deepEqual(mergePlan({ storage_drives: [{ label: 'C:', size: '500GB' }] }, { storage_drives: to }).updates.storage_drives, to);
  assert.equal(mergePlan({ storage_drives: [{ label: 'C:', size: '512GB NVMe SSD' }] }, { storage_drives: to }).updates.storage_drives, undefined);
});
