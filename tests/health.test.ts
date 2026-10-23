import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';

describe('GET /health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with service details when database is connected', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Service is healthy',
      data: {
        status: 'healthy',
        uptime: expect.any(Number),
        db: 'connected',
      },
    });
  });

  it('returns 503 when database is not connected', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      message: 'Database is not connected',
      code: 'SERVICE_UNAVAILABLE',
      errors: {
        status: 'unhealthy',
        uptime: expect.any(Number),
        db: 'disconnected',
      },
    });
  });
});
