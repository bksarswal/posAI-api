import type { Role } from './user.interface.js';
import { AppError } from '../../utils/appError.js';

export type StaffAction =
  'CREATE' | 'UPDATE' | 'RESET_PASSWORD' | 'LIST' | 'GET_BY_ID';

export interface StaffRoleValidationContext {
  action: StaffAction;
  actorRole: Role;
  actorId?: string;
  targetId?: string;
  targetRole?: Role;
  targetBranchIds?: string[];
  newRole?: Role;
  newBranchIds?: string[];
  newStatus?: string;
}

/**
 * Pure function enforcing role-based permissions and branch invariants for staff operations.
 * Single source of truth for staff management authorization and role-transition rules.
 */
export function validateStaffRoleRules(ctx: StaffRoleValidationContext): void {
  const {
    action,
    actorRole,
    actorId,
    targetId,
    targetRole,
    targetBranchIds,
    newRole,
    newBranchIds,
    newStatus,
  } = ctx;

  // 1. Only OWNER and ADMIN can manage staff or view staff lists. All other roles -> 403.
  if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    throw new AppError(
      'You do not have permission to manage staff',
      403,
      'FORBIDDEN',
    );
  }

  // Read-only actions only require the actor role check
  if (action === 'LIST' || action === 'GET_BY_ID') {
    return;
  }

  // 2. CREATE checks
  if (action === 'CREATE') {
    if (!newRole) {
      throw new AppError('Role is required', 400, 'ROLE_REQUIRED');
    }

    // OWNER role can never be assigned or created through the API (400)
    if (newRole === 'OWNER') {
      throw new AppError(
        'Cannot create an OWNER account through staff API',
        400,
        'CANNOT_ASSIGN_OWNER',
      );
    }

    // Only OWNER can create an ADMIN
    if (newRole === 'ADMIN' && actorRole !== 'OWNER') {
      throw new AppError(
        'Only OWNER can create an ADMIN account',
        403,
        'FORBIDDEN',
      );
    }

    // ADMIN accounts are tenant-wide: branchIds must be empty
    if (newRole === 'ADMIN' && newBranchIds && newBranchIds.length > 0) {
      throw new AppError(
        'ADMIN accounts must not be assigned to branches',
        400,
        'ADMIN_BRANCH_ASSIGNMENT_FORBIDDEN',
      );
    }

    // MANAGER, WAITER, CASHIER, CHEF must have at least one branchId
    if (newRole !== 'ADMIN' && (!newBranchIds || newBranchIds.length === 0)) {
      throw new AppError(
        'Staff must be assigned to at least one branch',
        400,
        'BRANCH_REQUIRED',
      );
    }

    return;
  }

  // 3. Target must exist for UPDATE and RESET_PASSWORD
  if (!targetRole) {
    return;
  }

  // Nobody can modify an OWNER account here, not even an OWNER -> 403 CANNOT_MODIFY_OWNER
  if (targetRole === 'OWNER') {
    throw new AppError(
      'Cannot modify or reset an OWNER account',
      403,
      'CANNOT_MODIFY_OWNER',
    );
  }

  const isSelf =
    Boolean(actorId) &&
    Boolean(targetId) &&
    actorId?.toString() === targetId?.toString();

  // 4. RESET_PASSWORD checks
  if (action === 'RESET_PASSWORD') {
    // Cannot target yourself (use change-password)
    if (isSelf) {
      throw new AppError(
        'Cannot reset your own password via staff management. Use change-password instead.',
        403,
        'FORBIDDEN',
      );
    }

    // Only OWNER can reset an ADMIN
    if (targetRole === 'ADMIN' && actorRole !== 'OWNER') {
      throw new AppError(
        'Only OWNER can reset an ADMIN account password',
        403,
        'FORBIDDEN',
      );
    }

    return;
  }

  // 5. UPDATE checks
  if (action === 'UPDATE') {
    // Deactivating yourself -> 409 CANNOT_DEACTIVATE_SELF
    if (isSelf && newStatus === 'INACTIVE') {
      throw new AppError(
        'You cannot deactivate your own account',
        409,
        'CANNOT_DEACTIVATE_SELF',
      );
    }

    // Nobody can change their own role, branchIds or status here (403)
    if (isSelf) {
      if (
        newRole !== undefined ||
        newBranchIds !== undefined ||
        newStatus !== undefined
      ) {
        throw new AppError(
          'You cannot change your own role, branch assignments, or status',
          403,
          'FORBIDDEN',
        );
      }
    }

    // Only OWNER can edit, demote, deactivate an ADMIN
    if (targetRole === 'ADMIN' && actorRole !== 'OWNER') {
      throw new AppError(
        'Only OWNER can modify an ADMIN account',
        403,
        'FORBIDDEN',
      );
    }

    // Only OWNER can promote someone to ADMIN
    if (newRole === 'ADMIN' && actorRole !== 'OWNER') {
      throw new AppError(
        'Only OWNER can promote a user to ADMIN',
        403,
        'FORBIDDEN',
      );
    }

    // OWNER role can never be assigned (400)
    if (newRole === 'OWNER') {
      throw new AppError(
        'Cannot assign OWNER role',
        400,
        'CANNOT_ASSIGN_OWNER',
      );
    }

    // Re-validate the branchIds/role combination against the resulting state
    const resultingRole = newRole ?? targetRole;
    const resultingBranchIds = newBranchIds ?? targetBranchIds ?? [];

    if (resultingRole === 'ADMIN') {
      if (resultingBranchIds.length > 0) {
        throw new AppError(
          'ADMIN accounts must not be assigned to branches',
          400,
          'ADMIN_BRANCH_ASSIGNMENT_FORBIDDEN',
        );
      }
    } else {
      // MANAGER, WAITER, CASHIER, CHEF must have at least one branchId
      if (resultingBranchIds.length === 0) {
        throw new AppError(
          'Staff must be assigned to at least one branch',
          400,
          'BRANCH_REQUIRED',
        );
      }
    }
  }
}
