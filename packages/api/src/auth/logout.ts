/**
 * Adds what Amazon Cognito's `/logout` endpoint requires to an RP-initiated logout URL.
 * Cognito publishes that endpoint as `end_session_endpoint` but ignores the standard
 * `post_logout_redirect_uri`, and fails without `client_id` and `logout_uri`, so its
 * managed login session would otherwise outlive the app's and sign the user back in
 * without a password. Other issuers are left untouched. `logoutUri` must be one of the
 * app client's allowed sign-out URLs.
 */
export function applyProviderLogoutParams(
  endSessionUrl: URL,
  { issuer, clientId, logoutUri }: { issuer?: string; clientId?: string; logoutUri: string },
): void {
  if (!isCognitoIssuer(issuer) || !clientId) {
    return;
  }
  endSessionUrl.searchParams.set('client_id', clientId);
  endSessionUrl.searchParams.set('logout_uri', logoutUri);
}

function isCognitoIssuer(issuer: string | undefined): boolean {
  if (!issuer) {
    return false;
  }
  try {
    return /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(new URL(issuer).hostname);
  } catch {
    return false;
  }
}
