import type { Document, Types } from 'mongoose';

export type AuthTokenType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface IAuthToken {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthTokenDocument = IAuthToken & Document<Types.ObjectId>;
