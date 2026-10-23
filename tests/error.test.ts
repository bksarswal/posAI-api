import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/appError.js';

function createMockResponse() {
  const res = {} as unknown as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Error Handling Middleware', () => {
  it('returns 404 with standard error shape when route does not exist and does not leak stack', async () => {
    const response = await request(app).get('/api/unknown-route-12345');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'Route GET /api/unknown-route-12345 not found',
      code: 'NOT_FOUND',
    });
    expect((response.body as Record<string, unknown>).stack).toBeUndefined();
  });

  it('formats AppError with custom status code, code, and details without leaking stack', () => {
    const req = { method: 'GET', originalUrl: '/test' } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;
    const err = new AppError('Forbidden action', 403, 'FORBIDDEN', {
      reason: 'No permission',
    });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Forbidden action',
        code: 'FORBIDDEN',
        errors: { reason: 'No permission' },
      }),
    );
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.stack).toBeUndefined();
  });

  it('formats unexpected errors as 500 INTERNAL_SERVER_ERROR without leaking stack', () => {
    const req = { method: 'POST', originalUrl: '/test' } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error('Database disk corrupted');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.success).toBe(false);
    expect(jsonCall.code).toBe('INTERNAL_SERVER_ERROR');
    expect(jsonCall.stack).toBeUndefined();
  });
});
