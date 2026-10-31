import type { ClientSession, Types } from 'mongoose';
import { User } from './user.model.js';
import type { UserDocument, UserRole } from './user.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';
import { TenantService } from '../tenant/index.js';
import { RestaurantService, formatRestaurant } from '../restaurant/index.js';
import {
  BranchService,
  filterAccessibleBranches,
  formatBranch,
} from '../branch/index.js';
import type { GetMeResponseData } from './user.types.js';
import { AppError } from '../../utils/appError.js';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  phone?: string;
  emailVerified?: boolean;
}

/**
 * Global cross-tenant user lookup by email for authentication and signup pre-checks.
 * Legitimate cross-tenant query explicitly wrapped in withGlobalScope.
 */
export async function findUserByEmailGlobal(
  email: string,
): Promise<UserDocument | null> {
  return withGlobalScope(async () => {
    return User.findOne({ email: email.toLowerCase().trim() });
  });
}

/**
 * Global cross-tenant user lookup by email for login, explicitly selecting +passwordHash.
 * Legitimate cross-tenant query explicitly wrapped in withGlobalScope.
 */
export async function findUserByEmailForLogin(
  email: string,
): Promise<UserDocument | null> {
  return withGlobalScope(async () => {
    return User.findOne({ email: email.toLowerCase().trim() }).select(
      '+passwordHash',
    );
  });
}

/**
 * Finds a user by ID within the active tenant execution context.
 */
export async function findUserById(id: string): Promise<UserDocument | null> {
  return User.findById(id);
}

/**
 * Finds a user by ID within the active tenant execution context, explicitly selecting +passwordHash.
 */
export async function findUserByIdWithPassword(
  id: string,
): Promise<UserDocument | null> {
  return User.findById(id).select('+passwordHash');
}

/**
 * Updates a user's password, sets passwordChangedAt, and resets mustChangePassword within active tenant context.
 */
export async function updatePassword(
  userId: string,
  newPasswordHash: string,
): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    },
  );
}

/**
 * Marks a user's email as verified within active tenant context.
 */
export async function markEmailVerified(
  userId: string | Types.ObjectId,
  options?: { session?: ClientSession },
): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    },
    options,
  );
}

/**
 * Resets a user's password, sets passwordChangedAt = now, mustChangePassword = false,
 * and marks emailVerified = true (mailbox ownership proved by token possession).
 */
export async function resetPassword(
  userId: string | Types.ObjectId,
  newPasswordHash: string,
  options?: { session?: ClientSession },
): Promise<void> {
  const now = new Date();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash: newPasswordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        emailVerified: true,
        emailVerifiedAt: now,
      },
    },
    options,
  );
}

/**
 * Updates the lastLoginAt timestamp for a user within the active tenant execution context.
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });
}

/**
 * Creates a user within the active tenant execution context.
 */
export async function createUser(
  input: CreateUserInput,
  options?: { session?: ClientSession },
): Promise<UserDocument> {
  const [user] = await User.create([input], options);
  if (!user) {
    throw new Error('Failed to create User');
  }
  return user;
}

/**
 * Composes the onboarding state for the currently authenticated user:
 * - User profile
 * - Tenant details
 * - Tenant restaurant profile (or null if none exists)
 * - Accessible branches (filtered by user role and branchIds)
 * Never imports other modules' models; composes strictly through their index.ts service/helpers.
 */
export async function getMe(userId: string): Promise<GetMeResponseData> {
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const tenant = await TenantService.findTenantById(user.tenantId.toString());
  if (!tenant) {
    throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  }

  const restaurantDoc = await RestaurantService.getRestaurant();
  const restaurant = restaurantDoc ? formatRestaurant(restaurantDoc) : null;

  const allBranches = await BranchService.getBranches();
  const accessibleBranches = filterAccessibleBranches(
    { role: user.role, branchIds: user.branchIds },
    allBranches,
  );
  const branches = accessibleBranches.map(formatBranch);

  return {
    user: {
      id: user._id.toString(),
      tenantId: user.tenantId.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      branchIds: (user.branchIds ?? []).map((id) => id.toString()),
      emailVerified: user.emailVerified,
      mustChangePassword: user.mustChangePassword,
    },
    tenant: {
      id: tenant._id.toString(),
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
    },
    restaurant,
    branches,
  };
}
