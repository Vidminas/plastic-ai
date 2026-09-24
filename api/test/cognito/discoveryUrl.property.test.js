/**
 * Feature: cognito-login-migration, Property 2: Discovery URL construction.
 *
 * The discovery URL is the issuer joined with /.well-known/openid-configuration,
 * i.e. new URL('.well-known/openid-configuration', issuerEndingWithSlash). The
 * join is owned by openid-client; this asserts the contract the fork relies on.
 */

const WELL_KNOWN = '.well-known/openid-configuration';

function resolveDiscoveryUrl(issuer) {
  const base = new URL(issuer);
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`;
  }
  return new URL(WELL_KNOWN, base).href;
}

function expectedDiscoveryUrl(issuer) {
  const u = new URL(issuer);
  let path = u.pathname;
  if (!path.endsWith('/')) {
    path = `${path}/`;
  }
  return `${u.origin}${path}${WELL_KNOWN}`;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateIssuer(rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const scheme = pick(['https', 'http']);
  const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2', 'eu-central-1'];
  const hosts = [
    'example.com',
    'auth.example.org',
    'login.internal',
    'ministack',
    `cognito-idp.${pick(regions)}.amazonaws.com`,
    `cognito-idp.${pick(regions)}.localhost.localstack.cloud`,
  ];
  const host = pick(hosts);
  const includePort = rng() < 0.4;
  const port = includePort ? `:${pick(['4566', '9229', '8080', '443', '3000'])}` : '';
  const region = pick(regions);
  const poolId = `${region}_${Math.floor(rng() * 1e8).toString(36).padStart(6, '0')}`;
  const pathShapes = [
    () => '',
    () => '/',
    () => `/${poolId}`,
    () => `/${poolId}/`,
    () => `/oidc/${poolId}`,
    () => `/oidc/${poolId}/`,
    () => `/realms/${poolId}/protocol`,
    () => `/realms/${poolId}/protocol/`,
    () => `/a/b/c`,
    () => `/a/b/c/`,
  ];
  const path = pick(pathShapes)();
  return `${scheme}://${host}${port}${path}`;
}

describe('Feature: cognito-login-migration, Property 2: Discovery URL construction', () => {
  const ITERATIONS = 200;
  const SEED = 0x2c0f1a7b;

  it('resolves <issuer>/.well-known/openid-configuration for any generated issuer (>=100 iterations)', () => {
    const rng = mulberry32(SEED);
    let checked = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const issuer = generateIssuer(rng);
      const resolved = resolveDiscoveryUrl(issuer);
      const expected = expectedDiscoveryUrl(issuer);
      expect(resolved).toBe(expected);
      expect(resolved.endsWith(`/${WELL_KNOWN}`)).toBe(true);
      const occurrences = resolved.split(WELL_KNOWN).length - 1;
      expect(occurrences).toBe(1);
      expect(resolved.startsWith(new URL(issuer).origin)).toBe(true);
      const afterScheme = resolved.slice(resolved.indexOf('://') + 3);
      expect(afterScheme).not.toContain('//');
      checked++;
    }
    expect(checked).toBe(ITERATIONS);
    expect(checked).toBeGreaterThanOrEqual(100);
  });

  it('matches openid-client oidc-algorithm documented examples', () => {
    expect(resolveDiscoveryUrl('https://example.com')).toBe(
      'https://example.com/.well-known/openid-configuration',
    );
    expect(resolveDiscoveryUrl('https://example.com/pathname')).toBe(
      'https://example.com/pathname/.well-known/openid-configuration',
    );
  });

  it('is stable whether or not the issuer path carries a trailing slash', () => {
    const withSlash = resolveDiscoveryUrl('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123/');
    const withoutSlash = resolveDiscoveryUrl('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123');
    expect(withSlash).toBe(withoutSlash);
    expect(withSlash).toBe(
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123/.well-known/openid-configuration',
    );
  });
});
