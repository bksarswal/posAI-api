import type { Document, Types } from 'mongoose';

export interface IRefreshToken {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = IRefreshToken & Document<Types.ObjectId>;
