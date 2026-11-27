'use strict';

/**
 * COMPTIVA multi-store domain prototype.
 * Pure validation/authorization helpers; not wired to Firebase or the UI.
 * Server-side Firestore rules must independently enforce the same policy.
 */

const SELLER_DEFAULT_ACTIONS = Object.freeze([
  'store:read',
  'dashboard:read',
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
  'purchases:read',
  'purchases:create',
  'expenses:read',
  'expenses:create',
  'reports:read'
]);

const OWNER_ACTIONS = Object.freeze([
  ...SELLER_DEFAULT_ACTIONS,
  'stores:manage',
  'members:manage',
  'products:manage',
  'stock:adjust',
  'sales:update',
  'sales:cancel',
  'debts:update',
  'payments:reverse',
  'purchases:update',
  'expenses:update',
  'expenses:delete',
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
  if (record.createdBy !== actorUid) {
    return { valid: false, reason: 'creator_mismatch' };
  }
  if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) {
    return { valid: false, reason: 'invalid_creation_timestamp' };
  }
  const hasUpdatedBy = record.updatedBy !== undefined;
  const hasUpdatedAt = record.updatedAt !== undefined;
  if (hasUpdatedBy !== hasUpdatedAt) {
    return { valid: false, reason: 'incomplete_update_provenance' };
  }
  if (hasUpdatedBy &&
      (!nonEmptyString(record.updatedBy) || typeof record.updatedAt !== 'string' ||
       !Number.isFinite(Date.parse(record.updatedAt)))) {
    return { valid: false, reason: 'invalid_update_provenance' };
  }
  const permission = authorizeStoreAction(bundle, actorUid, record.storeId, action);
  if (!permission.allowed) return { valid: false, reason: permission.reason };
  return { valid: true, reason: 'operation_provenance_valid' };
}

const api = {
  SELLER_DEFAULT_ACTIONS,
  OWNER_ACTIONS,
  validateOrganizationBundle,
  authorizeStoreAction,
  validateOperationRecord
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
