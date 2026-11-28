'use strict';

/**
 * COMPTIVA multi-store domain prototype.
 * Pure validation/authorization helpers; not wired to Firebase or the UI.
 * Server-side Firestore rules must independently enforce the same policy.
 */

const SELLER_DEFAULT_ACTIONS = Object.freeze([
  'store:read',
  'clients:read',
  'clients:create',
  'products:read',
  'stock:read',
  'sales:read',
  'sales:create',
  'debts:read',
  'debts:create',
  'payments:read',
  'payments:create',
  'transfers:read',
  'transfers:receive',
  // Seller defaults are deliberately limited to daily store operations.
  // Financial reporting, purchases, expenses and profit remain owner-only.
]);

const OWNER_ACTIONS = Object.freeze([
  ...SELLER_DEFAULT_ACTIONS,
  'dashboard:read',
  'reports:read',
  'purchases:read',
  'purchases:create',
  'expenses:read',
  'expenses:create',
  'expenses:update',
  'expenses:delete',
  'stores:manage',
  'members:manage',
  'products:manage',
  'stock:adjust',
  'sales:update',
  'sales:cancel',
  'sales:return',
  'debts:update',
  'payments:reverse',
  'purchases:update',
  'expenses:update',
  'audit:read',
  'transfers:create',
  'transfers:receive'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueBy(items, key) {
  const seen = new Set();
  for (const item of items) {
    const value = item && item[key];
    if (!nonEmptyString(value) || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

/**
 * Expected input:
 * {
 *   organization: { id, ownerUid, status: 'active' },
 *   stores: [{ id, organizationId, status: 'active' }],
 *   members: [{ uid, organizationId, role: 'owner'|'seller',
 *               status: 'active'|'invited'|'suspended',
 *               storeIds: string[], permissions?: string[] }]
 * }
 */
function validateOrganizationBundle(bundle) {
  const errors = [];
  if (!isRecord(bundle)) return { valid: false, errors: ['bundle_not_object'] };

  const org = bundle.organization;
  const stores = bundle.stores;
  const members = bundle.members;

  if (!isRecord(org) || !nonEmptyString(org.id) || !nonEmptyString(org.ownerUid)) {
    errors.push('invalid_organization');
  } else if (org.status !== 'active') {
    errors.push('organization_not_active');
  }

  if (!Array.isArray(stores) || !Array.isArray(members)) {
    errors.push('stores_and_members_must_be_arrays');
    return { valid: false, errors };
  }

  if (!uniqueBy(stores, 'id')) errors.push('invalid_or_duplicate_store_ids');
  if (!uniqueBy(members, 'uid')) errors.push('invalid_or_duplicate_member_uids');

  const storeIds = new Set(stores.map(s => s && s.id).filter(nonEmptyString));
  for (const store of stores) {
    if (!isRecord(store) || !nonEmptyString(store.id) ||
        !org || store.organizationId !== org.id || store.status !== 'active') {
      errors.push('invalid_or_cross_organization_store');
      break;
    }
  }

  let ownerCount = 0;
  for (const member of members) {
    if (!isRecord(member) || !nonEmptyString(member.uid) ||
        !org || member.organizationId !== org.id ||
        !['owner', 'seller'].includes(member.role) ||
        !['active', 'invited', 'suspended'].includes(member.status) ||
        !Array.isArray(member.storeIds)) {
      errors.push('invalid_member');
      break;
    }

    if (member.role === 'owner') {
      ownerCount++;
      if (member.uid !== org.ownerUid) errors.push('owner_uid_mismatch');
    } else {
      if (member.uid === org.ownerUid) errors.push('owner_cannot_be_seller');
      if (member.storeIds.length === 0) errors.push('seller_without_store_assignment');
    }

    if (new Set(member.storeIds).size !== member.storeIds.length ||
        member.storeIds.some(id => !storeIds.has(id))) {
      errors.push('invalid_member_store_assignment');
    }

    if (member.permissions !== undefined &&
        (!Array.isArray(member.permissions) ||
         member.permissions.some(p => typeof p !== 'string' || !p.trim()))) {
      errors.push('invalid_member_permissions');
    }
  }

  if (ownerCount !== 1) errors.push('exactly_one_owner_required');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * Authorization decision for a single organization/store/action.
 * The caller must obtain actorUid from the verified Firebase Auth session,
 * never from a client-supplied request body.
 */
function authorizeStoreAction(bundle, actorUid, storeId, action) {
  const validation = validateOrganizationBundle(bundle);
  if (!validation.valid) {
    return { allowed: false, reason: 'invalid_organization_model', errors: validation.errors };
  }
  if (!nonEmptyString(actorUid) || !nonEmptyString(storeId) || !nonEmptyString(action)) {
    return { allowed: false, reason: 'missing_context' };
  }

  const org = bundle.organization;
  const store = bundle.stores.find(item => item.id === storeId);
  if (!store || store.organizationId !== org.id || store.status !== 'active') {
    return { allowed: false, reason: 'store_not_in_organization' };
  }

  const member = bundle.members.find(item => item.uid === actorUid);
  if (!member || member.organizationId !== org.id || member.status !== 'active') {
    return { allowed: false, reason: 'not_an_active_member' };
  }

  if (member.role === 'owner') {
    if (member.uid !== org.ownerUid) return { allowed: false, reason: 'owner_identity_mismatch' };
    return {
      allowed: OWNER_ACTIONS.includes(action),
      reason: OWNER_ACTIONS.includes(action) ? 'owner_allowed' : 'unknown_or_forbidden_action'
    };
  }

  if (member.role !== 'seller' || !member.storeIds.includes(storeId)) {
    return { allowed: false, reason: 'store_not_assigned_to_seller' };
  }

  const granted = Array.isArray(member.permissions)
    ? member.permissions
    : SELLER_DEFAULT_ACTIONS;
  const allowed = SELLER_DEFAULT_ACTIONS.includes(action) && granted.includes(action);
  return { allowed, reason: allowed ? 'seller_allowed' : 'seller_permission_denied' };
}


/**
 * Validate mandatory provenance before a business operation is accepted.
 * This is a client-independent contract only; the trusted server must stamp
 * createdBy/createdAt and prevent clients from rewriting original provenance.
 */
function validateOperationRecord(bundle, actorUid, action, record) {
  if (!isRecord(record)) return { valid: false, reason: 'operation_not_object' };
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  const required = ['id', 'organizationId', 'storeId', 'createdBy', 'createdAt'];
  if (required.some(key => !nonEmptyString(record[key]))) {
    return { valid: false, reason: 'missing_provenance' };
  }
  if (record.organizationId !== bundle?.organization?.id) {
    return { valid: false, reason: 'organization_mismatch' };
  }
  if (!bundle.stores.some(store => store.id === record.storeId)) {
    return { valid: false, reason: 'store_mismatch' };
  }
    if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) {
    return { valid: false, reason: 'invalid_creation_timestamp' };
  }
  const hasUpdatedBy = record.updatedBy !== undefined;
  const hasUpdatedAt = record.updatedAt !== undefined;
  if (hasUpdatedBy !== hasUpdatedAt) {
    return { valid: false, reason: 'incomplete_update_provenance' };
  }
  if (typeof action === 'string' && action.endsWith(':create') && hasUpdatedBy) {
    return { valid: false, reason: 'creation_cannot_claim_update_provenance' };
  }
  if (hasUpdatedBy &&
      (!nonEmptyString(record.updatedBy) || typeof record.updatedAt !== 'string' ||
       !Number.isFinite(Date.parse(record.updatedAt)))) {
    return { valid: false, reason: 'invalid_update_provenance' };
  }
  if ((hasUpdatedBy ? record.updatedBy : record.createdBy) !== actorUid) {
    return { valid: false, reason: 'actor_provenance_mismatch' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, record.storeId, action);
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  return { valid: true, reason: 'operation_provenance_valid' };
}


/**
 * Validate an update against the persisted version. Original identity and
 * provenance fields are immutable; the caller must load previousRecord from
 * trusted storage and must not accept it from the request body.
 */
function validateOperationUpdate(bundle, actorUid, action, previousRecord, nextRecord) {
  if (typeof action !== 'string' || !action.endsWith(':update')) {
    return { valid: false, reason: 'update_action_required' };
  }
  if (!isRecord(previousRecord) || !isRecord(nextRecord)) {
    return { valid: false, reason: 'missing_persisted_or_next_record' };
  }
  const immutableFields = ['id', 'organizationId', 'storeId', 'createdBy', 'createdAt'];
  for (const field of immutableFields) {
    if (previousRecord[field] !== nextRecord[field]) {
      return { valid: false, reason: 'immutable_provenance_changed' };
    }
  }
  if (nextRecord.updatedBy !== actorUid ||
      typeof nextRecord.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(nextRecord.updatedAt))) {
    return { valid: false, reason: 'invalid_update_actor_or_timestamp' };
  }
  return validateOperationRecord(bundle, actorUid, action, nextRecord);
}


/**
 * Validate a pending seller invitation before a trusted backend persists it.
 * The backend must generate/store a one-time token hash, send the invitation,
 * and independently enforce all checks. This helper is not an invitation sender
 * or a security boundary.
 */
function validateSellerInvitation(bundle, actorUid, invitation, now = new Date().toISOString()) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(invitation)) return { valid: false, reason: 'invitation_not_object' };

  const owner = bundle.members.find(member =>
    member.uid === actorUid && member.role === 'owner' && member.status === 'active'
  );
  if (!owner || actorUid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_only' };
  }

  const email = invitation.email;
  if (typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      email !== email.trim().toLowerCase()) {
    return { valid: false, reason: 'invalid_normalized_email' };
  }
  if (invitation.organizationId !== bundle.organization.id ||
      invitation.role !== 'seller' ||
      invitation.status !== 'pending' ||
      invitation.createdBy !== actorUid ||
      !nonEmptyString(invitation.id)) {
    return { valid: false, reason: 'invalid_invitation_identity_or_state' };
  }
  if (!Array.isArray(invitation.storeIds) || invitation.storeIds.length === 0 ||
      new Set(invitation.storeIds).size !== invitation.storeIds.length ||
      invitation.storeIds.some(id => !bundle.stores.some(store =>
        store.id === id && store.status === 'active'
      ))) {
    return { valid: false, reason: 'invalid_invitation_store_assignment' };
  }
  if (invitation.permissions !== undefined &&
      (!Array.isArray(invitation.permissions) ||
       invitation.permissions.some(permission =>
         !SELLER_DEFAULT_ACTIONS.includes(permission)
       ) ||
       new Set(invitation.permissions).size !== invitation.permissions.length)) {
    return { valid: false, reason: 'invalid_or_elevated_seller_permissions' };
  }

  const nowMs = Date.parse(now);
  const createdMs = Date.parse(invitation.createdAt);
  const expiresMs = Date.parse(invitation.expiresAt);
  const maxLifetimeMs = 7 * 24 * 60 * 60 * 1000;
  if (![nowMs, createdMs, expiresMs].every(Number.isFinite) ||
      createdMs > nowMs || expiresMs <= nowMs ||
      expiresMs <= createdMs || expiresMs - createdMs > maxLifetimeMs) {
    return { valid: false, reason: 'invalid_or_expired_invitation_window' };
  }
  return { valid: true, reason: 'seller_invitation_valid' };
}


/**
 * Reject a product document that is about to be made directly readable by a
 * seller when it contains purchase-cost, margin, profit or valuation fields.
 * This is a schema guard for trusted write paths, not a Firestore security rule.
 */
function validateSellerOperationalProduct(product) {
  if (!isRecord(product)) return { valid: false, reason: 'product_not_object' };
  const forbidden = new Set([
    'purchaseprice', 'purchasecost', 'unitpurchaseprice', 'buyprice', 'buyingprice',
    'unitcost', 'costperunit', 'costprice', 'suppliercost', 'costamount',
    'cost', 'costtotal', 'totalcost', 'costsnapshot', 'averagecost', 'lastpurchaseprice', 'stockcost',
    'margin', 'profitmargin', 'grossmargin', 'netmargin', 'profit', 'profitamount', 'grossprofit', 'netprofit',
    'inventoryvalue', 'stockvalue', 'financials'
  ]);
  const found = [];
  const visited = new Set();
  function inspect(value, path) {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) {
      found.push(path || '<root>');
      return;
    }
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      const childPath = path ? path + '.' + key : key;
      if (forbidden.has(normalized)) found.push(childPath);
      else inspect(child, childPath);
    }
    visited.delete(value);
  }
  inspect(product, '');
  return found.length
    ? { valid: false, reason: 'sensitive_product_fields_present', fields: found }
    : { valid: true, reason: 'seller_product_schema_safe' };
}

/**
 * Return only fields a seller may need for routine product/stock operations.
 * Firestore rules cannot hide selected fields inside a readable document:
 * production must store sensitive cost/profit fields separately or expose a
 * server-maintained safe projection. This helper is not a data-access boundary.
 */
function projectSellerProduct(product) {
  if (!isRecord(product)) return null;
  const allowedFields = ['id', 'name', 'category', 'sku', 'quantity', 'salePrice', 'alertAt'];
  const safe = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(product, field)) safe[field] = product[field];
  }
  return safe;
}


/**
 * Validate acceptance using the authenticated identity and a backend-verified
 * one-time token hash. The caller must atomically consume the invitation and
 * create membership; this pure helper cannot prevent replay by itself.
 */
function validateSellerInvitationAcceptance(bundle, invitation, identity, suppliedTokenHash, now = new Date().toISOString()) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(invitation) || !isRecord(identity)) {
    return { valid: false, reason: 'invalid_acceptance_context' };
  }
  const nowMs = Date.parse(now);
  const createdMs = Date.parse(invitation.createdAt);
  const expiresMs = Date.parse(invitation.expiresAt);
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  if (invitation.status !== 'pending' || !Number.isFinite(nowMs) ||
      !Number.isFinite(createdMs) || !Number.isFinite(expiresMs) ||
      createdMs > nowMs || expiresMs <= nowMs || expiresMs <= createdMs ||
      expiresMs - createdMs > 7 * 24 * 60 * 60 * 1000) {
    return { valid: false, reason: 'invitation_not_pending_or_expired' };
  }
  if (!nonEmptyString(invitation.id) ||
      invitation.organizationId !== bundle.organization.id ||
      invitation.role !== 'seller' ||
      invitation.createdBy !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'invalid_invitation_identity_or_state' };
  }
  if (typeof invitation.email !== 'string' ||
      invitation.email !== invitation.email.trim().toLowerCase() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitation.email) ||
      !Array.isArray(invitation.storeIds) || invitation.storeIds.length === 0 ||
      new Set(invitation.storeIds).size !== invitation.storeIds.length ||
      invitation.storeIds.some(id => !bundle.stores.some(store =>
        store.id === id && store.status === 'active'
      ))) {
    return { valid: false, reason: 'invalid_invitation_email_or_store_assignment' };
  }
  if (invitation.permissions !== undefined &&
      (!Array.isArray(invitation.permissions) ||
       new Set(invitation.permissions).size !== invitation.permissions.length ||
       invitation.permissions.some(permission => !SELLER_DEFAULT_ACTIONS.includes(permission)))) {
    return { valid: false, reason: 'invalid_or_elevated_seller_permissions' };
  }
  if (!nonEmptyString(identity.uid) || identity.uid === bundle.organization.ownerUid ||
      bundle.members.some(member => member.uid === identity.uid)) {
    return { valid: false, reason: 'identity_already_member_or_invalid' };
  }
  if (!email || email !== invitation.email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, reason: 'authenticated_email_mismatch' };
  }
  if (!nonEmptyString(invitation.tokenHash) ||
      !nonEmptyString(suppliedTokenHash) ||
      invitation.tokenHash !== suppliedTokenHash) {
    return { valid: false, reason: 'invalid_invitation_token' };
  }
  return { valid: true, reason: 'seller_invitation_acceptance_valid' };
}

/** Only the active owner may revoke a still-pending invitation. */
function validateSellerInvitationRevocation(bundle, actorUid, invitation) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  const owner = bundle.members.find(member =>
    member.uid === actorUid && member.role === 'owner' && member.status === 'active'
  );
  if (!owner || actorUid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_only' };
  }
  if (!isRecord(invitation) || !nonEmptyString(invitation.id) ||
      invitation.organizationId !== bundle.organization.id ||
      invitation.createdBy !== bundle.organization.ownerUid ||
      invitation.role !== 'seller' || invitation.status !== 'pending') {
    return { valid: false, reason: 'invitation_not_revocable' };
  }
  return { valid: true, reason: 'seller_invitation_revocation_valid' };
}


/**
 * Validate owner-initiated suspension of an active seller. The backend must
 * persist status and audit event atomically; all requests must re-read current
 * membership so suspension takes effect immediately on subsequent requests.
 */
function validateSellerSuspension(bundle, actorUid, targetUid, reason, now = new Date().toISOString()) {
  const check = validateOrganizationBundle(bundle);
  if (!check.valid) return { valid: false, reason: 'invalid_organization_model' };
  const owner = bundle.members.find(member =>
    member.uid === actorUid && member.role === 'owner' && member.status === 'active'
  );
  if (!owner || actorUid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_only' };
  }
  const target = bundle.members.find(member => member.uid === targetUid);
  if (!target || target.organizationId !== bundle.organization.id || target.role !== 'seller') {
    return { valid: false, reason: 'seller_member_not_found' };
  }
  if (target.status !== 'active') return { valid: false, reason: 'seller_not_active' };
  if (!nonEmptyString(reason) || reason.trim().length > 500) {
    return { valid: false, reason: 'suspension_reason_required_or_too_long' };
  }
  if (!Number.isFinite(Date.parse(now))) return { valid: false, reason: 'invalid_membership_change_timestamp' };
  return {
    valid: true, reason: 'seller_suspension_valid',
    nextStatus: 'suspended', memberUid: target.uid,
    changedBy: actorUid, changedAt: now, changeReason: reason.trim()
  };
}

/** Only the active owner may reactivate a suspended seller. */
function validateSellerReactivation(bundle, actorUid, targetUid, now = new Date().toISOString()) {
  const check = validateOrganizationBundle(bundle);
  if (!check.valid) return { valid: false, reason: 'invalid_organization_model' };
  const owner = bundle.members.find(member =>
    member.uid === actorUid && member.role === 'owner' && member.status === 'active'
  );
  if (!owner || actorUid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_only' };
  }
  const target = bundle.members.find(member => member.uid === targetUid);
  if (!target || target.organizationId !== bundle.organization.id || target.role !== 'seller') {
    return { valid: false, reason: 'seller_member_not_found' };
  }
  if (target.status !== 'suspended') return { valid: false, reason: 'seller_not_suspended' };
  if (!Array.isArray(target.storeIds) || target.storeIds.length === 0 ||
      target.storeIds.some(id => !bundle.stores.some(store => store.id === id && store.status === 'active'))) {
    return { valid: false, reason: 'seller_store_assignment_invalid' };
  }
  if (!Number.isFinite(Date.parse(now))) return { valid: false, reason: 'invalid_membership_change_timestamp' };
  return {
    valid: true, reason: 'seller_reactivation_valid',
    nextStatus: 'active', memberUid: target.uid,
    changedBy: actorUid, changedAt: now
  };
}

/**
 * Change the stores assigned to an existing seller. The owner must use a
 * trusted transaction and increment a membership version so cached clients
 * cannot keep using stale assignments.
 */
function validateSellerStoreAssignment(bundle, actorUid, targetUid, nextStoreIds, now = new Date().toISOString()) {
  const check = validateOrganizationBundle(bundle);
  if (!check.valid) return { valid: false, reason: 'invalid_organization_model' };
  const owner = bundle.members.find(member =>
    member.uid === actorUid && member.role === 'owner' && member.status === 'active'
  );
  if (!owner || actorUid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_only' };
  }
  const target = bundle.members.find(member => member.uid === targetUid);
  if (!target || target.organizationId !== bundle.organization.id || target.role !== 'seller') {
    return { valid: false, reason: 'seller_member_not_found' };
  }
  if (!Array.isArray(nextStoreIds) || nextStoreIds.length === 0 ||
      nextStoreIds.some(id => !nonEmptyString(id)) ||
      new Set(nextStoreIds).size !== nextStoreIds.length ||
      nextStoreIds.some(id => !bundle.stores.some(store => store.id === id && store.status === 'active'))) {
    return { valid: false, reason: 'invalid_seller_store_assignment' };
  }
  if (!Number.isFinite(Date.parse(now))) return { valid: false, reason: 'invalid_membership_change_timestamp' };
  return {
    valid: true, reason: 'seller_store_assignment_valid',
    memberUid: target.uid, previousStoreIds: [...target.storeIds],
    nextStoreIds: [...nextStoreIds], changedBy: actorUid, changedAt: now
  };
}

/**
 * This decision is only as fresh as the membership bundle supplied to it.
 * Production must fetch the current membership from trusted storage on every
 * protected server operation (or use an equally strong revocation mechanism).
 */
function authorizeWithCurrentMembership(bundle, actorUid, storeId, action, currentMember) {
  if (!isRecord(currentMember) || currentMember.uid !== actorUid) {
    return { allowed: false, reason: 'current_membership_not_verified' };
  }
  const embedded = bundle?.members?.find(member => member.uid === actorUid);
  if (!embedded || embedded.status !== currentMember.status ||
      embedded.role !== currentMember.role ||
      embedded.organizationId !== currentMember.organizationId ||
      JSON.stringify(embedded.storeIds) !== JSON.stringify(currentMember.storeIds) ||
      JSON.stringify(embedded.permissions || []) !== JSON.stringify(currentMember.permissions || [])) {
    return { allowed: false, reason: 'stale_membership_snapshot' };
  }
  return authorizeStoreAction(bundle, actorUid, storeId, action);
}


/**
 * Validate a stock transfer creation. Production must execute the stock
 * decrement and transfer creation in one trusted database transaction.
 */
function validateStockTransferCreation(bundle, actorUid, transfer, now = new Date().toISOString(), existingMovement = null) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(transfer)) return { valid: false, reason: 'transfer_not_object' };
  const from = bundle.stores.find(store => store.id === transfer.fromStoreId);
  const to = bundle.stores.find(store => store.id === transfer.toStoreId);
  if (!from || !to || from.id === to.id ||
      from.organizationId !== bundle.organization.id ||
      to.organizationId !== bundle.organization.id) {
    return { valid: false, reason: 'invalid_transfer_stores' };
  }
  if (!nonEmptyString(transfer.id) ||
      !nonEmptyString(transfer.idempotencyKey) ||
      (existingMovement !== null && existingMovement !== undefined) ||
      transfer.organizationId !== bundle.organization.id ||
      !nonEmptyString(transfer.productId) ||
      !Number.isSafeInteger(transfer.quantity) || transfer.quantity <= 0 ||
      transfer.status !== 'in_transit' || transfer.createdBy !== actorUid) {
    return { valid: false, reason: 'invalid_transfer_fields' };
  }
  const nowMs = Date.parse(now);
  const createdMs = Date.parse(transfer.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_transfer_timestamp' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, from.id, 'transfers:create');
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  return { valid: true, reason: 'stock_transfer_creation_valid' };
}

/**
 * Prevalidate the source-stock debit when a transfer is dispatched.
 * The trusted backend must atomically re-read the transfer, current owner
 * membership, source inventory and dispatch movement, then write the debit,
 * immutable movement and transfer state in one Firestore transaction.
 */
function validateStockTransferDispatch(bundle, actorUid, transfer, sourceStock, now = new Date().toISOString(), existingMovement = null) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(transfer) || !isRecord(sourceStock)) {
    return { valid: false, reason: 'invalid_transfer_dispatch_context' };
  }
  if (existingMovement !== null && existingMovement !== undefined) {
    return { valid: false, reason: 'transfer_dispatch_already_applied' };
  }
  const sourceStore = bundle.stores.find(store => store.id === transfer.fromStoreId);
  const destinationStore = bundle.stores.find(store => store.id === transfer.toStoreId);
  if (!nonEmptyString(transfer.id) || !nonEmptyString(transfer.idempotencyKey) ||
      transfer.organizationId !== bundle.organization.id ||
      !sourceStore || !destinationStore || sourceStore.id === destinationStore.id ||
      sourceStore.organizationId !== bundle.organization.id ||
      destinationStore.organizationId !== bundle.organization.id ||
      !nonEmptyString(transfer.productId) ||
      !Number.isSafeInteger(transfer.quantity) || transfer.quantity <= 0 ||
      transfer.status !== 'in_transit' || transfer.createdBy !== actorUid ||
      sourceStock.organizationId !== transfer.organizationId ||
      sourceStock.storeId !== transfer.fromStoreId ||
      sourceStock.productId !== transfer.productId ||
      !Number.isSafeInteger(sourceStock.quantity) || sourceStock.quantity < 0) {
    return { valid: false, reason: 'invalid_transfer_dispatch_fields' };
  }
  const nowMs = Date.parse(now);
  const createdMs = Date.parse(transfer.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_transfer_dispatch_timestamp' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, transfer.fromStoreId, 'transfers:create');
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  if (sourceStock.quantity < transfer.quantity) {
    return { valid: false, reason: 'insufficient_source_stock' };
  }
  return {
    valid: true,
    reason: 'stock_transfer_dispatch_prevalidated',
    debitedQuantity: transfer.quantity,
    resultingSourceStockQuantity: sourceStock.quantity - transfer.quantity
  };
}

/**
 * Validate receipt against the persisted in-transit transfer. A trusted
 * transaction must atomically credit destination stock and mark it received.
 */
function validateStockTransferReceipt(bundle, actorUid, previousTransfer, receipt, now = new Date().toISOString(), existingReceipt = null) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(previousTransfer) || !isRecord(receipt)) {
    return { valid: false, reason: 'invalid_transfer_receipt_context' };
  }
  if (existingReceipt !== null && existingReceipt !== undefined) {
    return { valid: false, reason: 'transfer_receipt_already_applied' };
  }
  if (!nonEmptyString(previousTransfer.id) ||
      !nonEmptyString(previousTransfer.idempotencyKey) ||
      !nonEmptyString(receipt.id) || !nonEmptyString(receipt.idempotencyKey) ||
      receipt.fromStoreId !== previousTransfer.fromStoreId ||
      receipt.toStoreId !== previousTransfer.toStoreId ||
      previousTransfer.status !== 'in_transit' ||
      previousTransfer.organizationId !== bundle.organization.id ||
      receipt.transferId !== previousTransfer.id ||
      receipt.organizationId !== previousTransfer.organizationId ||
      receipt.storeId !== previousTransfer.toStoreId ||
      receipt.productId !== previousTransfer.productId ||
      receipt.quantity !== previousTransfer.quantity ||
      receipt.receivedBy !== actorUid) {
    return { valid: false, reason: 'transfer_receipt_mismatch_or_replay' };
  }
  const receivedMs = Date.parse(receipt.receivedAt);
  if (!Number.isFinite(receivedMs) ||
      receivedMs > nowMs || nowMs - receivedMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_receipt_timestamp' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, previousTransfer.toStoreId, 'transfers:receive');
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  return { valid: true, reason: 'stock_transfer_receipt_valid' };
}


/**
 * Classify store stock for the UI. The patron can run this for every store;
 * sellers may only see the assigned store projection. Threshold is per
 * product/store and must be maintained by an authorized owner.
 */
function classifyStoreStockAlert(stock) {
  if (!isRecord(stock) || !Number.isSafeInteger(stock.quantity) ||
      stock.quantity < 0 || !Number.isSafeInteger(stock.alertAt) || stock.alertAt < 0) {
    return { valid: false, level: 'unknown', label: 'Donnée de stock à vérifier' };
  }
  if (stock.quantity === 0) {
    return { valid: true, level: 'red', code: 'out_of_stock', label: 'Rupture de stock' };
  }
  if (stock.quantity <= stock.alertAt) {
    return { valid: true, level: 'red', code: 'low_stock', label: 'Stock faible' };
  }
  return { valid: true, level: 'green', code: 'sufficient_stock', label: 'Stock suffisant' };
}

/**
 * Owner-facing seller presence summary. A fresh server heartbeat indicates
 * online. Explicit sign-out indicates offline. A stale/missing heartbeat is
 * deliberately "unknown", not offline: network loss must not be misreported
 * as a deliberate logout. Presence must be written by trusted server logic.
 */
function projectOwnerSellerPresence(
  bundle, viewerUid, sellerUid, presence,
  now = new Date().toISOString(), heartbeatFreshSeconds = 120
) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  const viewer = bundle.members.find(member => member.uid === viewerUid);
  const seller = bundle.members.find(member => member.uid === sellerUid);
  if (!viewer || viewer.status !== 'active' || viewer.role !== 'owner' ||
      viewer.uid !== bundle.organization.ownerUid) {
    return { valid: false, reason: 'owner_access_required' };
  }
  if (!seller || seller.role !== 'seller' || seller.organizationId !== bundle.organization.id) {
    return { valid: false, reason: 'seller_not_found' };
  }
  if (!isRecord(presence) || presence.uid !== sellerUid ||
      presence.organizationId !== bundle.organization.id) {
    return { valid: false, reason: 'invalid_presence_record' };
  }
  const nowMs = Date.parse(now);
  const heartbeatMs = Date.parse(presence.heartbeatAt || '');
  const lastSeenMs = Date.parse(presence.lastSeenAt || '');
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(heartbeatFreshSeconds) ||
      heartbeatFreshSeconds < 1) {
    return { valid: false, reason: 'invalid_presence_clock' };
  }
  let state = 'unknown';
  if (presence.sessionState === 'signed_out') state = 'offline';
  else if (presence.sessionState === 'active' && Number.isFinite(heartbeatMs) &&
      heartbeatMs <= nowMs && nowMs - heartbeatMs <= heartbeatFreshSeconds * 1000) {
    state = 'online';
  } else if (presence.sessionState === 'active') state = 'connection_unconfirmed';
  return {
    valid: true, sellerUid, state,
    label: state === 'online' ? 'Connecté' :
      state === 'offline' ? 'Déconnecté' :
      state === 'connection_unconfirmed' ? 'Connexion non confirmée' : 'Présence inconnue',
    storeIds: [...seller.storeIds],
    lastSeenAt: Number.isFinite(lastSeenMs) && lastSeenMs <= nowMs
      ? presence.lastSeenAt : null,
    heartbeatAt: Number.isFinite(heartbeatMs) && heartbeatMs <= nowMs
      ? presence.heartbeatAt : null
  };
}


/**
 * Validate one delivery-receipt event, including partial, refused and damaged
 * quantities. Sellers may confirm only at a store assigned to them. The owner
 * can confirm at any organization store. A trusted transaction must re-read
 * transfer, receipt history and destination stock, then atomically append
 * event, credit only accepted units, update transfer status and append audit.
 */
function validateStockTransferReceiptEvent(
  bundle, actorUid, previousTransfer, receipt, priorReceipts = [],
  destinationStock = null, now = new Date().toISOString()
) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(previousTransfer) || !isRecord(receipt) || !Array.isArray(priorReceipts)) {
    return { valid: false, reason: 'invalid_transfer_receipt_context' };
  }
  const transfer = previousTransfer;
  const sourceStore = bundle.stores.find(store => store.id === transfer.fromStoreId);
  const destinationStore = bundle.stores.find(store => store.id === transfer.toStoreId);
  if (!nonEmptyString(transfer.id) || !nonEmptyString(transfer.idempotencyKey) ||
      transfer.organizationId !== bundle.organization.id ||
      !sourceStore || !destinationStore || sourceStore.id === destinationStore.id ||
      sourceStore.organizationId !== bundle.organization.id ||
      destinationStore.organizationId !== bundle.organization.id ||
      !nonEmptyString(transfer.productId) ||
      !Number.isSafeInteger(transfer.quantity) || transfer.quantity <= 0 ||
      !['in_transit', 'partially_received'].includes(transfer.status)) {
    return { valid: false, reason: 'invalid_transfer_state' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, transfer.toStoreId, 'transfers:receive');
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  if (!isRecord(destinationStock) ||
      destinationStock.organizationId !== transfer.organizationId ||
      destinationStock.storeId !== transfer.toStoreId ||
      destinationStock.productId !== transfer.productId ||
      !Number.isSafeInteger(destinationStock.quantity) || destinationStock.quantity < 0) {
    return { valid: false, reason: 'invalid_destination_stock_snapshot' };
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    return { valid: false, reason: 'invalid_receipt_timestamp' };
  }
  const seenIds = new Set();
  const seenKeys = new Set();
  let priorAccounted = 0, priorAccepted = 0, priorRefused = 0, priorDamaged = 0;
  for (const event of priorReceipts) {
    if (!isRecord(event) || event.transferId !== transfer.id ||
        event.organizationId !== transfer.organizationId ||
        event.storeId !== transfer.toStoreId ||
        event.fromStoreId !== transfer.fromStoreId ||
        event.toStoreId !== transfer.toStoreId ||
        event.productId !== transfer.productId ||
        !nonEmptyString(event.id) || !nonEmptyString(event.idempotencyKey) ||
        seenIds.has(event.id) || seenKeys.has(event.idempotencyKey) ||
        !Number.isSafeInteger(event.quantity) || event.quantity <= 0 ||
        !Number.isSafeInteger(event.acceptedQuantity) || event.acceptedQuantity < 0 ||
        !Number.isSafeInteger(event.refusedQuantity) || event.refusedQuantity < 0 ||
        !Number.isSafeInteger(event.damagedQuantity) || event.damagedQuantity < 0 ||
        event.acceptedQuantity + event.refusedQuantity + event.damagedQuantity !== event.quantity ||
        !nonEmptyString(event.receivedBy) || !Number.isFinite(Date.parse(event.receivedAt)) ||
        Date.parse(event.receivedAt) > nowMs) {
      return { valid: false, reason: 'invalid_receipt_history' };
    }
    const priorPermission = authorizeStoreAction(bundle, event.receivedBy, transfer.toStoreId, 'transfers:receive');
    if (!priorPermission.allowed) return { valid: false, reason: 'invalid_receipt_history_actor' };
    seenIds.add(event.id); seenKeys.add(event.idempotencyKey);
    priorAccounted += event.quantity;
    priorAccepted += event.acceptedQuantity;
    priorRefused += event.refusedQuantity;
    priorDamaged += event.damagedQuantity;
    if (![priorAccounted, priorAccepted, priorRefused, priorDamaged].every(Number.isSafeInteger)) {
      return { valid: false, reason: 'receipt_history_overflow' };
    }
  }
  if ((transfer.status === 'in_transit' && priorAccounted !== 0) ||
      (transfer.status === 'partially_received' && priorAccounted === 0)) {
    return { valid: false, reason: 'transfer_status_receipt_history_mismatch' };
  }
  if (!nonEmptyString(receipt.id) || !nonEmptyString(receipt.idempotencyKey) ||
      seenIds.has(receipt.id) || seenKeys.has(receipt.idempotencyKey) ||
      receipt.transferId !== transfer.id || receipt.organizationId !== transfer.organizationId ||
      receipt.storeId !== transfer.toStoreId || receipt.fromStoreId !== transfer.fromStoreId ||
      receipt.toStoreId !== transfer.toStoreId || receipt.productId !== transfer.productId ||
      !Number.isSafeInteger(receipt.quantity) || receipt.quantity <= 0 ||
      !Number.isSafeInteger(receipt.acceptedQuantity) || receipt.acceptedQuantity < 0 ||
      !Number.isSafeInteger(receipt.refusedQuantity) || receipt.refusedQuantity < 0 ||
      !Number.isSafeInteger(receipt.damagedQuantity) || receipt.damagedQuantity < 0 ||
      receipt.acceptedQuantity + receipt.refusedQuantity + receipt.damagedQuantity !== receipt.quantity ||
      receipt.receivedBy !== actorUid) {
    return { valid: false, reason: 'transfer_receipt_mismatch_or_replay' };
  }
  const receivedMs = Date.parse(receipt.receivedAt);
  if (!Number.isFinite(receivedMs) ||
      receivedMs > nowMs || nowMs - receivedMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_receipt_timestamp' };
  }
  const accounted = priorAccounted + receipt.quantity;
  const accepted = priorAccepted + receipt.acceptedQuantity;
  const refused = priorRefused + receipt.refusedQuantity;
  const damaged = priorDamaged + receipt.damagedQuantity;
  if (![accounted, accepted, refused, damaged].every(Number.isSafeInteger) ||
      accounted > transfer.quantity) {
    return { valid: false, reason: 'receipt_exceeds_transfer_quantity' };
  }
  const resultingStockQuantity = destinationStock.quantity + receipt.acceptedQuantity;
  if (!Number.isSafeInteger(resultingStockQuantity)) {
    return { valid: false, reason: 'destination_stock_overflow' };
  }
  const remainingToAccountFor = transfer.quantity - accounted;
  const resultingStatus = remainingToAccountFor > 0 ? 'partially_received' :
    (accepted === 0 && refused > 0 ? 'refused' :
      (refused > 0 || damaged > 0 ? 'received_with_issues' : 'received'));
  return {
    valid: true, reason: 'stock_transfer_receipt_event_valid',
    acceptedQuantityToAdd: receipt.acceptedQuantity,
    totalAccounted: accounted, totalAccepted: accepted,
    totalRefused: refused, totalDamaged: damaged,
    remainingToAccountFor, resultingStatus, resultingStockQuantity
  };
}

/**
 * Prepare (do not send) a reminder suggestion for a destination-store seller.
 * A trusted scheduled backend must re-check current membership and transfer
 * state, deduplicate reminders and deliver it after the due date + grace period.
 */
function buildStockTransferReminderSuggestion(
  bundle, transfer, sellerUid, now = new Date().toISOString(), graceMinutes = 60
) {
  if (!isRecord(transfer) || !Number.isSafeInteger(graceMinutes) || graceMinutes < 0) {
    return { eligible: false, reason: 'invalid_reminder_context' };
  }
  if (!['in_transit', 'partially_received'].includes(transfer.status) ||
      !nonEmptyString(transfer.expectedAt) || !Number.isFinite(Date.parse(transfer.expectedAt))) {
    return { eligible: false, reason: 'transfer_not_pending_or_missing_due_date' };
  }
  const nowMs = Date.parse(now);
  const dueMs = Date.parse(transfer.expectedAt) + graceMinutes * 60 * 1000;
  if (!Number.isFinite(nowMs) || nowMs < dueMs) {
    return { eligible: false, reason: 'reminder_not_due' };
  }
  const permission = authorizeStoreAction(bundle, sellerUid, transfer.toStoreId, 'transfers:receive');
  if (!permission.allowed || bundle.members.find(m => m.uid === sellerUid)?.role !== 'seller') {
    return { eligible: false, reason: permission.reason || 'destination_seller_required' };
  }
  return {
    eligible: true, recipientUid: sellerUid, transferId: transfer.id,
    message: 'Bonjour, la commande attend toujours votre confirmation de réception dans COMPTIVA. Merci d’indiquer si elle est bien reçue, partiellement reçue ou non reçue, avec les quantités et un motif si nécessaire.'
  };
}


/**
 * Validate a proposed sale stock decrement against a trusted stock snapshot.
 * This is only pre-validation: production MUST repeat the read, idempotency
 * check, decrement and movement creation atomically in a Firestore transaction.
 */
function validateSaleStockDecrement(bundle, actorUid, sale, stock, existingMovement, now = new Date().toISOString()) {
  if (!isRecord(sale) || !isRecord(stock)) {
    return { valid: false, reason: 'invalid_sale_stock_context' };
  }
  if (!nonEmptyString(sale.id) || !nonEmptyString(sale.productId) ||
      !Number.isSafeInteger(sale.quantity) || sale.quantity <= 0 ||
      !Number.isSafeInteger(stock.quantity) ||
      sale.organizationId !== bundle?.organization?.id ||
      stock.organizationId !== sale.organizationId ||
      stock.storeId !== sale.storeId || stock.productId !== sale.productId ||
      !Number.isFinite(stock.quantity) || stock.quantity < 0) {
    return { valid: false, reason: 'invalid_sale_or_stock_fields' };
  }
  if (!nonEmptyString(sale.idempotencyKey)) {
    return { valid: false, reason: 'missing_idempotency_key' };
  }
  if (existingMovement !== null && existingMovement !== undefined) {
    return { valid: false, reason: 'stock_operation_already_applied' };
  }
  if (stock.quantity < sale.quantity) {
    return { valid: false, reason: 'insufficient_stock' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'sales:create', sale);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  const nowMs = Date.parse(now);
  const createdMs = Date.parse(sale.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_sale_timestamp' };
  }
  return {
    valid: true,
    reason: 'sale_stock_decrement_prevalidated',
    remainingQuantity: stock.quantity - sale.quantity
  };
}


/**
 * Validate the financial split of a sale before persistence.
 * Amounts are GNF integers; this does not replace server-side validation.
 */
function validateSaleSettlement(sale) {
  if (!isRecord(sale)) return { valid: false, reason: 'sale_not_object' };
  const total = sale.total, paid = sale.paidAmount, credit = sale.creditAmount;
  if (![total, paid, credit].every(Number.isSafeInteger) ||
      total <= 0 || paid < 0 || credit < 0 || paid + credit !== total) {
    return { valid: false, reason: 'invalid_sale_settlement_totals' };
  }
  if (sale.saleType === 'credit') {
    if (paid !== 0 || credit !== total || !nonEmptyString(sale.clientId)) {
      return { valid: false, reason: 'invalid_credit_sale_settlement' };
    }
  } else if (sale.saleType === 'paid') {
    if (credit !== 0 || paid !== total) {
      return { valid: false, reason: 'invalid_paid_sale_settlement' };
    }
  } else {
    return { valid: false, reason: 'unknown_sale_type' };
  }
  if (sale.method === 'Paiement mixte') {
    if (![sale.cashPart, sale.mobilePart].every(Number.isSafeInteger) ||
        sale.cashPart < 0 || sale.mobilePart < 0 ||
        sale.cashPart + sale.mobilePart !== paid || paid <= 0) {
      return { valid: false, reason: 'invalid_mixed_payment_split' };
    }
  } else if (sale.cashPart !== undefined || sale.mobilePart !== undefined) {
    if (![sale.cashPart, sale.mobilePart].every(Number.isSafeInteger) ||
        sale.cashPart < 0 || sale.mobilePart < 0 ||
        sale.cashPart + sale.mobilePart !== paid) {
      return { valid: false, reason: 'invalid_payment_components' };
    }
  }
  return { valid: true, reason: 'sale_settlement_valid' };
}

/**
 * Pre-validate a partial debt repayment against trusted persisted debt and
 * payment history. Production must repeat this inside a transaction, reading
 * the debt and idempotency record before writing payment + updated balance.
 */
function validateDebtPayment(bundle, actorUid, debt, payment, existingPayments, existingIdempotencyRecord, now = new Date().toISOString()) {
  if (!isRecord(debt) || !isRecord(payment) || !Array.isArray(existingPayments)) {
    return { valid: false, reason: 'invalid_debt_payment_context' };
  }
  if (!nonEmptyString(debt.id) || !nonEmptyString(debt.clientId) ||
      debt.organizationId !== bundle?.organization?.id ||
      !nonEmptyString(debt.storeId) || !Number.isSafeInteger(debt.amount) ||
      debt.amount <= 0) {
    return { valid: false, reason: 'invalid_debt_record' };
  }
  if (payment.debtId !== debt.id || payment.clientId !== debt.clientId ||
      payment.organizationId !== debt.organizationId ||
      payment.storeId !== debt.storeId ||
      !Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
      !nonEmptyString(payment.idempotencyKey)) {
    return { valid: false, reason: 'invalid_payment_fields_or_reference' };
  }
  if (existingIdempotencyRecord !== null && existingIdempotencyRecord !== undefined) {
    return { valid: false, reason: 'payment_already_applied' };
  }
  const seen = new Set();
  const seenIdempotencyKeys = new Set();
  let paid = 0;
  for (const prior of existingPayments) {
    if (!isRecord(prior) || prior.debtId !== debt.id ||
        prior.clientId !== debt.clientId ||
        prior.organizationId !== debt.organizationId ||
        prior.storeId !== debt.storeId ||
        !nonEmptyString(prior.id) || seen.has(prior.id) ||
        !nonEmptyString(prior.idempotencyKey) ||
        seenIdempotencyKeys.has(prior.idempotencyKey) ||
        !Number.isSafeInteger(prior.amount) || prior.amount <= 0 ||
        !nonEmptyString(prior.createdBy) ||
        !Number.isFinite(Date.parse(prior.createdAt)) ||
        prior.reversedAt !== undefined || prior.reversalId !== undefined ||
        prior.status === 'reversed') {
      return { valid: false, reason: 'invalid_existing_payment_history' };
    }
    const priorCreatedMs = Date.parse(prior.createdAt);
    const nowForHistoryMs = Date.parse(now);
    if (!Number.isFinite(nowForHistoryMs) || priorCreatedMs > nowForHistoryMs ||
        !authorizeStoreAction(bundle, prior.createdBy, debt.storeId, 'payments:create').allowed) {
      return { valid: false, reason: 'invalid_existing_payment_history' };
    }
    seen.add(prior.id);
    seenIdempotencyKeys.add(prior.idempotencyKey);
    paid += prior.amount;
    if (!Number.isSafeInteger(paid) || paid > debt.amount) {
      return { valid: false, reason: 'existing_payments_exceed_debt' };
    }
  }
  if (seenIdempotencyKeys.has(payment.idempotencyKey)) {
    return { valid: false, reason: 'payment_already_applied' };
  }
  if (paid + payment.amount > debt.amount) {
    return { valid: false, reason: 'payment_exceeds_remaining_balance' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'payments:create', payment);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  const nowMs = Date.parse(now), createdMs = Date.parse(payment.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_payment_timestamp' };
  }
  return {
    valid: true,
    reason: 'debt_payment_prevalidated',
    paidAfter: paid + payment.amount,
    remainingAfter: debt.amount - paid - payment.amount
  };
}


/** Validate an owner-only purchase before a trusted write. */
function validatePurchaseRecord(bundle, actorUid, purchase) {
  if (!isRecord(purchase)) return { valid: false, reason: 'purchase_not_object' };
  if (!nonEmptyString(purchase.item) ||
      !Number.isSafeInteger(purchase.amount) || purchase.amount <= 0 ||
      !Number.isSafeInteger(purchase.quantity) || purchase.quantity <= 0 ||
      !nonEmptyString(purchase.method)) {
    return { valid: false, reason: 'invalid_purchase_fields' };
  }
  if (purchase.productId !== undefined && !nonEmptyString(purchase.productId)) {
    return { valid: false, reason: 'invalid_purchase_product_reference' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'purchases:create', purchase);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  return { valid: true, reason: 'purchase_record_valid' };
}

/**
 * Prevalidate a partial or final receipt of a stock-linked purchase.
 * The purchase and receipt history must be loaded from trusted storage.
 * A server transaction must re-read both, append the receipt, increment stock
 * and update received totals atomically; this helper does not write anything.
 */
function validatePurchaseStockReceipt(bundle, actorUid, purchase, receipt, priorReceipts = [], stock, now = new Date().toISOString()) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(purchase) || !isRecord(receipt) || !Array.isArray(priorReceipts) || !isRecord(stock)) {
    return { valid: false, reason: 'invalid_purchase_receipt_context' };
  }
  const purchaseCheck = validatePurchaseRecord(bundle, actorUid, purchase);
  if (!purchaseCheck.valid) return { valid: false, reason: purchaseCheck.reason };
  if (!nonEmptyString(purchase.productId)) {
    return { valid: false, reason: 'stock_linked_purchase_requires_product' };
  }
  if (!nonEmptyString(receipt.id) || !nonEmptyString(receipt.idempotencyKey) ||
      receipt.purchaseId !== purchase.id ||
      receipt.organizationId !== purchase.organizationId ||
      receipt.storeId !== purchase.storeId ||
      receipt.productId !== purchase.productId ||
      receipt.receivedBy !== actorUid ||
      !Number.isSafeInteger(receipt.quantity) || receipt.quantity <= 0) {
    return { valid: false, reason: 'invalid_purchase_receipt_fields' };
  }
  if (stock.organizationId !== purchase.organizationId ||
      stock.storeId !== purchase.storeId || stock.productId !== purchase.productId ||
      !Number.isSafeInteger(stock.quantity) || stock.quantity < 0) {
    return { valid: false, reason: 'purchase_receipt_stock_mismatch' };
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    return { valid: false, reason: 'invalid_purchase_receipt_timestamp' };
  }
  const seenIds = new Set();
  const seenKeys = new Set();
  let alreadyReceived = 0;
  for (const prior of priorReceipts) {
    if (!isRecord(prior) || prior.purchaseId !== purchase.id ||
        prior.organizationId !== purchase.organizationId ||
        prior.storeId !== purchase.storeId || prior.productId !== purchase.productId ||
        !nonEmptyString(prior.id) || !nonEmptyString(prior.idempotencyKey) ||
        !nonEmptyString(prior.receivedBy) ||
        !Number.isFinite(Date.parse(prior.receivedAt)) ||
        Date.parse(prior.receivedAt) > nowMs ||
        !Number.isSafeInteger(prior.quantity) || prior.quantity <= 0 ||
        seenIds.has(prior.id) || seenKeys.has(prior.idempotencyKey)) {
      return { valid: false, reason: 'invalid_or_duplicate_prior_purchase_receipt' };
    }
    const priorPermission = authorizeStoreAction(bundle, prior.receivedBy,
      purchase.storeId, 'purchases:create');
    if (!priorPermission.allowed) {
      return { valid: false, reason: 'invalid_prior_purchase_receipt_actor' };
    }
    seenIds.add(prior.id);
    seenKeys.add(prior.idempotencyKey);
    alreadyReceived += prior.quantity;
    if (!Number.isSafeInteger(alreadyReceived) || alreadyReceived > purchase.quantity) {
      return { valid: false, reason: 'prior_receipts_exceed_purchase_quantity' };
    }
  }
  if (seenIds.has(receipt.id) || seenKeys.has(receipt.idempotencyKey)) {
    return { valid: false, reason: 'purchase_receipt_already_applied' };
  }
  if (alreadyReceived + receipt.quantity > purchase.quantity) {
    return { valid: false, reason: 'receipt_exceeds_ordered_quantity' };
  }
  const receivedMs = Date.parse(receipt.receivedAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(receivedMs) || !Number.isFinite(nowMs) ||
      receivedMs > nowMs || nowMs - receivedMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_purchase_receipt_timestamp' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, purchase.storeId, 'purchases:create');
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  const totalReceived = alreadyReceived + receipt.quantity;
  const resultingStockQuantity = stock.quantity + receipt.quantity;
  if (!Number.isSafeInteger(totalReceived) || !Number.isSafeInteger(resultingStockQuantity)) {
    return { valid: false, reason: 'purchase_receipt_quantity_overflow' };
  }
  return {
    valid: true,
    reason: 'purchase_stock_receipt_prevalidated',
    totalReceived,
    remainingToReceive: purchase.quantity - totalReceived,
    resultingStockQuantity,
    fullyReceived: totalReceived === purchase.quantity
  };
}

/** Validate an owner-only expense before a trusted write. */
function validateExpenseRecord(bundle, actorUid, expense) {
  if (!isRecord(expense)) return { valid: false, reason: 'expense_not_object' };
  if (!nonEmptyString(expense.description) ||
      !nonEmptyString(expense.category) ||
      !Number.isSafeInteger(expense.amount) || expense.amount <= 0 ||
      !nonEmptyString(expense.method)) {
    return { valid: false, reason: 'invalid_expense_fields' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'expenses:create', expense);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  return { valid: true, reason: 'expense_record_valid' };
}

/**
 * Validate a sale cancellation request against a persisted sale. A trusted
 * transaction must atomically mark the sale cancelled and reverse stock,
 * debt and ledger entries. If repayments exist, a separate refund workflow
 * is mandatory; this validator rejects rather than silently erase them.
 */
function validateSaleCancellation(bundle, actorUid, persistedSale, cancellation, existingCancellation, linkedPayments = [], priorReturns = []) {
  if (!isRecord(persistedSale) || !isRecord(cancellation) || !Array.isArray(linkedPayments) || !Array.isArray(priorReturns)) {
    return { valid: false, reason: 'invalid_cancellation_context' };
  }
  if (existingCancellation !== null && existingCancellation !== undefined) {
    return { valid: false, reason: 'sale_already_cancelled' };
  }
  if (persistedSale.cancelledAt || persistedSale.status === 'cancelled') {
    return { valid: false, reason: 'sale_already_cancelled' };
  }
  if (linkedPayments.length > 0) {
    return { valid: false, reason: 'sale_has_repayments_requires_refund_workflow' };
  }
  if (priorReturns.length > 0) {
    return { valid: false, reason: 'sale_has_returns_requires_return_reversal_workflow' };
  }
  if (!nonEmptyString(persistedSale.id) ||
      persistedSale.organizationId !== bundle?.organization?.id ||
      !nonEmptyString(persistedSale.storeId) ||
      !Number.isSafeInteger(persistedSale.quantity) || persistedSale.quantity <= 0 ||
      !Number.isSafeInteger(persistedSale.total) || persistedSale.total <= 0) {
    return { valid: false, reason: 'invalid_persisted_sale' };
  }
  const settlement = validateSaleSettlement(persistedSale);
  if (!settlement.valid) return { valid: false, reason: 'invalid_persisted_sale_settlement' };
  if (cancellation.saleId !== persistedSale.id ||
      cancellation.organizationId !== persistedSale.organizationId ||
      cancellation.storeId !== persistedSale.storeId ||
      !nonEmptyString(cancellation.id) ||
      !nonEmptyString(cancellation.idempotencyKey) ||
      !nonEmptyString(cancellation.reason) ||
      cancellation.createdBy !== actorUid) {
    return { valid: false, reason: 'invalid_cancellation_fields' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'sales:cancel', cancellation);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  return {
    valid: true,
    reason: 'sale_cancellation_prevalidated',
    stockToRestore: (persistedSale.productId || persistedSale.stockProductId) ? persistedSale.quantity : 0,
    debtToReverse: persistedSale.saleType === 'credit' ? persistedSale.creditAmount : 0,
    cashToReverse: persistedSale.paidAmount,
    paymentMethodToReverse: persistedSale.method || null,
    cashPartToReverse: persistedSale.method === 'Paiement mixte' ? persistedSale.cashPart : null,
    mobilePartToReverse: persistedSale.method === 'Paiement mixte' ? persistedSale.mobilePart : null
  };
}


/**
 * Prevalidate the stock side of a sale cancellation. Stock is restored to the
 * store where the sale originally consumed it, not to a later transfer target.
 * The caller must load the persisted sale, cancellation and stock movement
 * from trusted storage; the backend must atomically write cancellation,
 * refund/debt reversal, stock increment and audit event.
 */
function validateSaleCancellationStock(bundle, actorUid, persistedSale, cancellation, stock, existingMovement = null, priorReturns = []) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(persistedSale) || !isRecord(cancellation) || !isRecord(stock)) {
    return { valid: false, reason: 'invalid_sale_cancellation_stock_context' };
  }
  if (!Array.isArray(priorReturns)) {
    return { valid: false, reason: 'invalid_sale_cancellation_stock_context' };
  }
  if (priorReturns.length > 0) {
    return { valid: false, reason: 'sale_has_returns_requires_return_reversal_workflow' };
  }
  if (existingMovement !== null && existingMovement !== undefined) {
    return { valid: false, reason: 'sale_cancellation_stock_already_restored' };
  }
  if (persistedSale.cancelledAt || persistedSale.status === 'cancelled') {
    return { valid: false, reason: 'sale_already_cancelled' };
  }
  const productId = persistedSale.productId || persistedSale.stockProductId;
  if (!nonEmptyString(persistedSale.id) ||
      persistedSale.organizationId !== bundle.organization.id ||
      !nonEmptyString(persistedSale.storeId) || !nonEmptyString(productId) ||
      cancellation.saleId !== persistedSale.id ||
      cancellation.organizationId !== persistedSale.organizationId ||
      cancellation.storeId !== persistedSale.storeId ||
      !nonEmptyString(cancellation.id) || !nonEmptyString(cancellation.idempotencyKey) ||
      cancellation.createdBy !== actorUid ||
      stock.organizationId !== persistedSale.organizationId ||
      stock.storeId !== persistedSale.storeId || stock.productId !== productId ||
      !Number.isSafeInteger(stock.quantity) || stock.quantity < 0 ||
      !Number.isSafeInteger(persistedSale.quantity) || persistedSale.quantity <= 0) {
    return { valid: false, reason: 'invalid_sale_cancellation_stock_fields' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'sales:cancel', cancellation);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  const resultingStockQuantity = stock.quantity + persistedSale.quantity;
  if (!Number.isSafeInteger(resultingStockQuantity)) {
    return { valid: false, reason: 'sale_cancellation_stock_overflow' };
  }
  return {
    valid: true,
    reason: 'sale_cancellation_stock_prevalidated',
    restoredToStoreId: persistedSale.storeId,
    resultingStockQuantity
  };
}

/**
 * Prevalidate a customer return against a persisted sale, prior returns and
 * stock snapshot. Returns linked to prior repayments are deliberately refused
 * until a dedicated debt/refund transaction exists. A server transaction must
 * re-read all inputs and atomically append the return and restore eligible stock.
 */
function validateSaleReturn(bundle, actorUid, persistedSale, returnRecord, priorReturns = [], linkedPayments = [], stock, now = new Date().toISOString()) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(persistedSale) || !isRecord(returnRecord) ||
      !Array.isArray(priorReturns) || !Array.isArray(linkedPayments) || !isRecord(stock)) {
    return { valid: false, reason: 'invalid_sale_return_context' };
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    return { valid: false, reason: 'invalid_sale_return_timestamp' };
  }
  if (persistedSale.cancelledAt || persistedSale.status === 'cancelled') {
    return { valid: false, reason: 'cancelled_sale_cannot_be_returned' };
  }
  if (linkedPayments.length > 0) {
    return { valid: false, reason: 'sale_has_repayments_requires_debt_refund_workflow' };
  }
  const settlement = validateSaleSettlement(persistedSale);
  if (!settlement.valid || !nonEmptyString(persistedSale.id) ||
      persistedSale.organizationId !== bundle.organization.id ||
      !nonEmptyString(persistedSale.storeId) || !nonEmptyString(persistedSale.productId) ||
      !Number.isSafeInteger(persistedSale.quantity) || persistedSale.quantity <= 0 ||
      !Number.isSafeInteger(persistedSale.unitPrice) || persistedSale.unitPrice <= 0 ||
      !Number.isSafeInteger(persistedSale.quantity * persistedSale.unitPrice) ||
      persistedSale.total > persistedSale.quantity * persistedSale.unitPrice) {
    return { valid: false, reason: 'invalid_persisted_sale_for_return' };
  }
  if (returnRecord.saleId !== persistedSale.id ||
      returnRecord.organizationId !== persistedSale.organizationId ||
      returnRecord.storeId !== persistedSale.storeId ||
      returnRecord.productId !== persistedSale.productId ||
      !nonEmptyString(returnRecord.id) || !nonEmptyString(returnRecord.idempotencyKey) ||
      !Number.isSafeInteger(returnRecord.quantity) || returnRecord.quantity <= 0 ||
      !Number.isSafeInteger(returnRecord.amount) || returnRecord.amount <= 0 ||
      !Number.isSafeInteger(returnRecord.cashRefundAmount) || returnRecord.cashRefundAmount < 0 ||
      !Number.isSafeInteger(returnRecord.creditReductionAmount) || returnRecord.creditReductionAmount < 0 ||
      returnRecord.cashRefundAmount + returnRecord.creditReductionAmount !== returnRecord.amount ||
      !Number.isSafeInteger(returnRecord.restockQuantity) || returnRecord.restockQuantity < 0 ||
      !Number.isSafeInteger(returnRecord.damagedQuantity) || returnRecord.damagedQuantity < 0 ||
      returnRecord.restockQuantity + returnRecord.damagedQuantity !== returnRecord.quantity ||
      !nonEmptyString(returnRecord.reason) || returnRecord.createdBy !== actorUid) {
    return { valid: false, reason: 'invalid_sale_return_fields' };
  }
  if (persistedSale.saleType === 'paid' &&
      (returnRecord.cashRefundAmount !== returnRecord.amount || returnRecord.creditReductionAmount !== 0)) {
    return { valid: false, reason: 'invalid_paid_sale_return_allocation' };
  }
  if (persistedSale.saleType === 'credit' &&
      (returnRecord.cashRefundAmount !== 0 || returnRecord.creditReductionAmount !== returnRecord.amount)) {
    return { valid: false, reason: 'invalid_credit_sale_return_allocation' };
  }
  if (stock.organizationId !== persistedSale.organizationId ||
      stock.storeId !== persistedSale.storeId || stock.productId !== persistedSale.productId ||
      !Number.isSafeInteger(stock.quantity) || stock.quantity < 0) {
    return { valid: false, reason: 'sale_return_stock_mismatch' };
  }
  const seenIds = new Set(), seenKeys = new Set();
  let returnedQuantity = 0, returnedAmount = 0, cashRefunded = 0, creditReduced = 0;
  for (const prior of priorReturns) {
    if (!isRecord(prior) || prior.saleId !== persistedSale.id ||
        prior.organizationId !== persistedSale.organizationId ||
        prior.storeId !== persistedSale.storeId || prior.productId !== persistedSale.productId ||
        !nonEmptyString(prior.id) || !nonEmptyString(prior.idempotencyKey) ||
        !Number.isSafeInteger(prior.quantity) || prior.quantity <= 0 ||
        !Number.isSafeInteger(prior.amount) || prior.amount <= 0 ||
        !Number.isSafeInteger(prior.cashRefundAmount) || prior.cashRefundAmount < 0 ||
        !Number.isSafeInteger(prior.creditReductionAmount) || prior.creditReductionAmount < 0 ||
        prior.cashRefundAmount + prior.creditReductionAmount !== prior.amount ||
        !Number.isSafeInteger(prior.restockQuantity) || prior.restockQuantity < 0 ||
        !Number.isSafeInteger(prior.damagedQuantity) || prior.damagedQuantity < 0 ||
        prior.restockQuantity + prior.damagedQuantity !== prior.quantity ||
        !nonEmptyString(prior.reason) || !nonEmptyString(prior.createdBy) ||
        prior.amount > prior.quantity * persistedSale.unitPrice ||
        !Number.isSafeInteger(prior.quantity * persistedSale.unitPrice) ||
        !Number.isFinite(Date.parse(prior.createdAt)) ||
        Date.parse(prior.createdAt) > nowMs ||
        !authorizeStoreAction(bundle, prior.createdBy, persistedSale.storeId, 'sales:return').allowed ||
        (persistedSale.saleType === 'paid' &&
          (prior.cashRefundAmount !== prior.amount || prior.creditReductionAmount !== 0)) ||
        (persistedSale.saleType === 'credit' &&
          (prior.cashRefundAmount !== 0 || prior.creditReductionAmount !== prior.amount)) ||
        seenIds.has(prior.id) || seenKeys.has(prior.idempotencyKey)) {
      return { valid: false, reason: 'invalid_existing_sale_return_history' };
    }
    seenIds.add(prior.id);
    seenKeys.add(prior.idempotencyKey);
    returnedQuantity += prior.quantity;
    returnedAmount += prior.amount;
    cashRefunded += prior.cashRefundAmount;
    creditReduced += prior.creditReductionAmount;
    if (![returnedQuantity, returnedAmount, cashRefunded, creditReduced].every(Number.isSafeInteger)) {
      return { valid: false, reason: 'sale_return_history_overflow' };
    }
  }
  if (seenIds.has(returnRecord.id) || seenKeys.has(returnRecord.idempotencyKey)) {
    return { valid: false, reason: 'sale_return_already_applied' };
  }
  if (returnedQuantity > persistedSale.quantity || returnedAmount > persistedSale.total ||
      returnedAmount > returnedQuantity * persistedSale.unitPrice ||
      cashRefunded > persistedSale.paidAmount || creditReduced > persistedSale.creditAmount) {
    return { valid: false, reason: 'invalid_existing_sale_return_totals' };
  }
  if (returnedQuantity + returnRecord.quantity > persistedSale.quantity) {
    return { valid: false, reason: 'return_exceeds_sold_quantity' };
  }
  if (returnRecord.amount > returnRecord.quantity * persistedSale.unitPrice ||
      !Number.isSafeInteger(returnRecord.quantity * persistedSale.unitPrice) ||
      returnedAmount + returnRecord.amount > persistedSale.total ||
      returnedAmount + returnRecord.amount >
        (returnedQuantity + returnRecord.quantity) * persistedSale.unitPrice ||
      cashRefunded + returnRecord.cashRefundAmount > persistedSale.paidAmount ||
      creditReduced + returnRecord.creditReductionAmount > persistedSale.creditAmount) {
    return { valid: false, reason: 'return_exceeds_unreturned_sale_value' };
  }
  const resultingStockQuantity = stock.quantity + returnRecord.restockQuantity;
  if (!Number.isSafeInteger(resultingStockQuantity)) {
    return { valid: false, reason: 'sale_return_stock_overflow' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'sales:return', returnRecord);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  const createdMs = Date.parse(returnRecord.createdAt);
  if (!Number.isFinite(createdMs) || createdMs > nowMs ||
      nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_sale_return_timestamp' };
  }
  return {
    valid: true,
    reason: 'sale_return_prevalidated',
    returnedQuantityAfter: returnedQuantity + returnRecord.quantity,
    remainingReturnableQuantity: persistedSale.quantity - returnedQuantity - returnRecord.quantity,
    refundedAfter: cashRefunded + returnRecord.cashRefundAmount,
    creditReducedAfter: creditReduced + returnRecord.creditReductionAmount,
    resultingStockQuantity,
    fullyReturned: returnedQuantity + returnRecord.quantity === persistedSale.quantity
  };
}

/**
 * Link a customer return to exactly the stock movement it is allowed to create.
 * A fully damaged return has no stock movement; a resellable quantity requires
 * one positive movement whose operationId is the immutable return ID.
 */
function validateSaleReturnMovementLink(returnRecord, movement) {
  if (!isRecord(returnRecord) ||
      !nonEmptyString(returnRecord.id) ||
      !nonEmptyString(returnRecord.organizationId) ||
      !nonEmptyString(returnRecord.storeId) ||
      !nonEmptyString(returnRecord.productId) ||
      !Number.isSafeInteger(returnRecord.restockQuantity) ||
      returnRecord.restockQuantity < 0) {
    return { valid: false, reason: 'invalid_sale_return_movement_context' };
  }
  if (returnRecord.restockQuantity === 0) {
    return movement == null
      ? { valid: true, reason: 'no_stock_movement_required' }
      : { valid: false, reason: 'unexpected_sale_return_stock_movement' };
  }
  if (!isRecord(movement) ||
      !nonEmptyString(movement.id) ||
      !nonEmptyString(movement.idempotencyKey) ||
      movement.movementType !== 'sale_return' ||
      movement.operationId !== returnRecord.id ||
      movement.organizationId !== returnRecord.organizationId ||
      movement.storeId !== returnRecord.storeId ||
      movement.productId !== returnRecord.productId ||
      movement.createdBy !== returnRecord.createdBy ||
      movement.quantityDelta !== returnRecord.restockQuantity) {
    return { valid: false, reason: 'sale_return_stock_movement_mismatch' };
  }
  return { valid: true, reason: 'sale_return_stock_movement_linked' };
}


/**
 * Audit events are append-only evidence. The trusted backend must stamp
 * actorUid/server timestamp, derive action from the authorized operation,
 * and deny client update/delete. This helper validates the event envelope.
 */
function validateAuditEvent(bundle, actorUid, event, now = new Date().toISOString()) {
  if (!isRecord(event)) return { valid: false, reason: 'audit_event_not_object' };
  const allowedActions = new Set([
    'sale.created', 'sale.updated', 'sale.cancelled', 'sale.returned',
    'purchase.created', 'expense.created',
    'stock.adjusted', 'stock.transfer.created', 'stock.transfer.received',
    'debt.created', 'payment.created', 'payment.reversed',
    'product.created', 'product.updated',
    'member.invited', 'member.suspended', 'member.reactivated'
  ]);
  if (!allowedActions.has(event.action) ||
      !nonEmptyString(event.id) ||
      event.organizationId !== bundle?.organization?.id ||
      !nonEmptyString(event.storeId) ||
      !nonEmptyString(event.targetId) ||
      !nonEmptyString(event.targetType) ||
      event.actorUid !== actorUid ||
      !nonEmptyString(event.operationId)) {
    return { valid: false, reason: 'invalid_audit_event_fields' };
  }
  const createdMs = Date.parse(event.createdAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_audit_event_timestamp' };
  }
  const permissionAction = event.action.startsWith('purchase.')
    ? 'purchases:read'
    : event.action.startsWith('expense.')
      ? 'expenses:read'
      : event.action.startsWith('stock.adjusted')
        ? 'stock:adjust'
        : event.action.startsWith('sale.cancelled')
          ? 'sales:cancel'
          : event.action.startsWith('sale.updated')
            ? 'sales:update'
            : event.action.startsWith('product.')
              ? 'products:manage'
              : event.action.startsWith('member.')
                ? 'members:manage'
                : event.action.startsWith('stock.transfer')
                  ? (event.action.endsWith('received') ? 'transfers:receive' : 'transfers:create')
                  : event.action.startsWith('payment.reversed')
                    ? 'payments:reverse'
                    : event.action.startsWith('payment.')
                      ? 'payments:create'
                      : event.action.startsWith('debt.')
                        ? 'debts:create'
                        : 'sales:create';
  const permission = authorizeStoreAction(bundle, actorUid, event.storeId, permissionAction);
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  return { valid: true, reason: 'audit_event_valid' };
}

/**
 * Validate one immutable stock-ledger movement and its organization-wide
 * idempotency uniqueness against the trusted movement history supplied by the
 * caller. The backend must query that history and atomically append this event
 * with the corresponding inventory mutation.
 */
function validateStockMovementRecord(bundle, actorUid, movement, priorMovements = [], now = new Date().toISOString()) {
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  if (!isRecord(movement) || !Array.isArray(priorMovements)) {
    return { valid: false, reason: 'invalid_stock_movement_context' };
  }
  const actionByType = {
    sale_decrement: { action: 'sales:create', sign: -1 },
    sale_return: { action: 'sales:return', sign: 1 },
    sale_cancellation: { action: 'sales:cancel', sign: 1 },
    stock_adjustment: { action: 'stock:adjust', sign: 0 },
    transfer_dispatch: { action: 'transfers:create', sign: -1 },
    transfer_receipt: { action: 'transfers:receive', sign: 1 },
    purchase_receipt: { action: 'purchases:create', sign: 1 }
  };
  const definition = actionByType[movement.movementType];
  if (!definition || !nonEmptyString(movement.id) ||
      !nonEmptyString(movement.idempotencyKey) ||
      !nonEmptyString(movement.operationId) ||
      movement.organizationId !== bundle.organization.id ||
      !nonEmptyString(movement.storeId) || !nonEmptyString(movement.productId) ||
      !Number.isSafeInteger(movement.quantityDelta) || movement.quantityDelta === 0 ||
      (definition.sign !== 0 && Math.sign(movement.quantityDelta) !== definition.sign) ||
      !nonEmptyString(movement.createdBy) || movement.createdBy !== actorUid ||
      typeof movement.createdAt !== 'string' || !Number.isFinite(Date.parse(movement.createdAt))) {
    return { valid: false, reason: 'invalid_stock_movement_fields' };
  }
  const seenIds = new Set(), seenKeys = new Set();
  for (const prior of priorMovements) {
    if (!isRecord(prior) || !nonEmptyString(prior.id) ||
        !nonEmptyString(prior.idempotencyKey) ||
        prior.organizationId !== movement.organizationId ||
        seenIds.has(prior.id) || seenKeys.has(prior.idempotencyKey)) {
      return { valid: false, reason: 'invalid_stock_movement_history' };
    }
    seenIds.add(prior.id);
    seenKeys.add(prior.idempotencyKey);
  }
  if (seenIds.has(movement.id) || seenKeys.has(movement.idempotencyKey)) {
    return { valid: false, reason: 'stock_movement_replay' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, movement.storeId, definition.action);
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  const nowMs = Date.parse(now), createdMs = Date.parse(movement.createdAt);
  if (!Number.isFinite(nowMs) || createdMs > nowMs ||
      nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_stock_movement_timestamp' };
  }
  return { valid: true, reason: 'stock_movement_valid' };
}


/** Stock corrections require an owner, a reason and a replay-safe movement ID. */
function validateStockAdjustment(bundle, actorUid, adjustment, stock, existingMovement = null, now = new Date().toISOString()) {
  if (!isRecord(adjustment) || !isRecord(stock)) {
    return { valid: false, reason: 'invalid_stock_adjustment_context' };
  }
  if (existingMovement !== null && existingMovement !== undefined) {
    return { valid: false, reason: 'stock_adjustment_already_applied' };
  }
  if (!nonEmptyString(adjustment.id) ||
      !nonEmptyString(adjustment.idempotencyKey) ||
      adjustment.organizationId !== bundle?.organization?.id ||
      adjustment.storeId !== stock.storeId ||
      adjustment.productId !== stock.productId ||
      stock.organizationId !== adjustment.organizationId ||
      !Number.isSafeInteger(adjustment.delta) || adjustment.delta === 0 ||
      !Number.isSafeInteger(stock.quantity) || stock.quantity < 0 ||
      !Number.isSafeInteger(stock.quantity + adjustment.delta) ||
      stock.quantity + adjustment.delta < 0 ||
      !nonEmptyString(adjustment.reason) ||
      adjustment.createdBy !== actorUid) {
    return { valid: false, reason: 'invalid_stock_adjustment_fields' };
  }
  const provenance = validateOperationRecord(bundle, actorUid, 'stock:adjust', adjustment);
  if (!provenance.valid) return { valid: false, reason: provenance.reason };
  const nowMs = Date.parse(now);
  const createdMs = Date.parse(adjustment.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) ||
      createdMs > nowMs || nowMs - createdMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_stock_adjustment_timestamp' };
  }
  return {
    valid: true,
    reason: 'stock_adjustment_valid',
    resultingQuantity: stock.quantity + adjustment.delta
  };
}


/**
 * Validate a seller-readable operational record. Financial cost/profit fields
 * are forbidden at every nesting level; this is a schema guard, not access control.
 */
function validateSellerOperationalRecord(record) {
  if (!isRecord(record)) return { valid: false, reason: 'record_not_object' };
  const forbidden = new Set([
    'purchaseprice', 'purchasecost', 'unitpurchaseprice', 'buyprice', 'buyingprice',
    'unitcost', 'costperunit', 'costprice', 'suppliercost', 'costamount',
    'cost', 'costtotal', 'totalcost', 'costsnapshot', 'averagecost', 'lastpurchaseprice', 'stockcost',
    'margin', 'profitmargin', 'grossmargin', 'netmargin', 'profit', 'profitamount',
    'grossprofit', 'netprofit', 'inventoryvalue', 'stockvalue', 'financials'
  ]);
  const found = [];
  const visited = new Set();
  function inspect(value, path) {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) { found.push(path || '<root>'); return; }
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      const childPath = path ? path + '.' + key : key;
      if (forbidden.has(normalized)) found.push(childPath);
      else inspect(child, childPath);
    }
    visited.delete(value);
  }
  inspect(record, '');
  return found.length
    ? { valid: false, reason: 'sensitive_financial_fields_present', fields: found }
    : { valid: true, reason: 'seller_record_schema_safe' };
}

function projectSellerRecord(record, allowedFields) {
  if (!isRecord(record)) return null;
  const safe = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) safe[field] = record[field];
  }
  return safe;
}

// Sales, debts and repayments expose only fields required for store operations.
// Profit, cost, supplier and internal financial-analysis fields are never projected.
function projectSellerSale(sale) {
  return projectSellerRecord(sale, [
    'id', 'organizationId', 'storeId', 'product', 'productId', 'quantity',
    'unitPrice', 'total', 'date', 'saleType', 'clientId', 'method',
    'paidAmount', 'creditAmount', 'cashPart', 'mobilePart', 'createdBy', 'createdAt'
  ]);
}

function projectSellerDebt(debt) {
  return projectSellerRecord(debt, [
    'id', 'organizationId', 'storeId', 'clientId', 'saleId', 'amount',
    'total', 'paidAmount', 'remaining', 'status', 'date', 'createdBy', 'createdAt'
  ]);
}

function projectSellerPayment(payment) {
  return projectSellerRecord(payment, [
    'id', 'organizationId', 'storeId', 'debtId', 'clientId', 'amount',
    'method', 'date', 'createdBy', 'createdAt', 'idempotencyKey'
  ]);
}

/**
 * Validate a single transition for patron-to-seller work orders or supplier orders.
 * This deliberately does not handle inter-store transfers, which have their own
 * stock-aware lifecycle. The trusted backend must load the persisted previous
 * state, re-check current membership, and commit transition + audit event atomically.
 */
function validateBusinessOrderTransition(bundle, actorUid, previous, next,
  existingTransitionIds = [], now = new Date().toISOString()) {
  if (!isRecord(previous) || !isRecord(next) || !Array.isArray(existingTransitionIds)) {
    return { valid: false, reason: 'invalid_order_transition_context' };
  }
  const modelCheck = validateOrganizationBundle(bundle);
  if (!modelCheck.valid) return { valid: false, reason: 'invalid_organization_model' };
  const type = previous.workflowType;
  if (!['patron_task', 'supplier_order'].includes(type) ||
      next.workflowType !== type ||
      !nonEmptyString(previous.id) || next.orderId !== previous.id ||
      previous.organizationId !== bundle.organization.id ||
      next.organizationId !== previous.organizationId ||
      !nonEmptyString(previous.storeId) || next.storeId !== previous.storeId ||
      !bundle.stores.some(s => s.id === previous.storeId) ||
      !nonEmptyString(previous.createdBy) || next.createdBy !== previous.createdBy ||
      !nonEmptyString(next.transitionId) || !nonEmptyString(next.idempotencyKey) ||
      existingTransitionIds.includes(next.transitionId) ||
      existingTransitionIds.includes(next.idempotencyKey) ||
      !nonEmptyString(next.updatedBy) || next.updatedBy !== actorUid ||
      !nonEmptyString(next.updatedAt) || !Number.isFinite(Date.parse(next.updatedAt))) {
    return { valid: false, reason: 'invalid_order_transition_fields' };
  }
  const nowMs = Date.parse(now), updatedMs = Date.parse(next.updatedAt);
  if (!Number.isFinite(nowMs) || updatedMs > nowMs || nowMs - updatedMs > 5 * 60 * 1000) {
    return { valid: false, reason: 'invalid_order_transition_timestamp' };
  }
  const actor = bundle.members.find(m => m.uid === actorUid && m.status === 'active');
  if (!actor) return { valid: false, reason: 'not_an_active_member' };
  const owner = actor.role === 'owner' && actorUid === bundle.organization.ownerUid;
  const assignedSeller = actor.role === 'seller' &&
    actor.storeIds.includes(previous.storeId) &&
    previous.assignedSellerUid === actorUid;
  const from = previous.status, to = next.status;
  const mayReassign = type === 'patron_task' && owner && to === 'assigned' &&
    ['draft', 'refused'].includes(from);
  if (!mayReassign && next.assignedSellerUid !== previous.assignedSellerUid) {
    return { valid: false, reason: 'assigned_seller_is_immutable_for_transition' };
  }
  let allowed = false;
  if (type === 'patron_task') {
    allowed = (owner && from === 'draft' && to === 'assigned') ||
      (assignedSeller && from === 'assigned' && ['accepted', 'refused'].includes(to)) ||
      (assignedSeller && from === 'accepted' && to === 'in_progress') ||
      (assignedSeller && from === 'in_progress' && to === 'completed') ||
      (owner && from === 'refused' && to === 'assigned') ||
      (owner && !['completed', 'cancelled'].includes(from) && to === 'cancelled');
    if (owner && to === 'assigned') {
      const target = bundle.members.find(m => m.uid === next.assignedSellerUid &&
        m.role === 'seller' && m.status === 'active' && m.storeIds.includes(previous.storeId));
      if (!target) allowed = false;
    }
  } else {
    allowed = owner &&
      ((from === 'draft' && to === 'submitted') ||
       (from === 'submitted' && ['supplier_accepted', 'supplier_refused'].includes(to)) ||
       (from === 'supplier_refused' && to === 'submitted') ||
       (from === 'supplier_accepted' && ['partially_received', 'received'].includes(to)) ||
       (from === 'partially_received' && ['partially_received', 'received'].includes(to)));
  }
  if (!allowed) return { valid: false, reason: 'order_transition_not_allowed' };
  if ((to === 'refused' || to === 'supplier_refused') &&
      (!nonEmptyString(next.reason) || next.reason.trim().length < 3)) {
    return { valid: false, reason: 'refusal_reason_required' };
  }
  if (type === 'patron_task' && to === 'accepted' &&
      (!nonEmptyString(previous.assignedSellerUid) || previous.assignedSellerUid !== actorUid)) {
    return { valid: false, reason: 'only_assigned_seller_can_accept' };
  }
  return { valid: true, reason: 'order_transition_valid', workflowType: type,
    fromStatus: from, toStatus: to };
}

const api = {
  SELLER_DEFAULT_ACTIONS,
  OWNER_ACTIONS,
  validateOrganizationBundle,
  authorizeStoreAction,
  validateOperationRecord,
  validateOperationUpdate,
  validateSellerInvitation,
  validateSellerInvitationAcceptance,
  validateSellerInvitationRevocation,
  validateSellerSuspension,
  validateSellerReactivation,
  validateSellerStoreAssignment,
  authorizeWithCurrentMembership,
  validateStockTransferCreation,
  validateStockTransferDispatch,
  validateStockTransferReceipt,
  validateStockTransferReceiptEvent,
  buildStockTransferReminderSuggestion,
  validateSaleStockDecrement,
  validateSaleSettlement,
  validateDebtPayment,
  validatePurchaseRecord,
  validatePurchaseStockReceipt,
  validateExpenseRecord,
  validateSaleCancellation,
  validateSaleCancellationStock,
  validateSaleReturn,
  validateSaleReturnMovementLink,
  validateAuditEvent,
  validateStockMovementRecord,
  validateStockAdjustment,
  validateBusinessOrderTransition,
  classifyStoreStockAlert,
  projectOwnerSellerPresence,
  projectSellerProduct,
  validateSellerOperationalProduct,
  validateSellerOperationalRecord,
  projectSellerSale,
  projectSellerDebt,
  projectSellerPayment
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
