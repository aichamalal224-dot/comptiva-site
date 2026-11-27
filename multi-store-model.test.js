'use strict';

const assert = require('node:assert/strict');
const {
  validateOrganizationBundle,
  authorizeStoreAction
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

console.log('PASS: 13 multi-store model and authorization assertions');
