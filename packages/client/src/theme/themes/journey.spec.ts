import type { IThemeRGB } from '../types';
import { libreChatTheme, resolveTheme, validateThemeDefinition } from '../registry';
import { journeyLightTheme, journeyTheme } from './journey';
import { paletteContrastChecks } from './contrast';

/** Backgrounds and borders the theme leaves on the stock light palette. */
const stockTokens: Array<keyof IThemeRGB> = [
  'rgb-surface-primary',
  'rgb-surface-primary-alt',
  'rgb-surface-secondary',
  'rgb-surface-tertiary',
  'rgb-surface-chat',
  'rgb-surface-dialog',
  'rgb-surface-hover',
  'rgb-surface-active',
  'rgb-surface-nav-selected',
  'rgb-surface-user-message',
  'rgb-border-light',
  'rgb-border-medium',
];

/** Roles that carry the theme's colour, which have to differ from LibreChat's. */
const divergentTokens: Array<keyof IThemeRGB> = [
  'rgb-text-primary',
  'rgb-text-secondary',
  'rgb-accent-primary',
  'rgb-surface-submit',
  'rgb-button-primary',
  'rgb-ring-primary',
  'rgb-link',
];

describe('journey light palette', () => {
  it.each(paletteContrastChecks(journeyLightTheme, { distinctLayers: false }))(
    '%s',
    (_check, failures) => {
      expect(failures).toEqual([]);
    },
  );
});

const theme = journeyLightTheme;

describe('journey theme definition', () => {
  it('validates as a data-only theme definition', () => {
    expect(validateThemeDefinition(journeyTheme)).toEqual([]);
  });

  it('paints light mode with its own palette and keeps the stock dark palette', () => {
    expect(resolveTheme(journeyTheme, 'light').colors).toEqual(journeyLightTheme);
    expect(resolveTheme(journeyTheme, 'dark').colors).toEqual(
      resolveTheme(libreChatTheme, 'dark').colors,
    );
  });

  it('keeps the stock light backgrounds and colours the text and controls', () => {
    const libreChat = resolveTheme(libreChatTheme, 'light').colors;
    expect(stockTokens.filter((token) => theme[token] !== libreChat[token])).toEqual([]);
    expect(divergentTokens.filter((token) => theme[token] === libreChat[token])).toEqual([]);
  });
});
