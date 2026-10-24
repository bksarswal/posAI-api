import { Schema, model } from 'mongoose';
import { tenantScopingPlugin } from '../../plugins/tenantScoping.plugin.js';
import type { BranchDocument } from './branch.interface.js';

const addressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const branchSchema = new Schema<BranchDocument>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    address: {
      type: addressSchema,
      required: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      required: true,
      default: 'Asia/Kolkata',
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
    },
    isMain: {
      type: Boolean,
      required: true,
      default: false,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  },
);

// Apply tenant-scoping plugin
branchSchema.plugin(tenantScopingPlugin);

// Unique branch code per tenant
branchSchema.index({ tenantId: 1, code: 1 }, { unique: true });

// Partial unique index: at most one main branch per tenant
branchSchema.index(
  { tenantId: 1 },
  {
    unique: true,
    partialFilterExpression: { isMain: true },
  },
);

// Branch queries by tenant and restaurant
branchSchema.index({ tenantId: 1, restaurantId: 1 });

export const Branch = model<BranchDocument>('Branch', branchSchema);
