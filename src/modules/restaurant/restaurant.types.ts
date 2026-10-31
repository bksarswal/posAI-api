import type {
  IRestaurant,
  IRestaurantAddress,
  RestaurantDocument,
} from './restaurant.interface.js';

export type { IRestaurant, IRestaurantAddress, RestaurantDocument };

export interface RestaurantResponseDto {
  id: string;
  tenantId: string;
  name: string;
  gstin?: string;
  fssai?: string;
  phone: string;
  email: string;
  address: IRestaurantAddress;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}
