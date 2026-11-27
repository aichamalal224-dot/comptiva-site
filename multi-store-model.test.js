'use strict';

const assert = require('node:assert/strict');
const {
  validateOrganizationBundle,
  authorizeStoreAction,
  validateOperationRecord,
  validateOperationUpdate,
  validateSellerInvitation,
  projectSellerProduct
} = require('./multi-store-model');

const modelAcceptance = require('./multi-store-model').validateSellerInvitationAcceptance;\nconst modelRevoke = require('./multi-store-model').validateSellerInvitationRevocation;\n\nconst bundle = {
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

// Seller role must not expose owner financial controls or sensitive reports.
for (const action of ['dashboard:read', 'reports:read', 'purchases:read',
  'purchases:create', 'expenses:read', 'expenses:create']) {
  assert.equal(authorizeStoreAction(bundle, 'seller-A', 'store-A', action).allowed, false,
    'seller is denied owner-only action: ' + action);
}
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-A', 'reports:read').allowed, true,
  'owner retains financial reporting access');
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-A', 'expenses:read').allowed, true,
  'owner retains expense access');
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-A', 'purchases:create').allowed, true,
  'owner retains purchase management');


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
  { ...saleRecord, updatedBy: 'seller-A', updatedAt: '2026-11-27T12:05:00.000Z' }).valid, false,
  'creation cannot claim update provenance');
assert.equal(validateOperationRecord(bundle, 'owner-1', 'sales:update',
  { ...saleRecord, updatedBy: 'owner-1', updatedAt: '2026-11-27T12:05:00.000Z' }).valid, true,
  'complete update provenance is accepted');
assert.equal(validateOperationRecord(bundle, 'seller-A', 'sales:create',
  { ...saleRecord, storeId: 'store-B' }).valid, false,
  'seller operation in an unassigned store is rejected');


const updatedSale = {
  ...saleRecord,
  total: 25000,
  updatedBy: 'owner-1',
  updatedAt: '2026-11-27T12:10:00.000Z'
};
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, updatedSale).valid, true,
  'owner update preserves original provenance');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:create', saleRecord, updatedSale).valid, false,
  'update validator rejects a creation action');
assert.equal(validateOperationUpdate(bundle, 'seller-A', 'sales:update', saleRecord, {
  ...updatedSale, updatedBy: 'seller-A'
}).valid, false, 'seller cannot update a validated sale');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, createdBy: 'owner-1'
}).valid, false, 'update cannot rewrite original creator');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, createdAt: '2026-11-27T12:09:00.000Z'
}).valid, false, 'update cannot rewrite original creation time');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, storeId: 'store-B'
}).valid, false, 'update cannot move operation to another store');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, organizationId: 'org-other'
}).valid, false, 'update cannot move operation to another organization');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, updatedBy: 'seller-A'
}).valid, false, 'update actor must match authenticated owner');
assert.equal(validateOperationUpdate(bundle, 'owner-1', 'sales:update', saleRecord, {
  ...updatedSale, updatedAt: 'invalid-date'
}).valid, false, 'update timestamp must be valid');


const suspendedOrg = structuredClone(bundle);
suspendedOrg.organization.status = 'suspended';
assert.equal(authorizeStoreAction(suspendedOrg, 'owner-1', 'store-A', 'sales:read').allowed, false,
  'suspended organization blocks even owner access');
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-A', 'unknown:admin').allowed, false,
  'unknown owner action is denied');
const privilegeEscalation = structuredClone(bundle);
privilegeEscalation.members[1].permissions = ['sales:update', 'members:manage', 'sales:create'];
assert.equal(authorizeStoreAction(privilegeEscalation, 'seller-A', 'store-A', 'sales:update').allowed, false,
  'seller permissions cannot elevate role capabilities');
assert.equal(authorizeStoreAction(privilegeEscalation, 'seller-A', 'store-A', 'members:manage').allowed, false,
  'seller cannot manage members through custom permissions');


const validInvite = {
  id: 'invite-1',
  organizationId: 'org-1',
  email: 'seller.new@example.com',
  role: 'seller',
  status: 'pending',
  storeIds: ['store-A'],
  permissions: ['sales:read', 'sales:create'],
  createdBy: 'owner-1',
  createdAt: '2026-11-27T12:00:00.000Z',
  expiresAt: '2026-12-04T12:00:00.000Z'
};
assert.equal(validateSellerInvitation(bundle, 'owner-1', validInvite,
  '2026-11-27T13:00:00.000Z').valid, true, 'owner can prepare a valid seller invitation');
assert.equal(validateSellerInvitation(bundle, 'seller-A', validInvite,
  '2026-11-27T13:00:00.000Z').valid, false, 'seller cannot invite another seller');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, email: 'Seller.New@example.com'
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation email must be normalized');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, organizationId: 'org-other'
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation cannot cross organizations');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, storeIds: ['store-A', 'store-A']
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation cannot duplicate store assignments');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, storeIds: ['store-B', 'store-X']
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation cannot assign unknown stores');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, permissions: ['members:manage']
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation cannot grant owner permissions');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, expiresAt: '2026-12-10T12:00:00.000Z'
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation lifetime cannot exceed seven days');
assert.equal(validateSellerInvitation(bundle, 'owner-1', validInvite,
  '2026-12-05T12:00:00.000Z').valid, false, 'expired invitation is rejected');
assert.equal(validateSellerInvitation(bundle, 'owner-1', {
  ...validInvite, createdBy: 'seller-A'
}, '2026-11-27T13:00:00.000Z').valid, false, 'invitation creator cannot be forged');


const sellerProductView = projectSellerProduct({
  id: 'product-1', name: 'Riz', category: 'Alimentaire', sku: 'RIZ-1',
  quantity: 12, salePrice: 50000, alertAt: 3, purchasePrice: 42000,
  margin: 8000, profit: 96000, supplierCost: 41000, internalNotes: 'secret'
});
assert.equal(sellerProductView.purchasePrice, undefined, 'seller product view hides purchase price');
assert.equal(sellerProductView.margin, undefined, 'seller product view hides margin');
assert.equal(sellerProductView.profit, undefined, 'seller product view hides profit');
assert.equal(sellerProductView.supplierCost, undefined, 'seller product view hides supplier cost');
assert.equal(sellerProductView.internalNotes, undefined, 'seller product view hides internal notes');
assert.equal(sellerProductView.salePrice, 50000, 'seller retains customer-facing sale price');
assert.equal(sellerProductView.quantity, 12, 'seller retains assigned-store stock quantity');
assert.equal(projectSellerProduct(null), null, 'invalid product projection rejected');


const acceptanceInvite = { ...validInvite, tokenHash: 'sha256:example-hash' };
assert.equal(modelAcceptance(bundle, acceptanceInvite, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').valid, true,
  'matching authenticated identity and token can accept pending invitation');
assert.equal(modelAcceptance(bundle, acceptanceInvite, {
  uid: 'seller-new', email: 'attacker@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').valid, false,
  'different authenticated email cannot accept invitation');
assert.equal(modelAcceptance(bundle, acceptanceInvite, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'wrong-hash', '2026-11-27T14:00:00.000Z').valid, false,
  'wrong one-time token hash is rejected');
assert.equal(modelAcceptance(bundle, acceptanceInvite, {
  uid: 'seller-A', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').valid, false,
  'existing member cannot accept another invitation as a new member');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, status: 'revoked' }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').valid, false,
  'revoked invitation cannot be accepted');
assert.equal(modelRevoke(bundle, 'owner-1', validInvite).valid, true,
  'owner can revoke pending invitation');
assert.equal(modelRevoke(bundle, 'seller-A', validInvite).valid, false,
  'seller cannot revoke invitation');
assert.equal(modelRevoke(bundle, 'owner-1', { ...validInvite, status: 'accepted' }).valid, false,
  'accepted invitation cannot be revoked as pending');

console.log('PASS: 69 multi-store model, permission, provenance, invitation lifecycle and seller-data projection assertions');
