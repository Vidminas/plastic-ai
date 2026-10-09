import express from 'express';
import request from 'supertest';
import { ErrorTypes } from 'librechat-data-provider';
import type { TOpeningHours } from 'librechat-data-provider';
import { createOpeningHoursGate } from './openingHours';

const hours: TOpeningHours = { open: '06:00', close: '22:00', timezone: 'Europe/London' };

function createApp(openingHours: TOpeningHours | undefined) {
  const app = express();
  app.use(
    '/api',
    createOpeningHoursGate(() => openingHours),
  );
  app.get(['/api/config', '/api/convos'], (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createOpeningHoursGate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes requests inside the window', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T12:00:00Z'), doNotFake: ['nextTick'] });
    const response = await request(createApp(hours)).get('/api/convos');
    expect(response.status).toBe(200);
  });

  it('refuses requests outside the window until it opens', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T23:00:00Z'), doNotFake: ['nextTick'] });
    const response = await request(createApp(hours)).get('/api/convos');
    expect(response.status).toBe(503);

    expect(response.body.type).toBe(ErrorTypes.OUTSIDE_OPENING_HOURS);
    expect(response.headers['retry-after']).toBe(String(7 * 3600));
  });

  it('keeps the startup config reachable while closed', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T23:00:00Z'), doNotFake: ['nextTick'] });
    const response = await request(createApp(hours)).get('/api/config');
    expect(response.status).toBe(200);
  });

  it('passes everything without opening hours', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-01T23:00:00Z'), doNotFake: ['nextTick'] });
    const response = await request(createApp(undefined)).get('/api/convos');
    expect(response.status).toBe(200);
  });
});
