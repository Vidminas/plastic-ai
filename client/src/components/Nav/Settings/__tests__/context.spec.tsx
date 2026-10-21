import { RecoilRoot } from 'recoil';
import { renderHook } from '@testing-library/react';
import type { TUser } from 'librechat-data-provider';
import type { PropsWithChildren } from 'react';
import { useSettingsContext } from '../context';

type LegacyProviderUser = Omit<TUser, 'provider'> & { provider?: string | null };

let mockUser: LegacyProviderUser | undefined;
let mockAccess: Record<string, boolean> = {};
let mockStartupConfig: { sharedLinksEnabled?: boolean } | undefined;

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useHasAccess: ({ permissionType, permission }: { permissionType: string; permission: string }) =>
    mockAccess[`${permissionType}:${permission}`] === true,
  useGetAgentsConfig: () => ({ agentsConfig: undefined }),
}));

jest.mock('~/hooks/usePersonalizationAccess', () => () => ({
  hasAnyPersonalizationFeature: false,
  hasMemoryOptOut: false,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

jest.mock('../../SettingsTabs/ProviderKeys/useProviderKeys', () => () => []);

const baseUser: Omit<TUser, 'provider'> = {
  id: 'user-1',
  username: 'policy-user',
  email: 'policy-user@example.com',
  name: 'Policy User',
  avatar: '',
  role: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const wrapper = ({ children }: PropsWithChildren) => <RecoilRoot>{children}</RecoilRoot>;

function policyProviderFor(user: LegacyProviderUser | undefined): boolean {
  mockUser = user;
  return renderHook(() => useSettingsContext(), { wrapper }).result.current
    .isTwoFactorPolicyProvider;
}

const userWith = (provider: string | null | undefined): LegacyProviderUser => ({
  ...baseUser,
  provider,
});

describe('useSettingsContext two-factor policy scope', () => {
  afterEach(() => {
    mockUser = undefined;
  });

  it.each(['local', 'ldap', null, undefined])(
    'derives the policy capability from an authenticated user with provider %s',
    (provider) => {
      expect(policyProviderFor(userWith(provider))).toBe(true);
    },
  );

  it('keeps a legacy user document with no provider field eligible', () => {
    expect(policyProviderFor(baseUser)).toBe(true);
  });

  it.each(['openid', 'google', 'saml'])(
    'withholds the policy capability from federated provider %s',
    (provider) => {
      expect(policyProviderFor(userWith(provider))).toBe(false);
    },
  );

  it('withholds the policy capability when no authenticated user is loaded', () => {
    expect(policyProviderFor(undefined)).toBe(false);
  });
});

describe('useSettingsContext shared links', () => {
  afterEach(() => {
    mockAccess = {};
    mockStartupConfig = undefined;
  });

  const sharedLinksEnabled = () =>
    renderHook(() => useSettingsContext(), { wrapper }).result.current.sharedLinksEnabled;

  it('offers shared links when the server allows them and the role may create them', () => {
    mockStartupConfig = { sharedLinksEnabled: true };
    mockAccess = { 'SHARED_LINKS:CREATE': true };
    expect(sharedLinksEnabled()).toBe(true);
  });

  it('leaves them out when the role may not create them, as `{ create: false }` sets', () => {
    mockStartupConfig = { sharedLinksEnabled: true };
    expect(sharedLinksEnabled()).toBe(false);
  });

  it('leaves them out when the server does not allow them', () => {
    mockStartupConfig = { sharedLinksEnabled: false };
    mockAccess = { 'SHARED_LINKS:CREATE': true };
    expect(sharedLinksEnabled()).toBe(false);
  });
});
