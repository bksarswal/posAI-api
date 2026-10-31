import type { Request, Response } from 'express';
import * as UserService from './user.service.js';
import { listUsersQuerySchema } from './user.validation.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/appError.js';
import { objectIdParam } from '../../utils/validators.js';

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

export async function updateMe(req: Request, res: Response): Promise<Response> {
  const userId = req.auth?.userId;
  if (!userId) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const updated = await UserService.updateMeProfile(userId, req.body);
  return sendSuccess(res, {
    statusCode: 200,
    message: 'Profile updated successfully',
    data: { user: UserService.formatUser(updated) },
  });
}

export async function createStaff(
  req: Request,
  res: Response,
): Promise<Response> {
  const actor = {
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
  };

  const { user, temporaryPassword } = await UserService.createStaffUser(
    req.body,
    actor,
  );

  res.setHeader('Cache-Control', 'no-store');
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Staff user created successfully',
    data: {
      user: UserService.formatUser(user),
      temporaryPassword,
    },
  });
}

export async function listStaff(
  req: Request,
  res: Response,
): Promise<Response> {
  const actor = {
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
  };

  const validatedQuery = listUsersQuerySchema.parse(req.query);
  const result = await UserService.listUsers(validatedQuery, actor);

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Staff users retrieved successfully',
    data: result,
    meta: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    },
  });
}

export async function getStaffById(
  req: Request,
  res: Response,
): Promise<Response> {
  const actor = {
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
  };

  const id = objectIdParam(req.params['id'] as string);
  const user = await UserService.getStaffUserById(id, actor);

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Staff user retrieved successfully',
    data: { user: UserService.formatUser(user) },
  });
}

export async function updateStaff(
  req: Request,
  res: Response,
): Promise<Response> {
  const actor = {
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
  };

  const id = objectIdParam(req.params['id'] as string);
  const user = await UserService.updateStaffUser(id, req.body, actor);

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Staff user updated successfully',
    data: { user: UserService.formatUser(user) },
  });
}

export async function adminResetPassword(
  req: Request,
  res: Response,
): Promise<Response> {
  const actor = {
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
  };

  const id = objectIdParam(req.params['id'] as string);
  const { temporaryPassword } = await UserService.adminResetPassword(id, actor);

  res.setHeader('Cache-Control', 'no-store');
  return sendSuccess(res, {
    statusCode: 200,
    message: 'Password reset successfully',
    data: { temporaryPassword },
  });
}
