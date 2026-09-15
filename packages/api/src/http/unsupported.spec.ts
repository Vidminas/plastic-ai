import express from 'express';
import request from 'supertest';

import { createUnsupportedRouter, unsupportedFeature } from './unsupported';

describe('DynamoDB unsupported feature responses', () => {
  it('returns the stable 501 body from a handler', async () => {
    const app = express();
    app.get('/feature', unsupportedFeature('memory'));

    const response = await request(app).get('/feature');

    expect(response.status).toBe(501);
    expect(response.body).toEqual({
      error: 'unsupported_feature',
      feature: 'memory',
      message: 'memory is not available with the DynamoDB core persistence profile.',
    });
  });

  it('stubs every method and nested path registered beneath a feature router', async () => {
    const app = express();
    app.use('/api/prompts', createUnsupportedRouter('prompts'));

    const [readResponse, writeResponse] = await Promise.all([
      request(app).get('/api/prompts/group/one'),
      request(app).post('/api/prompts').send({ name: 'ignored' }),
    ]);

    expect(readResponse.status).toBe(501);
    expect(writeResponse.status).toBe(501);
    expect(readResponse.body.error).toBe('unsupported_feature');
    expect(writeResponse.body.feature).toBe('prompts');
  });
});
