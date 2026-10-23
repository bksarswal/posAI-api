import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendSuccess, sendError } from '../../utils/response.js';

const DB_CONNECTION_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Health check controller.
 * Returns 200 with service metadata when healthy, or 503 if database is disconnected.
 */
export const getHealth = async (
  _req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const readyState = mongoose.connection.readyState;
    const isDbConnected = readyState === 1;
    const dbState = DB_CONNECTION_STATES[readyState] ?? 'unknown';

    const healthData = {
      status: isDbConnected ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      db: dbState,
    };

    if (!isDbConnected) {
      return sendError(res, {
        statusCode: 503,
        message: 'Database is not connected',
        code: 'SERVICE_UNAVAILABLE',
        errors: healthData,
      });
    }

    return sendSuccess(res, {
      statusCode: 200,
      message: 'Service is healthy',
      data: healthData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return sendError(res, {
      statusCode: 500,
      message,
      code: 'INTERNAL_ERROR',
    });
  }
};
