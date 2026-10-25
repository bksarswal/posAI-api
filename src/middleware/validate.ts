import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

/**
 * Express middleware factory to validate and parse req.body using a Zod schema.
 * Parses input (applying trim/lowercase/transforms) or delegates ZodError to errorHandler.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
