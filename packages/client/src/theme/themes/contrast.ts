import type { IThemeRGB } from '../types';
import { themeColorTokens } from '../registry';

/**
 * The contrast checks a bundled theme's palette is held to, shared by the theme specs so every
 * bundled theme meets the same rules.
 */

type Rgb = [number, number, number];

/** A brand theme, not an accessibility mode: WCAG AA rather than AAA. */
const WCAG_AA_NORMAL = 4.5;
/** WCAG 1.4.11 non-text contrast, for control boundaries, rings, fills and marks. */
const WCAG_NON_TEXT = 3;

const canvasSurfaces: Array<keyof IThemeRGB> = [
  'rgb-surface-primary',
  'rgb-chart-widget-surface',
  'rgb-surface-primary-alt',
  'rgb-surface-secondary',
  'rgb-surface-tertiary',
  'rgb-surface-tertiary-alt',
  'rgb-surface-dialog',
  'rgb-surface-chat',
  'rgb-surface-code',
  'rgb-surface-code-body',
  'rgb-presentation',
  'rgb-surface-canvas',
  'rgb-surface-card',
  'rgb-surface-card-hover',
  'rgb-surface-menu',
  'rgb-surface-popover',
  'rgb-surface-composer',
  'rgb-surface-search',
];

/** Fills a row or menu item takes on hover or selection, which carry the
 *  primary label. */
const interactiveFills: Array<keyof IThemeRGB> = [
  'rgb-surface-active',
  'rgb-surface-active-alt',
  'rgb-surface-hover',
  'rgb-surface-hover-alt',
  'rgb-surface-composer-hover',
  'rgb-surface-primary-contrast',
  'rgb-surface-secondary-alt',
  'rgb-header-primary',
  'rgb-header-hover',
  'rgb-header-button-hover',
  'rgb-surface-user-message',
  'rgb-surface-nav-hover',
  'rgb-surface-nav-selected',
  'rgb-surface-tab-selected',
];

const neutralTextTokens: Array<keyof IThemeRGB> = [
  'rgb-text-primary',
  'rgb-text-secondary',
  'rgb-text-secondary-alt',
  'rgb-text-tertiary',
  'rgb-text-muted',
];

const syntaxTokens: Array<keyof IThemeRGB> = [
  'rgb-syntax-text',
  'rgb-syntax-comment',
  'rgb-syntax-meta',
  'rgb-syntax-builtin',
  'rgb-syntax-keyword',
  'rgb-syntax-string',
  'rgb-syntax-attr',
  'rgb-syntax-title',
];

const accentTokens: Array<keyof IThemeRGB> = [
  'rgb-accent-primary',
  'rgb-accent-primary-hover',
  'rgb-link',
  'rgb-link-hover',
  'rgb-link-visited',
  'rgb-link-prose',
  'rgb-brand-purple',
];

/** Painted under `text-on-status`, the single per-mode label. */
const solidFills: Array<keyof IThemeRGB> = [
  'rgb-surface-submit',
  'rgb-surface-submit-hover',
  'rgb-surface-destructive',
  'rgb-surface-destructive-hover',
  'rgb-status-success-strong',
  'rgb-status-info-strong',
  'rgb-status-warning-strong',
  'rgb-status-error-strong',
];

/** The roles whose only job is to outline a control. `border-light` through
 *  `border-heavy` paint dividers and card edges, and `border-medium` also
 *  outlines inputs such as `Select` and `InputNumber`: that one sits at 1.24:1
 *  here and 1.52:1 in the LibreChat palette, a gap the registry has no
 *  control-boundary role to close, so it is left to a follow-up rather than
 *  asserted. */
const boundaryTokens: Array<keyof IThemeRGB> = [
  'rgb-border-xheavy',
  'rgb-border-destructive',
  'rgb-ring-primary',
];

const seriesTokens = Array.from(
  { length: 8 },
  (_, index) => `rgb-series-${index + 1}` as keyof IThemeRGB,
);

const statusHues = ['success', 'info', 'warning', 'error', 'neutral'] as const;

function toRgb(theme: IThemeRGB, token: keyof IThemeRGB): Rgb {
  const parts = theme[token]?.trim().split(/\s+/).map(Number);
  if (parts?.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`theme token "${token}" is not an "R G B" triplet`);
  }
  return [parts[0], parts[1], parts[2]];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function below(
  theme: IThemeRGB,
  minimum: number,
  foregrounds: Array<keyof IThemeRGB>,
  backgrounds: Array<keyof IThemeRGB>,
): string[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.flatMap((background) => {
      const ratio = contrast(toRgb(theme, foreground), toRgb(theme, background));
      return ratio < minimum
        ? [`${foreground} on ${background}: ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`]
        : [];
    }),
  );
}

export interface PaletteContrastOptions {
  /**
   * Whether every surface layer has to step off the one it sits on. A theme that keeps the
   * stock light layers leaves this off, since some of those share a fill.
   */
  distinctLayers?: boolean;
}

/**
 * The palette checks for `theme`, each with what fails it (empty when it passes). A spec turns
 * them into tests with `it.each(paletteContrastChecks(theme))`.
 */
export function paletteContrastChecks(
  theme: IThemeRGB,
  { distinctLayers = true }: PaletteContrastOptions = {},
): Array<[check: string, failures: string[]]> {
  const checks: Array<[string, string[]]> = [];
  let failures: string[] = [];
  const none = (found: string[]) => {
    failures.push(...found);
  };
  const it = (check: string, run: () => void) => {
    failures = [];
    run();
    checks.push([check, failures]);
  };
  {
    it('declares every registry token, so nothing falls back to the LibreChat palette', () => {
      none(themeColorTokens.filter((token) => theme[token] == null));
      none(
        Object.keys(theme).filter((key) => !(themeColorTokens as readonly string[]).includes(key)),
      );
    });

    it('keeps neutral text at WCAG AA on every canvas surface', () => {
      none(below(theme, WCAG_AA_NORMAL, neutralTextTokens, canvasSurfaces));
    });

    it('keeps primary text at WCAG AA on hover, selected and header fills', () => {
      none(below(theme, WCAG_AA_NORMAL, ['rgb-text-primary'], interactiveFills));
    });

    /** The chat error box, the route error boundary, the sign-in notices and the
     *  deleted rows of a diff paint neutral copy on a status fill rather than on a
     *  canvas. `text-muted` is left out because no consumer puts it on one. */
    it('keeps the text roles that meet status fills at WCAG AA on every one', () => {
      const fills = statusHues.map((hue) => `rgb-status-${hue}-subtle` as keyof IThemeRGB);
      const onStatusFills: Array<keyof IThemeRGB> = [
        'rgb-text-primary',
        'rgb-text-secondary',
        'rgb-text-secondary-alt',
        'rgb-text-tertiary',
        'rgb-text-destructive',
      ];
      none(below(theme, WCAG_AA_NORMAL, onStatusFills, fills));
    });

    it('keeps the primary button label at WCAG AA on its fill, hovered and pressed', () => {
      none(
        below(
          theme,
          WCAG_AA_NORMAL,
          ['rgb-text-inverted'],
          ['rgb-button-primary', 'rgb-button-primary-hover', 'rgb-surface-inverted-pressed'],
        ),
      );
    });

    it('keeps warning and destructive text at WCAG AA on canvas surfaces', () => {
      none(
        below(theme, WCAG_AA_NORMAL, ['rgb-text-warning', 'rgb-text-destructive'], canvasSurfaces),
      );
    });

    it('keeps every status hue at WCAG AA against its own subtle fill', () => {
      const failures = statusHues.flatMap((hue) =>
        below(
          theme,
          WCAG_AA_NORMAL,
          [`rgb-status-${hue}` as keyof IThemeRGB],
          [`rgb-status-${hue}-subtle` as keyof IThemeRGB],
        ),
      );
      none(failures);
    });

    it('keeps accents and links at WCAG AA on the page', () => {
      none(
        below(theme, WCAG_AA_NORMAL, accentTokens, [
          'rgb-surface-primary',
          'rgb-surface-secondary',
        ]),
      );
    });

    it('keeps every syntax colour at WCAG AA on the code surface', () => {
      none(
        below(theme, WCAG_AA_NORMAL, syntaxTokens, ['rgb-surface-code', 'rgb-surface-code-body']),
      );
    });

    it('keeps inverted and fixed pairs at WCAG AA', () => {
      none(
        below(
          theme,
          WCAG_AA_NORMAL,
          ['rgb-text-inverted'],
          ['rgb-surface-inverted', 'rgb-surface-inverted-hover'],
        ),
      );
      none(
        below(
          theme,
          WCAG_AA_NORMAL,
          ['rgb-text-fixed'],
          ['rgb-surface-fixed', 'rgb-surface-fixed-hover'],
        ),
      );
    });

    it('carries the status label at WCAG AA on every solid fill', () => {
      none(below(theme, WCAG_AA_NORMAL, ['rgb-text-on-status'], solidFills));
    });

    it('keeps solid fills and the verified mark at the 3:1 floor against the page', () => {
      none(
        below(
          theme,
          WCAG_NON_TEXT,
          [...solidFills, 'rgb-status-verified'],
          ['rgb-surface-primary', 'rgb-surface-secondary', 'rgb-surface-dialog'],
        ),
      );
      none(below(theme, WCAG_NON_TEXT, ['rgb-text-on-status'], ['rgb-status-verified']));
    });

    it('keeps control boundaries and rings at the 3:1 floor on every canvas', () => {
      none(
        below(theme, WCAG_NON_TEXT, boundaryTokens, [
          'rgb-surface-primary',
          'rgb-surface-secondary',
          'rgb-surface-tertiary',
          'rgb-surface-dialog',
        ]),
      );
    });

    it('keeps the list marker and the quote bar at the 3:1 floor on the page and the user bubble', () => {
      none(
        below(
          theme,
          WCAG_NON_TEXT,
          ['rgb-prose-bullet', 'rgb-prose-quote-bar'],
          [
            'rgb-surface-chat',
            'rgb-surface-primary',
            'rgb-presentation',
            'rgb-surface-user-message',
          ],
        ),
      );
    });

    it('keeps the inline code chip off the user message bubble it can sit on', () => {
      none(
        theme['rgb-surface-code-inline'] === theme['rgb-surface-user-message']
          ? ['rgb-surface-code-inline matches rgb-surface-user-message']
          : [],
      );
    });

    it('keeps primary text at WCAG AA on the inline code chip', () => {
      none(below(theme, WCAG_AA_NORMAL, ['rgb-text-primary'], ['rgb-surface-code-inline']));
    });

    it('keeps every series mark at the 3:1 floor on the page and under the status label', () => {
      none(
        below(theme, WCAG_NON_TEXT, seriesTokens, [
          'rgb-surface-primary',
          'rgb-surface-secondary',
          'rgb-surface-tertiary',
          'rgb-surface-chat',
          'rgb-surface-dialog',
          'rgb-text-on-status',
        ]),
      );
    });

    it('never reuses a reserved status colour for series identity', () => {
      const reserved = new Set(
        statusHues.map((hue) => theme[`rgb-status-${hue}` as keyof IThemeRGB]),
      );
      none(seriesTokens.filter((token) => reserved.has(theme[token])));
    });

    if (distinctLayers) {
      it('steps each layer off the one it sits on, so hover and selection stay apart', () => {
        const layers: Array<[keyof IThemeRGB, keyof IThemeRGB]> = [
          ['rgb-surface-user-message', 'rgb-surface-canvas'],
          ['rgb-surface-card-hover', 'rgb-surface-card'],
          ['rgb-surface-nav-selected', 'rgb-surface-nav-hover'],
          ['rgb-surface-nav-hover', 'rgb-surface-primary-alt'],
          ['rgb-surface-tab-selected', 'rgb-surface-dialog'],
          ['rgb-surface-search', 'rgb-surface-primary-alt'],
          ['rgb-border-menu', 'rgb-surface-menu'],
        ];
        none(
          layers
            .filter(([layer, ground]) => theme[layer] === theme[ground])
            .map(([layer, ground]) => `${layer} matches ${ground}`),
        );
      });
    }
  }
  return checks;
}
