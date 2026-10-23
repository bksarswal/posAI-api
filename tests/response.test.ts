import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendSuccess, sendError } from '../src/utils/response.js';
import { AppError } from '../src/utils/appError.js';

function createMockResponse() {
  const res = {} as unknown as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('AppError', () => {
  it('creates an AppError with default status 500 and code INTERNAL_ERROR', () => {
    const error = new AppError('Something went wrong');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('Something went wrong');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.details).toBeUndefined();
  });

  it('creates an AppError with custom status code, custom error code, and details', () => {
    const details = { field: 'email', reason: 'already exists' };
    const error = new AppError('User conflict', 409, 'USER_EXISTS', details);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('USER_EXISTS');
    expect(error.details).toEqual(details);
  });
});

describe('Response helpers', () => {
  describe('sendSuccess', () => {
    it('sends standardized success response with default status 200 and data', () => {
      const res = createMockResponse();
      const data = { id: '123', name: 'Restaurant' };

      sendSuccess(res, { message: 'Fetched successfully', data });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Fetched successfully',
        data,
      });
    });

    it('sends standardized success response with custom status code and no data', () => {
      const res = createMockResponse();

      sendSuccess(res, { statusCode: 204, message: 'Item deleted' });

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Item deleted',
      });
    });
  });

  describe('sendError', () => {
    it('sends standardized error response with default status 500 and default code', () => {
      const res = createMockResponse();

      sendError(res, { message: 'Server crash' });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Server crash',
        code: 'INTERNAL_ERROR',
      });
    });

    it('sends standardized error response with custom status code, code, and errors field', () => {
      const res = createMockResponse();
      const validationErrors = [{ field: 'name', message: 'Name is required' }];

      sendError(res, {
        statusCode: 400,
        message: 'Invalid input',
        code: 'VALIDATION_ERROR',
        errors: validationErrors,
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid input',
        code: 'VALIDATION_ERROR',
        errors: validationErrors,
      });
    });
  });
});
