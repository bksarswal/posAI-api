import { Restaurant } from './restaurant.model.js';
import type { RestaurantDocument } from './restaurant.interface.js';
import type { RestaurantResponseDto } from './restaurant.types.js';
import type {
  CreateRestaurantInput,
  UpdateRestaurantInput,
} from './restaurant.validation.js';
import { AppError } from '../../utils/appError.js';

export function formatRestaurant(
  doc: RestaurantDocument,
): RestaurantResponseDto {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    name: doc.name,
    gstin: doc.gstin,
    fssai: doc.fssai,
    phone: doc.phone,
    email: doc.email,
    address: doc.address,
    logoUrl: doc.logoUrl,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Retrieves the restaurant for the current tenant execution context.
 * Returns null if no restaurant exists yet.
 */
export async function getRestaurant(): Promise<RestaurantDocument | null> {
  return Restaurant.findOne();
}

/**
 * Creates the single restaurant for the current tenant.
 * Rejects with 409 RESTAURANT_ALREADY_EXISTS if one already exists or on duplicate race.
 */
export async function createRestaurant(
  input: CreateRestaurantInput,
): Promise<RestaurantDocument> {
  const existing = await Restaurant.findOne();
  if (existing) {
    throw new AppError(
      'A restaurant already exists for this tenant',
      409,
      'RESTAURANT_ALREADY_EXISTS',
    );
  }

  try {
    const [restaurant] = await Restaurant.create([input]);
    if (!restaurant) {
      throw new Error('Failed to create restaurant');
    }
    return restaurant;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === 11000
    ) {
      throw new AppError(
        'A restaurant already exists for this tenant',
        409,
        'RESTAURANT_ALREADY_EXISTS',
      );
    }
    throw err;
  }
}

/**
 * Updates restaurant details for the current tenant.
 * Rejects with 404 RESTAURANT_NOT_FOUND if no restaurant exists.
 */
export async function updateRestaurant(
  input: UpdateRestaurantInput,
): Promise<RestaurantDocument> {
  const restaurant = await Restaurant.findOneAndUpdate(
    {},
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  );

  if (!restaurant) {
    throw new AppError(
      'Restaurant not found for this tenant',
      404,
      'RESTAURANT_NOT_FOUND',
    );
  }

  return restaurant;
}
