import fs from 'fs';
import path from 'path';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import type { ThemeMode, IThemeRGB } from '../types';
import {
  defaultAppearance,
  libreChatTheme,
  resolveTheme,
  validateThemeDefinition,
} from '../registry';
import { clickHouseDarkTheme, clickHouseLightTheme, clickHouseTheme } from './clickhouse';
import { ThemeProvider } from '../context/ThemeProvider';
import { paletteContrastChecks } from './contrast';

/** Roles a reader would name as "the theme": if these match LibreChat's, the
 *  reference theme proves nothing. Light `surface-primary` is the one exception:
 *  Click UI's `background.default` and LibreChat's light canvas are both
 *  #ffffff, which the definition test asserts rather than hides. */
const divergentTokens: Array<keyof IThemeRGB> = [
  'rgb-surface-primary',
  'rgb-surface-secondary',
  'rgb-text-primary',
  'rgb-text-secondary',
  'rgb-border-light',
  'rgb-accent-primary',
  'rgb-surface-submit',
  'rgb-link',
];

const modes: Array<[ThemeMode, IThemeRGB]> = [
  ['light', clickHouseLightTheme],
  ['dark', clickHouseDarkTheme],
];

describe.each(modes)('clickhouse %s palette', (_mode, theme) => {
  it.each(paletteContrastChecks(theme))('%s', (_check, failures) => {
    expect(failures).toEqual([]);
  });
});

describe('clickhouse theme definition', () => {
  it('validates as a data-only theme definition', () => {
    expect(validateThemeDefinition(clickHouseTheme)).toEqual([]);
  });

  it.each(modes)('resolves %s mode to its own palette without fallback', (mode, palette) => {
    const resolved = resolveTheme(clickHouseTheme, mode);

    expect(resolved.name).toBe('clickhouse');
    expect(resolved.colors).toEqual(palette);
    expect(resolved.appearance).toMatchObject({
      controlRadius: '0.25rem',
      surfaceRadius: '0.5rem',
      largeSurfaceRadius: '0.75rem',
      roundControlRadius: '9999px',
    });
    expect(resolved.appearance.fontFamily).toMatch(/^"Inter", "SF Pro Display"/);
    expect(resolved.appearance.monoFontFamily).toBe(
      '"Inconsolata", Consolas, "SFMono Regular", monospace',
    );
    /** Click UI's `border.radii` 1, 2 and 3. */
    expect(resolved.appearance).toMatchObject({
      radiusSm: '0.25rem',
      radiusMd: '0.25rem',
      radiusLg: '0.25rem',
      radiusXl: '0.5rem',
      radius2xl: '0.5rem',
      radius3xl: '0.75rem',
    });
    /** Click UI's `shadow.1`, deeper in dark mode, raises every surface. */
    const alpha = mode === 'light' ? '0.15' : '0.6';
    expect(resolved.appearance.shadowLg).toBe(
      `0 4px 6px -1px rgb(21 21 21 / ${alpha}), 0 2px 4px -1px rgb(21 21 21 / ${alpha})`,
    );
    expect(resolved.appearance.elevationSurface).toBe(resolved.appearance.shadowLg);
  });

  it.each(modes)('repaints the %s canvas, text, border and accent roles', (mode) => {
    const clickHouse = resolveTheme(clickHouseTheme, mode);
    const libreChat = resolveTheme(libreChatTheme, mode);
    const expectedShared = mode === 'light' ? ['rgb-surface-primary'] : [];

    expect(
      divergentTokens.filter((token) => clickHouse.colors[token] === libreChat.colors[token]),
    ).toEqual(expectedShared);
    expect(clickHouse.appearance.controlRadius).not.toBe(defaultAppearance.controlRadius);
    expect(clickHouse.appearance.surfaceRadius).not.toBe(defaultAppearance.surfaceRadius);
    expect(clickHouse.appearance.largeSurfaceRadius).not.toBe(defaultAppearance.largeSurfaceRadius);

    /** The plain utilities' scales move too, not only the `theme-*` roles. `rounded-sm` is left
     *  out: Click UI's `radii.1` (0.25rem) renders the same as LibreChat's `calc(0.5rem - 4px)`
     *  on a 16px root. */
    const shapeTokens = [
      'radiusMd',
      'radiusLg',
      'radiusXl',
      'radius2xl',
      'radius3xl',
      'monoFontFamily',
      'shadowXs',
      'shadowSm',
      'shadowMd',
      'shadowLg',
      'shadowXl',
      'shadow2xl',
      'elevationSurface',
      'controlHeight',
      'controlPaddingX',
      'controlGap',
      'motionFast',
    ] as const;
    expect(
      shapeTokens.filter((token) => clickHouse.appearance[token] === libreChat.appearance[token]),
    ).toEqual([]);
  });

  /** Click UI draws no stroke on icon buttons or chat chrome and separates a card's regions by
   *  fill; its keyboard outline is the focus ring. */
  it.each<ThemeMode>(['light', 'dark'])(
    'draws no chrome or inset border and rings subtle focus in the outline in %s',
    (mode) => {
      const { appearance, colors } = resolveTheme(clickHouseTheme, mode);
      expect([appearance.chromeBorderAlpha, appearance.insetBorderAlpha]).toEqual(['0', '0']);
      expect(colors['rgb-focus-subtle']).toBe(colors['rgb-focus-outline']);
    },
  );

  /** Click UI's control height, button padding and gap, `transition.default`, and the two steps of
   *  its `spaces` scale the shared spacing takes. */
  it('squares the composer actions and brings its popovers onto the menu corner', () => {
    const { appearance } = resolveTheme(clickHouseTheme, 'light');
    expect(appearance).toMatchObject({
      composerActionRadius: '0.25rem',
      popoverRadius: appearance.menuRadius,
      menuPanelRadius: appearance.menuRadius,
      inlineCodeWeight: '500',
    });
  });

  it('bundles the Inconsolata face the inline code weight selects', () => {
    const { appearance } = resolveTheme(clickHouseTheme, 'light');
    const fonts = fs.readFileSync(path.resolve(__dirname, '../fonts.css'), 'utf8');
    const faces = fonts.match(/font-family: Inconsolata;[^}]*font-weight: (\d+);/g) ?? [];
    expect(faces.map((face) => face.match(/font-weight: (\d+)/)?.[1])).toContain(
      appearance.inlineCodeWeight,
    );
  });

  it('sizes theme controls and the shared spacing from Click UI', () => {
    const { appearance } = resolveTheme(clickHouseTheme, 'light');
    expect(appearance).toMatchObject({
      controlHeight: '2rem',
      controlPaddingX: '1rem',
      controlGap: '0.5rem',
      controlFontWeight: '400',
      buttonHeight: '2rem',
      buttonHeightSm: '2rem',
      motionFast: '100ms',
    });
    expect(appearance.spaceCompact).toBe('0.5rem');
    expect(appearance.spaceNormal).toBe(defaultAppearance.spaceNormal);
  });

  /** The checkbox, switch and default button share `surface-inverted`. Dark mode takes Click UI's
   *  primary fill, which its checkbox and switch also use; light keeps `#151515`, the checkbox and
   *  switch colour. Every focus ring takes `outline.default`. */
  it.each([
    ['light', clickHouseLightTheme, '21 21 21', '67 126 239'],
    ['dark', clickHouseDarkTheme, '250 255 105', '250 255 105'],
  ])('paints the %s primary fill and focus ring from Click UI', (_mode, theme, fill, ring) => {
    expect(theme['rgb-surface-inverted']).toBe(fill);
    expect(theme['rgb-ring-primary']).toBe(ring);
  });

  it('keeps the brand yellow as the dark-mode accent and link', () => {
    expect(clickHouseDarkTheme['rgb-accent-primary']).toBe('250 255 105');
    expect(clickHouseDarkTheme['rgb-surface-submit']).toBe('250 255 105');
    expect(clickHouseDarkTheme['rgb-link']).toBe('250 255 105');
  });
});

describe('clickhouse theme at runtime', () => {
  const matchMedia = (): MediaQueryList =>
    ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }) as MediaQueryList;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    window.matchMedia = jest.fn(matchMedia);
  });

  const renderProvider = (initialTheme: ThemeMode, themeDefinition = clickHouseTheme) => (
    <ThemeProvider
      initialTheme={initialTheme}
      persistThemeDefinition={false}
      themeDefinition={themeDefinition}
    >
      {null}
    </ThemeProvider>
  );

  const property = (name: string) => document.documentElement.style.getPropertyValue(name);

  it('repaints the root from the definition in both modes and hands back to LibreChat', async () => {
    const { rerender } = render(renderProvider('light'));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('clickhouse');
    });
    expect(property('--surface-primary')).toBe(clickHouseLightTheme['rgb-surface-primary']);
    expect(property('--text-primary')).toBe(clickHouseLightTheme['rgb-text-primary']);
    expect(property('--theme-control-radius')).toBe('0.25rem');

    rerender(renderProvider('dark'));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });
    expect(property('--surface-primary')).toBe(clickHouseDarkTheme['rgb-surface-primary']);
    expect(property('--text-primary')).toBe(clickHouseDarkTheme['rgb-text-primary']);
    expect(property('--theme-control-radius')).toBe('0.25rem');
    expect(property('--theme-radius-lg')).toBe('0.25rem');
    expect(property('--theme-shadow-lg')).toContain('rgb(21 21 21 / 0.6)');

    rerender(renderProvider('dark', libreChatTheme));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('librechat');
    });
    const libreChatDark = resolveTheme(libreChatTheme, 'dark');
    expect(property('--surface-primary')).toBe(libreChatDark.colors['rgb-surface-primary']);
    expect(property('--text-primary')).toBe(libreChatDark.colors['rgb-text-primary']);
    expect(property('--theme-control-radius')).toBe(defaultAppearance.controlRadius);
    expect(property('--theme-radius-lg')).toBe(defaultAppearance.radiusLg);
    expect(property('--theme-shadow-lg')).toBe(defaultAppearance.shadowLg);
  });
});
