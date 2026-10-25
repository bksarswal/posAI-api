import { Schema, model } from 'mongoose';
import { tenantScopingPlugin } from '../../plugins/tenantScoping.plugin.js';
import type { RefreshTokenDocument } from './refreshToken.interface.js';

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
    },
    familyId: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    rotatedAt: {
      type: Date,
    },
    revokedAt: {
      type: Date,
    },
    ip: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

// Apply tenant-scoping plugin
refreshTokenSchema.plugin(tenantScopingPlugin);

// Indexes:
// 1. UNIQUE { tokenHash }
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });

// 2. { familyId } for family revocation & rotation lookups
refreshTokenSchema.index({ familyId: 1 });

// 3. { userId } for user-level session revocation
refreshTokenSchema.index({ userId: 1 });

// 4. TTL index on expiresAt:
// Note: MongoDB TTL index background thread runs approximately every 60 seconds.
// As a result, expired documents can persist for up to 60 seconds after expiresAt.
// Application code MUST always explicitly check `expiresAt > new Date()` when validating tokens.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDocument>(
  'RefreshToken',
  refreshTokenSchema,
);
