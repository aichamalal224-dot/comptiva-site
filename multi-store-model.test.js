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
  validateStockTransferDispatch,
  validateStockTransferReceipt,
  validateStockTransferReceiptEvent,
  buildStockTransferReminderSuggestion,
  classifyStoreStockAlert,
  projectOwnerSellerPresence,
  validateSaleStockDecrement,
  validateSaleSettlement,
  validateDebtPayment,
  validatePurchaseRecord,
  validatePurchaseStockReceipt,
  validateExpenseRecord,
  validateSaleCancellation,
  validateSaleCancellationStock,
  validateSaleReturn,
  validateAuditEvent,
  validateStockAdjustment,
  validateStockMovementRecord,
  projectSellerProduct,
  validateSellerOperationalProduct,
  validateSellerOperationalRecord,
  projectSellerSale,
  projectSellerDebt,
  projectSellerPayment
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
assert.equal(authorizeStoreAction(bundle, 'owner-1', 'store-B', 'transfers:read').allowed, true,
  'patron can read transfer activity across all stores');
assert.equal(authorizeStoreAction(bundle, 'seller-B', 'store-B', 'transfers:read').allowed, true,
  'seller can read assigned-store incoming transfers');
assert.equal(authorizeStoreAction(bundle, 'seller-B', 'store-A', 'transfers:read').allowed, false,
  'seller cannot read transfers for another store');
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
assert.equal(validateSellerOperationalProduct({
  id: 'product-margin-alias', name: 'Riz', metrics: { profit_margin: 18 }
}).valid, false, 'seller-readable product rejects profit margin aliases');
assert.equal(validateSellerOperationalProduct({
  id: 'product-cost-alias', name: 'Riz', details: { purchase_cost: 42000 }
}).valid, false, 'seller-readable product rejects purchase cost aliases');




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
  id: 'transfer-1', idempotencyKey: 'transfer-key-1', organizationId: 'org-1', productId: 'product-1',
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
assert.equal(validateStockTransferCreation(bundle, 'owner-1', {
  ...transfer, idempotencyKey: ''
}, '2026-11-27T14:01:00.000Z').valid, false,
  'transfer requires a stable idempotency key');
assert.equal(validateStockTransferCreation(bundle, 'owner-1', transfer,
  '2026-11-27T14:01:00.000Z', { id: 'movement-existing' }).reason,
  'invalid_transfer_fields', 'duplicate transfer creation is rejected');
assert.equal(validateStockTransferCreation(bundle, 'owner-1', {
  ...transfer, quantity: 1.5
}, '2026-11-27T14:01:00.000Z').valid, false,
  'fractional transfer quantity is rejected');
const sourceTransferStock = {
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-1', quantity: 9
};
const dispatchCheck = validateStockTransferDispatch(bundle, 'owner-1', transfer,
  sourceTransferStock, '2026-11-27T14:01:00.000Z');
assert.equal(dispatchCheck.valid, true, 'owner can prevalidate dispatch from source stock');
assert.equal(dispatchCheck.resultingSourceStockQuantity, 4,
  'dispatch prevalidation debits exactly the transferred quantity from source stock');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1', transfer,
  { ...sourceTransferStock, quantity: 4 }, '2026-11-27T14:01:00.000Z').reason,
  'insufficient_source_stock', 'transfer dispatch cannot exceed available source stock');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1', transfer,
  { ...sourceTransferStock, storeId: 'store-B' }, '2026-11-27T14:01:00.000Z').reason,
  'invalid_transfer_dispatch_fields', 'dispatch cannot debit destination or unrelated store stock');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1', transfer,
  sourceTransferStock, '2026-11-27T14:01:00.000Z',
  { id: 'dispatch-movement-existing' }).reason,
  'transfer_dispatch_already_applied', 'dispatch movement replay is rejected');
assert.equal(validateStockTransferDispatch(bundle, 'seller-A', transfer,
  sourceTransferStock, '2026-11-27T14:01:00.000Z').valid, false,
  'seller cannot dispatch owner-controlled inter-store transfers');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1', transfer,
  { ...sourceTransferStock, quantity: 1.5 }, '2026-11-27T14:01:00.000Z').reason,
  'invalid_transfer_dispatch_fields', 'fractional source stock is rejected for dispatch');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1', transfer,
  { ...sourceTransferStock, organizationId: 'org-other' },
  '2026-11-27T14:01:00.000Z').reason,
  'invalid_transfer_dispatch_fields', 'dispatch cannot debit stock from another organization');
assert.equal(validateStockTransferDispatch(bundle, 'owner-1',
  { ...transfer, createdAt: '2026-11-27T14:00:00.000Z' }, sourceTransferStock,
  '2026-11-27T14:10:00.000Z').reason,
  'invalid_transfer_dispatch_timestamp', 'stale transfer dispatch proposal is rejected');

const receipt = {
  transferId: 'transfer-1', organizationId: 'org-1',
  storeId: 'store-B', fromStoreId: 'store-A', toStoreId: 'store-B',
  id: 'receipt-1', idempotencyKey: 'receipt-key-1', productId: 'product-1', quantity: 5,
  receivedBy: 'owner-1', receivedAt: '2026-11-27T14:02:00.000Z'
};
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, receipt,
  '2026-11-27T14:03:00.000Z').valid, true,
  'owner can validate receipt at destination store');
assert.equal(validateStockTransferReceipt(bundle, 'seller-B', transfer, { ...receipt, receivedBy: 'seller-B' },
  '2026-11-27T14:03:00.000Z').valid, true,
  'seller can confirm receipt in their assigned destination store');
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
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, {
  ...receipt, fromStoreId: 'store-B'
}, '2026-11-27T14:03:00.000Z').valid, false,
  'receipt source store must match persisted transfer');
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, {
  ...receipt, idempotencyKey: ''
}, '2026-11-27T14:03:00.000Z').valid, false,
  'receipt requires an idempotency key');
assert.equal(validateStockTransferReceipt(bundle, 'owner-1', transfer, receipt,
  '2026-11-27T14:03:00.000Z', { id: 'receipt-existing' }).reason,
  'transfer_receipt_already_applied', 'duplicate receipt is rejected even if transfer snapshot is stale');


// Red/green stock alerts and owner visibility of seller connection presence.
assert.deepEqual(classifyStoreStockAlert({ quantity: 0, alertAt: 3 }), {
  valid: true, level: 'red', code: 'out_of_stock', label: 'Rupture de stock'
}, 'zero stock displays a red out-of-stock alert');
assert.equal(classifyStoreStockAlert({ quantity: 2, alertAt: 3 }).level, 'red',
  'stock at or below threshold displays red low-stock alert');
assert.equal(classifyStoreStockAlert({ quantity: 4, alertAt: 3 }).level, 'green',
  'stock above threshold displays green sufficient-stock alert');
assert.equal(classifyStoreStockAlert({ quantity: -1, alertAt: 3 }).valid, false,
  'negative stock is invalid for alert display');
const sellerPresence = {
  uid: 'seller-B', organizationId: 'org-1', sessionState: 'active',
  heartbeatAt: '2026-11-28T15:00:00.000Z',
  lastSeenAt: '2026-11-28T15:00:00.000Z'
};
assert.equal(projectOwnerSellerPresence(
  bundle, 'owner-1', 'seller-B', sellerPresence, '2026-11-28T15:00:30.000Z'
).state, 'online', 'patron sees seller as connected with a fresh heartbeat');
assert.equal(projectOwnerSellerPresence(
  bundle, 'owner-1', 'seller-B',
  { ...sellerPresence, sessionState: 'signed_out' }, '2026-11-28T15:00:30.000Z'
).state, 'offline', 'patron sees explicit seller sign-out as offline');
assert.equal(projectOwnerSellerPresence(
  bundle, 'owner-1', 'seller-B', sellerPresence, '2026-11-28T15:10:00.000Z'
).state, 'connection_unconfirmed', 'stale heartbeat is not falsely labelled offline');
assert.equal(projectOwnerSellerPresence(
  bundle, 'seller-A', 'seller-B', sellerPresence, '2026-11-28T15:00:30.000Z'
).valid, false, 'seller cannot access owner-wide presence view');
assert.equal(projectOwnerSellerPresence(
  bundle, 'owner-1', 'seller-B',
  { ...sellerPresence, uid: 'seller-A' }, '2026-11-28T15:00:30.000Z'
).valid, false, 'presence record identity must match requested seller');


// Destination-store seller receipt lifecycle: partial, refused and damaged units.
const destinationStockSnapshot = {
  organizationId: 'org-1', storeId: 'store-B', productId: 'product-1', quantity: 10
};
const partialReceipt1 = {
  transferId: 'transfer-1', organizationId: 'org-1',
  storeId: 'store-B', fromStoreId: 'store-A', toStoreId: 'store-B',
  id: 'receipt-part-1', idempotencyKey: 'receipt-part-key-1', productId: 'product-1',
  quantity: 3, acceptedQuantity: 2, refusedQuantity: 1, damagedQuantity: 0,
  receivedBy: 'seller-B', receivedAt: '2026-11-27T14:02:00.000Z'
};
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt1, [partialReceipt1],
  destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).reason, 'transfer_status_receipt_history_mismatch',
  'in-transit transfer cannot already contain receipt history');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', { ...transfer, status: 'partially_received' },
  partialReceipt1, [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).reason, 'transfer_status_receipt_history_mismatch',
  'partially received transfer requires a persisted prior receipt event');
const partialCheck1 = validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt1, [], destinationStockSnapshot,
  '2026-11-27T14:03:00.000Z'
);
assert.equal(partialCheck1.valid, true, 'assigned destination seller can record partial receipt');
assert.equal(partialCheck1.resultingStatus, 'partially_received', 'partial delivery stays pending');
assert.equal(partialCheck1.remainingToAccountFor, 2, 'partial receipt exposes remaining quantity');
assert.equal(partialCheck1.resultingStockQuantity, 12, 'only accepted units enter destination stock');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', { ...transfer, fromStoreId: 'store-unknown' },
  partialReceipt1, [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).reason, 'invalid_transfer_state',
  'receipt rejects a transfer whose source store is not in the organization');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', { ...transfer, fromStoreId: 'store-B' },
  partialReceipt1, [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).reason, 'invalid_transfer_state',
  'receipt rejects a transfer whose source and destination stores are identical');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', { ...transfer, fromStoreId: undefined },
  { ...partialReceipt1, fromStoreId: undefined }, [], destinationStockSnapshot,
  '2026-11-27T14:03:00.000Z'
).reason, 'invalid_transfer_state',
  'receipt rejects a transfer missing its source store reference');
const partialReceipt2 = {
  ...partialReceipt1, id: 'receipt-part-2', idempotencyKey: 'receipt-part-key-2',
  quantity: 2, acceptedQuantity: 1, refusedQuantity: 0, damagedQuantity: 1,
  receivedAt: '2026-11-27T14:04:00.000Z'
};
const partialCheck2 = validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt2, [partialReceipt1],
  { ...destinationStockSnapshot, quantity: 12 }, '2026-11-27T14:05:00.000Z'
);
assert.equal(partialCheck2.valid, true, 'second receipt event can complete a partial transfer');
assert.equal(partialCheck2.resultingStatus, 'received_with_issues', 'damaged/refused delivery closes with issue status');
assert.equal(partialCheck2.totalAccepted, 3, 'receipt history accumulates accepted quantity');
assert.equal(partialCheck2.totalRefused, 1, 'receipt history accumulates refused quantity');
assert.equal(partialCheck2.totalDamaged, 1, 'receipt history accumulates damaged quantity');
assert.equal(partialCheck2.resultingStockQuantity, 13, 'damaged and refused units never enter stock');
const fullRefusal = validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, {
    ...partialReceipt1, id: 'receipt-refused-all', idempotencyKey: 'receipt-refused-all-key',
    quantity: 5, acceptedQuantity: 0, refusedQuantity: 5, damagedQuantity: 0
  }, [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
);
assert.equal(fullRefusal.valid, true, 'destination seller can report a fully refused delivery');
assert.equal(fullRefusal.resultingStatus, 'refused', 'fully refused delivery is explicitly marked refused');
assert.equal(fullRefusal.resultingStockQuantity, 10, 'fully refused delivery adds nothing to destination stock');
const sellerWithoutReceiptPermission = structuredClone(bundle);
sellerWithoutReceiptPermission.members[2].permissions = ['sales:read'];
assert.equal(validateStockTransferReceiptEvent(
  sellerWithoutReceiptPermission, 'seller-B', transfer, partialReceipt1, [],
  destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).valid, false, 'patron can explicitly remove receipt confirmation permission from a seller');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-A', transfer, partialReceipt1, [], destinationStockSnapshot,
  '2026-11-27T14:03:00.000Z'
).valid, false, 'seller assigned to another store cannot confirm destination receipt');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, { ...partialReceipt1, quantity: 6 },
  [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).valid, false, 'receipt event cannot exceed dispatched quantity');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, { ...partialReceipt1, acceptedQuantity: 3 },
  [], destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).valid, false, 'accepted refused damaged quantities must reconcile');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt1, [partialReceipt1],
  destinationStockSnapshot, '2026-11-27T14:03:00.000Z'
).valid, false, 'receipt ID and idempotency replay are rejected');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt2,
  [{ ...partialReceipt1, fromStoreId: 'store-unknown' }],
  { ...destinationStockSnapshot, quantity: 12 }, '2026-11-27T14:05:00.000Z'
).reason, 'invalid_receipt_history',
  'prior receipt history must preserve the transfer source store');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt2,
  [{ ...partialReceipt1, receivedAt: '2026-11-27T14:06:00.000Z' }],
  { ...destinationStockSnapshot, quantity: 12 }, '2026-11-27T14:05:00.000Z'
).reason, 'invalid_receipt_history',
  'future-dated prior receipt events are rejected');
assert.equal(validateStockTransferReceiptEvent(
  bundle, 'seller-B', transfer, partialReceipt1, [],
  { ...destinationStockSnapshot, quantity: Number.MAX_SAFE_INTEGER },
  '2026-11-27T14:03:00.000Z'
).reason, 'destination_stock_overflow', 'destination stock overflow is rejected');
const reminderTransfer = {
  ...transfer, expectedAt: '2026-11-27T13:00:00.000Z', status: 'in_transit'
};
const reminder = buildStockTransferReminderSuggestion(
  bundle, reminderTransfer, 'seller-B', '2026-11-27T15:00:00.000Z', 60
);
assert.equal(reminder.eligible, true, 'overdue transfer produces a reminder suggestion for assigned seller');
assert.ok(reminder.message.includes('confirmation de réception'), 'reminder proposes a clear receipt confirmation message');
assert.equal(buildStockTransferReminderSuggestion(
  bundle, reminderTransfer, 'seller-A', '2026-11-27T15:00:00.000Z', 60
).eligible, false, 'reminder cannot target a seller outside destination store');
assert.equal(buildStockTransferReminderSuggestion(
  bundle, { ...reminderTransfer, expectedAt: '2026-11-27T14:30:00.000Z' },
  'seller-B', '2026-11-27T15:00:00.000Z', 60
).eligible, false, 'reminder respects configured grace period');


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
  { id: 'payment-old-1', idempotencyKey: 'payment-old-key-1', debtId: 'debt-pay-1', clientId: 'client-1', organizationId: 'org-1', storeId: 'store-A', amount: 3000, createdBy: 'seller-A', createdAt: '2026-11-27T14:00:00.000Z' }
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


assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], organizationId: 'org-other' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment from another organization is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], storeId: 'store-B' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment from another store is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], clientId: 'client-other' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment for another client is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], idempotencyKey: '' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment without idempotency key is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], idempotencyKey: 'payment-key-1' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'payment_already_applied', 'duplicate historical idempotency keys are rejected');

assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], createdBy: 'seller-B' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment author must have access to the debt store');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], createdAt: '2026-11-27T14:22:00.000Z' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'future-dated historical repayment is rejected');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], reversedAt: '2026-11-27T14:10:00.000Z' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'reversed repayment requires reconciled ledger before new payment');
assert.equal(validateDebtPayment(bundle, 'seller-A', debtForPayment,
  newPayment, [{ ...priorPayments[0], createdBy: '' }], null,
  '2026-11-27T14:21:00.000Z').reason,
  'invalid_existing_payment_history', 'historical repayment without actor provenance is rejected');



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
  ...purchaseRecord, quantity: 0
}).valid, false, 'zero-quantity purchase rejected');
assert.equal(validatePurchaseRecord(bundle, 'owner-1', {
  ...purchaseRecord, quantity: 1.5
}).valid, false, 'fractional purchase quantity rejected');
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
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  { ...persistedSaleForCancel, productId: 'product-rice', stockProductId: undefined },
  cancellationRecord, null, []).stockToRestore, 2,
  'cancellation restores stock using the canonical productId when stockProductId is absent');

assert.equal(cancellationCheck.cashToReverse, 40000, 'cancellation reports cash ledger amount to reverse');
const mixedPaidSaleForCancel = {
  ...persistedSaleForCancel, id: 'sale-cancel-mixed', method: 'Paiement mixte',
  cashPart: 15000, mobilePart: 25000
};
const mixedCancellation = {
  ...cancellationRecord, id: 'cancel-mixed', idempotencyKey: 'cancel-mixed-key',
  saleId: 'sale-cancel-mixed'
};
const mixedCancellationCheck = validateSaleCancellation(bundle, 'owner-1',
  mixedPaidSaleForCancel, mixedCancellation, null, []);
assert.equal(mixedCancellationCheck.valid, true,
  'mixed-payment sale cancellation passes settlement validation');
assert.equal(mixedCancellationCheck.cashToReverse, 40000,
  'mixed-payment cancellation preserves total collected amount');
assert.equal(mixedCancellationCheck.paymentMethodToReverse, 'Paiement mixte',
  'mixed-payment cancellation retains original payment method');
assert.equal(mixedCancellationCheck.cashPartToReverse, 15000,
  'mixed-payment cancellation exposes exact cash reversal component');
assert.equal(mixedCancellationCheck.mobilePartToReverse, 25000,
  'mixed-payment cancellation exposes exact mobile reversal component');

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
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  { ...persistedSaleForCancel, quantity: 1.5 }, cancellationRecord, null, []).reason,
  'invalid_persisted_sale', 'fractional sale quantity cannot be restored to stock');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  { ...persistedSaleForCancel, paidAmount: 30000 }, cancellationRecord, null, []).reason,
  'invalid_persisted_sale_settlement', 'cancellation rejects inconsistent paid and credit totals');
assert.equal(validateSaleCancellation(bundle, 'owner-1',
  { ...persistedSaleForCancel, creditAmount: 5000 }, cancellationRecord, null, []).reason,
  'invalid_persisted_sale_settlement', 'cancellation rejects invalid paid-sale credit balance');


// Partial and final receipts for stock-linked purchases.
const stockPurchase = {
  id: 'purchase-stock-1', organizationId: 'org-1', storeId: 'store-A',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:00:00.000Z',
  item: 'Riz', productId: 'product-rice', quantity: 20,
  amount: 200000, method: 'cash'
};
const purchaseStockSnapshot = {
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', quantity: 7
};
const firstPurchaseReceipt = {
  id: 'purchase-receipt-1', idempotencyKey: 'purchase-receipt-key-1',
  purchaseId: 'purchase-stock-1', organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', quantity: 12, receivedBy: 'owner-1',
  receivedAt: '2026-11-28T10:05:00.000Z'
};
const firstReceiptCheck = validatePurchaseStockReceipt(bundle, 'owner-1',
  stockPurchase, firstPurchaseReceipt, [], purchaseStockSnapshot,
  '2026-11-28T10:06:00.000Z');
assert.equal(firstReceiptCheck.valid, true, 'owner can receive part of a stock-linked purchase');
assert.equal(firstReceiptCheck.totalReceived, 12, 'partial receipt accumulates received quantity');
assert.equal(firstReceiptCheck.remainingToReceive, 8, 'partial receipt preserves outstanding quantity');
assert.equal(firstReceiptCheck.resultingStockQuantity, 19, 'partial receipt calculates stock increment');
assert.equal(firstReceiptCheck.fullyReceived, false, 'partial receipt does not mark order fully received');
const secondPurchaseReceipt = {
  ...firstPurchaseReceipt, id: 'purchase-receipt-2',
  idempotencyKey: 'purchase-receipt-key-2', quantity: 8,
  receivedAt: '2026-11-28T10:07:00.000Z'
};
const secondReceiptCheck = validatePurchaseStockReceipt(bundle, 'owner-1',
  stockPurchase, secondPurchaseReceipt, [firstPurchaseReceipt],
  { ...purchaseStockSnapshot, quantity: 19 }, '2026-11-28T10:08:00.000Z');
assert.equal(secondReceiptCheck.valid, true, 'owner can complete a purchase in a second delivery');
assert.equal(secondReceiptCheck.remainingToReceive, 0, 'final receipt closes outstanding quantity');
assert.equal(secondReceiptCheck.fullyReceived, true, 'final receipt marks purchase fully received');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  { ...firstPurchaseReceipt, quantity: 9 }, [firstPurchaseReceipt],
  purchaseStockSnapshot, '2026-11-28T10:06:00.000Z').reason,
  'purchase_receipt_already_applied', 'receipt replay by ID or idempotency key is rejected');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  { ...firstPurchaseReceipt, id: 'receipt-over', idempotencyKey: 'key-over', quantity: 9 },
  [firstPurchaseReceipt], purchaseStockSnapshot, '2026-11-28T10:06:00.000Z').reason,
  'receipt_exceeds_ordered_quantity', 'cumulative receipt cannot exceed ordered quantity');
assert.equal(validatePurchaseStockReceipt(bundle, 'seller-A', stockPurchase,
  { ...firstPurchaseReceipt, receivedBy: 'seller-A' }, [], purchaseStockSnapshot,
  '2026-11-28T10:06:00.000Z').valid, false, 'seller cannot receive owner-only purchases');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  { ...firstPurchaseReceipt, quantity: 1.5 }, [], purchaseStockSnapshot,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_purchase_receipt_fields', 'fractional receipt quantities are rejected');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1',
  { ...stockPurchase, productId: undefined }, firstPurchaseReceipt, [],
  purchaseStockSnapshot, '2026-11-28T10:06:00.000Z').reason,
  'stock_linked_purchase_requires_product', 'stock receipt requires a stable product reference');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  { ...firstPurchaseReceipt, storeId: 'store-B' }, [], purchaseStockSnapshot,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_purchase_receipt_fields', 'receipt cannot be posted to another store');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  firstPurchaseReceipt, [], { ...purchaseStockSnapshot, quantity: -1 },
  '2026-11-28T10:06:00.000Z').reason,
  'purchase_receipt_stock_mismatch', 'receipt refuses an invalid stock snapshot');

assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  secondPurchaseReceipt, [{ ...firstPurchaseReceipt, receivedAt: 'invalid-date' }],
  { ...purchaseStockSnapshot, quantity: 19 }, '2026-11-28T10:08:00.000Z').reason,
  'invalid_or_duplicate_prior_purchase_receipt', 'receipt history rejects invalid prior timestamps');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  secondPurchaseReceipt, [{ ...firstPurchaseReceipt, receivedAt: '2026-11-28T10:09:00.000Z' }],
  { ...purchaseStockSnapshot, quantity: 19 }, '2026-11-28T10:08:00.000Z').reason,
  'invalid_or_duplicate_prior_purchase_receipt', 'future-dated purchase receipt history is rejected');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  secondPurchaseReceipt, [{ ...firstPurchaseReceipt, receivedBy: 'seller-B' }],
  { ...purchaseStockSnapshot, quantity: 19 }, '2026-11-28T10:08:00.000Z').reason,
  'invalid_prior_purchase_receipt_actor', 'purchase receipt history cannot be attributed to an unauthorized seller');
assert.equal(validatePurchaseStockReceipt(bundle, 'owner-1', stockPurchase,
  { ...firstPurchaseReceipt, id: 'receipt-overflow', idempotencyKey: 'key-overflow' },
  [], { ...purchaseStockSnapshot, quantity: Number.MAX_SAFE_INTEGER },
  '2026-11-28T10:06:00.000Z').reason,
  'purchase_receipt_quantity_overflow', 'stock increment cannot exceed safe integer range');

// Cancellation after a later stock transfer restores the original sale store only.
const cancellableStockSale = {
  id: 'sale-cancel-stock', organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-1', quantity: 2, total: 20000,
  saleType: 'paid', paidAmount: 20000, creditAmount: 0,
  createdBy: 'seller-A', createdAt: '2026-11-28T10:00:00.000Z'
};
const cancellationForStock = {
  id: 'cancel-stock-1', idempotencyKey: 'cancel-stock-key-1',
  saleId: 'sale-cancel-stock', organizationId: 'org-1', storeId: 'store-A',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:05:00.000Z',
  reason: 'Annulation validée'
};
const originalStoreStock = {
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-1', quantity: 4
};
const cancellationStockCheck = validateSaleCancellationStock(bundle, 'owner-1',
  cancellableStockSale, cancellationForStock, originalStoreStock);
assert.equal(cancellationStockCheck.valid, true, 'owner can prevalidate stock restoration for cancellation');
assert.equal(cancellationStockCheck.restoredToStoreId, 'store-A',
  'cancelled sale stock returns to original sale store after later transfer');
assert.equal(cancellationStockCheck.resultingStockQuantity, 6,
  'cancellation restores exactly the sold quantity to original store');
assert.equal(validateSaleCancellationStock(bundle, 'owner-1',
  { ...cancellableStockSale, status: 'cancelled' }, cancellationForStock,
  originalStoreStock).reason, 'sale_already_cancelled',
  'stock helper refuses a second restoration after sale cancellation');

assert.equal(validateSaleCancellationStock(bundle, 'owner-1',
  cancellableStockSale, cancellationForStock, originalStoreStock,
  { id: 'movement-cancel-existing' }).reason,
  'sale_cancellation_stock_already_restored', 'cancellation stock cannot be restored twice');
assert.equal(validateSaleCancellationStock(bundle, 'owner-1',
  cancellableStockSale, { ...cancellationForStock, storeId: 'store-B' },
  originalStoreStock).reason,
  'invalid_sale_cancellation_stock_fields', 'cancellation cannot restore to a different store');
assert.equal(validateSaleCancellationStock(bundle, 'seller-A',
  cancellableStockSale, { ...cancellationForStock, createdBy: 'seller-A' },
  originalStoreStock).valid, false, 'seller cannot restore stock through owner cancellation');
assert.equal(validateSaleCancellationStock(bundle, 'owner-1',
  cancellableStockSale, cancellationForStock,
  { ...originalStoreStock, quantity: Number.MAX_SAFE_INTEGER }).reason,
  'sale_cancellation_stock_overflow', 'cancellation cannot overflow stock quantity');

// Customer returns: quantity, refund/credit reduction and restock are bounded.
const saleForReturn = {
  id: 'sale-return-1', organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-1', quantity: 3, total: 30000, unitPrice: 10000,
  saleType: 'paid', paidAmount: 30000, creditAmount: 0, method: 'Espèces',
  createdBy: 'seller-A', createdAt: '2026-11-28T10:00:00.000Z'
};
const returnStock = {
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-1', quantity: 5
};
const firstReturn = {
  id: 'return-1', idempotencyKey: 'return-key-1', saleId: 'sale-return-1',
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-1',
  quantity: 1, amount: 10000, cashRefundAmount: 10000, creditReductionAmount: 0,
  restockQuantity: 1, damagedQuantity: 0, reason: 'Produit retourné intact',
  createdBy: 'owner-1', createdAt: '2026-11-28T10:05:00.000Z'
};
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-future', idempotencyKey: 'prior-future-key',
    createdAt: '2026-11-28T10:07:00.000Z' }], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'future-dated prior sale returns are rejected');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-actor', idempotencyKey: 'prior-actor-key',
    createdBy: 'seller-A' }], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'prior return history must be attributed to an authorized owner');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [], [], returnStock, 'not-a-date').reason,
  'invalid_sale_return_timestamp', 'invalid reference time is rejected before history evaluation');
const returnCheck = validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [], [], returnStock, '2026-11-28T10:06:00.000Z');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, amount: 20000, cashRefundAmount: 20000 },
  [], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'return_exceeds_unreturned_sale_value', 'single-unit refund cannot exceed that unit sale price');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-unit-over', idempotencyKey: 'prior-unit-over-key',
    amount: 20000, cashRefundAmount: 20000 }],
  [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'historical return cannot exceed value of returned units');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-quantity-over', idempotencyKey: 'prior-quantity-over-key',
    quantity: 1, amount: 20000, cashRefundAmount: 20000, restockQuantity: 1 }],
  [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'historical return value must match returned quantity ceiling');
assert.equal(returnCheck.valid, true, 'owner can prevalidate a valid paid-sale return');
assert.equal(returnCheck.remainingReturnableQuantity, 2, 'return tracks remaining returnable quantity');
assert.equal(returnCheck.refundedAfter, 10000, 'return tracks cumulative cash refund');
assert.equal(returnCheck.resultingStockQuantity, 6, 'only resellable returned units re-enter stock');
assert.equal(returnCheck.fullyReturned, false, 'partial return leaves sale returnable balance');
const secondReturn = {
  ...firstReturn, id: 'return-2', idempotencyKey: 'return-key-2',
  quantity: 2, amount: 20000, cashRefundAmount: 20000,
  restockQuantity: 1, damagedQuantity: 1, createdAt: '2026-11-28T10:07:00.000Z'
};
const finalReturnCheck = validateSaleReturn(bundle, 'owner-1', saleForReturn,
  secondReturn, [firstReturn], [], { ...returnStock, quantity: 6 },
  '2026-11-28T10:08:00.000Z');
assert.equal(finalReturnCheck.valid, true, 'remaining items can be returned with one damaged unit');
assert.equal(finalReturnCheck.fullyReturned, true, 'all sold quantity can be returned once');
assert.equal(finalReturnCheck.resultingStockQuantity, 7, 'damaged returned unit is not restored to stock');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, id: 'return-over', idempotencyKey: 'return-key-over', quantity: 3, amount: 30000,
    cashRefundAmount: 30000, restockQuantity: 3 },
  [firstReturn], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'return_exceeds_sold_quantity', 'cumulative return quantity cannot exceed sold quantity');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, amount: 35000, cashRefundAmount: 35000 },
  [], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'return_exceeds_unreturned_sale_value', 'return refund cannot exceed the original sale value');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, id: 'return-dup', idempotencyKey: 'return-key-1' },
  [firstReturn], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'sale_return_already_applied', 'return replay by idempotency key is rejected');
assert.equal(validateSaleReturn(bundle, 'seller-A', saleForReturn,
  { ...firstReturn, createdBy: 'seller-A' }, [], [], returnStock,
  '2026-11-28T10:06:00.000Z').valid, false, 'seller cannot perform owner-only sale returns');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [], [{ id: 'repayment-1' }], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'sale_has_repayments_requires_debt_refund_workflow', 'returns with prior repayments require dedicated debt workflow');
assert.equal(validateSaleReturn(bundle, 'owner-1',
  { ...saleForReturn, status: 'cancelled' }, firstReturn, [], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'cancelled_sale_cannot_be_returned', 'cancelled sale cannot be returned again');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, restockQuantity: 2, damagedQuantity: 0 },
  [], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'invalid_sale_return_fields', 'restocked and damaged quantities must equal returned quantity');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  { ...firstReturn, quantity: 1.5 }, [], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_sale_return_fields', 'fractional return quantities are rejected');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [], [], { ...returnStock, quantity: Number.MAX_SAFE_INTEGER },
  '2026-11-28T10:06:00.000Z').reason,
  'sale_return_stock_overflow', 'return stock increment cannot overflow safe integer range');
const creditSaleForReturn = {
  ...saleForReturn, id: 'sale-credit-return', saleType: 'credit',
  paidAmount: 0, creditAmount: 30000, method: 'Crédit client', clientId: 'client-1'
};
const creditReturn = {
  ...firstReturn, id: 'return-credit', idempotencyKey: 'return-credit-key',
  saleId: 'sale-credit-return', amount: 10000, cashRefundAmount: 0,
  creditReductionAmount: 10000, restockQuantity: 1
};
assert.equal(validateSaleReturn(bundle, 'owner-1', creditSaleForReturn,
  creditReturn, [], [], returnStock, '2026-11-28T10:06:00.000Z').valid,
  true, 'unpaid credit sale return reduces outstanding credit rather than paying cash');
assert.equal(validateSaleReturn(bundle, 'owner-1', creditSaleForReturn,
  { ...creditReturn, cashRefundAmount: 10000, creditReductionAmount: 0 },
  [], [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'invalid_credit_sale_return_allocation', 'credit return cannot create an unsupported cash refund');

assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-bad', idempotencyKey: 'prior-bad-key',
    cashRefundAmount: 5000 }], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'prior return allocations must match original sale type');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-over', idempotencyKey: 'prior-over-key',
    quantity: 4, amount: 30000, cashRefundAmount: 30000, restockQuantity: 4 }],
  [], returnStock, '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_totals', 'inconsistent prior return totals are rejected');
assert.equal(validateSaleReturn(bundle, 'owner-1', saleForReturn,
  firstReturn, [{ ...firstReturn, id: 'prior-date', idempotencyKey: 'prior-date-key',
    createdAt: 'not-a-date' }], [], returnStock,
  '2026-11-28T10:06:00.000Z').reason,
  'invalid_existing_sale_return_history', 'prior return history requires a valid timestamp');
// Append-only audit evidence and owner-controlled stock corrections.
const stockSnapshotForAdjustment = {
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', quantity: 12
};
const adjustment = {
  id: 'adjust-1', idempotencyKey: 'adjust-key-1',
  organizationId: 'org-1', storeId: 'store-A',
  productId: 'product-rice', delta: -2,
  reason: 'Inventaire physique', createdBy: 'owner-1', createdAt: new Date().toISOString()
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
assert.equal(validateStockAdjustment(bundle, 'owner-1',
  { ...adjustment, createdAt: 'not-a-date' }, stockSnapshotForAdjustment, null).reason,
  'invalid_creation_timestamp', 'stock adjustment requires a valid creation timestamp');
assert.equal(validateStockAdjustment(bundle, 'owner-1',
  { ...adjustment, createdAt: new Date(Date.now() + 60000).toISOString() },
  stockSnapshotForAdjustment, null).reason,
  'invalid_stock_adjustment_timestamp', 'future stock adjustment timestamp is rejected');
assert.equal(validateStockAdjustment(bundle, 'owner-1',
  { ...adjustment, delta: Number.MAX_SAFE_INTEGER },
  { ...stockSnapshotForAdjustment, quantity: 1 }, null).reason,
  'invalid_stock_adjustment_fields', 'stock adjustment resulting quantity must remain a safe integer');


// Immutable stock ledger: movement direction, actor/store authorization and organization-wide replay protection.
const stockMovement = {
  id: 'movement-sale-1', idempotencyKey: 'movement-sale-key-1',
  organizationId: 'org-1', storeId: 'store-A', productId: 'product-rice',
  movementType: 'sale_decrement', operationId: 'sale-stock-1',
  quantityDelta: -3, createdBy: 'seller-A', createdAt: '2026-11-28T11:00:00.000Z'
};
assert.equal(validateStockMovementRecord(bundle, 'seller-A', stockMovement, [],
  '2026-11-28T11:01:00.000Z').valid, true,
  'assigned seller can append a sale stock-decrement movement');
assert.equal(validateStockMovementRecord(bundle, 'seller-A',
  { ...stockMovement, quantityDelta: 3 }, [], '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_fields', 'sale movement must decrement stock');
assert.equal(validateStockMovementRecord(bundle, 'seller-A', stockMovement,
  [{ id: 'old-movement', idempotencyKey: stockMovement.idempotencyKey, organizationId: 'org-1' }],
  '2026-11-28T11:01:00.000Z').reason,
  'stock_movement_replay', 'movement idempotency key cannot be reused in the organization');
assert.equal(validateStockMovementRecord(bundle, 'seller-A',
  { ...stockMovement, storeId: 'store-B' }, [], '2026-11-28T11:01:00.000Z').valid,
  false, 'seller cannot append stock movement to another store');
assert.equal(validateStockMovementRecord(bundle, 'seller-B',
  { ...stockMovement, createdBy: 'seller-B' }, [], '2026-11-28T11:01:00.000Z').valid,
  false, 'movement actor must have permission in its store');
assert.equal(validateStockMovementRecord(bundle, 'owner-1',
  { ...stockMovement, movementType: 'stock_adjustment', quantityDelta: 2,
    createdBy: 'owner-1' }, [], '2026-11-28T11:01:00.000Z').valid,
  true, 'owner can append a positive stock adjustment');
assert.equal(validateStockMovementRecord(bundle, 'owner-1',
  { ...stockMovement, movementType: 'stock_adjustment', quantityDelta: 0,
    createdBy: 'owner-1' }, [], '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_fields', 'zero-quantity movement is rejected');
assert.equal(validateStockMovementRecord(bundle, 'seller-A',
  { ...stockMovement, createdAt: '2026-11-28T12:00:00.000Z' }, [],
  '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_timestamp', 'future ledger movement timestamp is rejected');
assert.equal(validateStockMovementRecord(bundle, 'seller-A',
  { ...stockMovement, createdAt: '2026-11-28T10:00:00.000Z' }, [],
  '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_timestamp', 'stale new ledger movement timestamp is rejected');
assert.equal(validateStockMovementRecord(bundle, 'owner-1',
  { ...stockMovement, organizationId: 'org-2', createdBy: 'owner-1' }, [],
  '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_fields', 'ledger movement cannot cross organizations');
assert.equal(validateStockMovementRecord(bundle, 'owner-1', stockMovement,
  [{ id: 'duplicate-history', idempotencyKey: 'other-key', organizationId: 'org-1' },
   { id: 'duplicate-history', idempotencyKey: 'another-key', organizationId: 'org-1' }],
  '2026-11-28T11:01:00.000Z').reason,
  'invalid_stock_movement_history', 'corrupt duplicate movement history is rejected');

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

 
// Seller views use positive field allowlists for sales, debts and repayments.
const sellerSale = projectSellerSale({
  id: 'sale-safe', organizationId: 'org-1', storeId: 'store-A',
  product: 'Riz', quantity: 2, unitPrice: 5000, total: 10000,
  date: '2026-11-28', saleType: 'cash', method: 'cash',
  paidAmount: 10000, creditAmount: 0, createdBy: 'seller-A',
  purchasePrice: 3000, grossProfit: 4000, internalNotes: 'secret'
});
assert.deepEqual(Object.keys(sellerSale).sort(),
  ['createdBy','creditAmount','date','id','method','organizationId','paidAmount','product','quantity','saleType','storeId','total','unitPrice'].sort(),
  'seller sale projection contains only operational allowlisted fields');
assert.equal(Object.hasOwn(sellerSale, 'purchasePrice'), false,
  'seller sale projection excludes purchase cost');
assert.equal(Object.hasOwn(sellerSale, 'grossProfit'), false,
  'seller sale projection excludes gross profit');

const sellerDebt = projectSellerDebt({
  id: 'debt-safe', organizationId: 'org-1', storeId: 'store-A',
  clientId: 'client-1', saleId: 'sale-safe', amount: 10000,
  paidAmount: 2000, remaining: 8000, status: 'partial',
  supplierCost: 5000, margin: 3000
});
assert.equal(sellerDebt.remaining, 8000, 'seller can see debt balance needed for collection');
assert.equal(Object.hasOwn(sellerDebt, 'supplierCost'), false,
  'seller debt projection excludes supplier cost');
assert.equal(Object.hasOwn(sellerDebt, 'margin'), false,
  'seller debt projection excludes margin');

const sellerPayment = projectSellerPayment({
  id: 'payment-safe', organizationId: 'org-1', storeId: 'store-A',
  debtId: 'debt-safe', clientId: 'client-1', amount: 2000,
  method: 'cash', date: '2026-11-28', createdBy: 'seller-A',
  costSnapshot: 1500, netProfit: 500
});
assert.equal(sellerPayment.amount, 2000, 'seller can see received repayment amount');
assert.equal(Object.hasOwn(sellerPayment, 'costSnapshot'), false,
  'seller payment projection excludes cost snapshot');
assert.equal(Object.hasOwn(sellerPayment, 'netProfit'), false,
  'seller payment projection excludes net profit');

assert.equal(validateSellerOperationalRecord({
  id: 'sale-1', details: [{ payment: { profit_margin: 15 } }]
}).valid, false, 'seller operational records reject nested profit fields');
assert.equal(validateSellerOperationalRecord({
  id: 'sale-2', total: 10000, paidAmount: 10000, method: 'cash'
}).valid, true, 'seller operational records allow ordinary settlement fields');
assert.equal(validateSellerOperationalRecord(null).valid, false,
  'seller operational record validator rejects missing objects');


// Patron-to-seller work orders, supplier orders and store transfers remain distinct.
const { validateBusinessOrderTransition } = require('./multi-store-model');
const taskBase = {
  id: 'task-1', workflowType: 'patron_task', organizationId: 'org-1',
  storeId: 'store-A', status: 'assigned', assignedSellerUid: 'seller-A',
  createdBy: 'owner-1'
};
const taskAccept = {
  orderId: 'task-1', workflowType: 'patron_task', organizationId: 'org-1',
  storeId: 'store-A', createdBy: 'owner-1', transitionId: 'task-event-1',
  idempotencyKey: 'task-key-1', status: 'accepted', updatedBy: 'seller-A',
  updatedAt: '2026-11-28T12:00:00.000Z'
};
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskBase,
  taskAccept, [], '2026-11-28T12:01:00.000Z').valid, true,
  'assigned seller can accept patron work order');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-B', taskBase,
  { ...taskAccept, updatedBy: 'seller-B' }, [], '2026-11-28T12:01:00.000Z').valid, false,
  'seller from another store cannot accept work order');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskBase,
  { ...taskAccept, status: 'refused', reason: '' }, [], '2026-11-28T12:01:00.000Z').reason,
  'refusal_reason_required', 'seller refusal requires a reason');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskBase,
  { ...taskAccept, status: 'completed' }, [], '2026-11-28T12:01:00.000Z').valid, false,
  'seller cannot skip acceptance and complete assigned work');
const taskAccepted = { ...taskBase, status: 'accepted' };
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskAccepted,
  { ...taskAccept, status: 'completed', transitionId: 'task-event-skip',
    idempotencyKey: 'task-key-skip' }, [], '2026-11-28T12:01:00.000Z').valid,
  false, 'seller cannot skip the in-progress stage after acceptance');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskAccepted,
  { ...taskAccept, status: 'in_progress', transitionId: 'task-event-start',
    idempotencyKey: 'task-key-start' }, [], '2026-11-28T12:01:00.000Z').valid,
  true, 'assigned seller can start accepted work');
const taskInProgress = { ...taskBase, status: 'in_progress' };
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskInProgress,
  { ...taskAccept, status: 'completed', transitionId: 'task-event-done',
    idempotencyKey: 'task-key-done' }, [], '2026-11-28T12:01:00.000Z').valid,
  true, 'assigned seller can complete work after it is in progress');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', taskBase,
  taskAccept, ['task-event-1'], '2026-11-28T12:01:00.000Z').reason,
  'invalid_order_transition_fields', 'replayed transition ID is rejected');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1',
  { ...taskBase, status: 'draft' },
  { ...taskAccept, status: 'assigned', assignedSellerUid: 'seller-A',
    updatedBy: 'owner-1', transitionId: 'task-event-2', idempotencyKey: 'task-key-2' },
  [], '2026-11-28T12:01:00.000Z').valid, true,
  'owner can assign a work order to a seller assigned to the store');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1',
  { ...taskBase, status: 'draft' },
  { ...taskAccept, status: 'assigned', assignedSellerUid: 'seller-A',
    updatedBy: 'owner-1', transitionId: 'task-event-3', idempotencyKey: 'task-key-3' },
  [], '2026-11-28T12:01:00.000Z').valid, true,
  'owner can assign work to seller assigned to store A');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1',
  { ...taskBase, status: 'draft' },
  { ...taskAccept, status: 'assigned', assignedSellerUid: 'seller-B',
    updatedBy: 'owner-1', transitionId: 'task-event-4', idempotencyKey: 'task-key-4' },
  [], '2026-11-28T12:01:00.000Z').valid, false,
  'owner cannot assign a store A task to seller assigned only to store B');
const supplierOrder = {
  id: 'supplier-order-1', workflowType: 'supplier_order',
  organizationId: 'org-1', storeId: 'store-A', status: 'submitted',
  createdBy: 'owner-1'
};
const supplierAccepted = {
  orderId: 'supplier-order-1', workflowType: 'supplier_order',
  organizationId: 'org-1', storeId: 'store-A', createdBy: 'owner-1',
  transitionId: 'supplier-event-1', idempotencyKey: 'supplier-key-1',
  status: 'supplier_accepted', updatedBy: 'owner-1',
  updatedAt: '2026-11-28T12:00:00.000Z'
};
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1', supplierOrder,
  supplierAccepted, [], '2026-11-28T12:01:00.000Z').valid, true,
  'owner records supplier acceptance');
assert.equal(validateBusinessOrderTransition(bundle, 'seller-A', supplierOrder,
  { ...supplierAccepted, updatedBy: 'seller-A' }, [], '2026-11-28T12:01:00.000Z').valid, false,
  'seller cannot manage supplier purchase orders');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1', supplierOrder,
  { ...supplierAccepted, status: 'supplier_refused', reason: '' },
  [], '2026-11-28T12:01:00.000Z').reason,
  'refusal_reason_required', 'supplier refusal requires a recorded reason');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1',
  { ...supplierOrder, status: 'received' },
  { ...supplierAccepted, status: 'submitted', transitionId: 'supplier-event-2',
    idempotencyKey: 'supplier-key-2' }, [], '2026-11-28T12:01:00.000Z').valid,
  false, 'received supplier order cannot be reopened as submitted');
assert.equal(validateBusinessOrderTransition(bundle, 'owner-1', supplierOrder,
  { ...supplierAccepted, updatedAt: 'not-a-date' }, [], '2026-11-28T12:01:00.000Z').valid,
  false, 'order transition requires a valid timestamp');

console.log('PASS: 346 multi-store model, permission, provenance, seller lifecycle, seller-data, purchase-receipt, cancellation-stock, sale-return and stock-transfer assertions');
