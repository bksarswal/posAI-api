import type { ClientSession, Types } from 'mongoose';
import { User } from './user.model.js';
import type { UserDocument, UserRole, Role } from './user.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';
import { TenantService } from '../tenant/index.js';
import { RestaurantService, formatRestaurant } from '../restaurant/index.js';
import {
  BranchService,
  filterAccessibleBranches,
  formatBranch,
} from '../branch/index.js';
import type {
  GetMeResponseData,
  UserResponseDto,
  PaginatedUsersData,
} from './user.types.js';
import type {
  CreateStaffInput,
  UpdateStaffInput,
  UpdateMeInput,
  ListUsersQuery,
} from './user.validation.js';
import { validateStaffRoleRules } from './user.roles.js';
import {
  generateTemporaryPassword,
  hashPassword,
} from '../../utils/password.js';
import { auditLog } from '../../utils/audit.js';
import { AppError } from '../../utils/appError.js';

export function formatUser(user: UserDocument): UserResponseDto {
  return {
    id: user._id.toString(),
    tenantId: user.tenantId.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    branchIds: (user.branchIds || []).map((id) => id.toString()),
    status: user.status,
    emailVerified: user.emailVerified,
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

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

export interface ActorContext {
  actorId: string;
  actorRole: Role;
}

/**
 * Creates a staff user within the active tenant execution context:
 * - Enforces role authorization rules (OWNER and ADMIN only, OWNER creation forbidden).
 * - Enforces branch invariants (ADMIN has no branches, others must have active branches).
 * - Generates temporary password.
 * - Global email uniqueness check and conflict handling (409).
 * - Emits audit log line (never containing temporary password).
 */
export async function createStaffUser(
  input: CreateStaffInput,
  actor: ActorContext,
): Promise<{ user: UserDocument; temporaryPassword: string }> {
  validateStaffRoleRules({
    action: 'CREATE',
    actorRole: actor.actorRole,
    actorId: actor.actorId,
    newRole: input.role,
    newBranchIds: input.branchIds,
  });

  if (input.role !== 'ADMIN') {
    await BranchService.assertBranchesActiveInTenant(input.branchIds);
  }

  const normalizedEmail = input.email.toLowerCase().trim();
  const existing = await findUserByEmailGlobal(normalizedEmail);
  if (existing) {
    throw new AppError(
      'Email is already registered',
      409,
      'EMAIL_ALREADY_REGISTERED',
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const [user] = await User.create([
      {
        name: input.name,
        email: normalizedEmail,
        phone: input.phone,
        passwordHash,
        role: input.role,
        branchIds: input.role === 'ADMIN' ? [] : input.branchIds,
        status: 'ACTIVE',
        emailVerified: true,
        mustChangePassword: true,
      },
    ]);

    if (!user) {
      throw new Error('Failed to create staff user');
    }

    auditLog({
      action: 'STAFF_USER_CREATED',
      actorId: actor.actorId,
      tenantId: user.tenantId,
      targetId: user._id,
      details: { role: user.role, email: user.email },
    });

    return { user, temporaryPassword };
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === 11000
    ) {
      throw new AppError(
        'Email is already registered',
        409,
        'EMAIL_ALREADY_REGISTERED',
      );
    }
    throw err;
  }
}

/**
 * Lists staff users in the active tenant context with filtering and pagination.
 */
export async function listUsers(
  query: ListUsersQuery,
  actor: ActorContext,
): Promise<PaginatedUsersData> {
  validateStaffRoleRules({
    action: 'LIST',
    actorRole: actor.actorRole,
    actorId: actor.actorId,
  });

  const filter: Record<string, unknown> = {};

  if (query.role) {
    filter['role'] = query.role;
  }

  if (query.status) {
    filter['status'] = query.status;
  }

  if (query.branchId) {
    filter['branchIds'] = query.branchId;
  }

  if (query.q) {
    const safeQ = query.q
      .trim()
      .slice(0, 50)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['$or'] = [
      { name: { $regex: safeQ, $options: 'i' } },
      { email: { $regex: safeQ, $options: 'i' } },
    ];
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return {
    items: users.map(formatUser),
    page,
    limit,
    total,
  };
}

/**
 * Gets a staff user by ID within the active tenant context.
 */
export async function getStaffUserById(
  id: string,
  actor: ActorContext,
): Promise<UserDocument> {
  validateStaffRoleRules({
    action: 'GET_BY_ID',
    actorRole: actor.actorRole,
    actorId: actor.actorId,
  });

  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return user;
}

/**
 * Updates a staff user within the active tenant context.
 */
export async function updateStaffUser(
  id: string,
  input: UpdateStaffInput,
  actor: ActorContext,
): Promise<UserDocument> {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  validateStaffRoleRules({
    action: 'UPDATE',
    actorRole: actor.actorRole,
    actorId: actor.actorId,
    targetId: user._id.toString(),
    targetRole: user.role,
    targetBranchIds: (user.branchIds || []).map((b) => b.toString()),
    newRole: input.role,
    newBranchIds: input.branchIds,
    newStatus: input.status,
  });

  const resultingRole = input.role ?? user.role;
  const resultingBranchIds =
    input.branchIds ?? (user.branchIds || []).map((b) => b.toString());

  if (resultingRole !== 'ADMIN' && input.branchIds !== undefined) {
    await BranchService.assertBranchesActiveInTenant(resultingBranchIds);
  }

  const updateFields: Record<string, unknown> = {};
  if (input.name !== undefined) updateFields['name'] = input.name;
  if (input.phone !== undefined) updateFields['phone'] = input.phone;
  if (input.role !== undefined) updateFields['role'] = input.role;
  if (input.branchIds !== undefined) {
    updateFields['branchIds'] =
      resultingRole === 'ADMIN' ? [] : input.branchIds;
  }
  if (input.status !== undefined) updateFields['status'] = input.status;

  const updated = await User.findByIdAndUpdate(
    id,
    { $set: updateFields },
    { returnDocument: 'after', runValidators: true },
  );

  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  auditLog({
    action: 'STAFF_USER_UPDATED',
    actorId: actor.actorId,
    tenantId: user.tenantId,
    targetId: user._id,
    details: { changes: Object.keys(updateFields) },
  });

  return updated;
}

/**
 * Resets a staff user's password by an admin/owner:
 * Generates a new temporary password, updates passwordChangedAt, sets mustChangePassword: true.
 * Emits audit log without logging the temporary password.
 */
export async function adminResetPassword(
  id: string,
  actor: ActorContext,
): Promise<{ temporaryPassword: string }> {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  validateStaffRoleRules({
    action: 'RESET_PASSWORD',
    actorRole: actor.actorRole,
    actorId: actor.actorId,
    targetId: user._id.toString(),
    targetRole: user.role,
  });

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: true,
      },
    },
  );

  auditLog({
    action: 'STAFF_USER_PASSWORD_RESET',
    actorId: actor.actorId,
    tenantId: user.tenantId,
    targetId: user._id,
  });

  return { temporaryPassword };
}

/**
 * Updates the authenticated user's own profile (name, phone).
 */
export async function updateMeProfile(
  userId: string,
  input: UpdateMeInput,
): Promise<UserDocument> {
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  );

  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return updated;
}
