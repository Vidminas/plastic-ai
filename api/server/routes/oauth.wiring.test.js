const express = require('express');
const request = require('supertest');

const originalDomainClient = process.env.DOMAIN_CLIENT;
process.env.DOMAIN_CLIENT = 'http://client.test';

const mockLogger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

const mockOAuthHandler = jest.fn((_req, res) => res.status(204).end());
const mockOpenIDCallbackMiddleware = jest.fn((_req, _res, next) => next());
const mockCreateOpenIDCallbackAuthenticator = jest.fn(() => mockOpenIDCallbackMiddleware);

const mockPassportAuthenticate = jest.fn(() => (_req, res, _next) => res.redirect('/authorize'));

jest.mock('passport', () => ({
  authenticate: (...args) => mockPassportAuthenticate(...args),
}));

jest.mock('openid-client', () => ({
  randomState: jest.fn(() => 'random-state'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  ErrorTypes: {
    AUTH_FAILED: 'auth_failed',
  },
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  buildOAuthFailureLog: jest.fn(() => ({})),
  createOpenIDCallbackAuthenticator: (...args) => mockCreateOpenIDCallbackAuthenticator(...args),
  createSetBalanceConfig: jest.fn(() => (_req, _res, next) => next()),
  getOAuthFailureMessage: jest.fn(() => 'OAuth authentication failed'),
  redirectToAuthFailure: jest.fn((res) => res.redirect('/login?error=auth_failed')),
}));

jest.mock('~/server/middleware', () => ({
  checkDomainAllowed: jest.fn((_req, _res, next) => next()),
  loginLimiter: jest.fn((_req, _res, next) => next()),
  logHeaders: jest.fn((_req, _res, next) => next()),
  markOAuthNavigation: jest.fn((_req, _res, next) => next()),
}));

jest.mock('~/server/controllers/auth/oauth', () => ({
  createOAuthHandler: jest.fn(() => mockOAuthHandler),
}));

jest.mock('~/models', () => ({
  findBalanceByUser: jest.fn(),
  upsertBalanceFields: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

afterAll(() => {
  if (originalDomainClient === undefined) {
    delete process.env.DOMAIN_CLIENT;
    return;
  }
  process.env.DOMAIN_CLIENT = originalDomainClient;
});

function getOAuthRouter() {
  jest.resetModules();
  return require('./oauth');
}

function createApp() {
  const app = express();
  app.use('/oauth', getOAuthRouter());
  app.use((err, _req, res, _next) => {
    res.status(500).json({ message: err.message });
  });
  return app;
}

describe('OAuth route wiring', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockOAuthHandler.mockClear();
    mockOpenIDCallbackMiddleware.mockClear();
    mockCreateOpenIDCallbackAuthenticator.mockClear();
    mockPassportAuthenticate.mockClear();
    mockPassportAuthenticate.mockImplementation(() => (_req, res, _next) => res.redirect('/authorize'));
    mockOpenIDCallbackMiddleware.mockImplementation((_req, _res, next) => next());
  });

  it('initiates the OIDC authorization-code flow at /oauth/openid', async () => {
    const app = createApp();

    const response = await request(app).get('/oauth/openid');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/authorize');
    expect(mockPassportAuthenticate).toHaveBeenCalledWith(
      'openid',
      expect.objectContaining({ session: false, state: 'random-state' }),
    );
  });

  it('invokes the OIDC callback authenticator at /oauth/openid/callback', async () => {
    const app = createApp();

    const response = await request(app).get(
      '/oauth/openid/callback?code=secret-code&state=random-state',
    );

    expect(response.status).toBe(204);
    expect(mockCreateOpenIDCallbackAuthenticator).toHaveBeenCalled();
    expect(mockOpenIDCallbackMiddleware).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockOAuthHandler).toHaveBeenCalled();
  });
});
