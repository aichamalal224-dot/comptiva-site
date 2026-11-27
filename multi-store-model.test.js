'use strict';

const assert = require('node:assert/strict');
const {
  validateOrganizationBundle,
  authorizeStoreAction,
  validateOperationRecord,
  validateOperationUpdate,
  validateSellerInvitation,
  validateSellerSuspension,
  validateSellerReactivation,
  validateSellerStoreAssignment,
  authorizeWithCurrentMembership,
  validateStockTransferCreation,
  validateStockTransferReceipt,
  validateSaleStockDecrement,
  validateSaleSettlement,
  validateDebtPayment,
  validatePurchaseRecord,
  validateExpenseRecord,
  validateSaleCancellation,
  validateAuditEvent,
  validateStockAdjustment,
  projectSellerProduct,
  validateSellerOperationalProduct
} = require('./multi-store-model');

const modelAcceptance = require('./multi-store-model').validateSellerInvitationAcceptance;
const modelRevoke = require('./multi-store-model').validateSellerInvitationRevocation;

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
assert.equal(validateSellerOperationalProduct({
  id: 'product-safe', name: 'Riz', quantity: 5, salePrice: 50000, alertAt: 2
}).valid, true, 'seller operational product accepts only routine fields');
assert.equal(validateSellerOperationalProduct({
  id: 'product-leak', name: 'Riz', quantity: 5, salePrice: 50000,
  purchasePrice: 42000
}).valid, false, 'seller-readable product rejects purchase price at write boundary');
assert.equal(validateSellerOperationalProduct({
  id: 'product-nested-leak', name: 'Riz',
  metadata: { supplier: { unit_cost: 41000 } }
}).valid, false, 'seller-readable product rejects nested cost fields');
assert.equal(validateSellerOperationalProduct({
  id: 'product-profit-leak', name: 'Riz',
  analytics: [{ grossProfit: 9000 }]
}).valid, false, 'seller-readable product rejects nested profit fields');
assert.equal(validateSellerOperationalProduct({
  id: 'product-financials-leak', name: 'Riz',
  financials: { inventoryValue: 100000 }
}).valid, false, 'seller-readable product rejects bundled financial objects');
assert.equal(validateSellerOperationalProduct(null).valid, false,
  'invalid seller operational product rejected');



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
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, organizationId: 'org-other' }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invalid_invitation_identity_or_state', 'acceptance rejects invitation from another organization');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, role: 'owner' }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invalid_invitation_identity_or_state', 'acceptance cannot promote invitee to owner');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, createdBy: 'seller-A' }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invalid_invitation_identity_or_state', 'acceptance rejects invitation not created by owner');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, storeIds: ['store-A', 'store-X'] }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invalid_invitation_email_or_store_assignment', 'acceptance revalidates store assignments');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, permissions: ['members:manage'] }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invalid_or_elevated_seller_permissions', 'acceptance revalidates permission allowlist');
assert.equal(modelAcceptance(bundle, { ...acceptanceInvite, expiresAt: '2026-12-10T12:00:00.000Z' }, {
  uid: 'seller-new', email: 'seller.new@example.com'
}, 'sha256:example-hash', '2026-11-27T14:00:00.000Z').reason,
  'invitation_not_pending_or_expired', 'acceptance rejects invitation lifetime beyond seven days');
assert.equal(modelRevoke(bundle, 'owner-1', { ...validInvite, organizationId: 'org-other' }).valid, false,
  'owner cannot revoke invitation belonging to another organization');
assert.equal(modelRevoke(bundle, 'owner-1', { ...validInvite, createdBy: 'seller-A' }).valid, false,
  'owner cannot revoke invitation with forged creator provenance');




const activeSellerForLifecycle = bundle.members[1];
assert.equal(validateSellerSuspension(bundle, 'owner-1', 'seller-A',
  'Fin de contrat', '2026-11-27T15:00:00.000Z').valid, true,
  'owner can suspend an active seller with a reason');
assert.equal(validateSellerSuspension(bundle, 'seller-A', 'seller-B',
  'Motif', '2026-11-27T15:00:00.000Z').reason, 'owner_only',
  'seller cannot suspend another member');
assert.equal(validateSellerSuspension(bundle, 'owner-1', 'owner-1',
  'Motif', '2026-11-27T15:00:00.000Z').reason, 'seller_member_not_found',
  'owner account cannot be suspended as a seller');
assert.equal(validateSellerSuspension(bundle, 'owner-1', 'seller-A',
  '', '2026-11-27T15:00:00.000Z').reason, 'suspension_reason_required_or_too_long',
  'suspension requires an audit reason');
assert.equal(validateSellerSuspension(bundle, 'owner-1', 'seller-A',
  'Motif', 'invalid-date').valid, false, 'suspension requires a valid timestamp');
const suspendedSellerBundle = structuredClone(bundle);
suspendedSellerBundle.members[1].status = 'suspended';
assert.equal(validateSellerReactivation(suspendedSellerBundle, 'owner-1', 'seller-A',
  '2026-11-27T15:05:00.000Z').valid, true,
  'owner can reactivate a suspended seller with valid store assignments');
assert.equal(validateSellerReactivation(bundle, 'owner-1', 'seller-A',
  '2026-11-27T15:05:00.000Z').reason, 'seller_not_suspended',
  'active seller cannot be reactivated twice');
assert.equal(validateSellerReactivation(suspendedSellerBundle, 'seller-B', 'seller-A',
  '2026-11-27T15:05:00.000Z').reason, 'owner_only',
  'seller cannot reactivate another seller');
const suspendedWithoutStore = structuredClone(suspendedSellerBundle);
suspendedWithoutStore.members[1].storeIds = [];
assert.equal(validateSellerReactivation(suspendedWithoutStore, 'owner-1', 'seller-A',
  '2026-11-27T15:05:00.000Z').reason, 'invalid_organization_model',
  'organization model rejects a seller without an assigned store');
assert.equal(validateSellerStoreAssignment(bundle, 'owner-1', 'seller-A', ['store-A', 'store-B'],
  '2026-11-27T15:10:00.000Z').valid, true,
  'owner can assign seller to multiple active stores');
assert.equal(validateSellerStoreAssignment(bundle, 'seller-A', 'seller-B', ['store-A'],
  '2026-11-27T15:10:00.000Z').reason, 'owner_only',
  'seller cannot change store assignments');
assert.equal(validateSellerStoreAssignment(bundle, 'owner-1', 'seller-A', ['store-X'],
  '2026-11-27T15:10:00.000Z').reason, 'invalid_seller_store_assignment',
  'assignment rejects unknown stores');
assert.equal(validateSellerStoreAssignment(bundle, 'owner-1', 'seller-A', ['store-A', 'store-A'],
  '2026-11-27T15:10:00.000Z').reason, 'invalid_seller_store_assignment',
  'assignment rejects duplicate stores');
assert.equal(validateSellerStoreAssignment(bundle, 'owner-1', 'seller-A', [],
  '2026-11-27T15:10:00.000Z').reason, 'invalid_seller_store_assignment',
  'seller must retain at least one assigned store');
assert.equal(authorizeWithCurrentMembership(bundle, 'seller-A', 'store-A', 'sales:read',
  bundle.members[1]).allowed, true, 'authorization accepts the matching current membership snapshot');
assert.equal(authorizeWithCurrentMembership(bundle, 'seller-A', 'store-A', 'sales:read',
  { ...bundle.members[1], status: 'suspended' }).reason, 'stale_membership_snapshot',
  'stale active client snapshot is denied after suspension');
assert.equal(authorizeWithCurrentMembership(bundle, 'seller-A', 'store-B', 'sales:read',
  bundle.members[1]).allowed, false, 'current membership still enforces store assignment');
assert.equal(authorizeWithCurrentMembership(bundle, 'seller-A', 'store-A', 'sales:read',
  { ...bundle.members[1], uid: 'seller-B' }).reason, 'current_membership_not_verified',
  'membership snapshot for a different UID is rejected');

const transfer = {
  id: 'transfer-1', organizationId: 'org-1', productId: 'product-1',
  fromStoreId: 'store-A', toStoreId: 'store-B', quantity: 5,
  status: 'in_transit', createdBy: 'owner-1',
  createdAt: '2026-11-27T14:00:00.000Z'
};
assert.equal(validateStockTransferCreation(bundle, 'owner-1', transfer,
  '2026-11-27T14:01:00.000Z').valid, true,
  'owner can create a valid inter-store stock transfer');
assert.equal(validateStockTransferCreation(bundle, 'seller-A', transfer,
  '2026-11-27T14:01:00.000Z').valid, false,
  'seller cannot initiate stock transfers');
assert.equal(validateStockTransferCreation(bundle, 'owner-1', {
  ...transfer, toStoreId: 'store-A'
}, '2026-11-27T14:01:00.000Z').valid, false,
  'transfer cannot target its source store');
assert.equal(validateStockTransferCreation(bundle, 'owner-1', {
  ...transfer, quantity: -2
}, '2026-11-27T14:01:00.000Z').valid, false,
  'negative transfer quantity is rejected');
assert.equal(validateStockTransferCreation(bundle, 'owner-1', {
  ...transfer, toStoreId: 'store-X'
}, '2026-11-27T14:01:00.000Z').valid, false,
  'transfer cannot target unknown store');
const receipt = {
  transferId: 'transfer-1', organizationId: 'org-1',
  storeId: 'store-B', productId: 'product-1', quantity: 5,
  receivedBy: 'owner-1', receivedAt: '2026-11-27T14:02:00.000Z'
};
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, receipt,
  '2026-11-27T14:03:00.000Z').valid, true,
  'owner can validate receipt at destination store');
assert.equal(validateStockTransferReceipt(bundle, 'seller-B', transfer, receipt,
  '2026-11-27T14:03:00.000Z').valid, false,
  'seller cannot validate transfer receipt');
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', {
  ...transfer, status: 'received'
}, receipt, '2026-11-27T14:03:00.000Z').valid, false,
  'already received transfer cannot be received twice');
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, {
  ...receipt, quantity: 4
}, '2026-11-27T14:03:00.000Z').valid, false,
  'partial or altered quantity cannot silently complete transfer');
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, {
  ...receipt, storeId: 'store-A'
}, '2026-11-27T14:03:00.000Z').valid, false,
  'receipt must credit the designated destination store');


// Sale stock decrement: pre-validation, replay protection and stock bounds.
const saleForStock = {
  id: 'sale-stock-1', idempotencyKey: 'sale-stock-key-1',
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-1',
  quantity: 3, createdBy: 'seller-A', createdAt: '2026-11-27T14:10:00.000Z'
};
const stockSnapshot = {
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-1', quantity: 8
};
const stockCheck = validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  stockSnapshot, null, '2026-11-27T14:11:00.000Z');
assert.equal(stockCheck.valid, true, 'assigned seller can prevalidate a sale stock decrement');
assert.equal(stockCheck.remainingQuantity, 5, 'prevalidation calculates expected remaining stock');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  stockSnapshot, { id: 'movement-existing' }, '2026-11-27T14:11:00.000Z').reason,
  'stock_operation_already_applied', 'duplicate idempotency operation is rejected');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  { ...stockSnapshot, quantity: 2 }, null, '2026-11-27T14:11:00.000Z').reason,
  'insufficient_stock', 'sale cannot consume more stock than available');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A',
  { ...saleForStock, storeId: 'store-B' }, stockSnapshot, null,
  '2026-11-27T14:11:00.000Z').valid, false, 'seller cannot decrement another store stock');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A',
  { ...saleForStock, createdBy: 'seller-B' }, stockSnapshot, null,
  '2026-11-27T14:11:00.000Z').valid, false, 'sale creator must match authenticated seller');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A',
  { ...saleForStock, idempotencyKey: '' }, stockSnapshot, null,
  '2026-11-27T14:11:00.000Z').reason, 'missing_idempotency_key',
  'stock-changing sale requires an idempotency key');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A',
  { ...saleForStock, quantity: 0 }, stockSnapshot, null,
  '2026-11-27T14:11:00.000Z').valid, false, 'zero-quantity sale cannot change stock');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  { ...stockSnapshot, organizationId: 'org-other' }, null,
  '2026-11-27T14:11:00.000Z').valid, false, 'stock from another organization is rejected');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  { ...stockSnapshot, quantity: -1 }, null,
  '2026-11-27T14:11:00.000Z').valid, false, 'negative persisted stock is rejected');
assert.equal(validateSaleStockDecrement(bundle, 'seller-A', saleForStock,
  stockSnapshot, null, '2026-11-27T14:20:00.000Z').reason,
  'invalid_sale_timestamp', 'stale sale proposal is rejected');


// Financial ledger integrity: sale settlement and partial debt repayments.
assert.equal(validateSaleSettlement({
  saleType: 'paid', total: 12000, paidAmount: 12000, creditAmount: 0,
  method: 'Espèces'
}).valid, true, 'fully paid sale settlement is coherent');
assert.equal(validateSaleSettlement({
  saleType: 'credit', total: 12000, paidAmount: 0, creditAmount: 12000,
  clientId: 'client-1', method: 'Crédit client'
}).valid, true, 'credit sale settlement requires a customer and full debt amount');
assert.equal(validateSaleSettlement({
  saleType: 'paid', total: 7000, paidAmount: 7000, creditAmount: 0,
  method: 'Paiement mixte', cashPart: 4000, mobilePart: 3000
}).valid, true, 'mixed sale split reconciles to amount received');
assert.equal(validateSaleSettlement({
  saleType: 'paid', total: 12000, paidAmount: 7000, creditAmount: 4000,
  method: 'Paiement mixte', cashPart: 4000, mobilePart: 3000
}).valid, false, 'sale paid plus credit must equal total');
assert.equal(validateSaleSettlement({
  saleType: 'paid', total: 7000, paidAmount: 7000, creditAmount: 0,
  method: 'Paiement mixte', cashPart: 5000, mobilePart: 3000
}).valid, false, 'mixed tender components must equal amount received');
assert.equal(validateSaleSettlement({
  saleType: 'credit', total: 12000, paidAmount: 1000, creditAmount: 11000,
  clientId: 'client-1'
}).valid, false, 'credit-only sale cannot silently include a payment');
assert.equal(validateSaleSettlement({
  saleType: 'paid', total: 12000.5, paidAmount: 12000.5, creditAmount: 0
}).valid, false, 'GNF ledger amounts must be safe integer values');

const debtForPayment = {
  id: 'debt-pay-1', clientId: 'client-1', organizationId: 'org-1',
  storeId: 'store-A', amount: 10000
};
const priorPayments = [
  { id: 'payment-old-1', debtId: 'debt-pay-1', amount: 3000 }
];
const newPayment = {
  id: 'payment-new-1', idempotencyKey: 'payment-key-1',
  debtId: 'debt-pay-1', clientId: 'client-1',
  organizationId: 'org-1', storeId: 'store-A', amount: 4000,
  createdBy: 'seller-A', createdAt: '2026-11-27T14:20:00.000Z'
};
const repaymentCheck = validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, priorPayments, null, '2026-11-27T14:21:00.000Z');
assert.equal(repaymentCheck.valid, true, 'assigned seller can record valid partial repayment');
assert.equal(repaymentCheck.paidAfter, 7000, 'partial repayment updates paid total accurately');
assert.equal(repaymentCheck.remainingAfter, 3000, 'partial repayment calculates remaining debt');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment, newPayment,
  priorPayments, { id: 'payment-key-1' }, '2026-11-27T14:21:00.000Z').reason,
  'payment_already_applied', 'payment replay is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  { ...newPayment, amount: 8000 }, priorPayments, null,
  '2026-11-27T14:21:00.000Z').reason,
  'payment_exceeds_remaining_balance', 'repayment cannot exceed current debt balance');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  { ...newPayment, clientId: 'client-other' }, priorPayments, null,
  '2026-11-27T14:21:00.000Z').valid, false, 'payment must reference same debt customer');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  { ...newPayment, storeId: 'store-B' }, priorPayments, null,
  '2026-11-27T14:21:00.000Z').valid, false, 'payment cannot cross store boundary');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  { ...newPayment, createdBy: 'seller-B' }, priorPayments, null,
  '2026-11-27T14:21:00.000Z').valid, false, 'payment actor cannot be forged');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  { ...newPayment, idempotencyKey: '' }, priorPayments, null,
  '2026-11-27T14:21:00.000Z').valid, false, 'repayment requires idempotency key');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], amount: 11000 }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'existing_payments_exceed_debt', 'corrupt historical payments block new repayment');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], id: 'duplicate' }, { ...priorPayments[0], id: 'duplicate' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'duplicate payment IDs in history are rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, priorPayments, null, '2026-11-27T14:30:00.000Z').reason,
  'invalid_payment_timestamp', 'stale repayment proposal is rejected');


// Purchases, expenses and sale cancellation audit controls.
const purchaseRecord = {
  id: 'purchase-1', organizationId: 'org-1', storeId: 'store-A',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:00:00.000Z',
  item: 'Rice', productId: 'product-rice', quantity: 20,
  amount: 500000, method: 'Espèces'
};
assert.equal(validatePurchaseRecord(bundle, 'owner-1', purchaseRecord).valid, true,
  'owner purchase with product reference and provenance is accepted');
assert.equal(validatePurchaseRecord(bundle, 'seller-A', purchaseRecord).valid, false,
  'seller cannot create purchases');
assert.equal(validatePurchaseRecord(bundle, 'owner-1', {
  ...purchaseRecord, amount: 0
}).valid, false, 'zero-value purchase rejected');
assert.equal(validatePurchaseRecord(bundle, 'owner-1', {
  ...purchaseRecord, quantity: -2
}).valid, false, 'negative purchase quantity rejected');
assert.equal(validatePurchaseRecord(bundle, 'owner-1', {
  ...purchaseRecord, productId: ''
}).valid, false, 'empty linked product ID rejected');
assert.equal(validatePurchaseRecord(bundle, 'owner-1', {
  ...purchaseRecord, storeId: 'store-unknown'
}).valid, false, 'purchase outside organization stores rejected');

const expenseRecord = {
  id: 'expense-1', organizationId: 'org-1', storeId: 'store-A',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:05:00.000Z',
  category: 'Transport', description: 'Livraison',
  amount: 25000, method: 'Espèces'
};
assert.equal(validateExpenseRecord(bundle, 'owner-1', expenseRecord).valid, true,
  'owner expense with complete provenance is accepted');
assert.equal(validateExpenseRecord(bundle, 'seller-A', expenseRecord).valid, false,
  'seller cannot create expenses');
assert.equal(validateExpenseRecord(bundle, 'owner-1', {
  ...expenseRecord, amount: -100
}).valid, false, 'negative expense amount rejected');
assert.equal(validateExpenseRecord(bundle, 'owner-1', {
  ...expenseRecord, description: ''
}).valid, false, 'expense description is mandatory');
assert.equal(validateExpenseRecord(bundle, 'owner-1', {
  ...expenseRecord, createdBy: 'seller-A'
}).valid, false, 'expense creator cannot be forged');

const persistedSaleForCancel = {
  id: 'sale-cancel-1', organizationId: 'org-1', storeId: 'store-A',
  quantity: 2, total: 40000, paidAmount: 40000, creditAmount: 0,
  saleType: 'paid', stockProductId: 'product-rice', status: 'validated'
};
const cancellationRecord = {
  id: 'cancel-1', idempotencyKey: 'cancel-key-1',
  saleId: 'sale-cancel-1', organizationId: 'org-1', storeId: 'store-A',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:10:00.000Z',
  reason: 'Erreur de saisie'
};
const cancellationCheck = validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, cancellationRecord, null, []);
assert.equal(cancellationCheck.valid, true, 'owner can prevalidate a valid sale cancellation');
assert.equal(cancellationCheck.stockToRestore, 2, 'cancellation signals stock quantity to restore');
assert.equal(cancellationCheck.cashToReverse, 40000, 'cancellation reports cash ledger amount to reverse');
assert.equal(validateSaleCancellation(bundle, 'seller-A',
  persistedSaleForCancel, cancellationRecord, null, []).valid, false,
  'seller cannot cancel a validated sale');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, cancellationRecord, { id: 'cancel-previous' }, []).reason,
  'sale_already_cancelled', 'duplicate cancellation is rejected');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  { ...persistedSaleForCancel, status: 'cancelled' }, cancellationRecord, null, []).reason,
  'sale_already_cancelled', 'cancelled sale cannot be cancelled again');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, { ...cancellationRecord, reason: '' }, null, []).valid,
  false, 'cancellation requires a reason');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, { ...cancellationRecord, idempotencyKey: '' }, null, []).valid,
  false, 'cancellation requires idempotency key');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, cancellationRecord, null, [{ id: 'repayment-1', amount: 10000 }]).reason,
  'sale_has_repayments_requires_refund_workflow', 'sale with repayments requires explicit refund workflow');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  persistedSaleForCancel, { ...cancellationRecord, storeId: 'store-B' }, null, []).valid,
  false, 'cancellation cannot move across stores');


// Append-only audit evidence and owner-controlled stock corrections.
const stockSnapshotForAdjustment = {
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', quantity: 12
};
const adjustment = {
  id: 'adjust-1', idempotencyKey: 'adjust-key-1',
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', delta: -2,
  reason: 'Inventaire physique', createdBy: 'owner-1'
};
const adjustmentCheck = validateStockAdjustment(bundle, 'owner-1',
  adjustment, stockSnapshotForAdjustment, null);
assert.equal(adjustmentCheck.valid, true, 'owner can validate a reasoned stock adjustment');
assert.equal(adjustmentCheck.resultingQuantity, 10, 'stock adjustment computes resulting quantity');
assert.equal(validateStockAdjustment(bundle, 'seller-A', adjustment,
  stockSnapshotForAdjustment, null).valid, false, 'seller cannot adjust stock');
assert.equal(validateStockAdjustment(bundle, 'owner-1',
  { ...adjustment, delta: -20 }, stockSnapshotForAdjustment, null).valid, false,
  'stock adjustment cannot make quantity negative');
assert.equal(validateStockAdjustment(bundle, 'owner-1',
  { ...adjustment, reason: '' }, stockSnapshotForAdjustment, null).valid, false,
  'stock adjustment requires a reason');
assert.equal(validateStockAdjustment(bundle, 'owner-1', adjustment,
  stockSnapshotForAdjustment, { id: 'movement-existing' }).reason,
  'stock_adjustment_already_applied', 'stock adjustment replay is rejected');

const auditEvent = {
  id: 'audit-1', organizationId: 'org-1', storeId: 'store-A',
  actorUid: 'seller-A', action: 'sale.created',
  targetType: 'sale', targetId: 'sale-1', operationId: 'sale-op-1',
  createdAt: '2026-11-28T11:00:00.000Z'
};
assert.equal(validateAuditEvent(bundle, 'seller-A', auditEvent,
  '2026-11-28T11:00:30.000Z').valid, true,
  'assigned seller event for an allowed sale operation is accepted');
assert.equal(validateAuditEvent(bundle, 'seller-B', auditEvent,
  '2026-11-28T11:00:30.000Z').valid, false,
  'audit actor cannot be forged across seller identities');
assert.equal(validateAuditEvent(bundle, 'seller-A',
  { ...auditEvent, storeId: 'store-B' }, '2026-11-28T11:00:30.000Z').valid,
  false, 'seller cannot write audit events into another store');
assert.equal(validateAuditEvent(bundle, 'seller-A',
  { ...auditEvent, action: 'expense.created' }, '2026-11-28T11:00:30.000Z').valid,
  false, 'seller cannot create expense audit evidence');
assert.equal(validateAuditEvent(bundle, 'seller-A',
  { ...auditEvent, createdAt: 'not-a-date' }, '2026-11-28T11:00:30.000Z').valid,
  false, 'audit event timestamp must be valid');
assert.equal(validateAuditEvent(bundle, 'seller-A',
  { ...auditEvent, operationId: '' }, '2026-11-28T11:00:30.000Z').valid,
  false, 'audit event must reference its originating operation');
assert.equal(validateAuditEvent(bundle, 'seller-A',
  { ...auditEvent, action: 'untrusted.admin' }, '2026-11-28T11:00:30.000Z').valid,
  false, 'unknown audit action is rejected');
assert.equal(validateAuditEvent(bundle, 'owner-1',
  { ...auditEvent, actorUid: 'owner-1', action: 'expense.created' },
  '2026-11-28T11:00:30.000Z').valid, true,
  'owner expense event is accepted');

console.log('PASS: 165 multi-store model, permission, provenance, hardened invitation, seller lifecycle, seller-data and stock-transfer assertions');
