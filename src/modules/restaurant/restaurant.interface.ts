import type { Document, Types } from 'mongoose';

export interface IRestaurantAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface IRestaurant {
  tenantId: Types.ObjectId;
  name: string;
  gstin?: string;
  fssai?: string;
  phone: string;
  email: string;
  address: IRestaurantAddress;
  logoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RestaurantDocument = IRestaurant & Document<Types.ObjectId>;
