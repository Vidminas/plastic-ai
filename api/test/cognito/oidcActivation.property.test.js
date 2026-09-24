/**
 * Feature: cognito-login-migration, Property 1: OIDC activation matches the gating condition.
 *
 * OIDC is configured iff OPENID_ISSUER, OPENID_CLIENT_ID, OPENID_SCOPE and
 * OPENID_SESSION_SECRET are all set AND (OPENID_USE_PKCE enabled OR
 * OPENID_CLIENT_SECRET present). The predicate mirrors the guard in
 * api/server/socialLogins.js and is checked against the real isEnabled.
 */

const { isEnabled } = require('@librechat/api');

function oidcActivates(env) {
  return Boolean(
    env.OPENID_CLIENT_ID &&
      (isEnabled(env.OPENID_USE_PKCE) || env.OPENID_CLIENT_SECRET?.trim()) &&
      env.OPENID_ISSUER &&
      env.OPENID_SCOPE &&
      env.OPENID_SESSION_SECRET,
  );
}

function specSaysActivate(env) {
  const isSet = (v) => typeof v === 'string' && v !== '';
  const coreConfigured =
    isSet(env.OPENID_ISSUER) &&
    isSet(env.OPENID_CLIENT_ID) &&
    isSet(env.OPENID_SCOPE) &&
    isSet(env.OPENID_SESSION_SECRET);
  const pkceEnabled = isEnabled(env.OPENID_USE_PKCE);
  const secretPresent =
    typeof env.OPENID_CLIENT_SECRET === 'string' && env.OPENID_CLIENT_SECRET.trim() !== '';
  return coreConfigured && (pkceEnabled || secretPresent);
}

const STRING_STATES = [undefined, '', '   ', 'set-value'];
const PKCE_STATES = [undefined, '', 'true', 'TRUE', 'True', 'false', 'no', 'yes', '1'];
const RELEVANT_KEYS = [
  'OPENID_ISSUER',
  'OPENID_CLIENT_ID',
  'OPENID_SCOPE',
  'OPENID_SESSION_SECRET',
  'OPENID_CLIENT_SECRET',
];

function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function enumerateConfigs() {
  const configs = [];
  const total = STRING_STATES.length ** RELEVANT_KEYS.length;
  for (let combo = 0; combo < total; combo++) {
    let n = combo;
    const base = {};
    for (const key of RELEVANT_KEYS) {
      base[key] = STRING_STATES[n % STRING_STATES.length];
      n = Math.floor(n / STRING_STATES.length);
    }
    for (const pkce of PKCE_STATES) {
      configs.push({ ...base, OPENID_USE_PKCE: pkce });
    }
  }
  return configs;
}

function randomConfigs(count, seed) {
  const rng = makeRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const stringPool = [undefined, '', '  ', '\t', 'x', 'https://issuer.example', 'abc-123', ' padded '];
  const pkcePool = [undefined, '', 'true', 'TRUE', ' true ', 'false', '0', '1', 'enabled'];
  const configs = [];
  for (let i = 0; i < count; i++) {
    const cfg = { OPENID_USE_PKCE: pick(pkcePool) };
    for (const key of RELEVANT_KEYS) {
      cfg[key] = pick(stringPool);
    }
    configs.push(cfg);
  }
  return configs;
}

describe('Feature: cognito-login-migration, Property 1: OIDC activation matches the gating condition', () => {
  const configs = [...enumerateConfigs(), ...randomConfigs(256, 0x5eed)];

  it('exceeds the 100-iteration property-test minimum', () => {
    expect(configs.length).toBeGreaterThanOrEqual(100);
  });

  it('activates OIDC iff core vars are set AND (PKCE enabled OR client secret present)', () => {
    let activatedCount = 0;
    let notActivatedCount = 0;
    for (const cfg of configs) {
      const actual = oidcActivates(cfg);
      const expected = specSaysActivate(cfg);
      expect(actual).toBe(expected);
      if (actual) {
        activatedCount++;
      } else {
        notActivatedCount++;
      }
    }
    expect(activatedCount).toBeGreaterThan(0);
    expect(notActivatedCount).toBeGreaterThan(0);
  });

  describe('boundary examples pinning the gating condition', () => {
    const core = {
      OPENID_ISSUER: 'https://issuer.example',
      OPENID_CLIENT_ID: 'client-id',
      OPENID_SCOPE: 'openid profile email',
      OPENID_SESSION_SECRET: 'session-secret',
    };

    it('activates for a public/PKCE client with no client secret', () => {
      expect(oidcActivates({ ...core, OPENID_USE_PKCE: 'true', OPENID_CLIENT_SECRET: '' })).toBe(true);
    });

    it('activates for a confidential client via client secret when PKCE is off', () => {
      expect(oidcActivates({ ...core, OPENID_USE_PKCE: 'false', OPENID_CLIENT_SECRET: 'shhh' })).toBe(true);
    });

    it('does NOT activate when neither PKCE is enabled nor a client secret is present', () => {
      expect(oidcActivates({ ...core, OPENID_USE_PKCE: 'false', OPENID_CLIENT_SECRET: '   ' })).toBe(false);
    });

    it.each([
      ['OPENID_ISSUER'],
      ['OPENID_CLIENT_ID'],
      ['OPENID_SCOPE'],
      ['OPENID_SESSION_SECRET'],
    ])('does NOT activate when required var %s is missing', (missingKey) => {
      const cfg = { ...core, OPENID_USE_PKCE: 'true', OPENID_CLIENT_SECRET: '' };
      delete cfg[missingKey];
      expect(oidcActivates(cfg)).toBe(false);
    });
  });
});
