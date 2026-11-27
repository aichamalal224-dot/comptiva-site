'use strict';

const assert = require('node:assert/strict');
const {
  validateOrganizationBundle,
  authorizeStoreAction,
  validateOperationRecord
} = require('./multi-store-model');

const bundle = {
  organization: { id: 'org-1', ownerUid: 'owner-1', status: 'active' },
  stores: [
    { id: 'store-A', organizationId: 'org-1', status: 'active' },
    { id: 'store-B', organizationId: 'org-1', status: 'active' }
  ],
  members: [
    { uid: 'owner-1', organizationId: 'org-1', role: 'owner', status: 'active', storeIds: [] },
    { uid: 'seller-A', organizationId: 'org-1', role: 'seller', status: 'active', storeIds: ['store-A'] },
    { uid: 'seller-B', organizationId: 'org-1', role: 'seller', status: 'active', storeIds: ['store-B'] }
  ]
};

assert.equal(validateOrganizationBundle(bundle).valid, true, 'valid organization model');

assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-A', 'sales:read').allowed, true,
  'owner reads store A');
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-B', 'stock:read').allowed, true,
  'owner reads store B and its distinct stock');
assert.equal(authorizeStoreAction(bundle, 'seller-A', 'store-A', 'sales:create').allowed, true,
  'seller creates sales in assigned store');
assert.equal(authorizeStoreAction(bundle, 'seller-A', 'store-A', 'stock:read').allowed, true,
  'seller shares assigned store stock');
assert.equal(authorizeStoreAction(bundle, 'seller-A', 'store-B', 'stock:read').allowed, false,
  'seller cannot read another store stock');
assert.equal(authorizeStoreAction(bundle, 'seller-A', 'store-A', 'sales:cancel').allowed, false,
  'seller cannot cancel a validated sale by default');
assert.equal(authorizeStoreAction(bundle, 'unknown-user', 'store-A', 'sales:read').allowed, false,
  'unknown user denied');

const suspended = structuredClone(bundle);
suspended.members[1].status = 'suspended';
assert.equal(authorizeStoreAction(suspended, 'seller-A', 'store-A', 'sales:read').allowed, false,
  'suspended seller denied');

const crossOrg = structuredClone(bundle);
crossOrg.stores[1].organizationId = 'org-other';
assert.equal(validateOrganizationBundle(crossOrg).valid, false,
  'cross-organization store rejected');

const duplicateStore = structuredClone(bundle);
duplicateStore.stores.push({ id: 'store-A', organizationId: 'org-1', status: 'active' });
assert.equal(validateOrganizationBundle(duplicateStore).valid, false,
  'duplicate store ID rejected');

const noOwner = structuredClone(bundle);
noOwner.members = noOwner.members.filter(member => member.role !== 'owner');
assert.equal(validateOrganizationBundle(noOwner).valid, false,
  'missing owner rejected');

const restrictedSeller = structuredClone(bundle);
restrictedSeller.members[1].permissions = ['sales:read'];
assert.equal(authorizeStoreAction(restrictedSeller, 'seller-A', 'store-A', 'sales:create').allowed, false,
  'explicit seller permission list restricts defaults');


const saleRecord = {
  id: 'sale-1',
  organizationId: 'org-1',
  storeId: 'store-A',
  createdBy: 'seller-A',
  createdAt: '2026-11-27T12:00:00.000Z'
};
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create', saleRecord).valid, true,
  'seller operation has valid provenance');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, createdBy: 'seller-B' }).valid, false,
  'forged creator is rejected');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, organizationId: 'org-other' }).valid, false,
  'cross-organization operation is rejected');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, createdAt: 'not-a-date' }).valid, false,
  'invalid creation timestamp is rejected');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, updatedBy: 'seller-A' }).valid, false,
  'incomplete update provenance is rejected');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, updatedBy: 'seller-A', updatedAt: '2026-11-27T12:05:00.000Z' }).valid, true,
  'complete update provenance is accepted');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, storeId: 'store-B' }).valid, false,
  'seller operation in an unassigned store is rejected');

console.log('PASS: 20 multi-store model, permission and provenance assertions');
