import { Schema, model } from 'mongoose';
import { tenantScopingPlugin } from '../../plugins/tenantScoping.plugin.js';
import type { RestaurantDocument } from './restaurant.interface.js';

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

const restaurantSchema = new Schema<RestaurantDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
    },
    fssai: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    address: {
      type: addressSchema,
      required: true,
    },
    logoUrl: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

// Apply tenant-scoping plugin (adds tenantId path & scoping hooks)
restaurantSchema.plugin(tenantScopingPlugin);

// Unique index on { tenantId }: one restaurant per tenant for now (Sprint 11 relaxes this)
restaurantSchema.index({ tenantId: 1 }, { unique: true });

export const Restaurant = model<RestaurantDocument>(
  'Restaurant',
  restaurantSchema,
);
