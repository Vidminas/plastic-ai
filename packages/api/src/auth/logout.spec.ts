import { applyProviderLogoutParams } from './logout';

const logoutUri = 'https://chat.example.com/login';

describe('applyProviderLogoutParams', () => {
  it('adds client_id and logout_uri for a Cognito issuer', () => {
    const url = new URL('https://plastic-ai-123.auth.eu-west-2.amazoncognito.com/logout');
    url.searchParams.set('id_token_hint', 'token');
    applyProviderLogoutParams(url, {
      issuer: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_abc',
      clientId: 'client-1',
      logoutUri,
    });
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('logout_uri')).toBe(logoutUri);
    expect(url.searchParams.get('id_token_hint')).toBe('token');
  });

  it('leaves other issuers to standard RP-initiated logout', () => {
    const url = new URL('https://login.example.com/end-session');
    applyProviderLogoutParams(url, {
      issuer: 'https://login.example.com/realms/app',
      clientId: 'client-1',
      logoutUri,
    });
    expect(url.search).toBe('');
  });

  it('does not mistake a look-alike host for Cognito', () => {
    const url = new URL('https://evil.example.com/logout');
    applyProviderLogoutParams(url, {
      issuer: 'https://cognito-idp.eu-west-2.amazonaws.com.evil.example.com/pool',
      clientId: 'client-1',
      logoutUri,
    });
    expect(url.search).toBe('');
  });

  it('adds nothing without a client ID or an issuer', () => {
    const url = new URL('https://plastic-ai-123.auth.eu-west-2.amazoncognito.com/logout');
    applyProviderLogoutParams(url, { issuer: 'not a url', clientId: 'client-1', logoutUri });
    applyProviderLogoutParams(url, {
      issuer: 'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_abc',
      logoutUri,
    });
    expect(url.search).toBe('');
  });
});
