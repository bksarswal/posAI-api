import type { Request, Response } from 'express';
import * as UserService from './user.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/appError.js';

export async function getMe(req: Request, res: Response): Promise<Response> {
  const userId = req.auth?.userId;
  if (!userId) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const onboardingData = await UserService.getMe(userId);
  return sendSuccess(res, {
    statusCode: 200,
    message: 'User profile retrieved successfully',
    data: onboardingData,
  });
}
