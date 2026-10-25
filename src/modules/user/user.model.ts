import { Schema, model } from 'mongoose';
import { tenantScopingPlugin } from '../../plugins/tenantScoping.plugin.js';
import type { UserDocument } from './user.interface.js';

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'CASHIER', 'CHEF'],
      required: true,
    },
    branchIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
      default: [],
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifiedAt: {
      type: Date,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: {
      type: Date,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Apply tenant-scoping plugin
userSchema.plugin(tenantScopingPlugin);

// Indexes:
// 1. UNIQUE { email } (global, NOT per tenant, because authentication queries by email only)
userSchema.index({ email: 1 }, { unique: true });

// 2. Query users by role within a tenant
userSchema.index({ tenantId: 1, role: 1 });

// 3. Query active/inactive users within a tenant
userSchema.index({ tenantId: 1, status: 1 });

export const User = model<UserDocument>('User', userSchema);
