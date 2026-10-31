import type { Types } from 'mongoose';
import type { Role } from '../user/index.js';

export interface UserBranchAccessContext {
  role: Role;
  branchIds?: Array<string | Types.ObjectId>;
}

/**
 * Checks whether a user has permission to access a specific branch.
 * - OWNER and ADMIN can access every branch of the tenant.
 * - Every other role can access ONLY the branches listed in user.branchIds.
 * - Empty branchIds means NO branches for non-owner/admin roles.
 */
export function canUserAccessBranch(
  user: UserBranchAccessContext,
  branchId: string | Types.ObjectId,
): boolean {
  if (user.role === 'OWNER' || user.role === 'ADMIN') {
    return true;
  }

  if (!user.branchIds || user.branchIds.length === 0) {
    return false;
  }

  const branchIdStr = branchId.toString();
  return user.branchIds.some((id) => id.toString() === branchIdStr);
}

/**
 * Filters a list of branches to only those accessible by the user.
 * - OWNER and ADMIN can access every branch of the tenant.
 * - Other roles can access only branches whose _id is listed in user.branchIds.
 * - Empty branchIds for non-owner/admin returns an empty array [].
 */
export function filterAccessibleBranches<
  T extends { _id: Types.ObjectId | string },
>(user: UserBranchAccessContext, branches: T[]): T[] {
  if (user.role === 'OWNER' || user.role === 'ADMIN') {
    return branches;
  }

  if (!user.branchIds || user.branchIds.length === 0) {
    return [];
  }

  const allowedSet = new Set(user.branchIds.map((id) => id.toString()));
  return branches.filter((branch) => allowedSet.has(branch._id.toString()));
}
