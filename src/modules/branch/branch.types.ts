import type {
  IBranch,
  IBranchAddress,
  BranchDocument,
  BranchStatus,
} from './branch.interface.js';

export type { IBranch, IBranchAddress, BranchDocument, BranchStatus };

export interface BranchResponseDto {
  id: string;
  tenantId: string;
  restaurantId: string;
  name: string;
  code: string;
  address: IBranchAddress;
  phone?: string;
  timezone: string;
  currency: string;
  isMain: boolean;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
}
