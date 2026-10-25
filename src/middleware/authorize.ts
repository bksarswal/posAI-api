import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../modules/user/user.interface.js';
import { sendError } from '../utils/response.js';

/**
 * Authorization middleware.
 * Verifies that the authenticated user possesses one of the allowed roles.
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return sendError(res, {
        statusCode: 403,
        message: 'You do not have permission to perform this action',
        code: 'FORBIDDEN',
      });
    }
    next();
  };
}
