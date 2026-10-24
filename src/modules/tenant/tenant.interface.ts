import type { Document, Types } from 'mongoose';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED';

export interface ITenant {
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantDocument = ITenant & Document<Types.ObjectId>;
