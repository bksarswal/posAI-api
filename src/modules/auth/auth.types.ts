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

export interface LoginResponseUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  branchIds: string[];
  mustChangePassword: boolean;
}

export interface LoginResponseData {
  accessToken: string;
  user: LoginResponseUser;
}

export interface AuthTokenPayload {
  sub: string;
  tid: string;
  role: UserRole;
  iss: string;
  iat?: number;
  exp?: number;
}
