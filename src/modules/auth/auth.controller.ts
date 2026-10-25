import type { Request, Response, NextFunction } from 'express';
import * as AuthService from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';
import { env } from '../../config/env.js';
import type { SignupInput, LoginInput } from './auth.validation.js';

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

/**
 * Controller for POST /api/v1/auth/login.
 * Authenticates user, issues access token and httpOnly refresh cookie.
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const result = await AuthService.login(req.body as LoginInput, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', result.rawRefreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Login successful',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/logout.
 * Revokes refresh token family and clears the refresh cookie.
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[
      'refreshToken'
    ];
    await AuthService.logout(rawToken);

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};
