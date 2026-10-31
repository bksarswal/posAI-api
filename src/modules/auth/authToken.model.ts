import { Schema, model } from 'mongoose';
import { tenantScopingPlugin } from '../../plugins/tenantScoping.plugin.js';
import type { AuthTokenDocument } from './authToken.interface.js';

const authTokenSchema = new Schema<AuthTokenDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET'],
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Apply tenant-scoping plugin (adds tenantId path and query/aggregate scoping hooks)
authTokenSchema.plugin(tenantScopingPlugin);

// Indexes:
// 1. UNIQUE { tokenHash }
authTokenSchema.index({ tokenHash: 1 }, { unique: true });

// 2. Compound index on { userId, type } for rapid retrieval and invalidation of user token families
authTokenSchema.index({ userId: 1, type: 1 });

// 3. TTL index on expiresAt:
// Note: MongoDB's background TTL cleanup thread runs approximately once every 60 seconds.
// As a result, expired documents can persist in the database for up to 60 seconds after expiresAt.
// Application code MUST ALWAYS explicitly check `expiresAt > new Date()` when validating tokens.
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = model<AuthTokenDocument>('AuthToken', authTokenSchema);
