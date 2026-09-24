/**
 * Feature: cognito-login-migration: the Cognito OIDC login option is exposed
 * when ALLOW_SOCIAL_LOGIN=true and the OPENID_* gate is satisfied.
 *
 * Scoped to ~/server/socialLogins so the routes-index module graph is not loaded.
 */

const mockSessionMiddleware = jest.fn((req, res, next) => next());
const mockPassportSessionMiddleware = jest.fn((req, res, next) => next());
const mockSession = jest.fn(() => mockSessionMiddleware);
const mockPassportUse = jest.fn();
const mockPassportSession = jest.fn(() => mockPassportSessionMiddleware);
const mockGetLogStores = jest.fn(() => 'openid-session-store');
const mockOpenIdJwtLogin = jest.fn(() => 'openid-jwt-strategy');
const mockSetupOpenId = jest.fn();
const mockSetupSaml = jest.fn();
const mockRegisterOpenIdWithRetry = jest.fn(async () => {});
const mockShouldUseSecureCookie = jest.fn(() => true);
const mockMath = jest.fn((value, fallback) => (value == null || value === '' ? fallback : value));

const isEnabled = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase().trim() === 'true';
  }
  return false;
};

jest.mock('express-session', () => (...args) => mockSession(...args));
jest.mock('passport', () => ({
  use: (...args) => mockPassportUse(...args),
  session: (...args) => mockPassportSession(...args),
}));
jest.mock('librechat-data-provider', () => ({
  CacheKeys: { OPENID_SESSION: 'openid-session', SAML_SESSION: 'saml-session' },
}));
jest.mock('@librechat/api', () => ({
  math: (...args) => mockMath(...args),
  isEnabled: (value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase().trim() === 'true';
    }
    return false;
  },
  shouldUseSecureCookie: (...args) => mockShouldUseSecureCookie(...args),
  registerOpenIdWithRetry: (...args) => mockRegisterOpenIdWithRetry(...args),
}));
jest.mock('@librechat/data-schemas', () => ({
  DEFAULT_SESSION_EXPIRY: 900000,
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('~/cache', () => ({ getLogStores: (...args) => mockGetLogStores(...args) }));
jest.mock('~/strategies', () => ({
  openIdJwtLogin: (...args) => mockOpenIdJwtLogin(...args),
  facebookLogin: jest.fn(),
  facebookAdminLogin: jest.fn(),
  discordLogin: jest.fn(),
  discordAdminLogin: jest.fn(),
  setupOpenId: (...args) => mockSetupOpenId(...args),
  googleLogin: jest.fn(),
  googleAdminLogin: jest.fn(),
  githubLogin: jest.fn(),
  githubAdminLogin: jest.fn(),
  appleLogin: jest.fn(),
  appleAdminLogin: jest.fn(),
  setupSaml: (...args) => mockSetupSaml(...args),
}));

const configureSocialLogins = require('~/server/socialLogins');

const setPkceOpenIdEnv = () => {
  process.env.OPENID_CLIENT_ID = 'ministack-client-id';
  process.env.OPENID_CLIENT_SECRET = '';
  process.env.OPENID_ISSUER = 'https://issuer.example.com';
  process.env.OPENID_SCOPE = 'openid profile email';
  process.env.OPENID_SESSION_SECRET = 'openid-session-secret';
  process.env.OPENID_USE_PKCE = 'true';
};

describe('Feature: cognito-login-migration — Cognito login-option presence (Req 2.2)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {};
    mockSetupOpenId.mockResolvedValue({ issuer: 'https://issuer.example.com' });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('exposes the Cognito OIDC login option when ALLOW_SOCIAL_LOGIN=true and OPENID_* is configured', async () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    setPkceOpenIdEnv();
    const app = { use: jest.fn() };
    expect(isEnabled(process.env.ALLOW_SOCIAL_LOGIN)).toBe(true);
    await configureSocialLogins(app);
    expect(mockRegisterOpenIdWithRetry).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenCalledWith(mockSessionMiddleware);
  });

  it('does not expose the OIDC login option when the OPENID_* gate is unmet', async () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    const app = { use: jest.fn() };
    await configureSocialLogins(app);
    expect(mockRegisterOpenIdWithRetry).not.toHaveBeenCalled();
  });
});
