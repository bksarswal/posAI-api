import type { UserRole } from '../user/user.interface.js';

export interface SignupResponseUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

export interface SignupResponseData {
  user: SignupResponseUser;
}
