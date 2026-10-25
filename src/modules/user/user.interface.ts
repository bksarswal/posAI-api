import type { Document, Types } from 'mongoose';

export type UserRole =
  'OWNER' | 'ADMIN' | 'MANAGER' | 'WAITER' | 'CASHIER' | 'CHEF';

export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface IUser {
  tenantId: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string;
  role: UserRole;
  branchIds: Types.ObjectId[];
  status: UserStatus;
  emailVerified: boolean;
  emailVerifiedAt?: Date;
  mustChangePassword: boolean;
  passwordChangedAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = IUser & Document<Types.ObjectId>;
