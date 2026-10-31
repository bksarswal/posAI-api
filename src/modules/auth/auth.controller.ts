import type { Request, Response, NextFunction } from 'express';
import * as AuthService from './auth.service.js';
import {
  getRefreshTokenCookieOptions,
  getClearRefreshTokenCookieOptions,
} from './auth.constants.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { AppError } from '../../utils/appError.js';
import type {
  SignupInput,
  LoginInput,
  ChangePasswordInput,
  VerifyEmailInput,
  ResendVerificationInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.validation.js';

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
    res.cookie(
      'refreshToken',
      result.rawRefreshToken,
      getRefreshTokenCookieOptions(),
    );

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

    res.clearCookie('refreshToken', getClearRefreshTokenCookieOptions());

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/refresh.
 * Rotates refresh token atomically, issues new access token, sets new refresh cookie.
 */
export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[
      'refreshToken'
    ];

    const result = await AuthService.refreshSession(rawToken, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.cookie(
      'refreshToken',
      result.rawRefreshToken,
      getRefreshTokenCookieOptions(),
    );

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Token refreshed successfully',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (error: unknown) {
    if (
      error instanceof AppError &&
      (error.code === 'INVALID_REFRESH_TOKEN' ||
        error.code === 'REFRESH_TOKEN_REUSED')
    ) {
      res.clearCookie('refreshToken', getClearRefreshTokenCookieOptions());
    }
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/change-password.
 * Validates current password, updates to new password, revokes all user sessions.
 */
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return sendError(res, {
        statusCode: 401,
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    await AuthService.changePassword(userId, req.body as ChangePasswordInput);

    res.clearCookie('refreshToken', getClearRefreshTokenCookieOptions());

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Password changed. Please log in again.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/verify-email.
 * Verifies email using single-use token.
 */
export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    await AuthService.verifyEmail(req.body as VerifyEmailInput);

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Email verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/resend-verification.
 * Issues a new verification token and emails user if eligible (cooldown 60s).
 */
export const resendVerification = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const { email } = req.body as ResendVerificationInput;
    const message = await AuthService.resendVerification(email);

    return sendSuccess(res, {
      statusCode: 200,
      message,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/forgot-password.
 * Issues password reset token and emails user if account is ACTIVE.
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    const { email } = req.body as ForgotPasswordInput;
    const message = await AuthService.forgotPassword(email);

    return sendSuccess(res, {
      statusCode: 200,
      message,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for POST /api/v1/auth/reset-password.
 * Resets user password, updates emailVerified, and invalidates all active sessions.
 */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> => {
  try {
    await AuthService.resetPassword(req.body as ResetPasswordInput);

    return sendSuccess(res, {
      statusCode: 200,
      message:
        'Password reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};
