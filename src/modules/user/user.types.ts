import type { UserDocument, UserRole } from './user.interface.js';
import type { RestaurantResponseDto } from '../restaurant/index.js';
import type { BranchResponseDto } from '../branch/index.js';

export type { UserDocument, UserRole };

export interface GetMeUserDto {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  branchIds: string[];
  emailVerified: boolean;
  mustChangePassword: boolean;
}

export interface GetMeTenantDto {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface GetMeResponseData {
  user: GetMeUserDto;
  tenant: GetMeTenantDto;
  restaurant: RestaurantResponseDto | null;
  branches: BranchResponseDto[];
}
