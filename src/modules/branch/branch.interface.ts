import type { Document, Types } from 'mongoose';

export type BranchStatus = 'ACTIVE' | 'INACTIVE';

export interface IBranchAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface IBranch {
  tenantId: Types.ObjectId;
  restaurantId: Types.ObjectId;
  name: string;
  code: string;
  address: IBranchAddress;
  phone?: string;
  timezone: string;
  currency: string;
  isMain: boolean;
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type BranchDocument = IBranch & Document<Types.ObjectId>;
