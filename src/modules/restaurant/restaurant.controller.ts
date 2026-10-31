import type { Request, Response } from 'express';
import * as RestaurantService from './restaurant.service.js';
import { formatRestaurant } from './restaurant.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/appError.js';

export { formatRestaurant };

export async function createRestaurant(
  req: Request,
  res: Response,
): Promise<Response> {
  const restaurant = await RestaurantService.createRestaurant(req.body);
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Restaurant created successfully',
    data: { restaurant: formatRestaurant(restaurant) },
  });
}

export async function getRestaurant(
  _req: Request,
  res: Response,
): Promise<Response> {
  const restaurant = await RestaurantService.getRestaurant();
  if (!restaurant) {
    throw new AppError(
      'Restaurant not found for this tenant',
      404,
      'RESTAURANT_NOT_FOUND',
    );
  }

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Restaurant retrieved successfully',
    data: { restaurant: formatRestaurant(restaurant) },
  });
}

export async function updateRestaurant(
  req: Request,
  res: Response,
): Promise<Response> {
  const restaurant = await RestaurantService.updateRestaurant(req.body);
  return sendSuccess(res, {
    statusCode: 200,
    message: 'Restaurant updated successfully',
    data: { restaurant: formatRestaurant(restaurant) },
  });
}
