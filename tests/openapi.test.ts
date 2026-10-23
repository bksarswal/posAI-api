import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getOpenAPIDocument } from '../src/config/openapi.js';

describe('OpenAPI 3.1 Setup', () => {
  it('generates a valid OpenAPI 3.1 document structure with /health path and security schemes', () => {
    const document = getOpenAPIDocument();

    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual(
      expect.objectContaining({
        title: 'POSAI API',
        version: expect.any(String),
      }),
    );
    expect(document.paths).toHaveProperty('/health');
    expect(document.paths?.['/health']).toHaveProperty('get');
    expect(document.components?.securitySchemes).toHaveProperty('bearerAuth');
    expect(document.components?.schemas).toHaveProperty('SuccessResponse');
    expect(document.components?.schemas).toHaveProperty('ErrorResponse');
  });

  it('serves the OpenAPI specification as JSON via GET /api/v1/docs/openapi.json', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(
      expect.objectContaining({
        openapi: '3.1.0',
        info: expect.objectContaining({
          title: 'POSAI API',
        }),
      }),
    );
    expect(response.body.paths).toHaveProperty('/health');
  });
});
