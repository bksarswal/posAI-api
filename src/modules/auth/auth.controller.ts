import type { Request, Response, NextFunction } from 'express';
import * as AuthService from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';
import type { SignupInput } from './auth.validation.js';

/**
 * Controller for POST /api/v1/auth/signup.
 * Registers a new Tenant and OWNER User.
 */
export const signup = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const data = await AuthService.signup(req.body as SignupInput);
    return sendSuccess(res, {
      statusCode: 201,
      message: 'Account created successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};
