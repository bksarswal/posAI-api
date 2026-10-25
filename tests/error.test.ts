import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { Error as MongooseError } from 'mongoose';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { AppError, TenantScopingError } from '../src/utils/appError.js';

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

  it('formats TenantScopingError as 500 INTERNAL_SERVER_ERROR without leaking internal error details', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/restaurants',
    } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;
    const err = new TenantScopingError(
      'Unscoped query rejected: Query find on tenant-scoped model missing tenantId filter and execution context.',
    );

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.success).toBe(false);
    expect(jsonCall.code).toBe('INTERNAL_SERVER_ERROR');
    expect(jsonCall.message).toBe('Internal server error');
    // Ensure internal query details and tenant leaks are strictly prevented
    expect(jsonCall.message).not.toContain('Unscoped query rejected');
    expect(jsonCall.stack).toBeUndefined();
  });

  it('maps MongoServerError code 11000 to 409 DUPLICATE_RESOURCE with a generic message', () => {
    const req = { method: 'POST', originalUrl: '/api/v1/branches' } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;

    const mongoErr = Object.assign(
      new Error(
        'E11000 duplicate key error collection: posai.branches index: tenantId_1_code_1 dup key: { tenantId: ObjectId("..."), code: "MAIN" }',
      ),
      {
        code: 11000,
        keyValue: { code: 'MAIN' },
      },
    );

    errorHandler(mongoErr, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.success).toBe(false);
    expect(jsonCall.code).toBe('DUPLICATE_RESOURCE');
    expect(jsonCall.message).toBe(
      'A resource with the specified identifier already exists',
    );
    // Ensure index name, collection name and raw keyValue are never exposed
    expect(JSON.stringify(jsonCall)).not.toContain('tenantId_1_code_1');
    expect(JSON.stringify(jsonCall)).not.toContain('posai.branches');
    expect(jsonCall.stack).toBeUndefined();
  });

  it('maps Mongoose ValidationError to 400 VALIDATION_ERROR with field details', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/restaurants',
    } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;

    const validationErr = new MongooseError.ValidationError();
    validationErr.errors = {
      name: new MongooseError.ValidatorError({
        path: 'name',
        message: 'Path `name` is required.',
        type: 'required',
      }),
    };

    errorHandler(validationErr, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.success).toBe(false);
    expect(jsonCall.code).toBe('VALIDATION_ERROR');
    expect(jsonCall.errors).toEqual([
      { field: 'name', message: 'Path `name` is required.' },
    ]);
    expect(jsonCall.stack).toBeUndefined();
  });

  it('maps Mongoose CastError to 400 INVALID_ID', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/branches/invalid-id',
    } as Request;
    const res = createMockResponse();
    const next = vi.fn() as unknown as NextFunction;

    const castErr = new MongooseError.CastError(
      'ObjectId',
      'invalid-id',
      'branchId',
    );

    errorHandler(castErr, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = vi.mocked(res.json).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(jsonCall.success).toBe(false);
    expect(jsonCall.code).toBe('INVALID_ID');
    expect(jsonCall.message).toBe('Invalid identifier provided for branchId');
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
