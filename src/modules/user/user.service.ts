import type { ClientSession } from 'mongoose';
import { User } from './user.model.js';
import type { UserDocument, UserRole } from './user.interface.js';
import { withGlobalScope } from '../../utils/tenantBypass.js';

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
