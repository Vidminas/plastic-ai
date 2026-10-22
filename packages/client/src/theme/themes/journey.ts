import type { IThemeRGB, ThemeDefinition } from '../types';
import { defaultTheme } from './default';

/**
 * The learning journey theme: LibreChat's light palette with the learning journey page's colours
 * on its controls and copy. Backgrounds, hover and selection fills and borders stay the stock
 * light ones; text moves to warm browns, sending and focus to orange, and the primary button,
 * links and accents to teal. Status hues and the series scale stay the stock ones, so meanings
 * and chart colours do not change between themes.
 *
 * Only light mode is defined: dark mode keeps LibreChat's dark palette. Select it for a
 * deployment with `interface.theme: journey` in `librechat.yaml`.
 */
export const journeyLightTheme: IThemeRGB = {
  ...defaultTheme,

  // Text colors
  'rgb-text-primary': '41 32 28', // #29201c
  'rgb-text-secondary': '84 64 54', // #544036
  'rgb-text-secondary-alt': '99 77 66', // #634d42
  'rgb-text-tertiary': '99 77 66', // #634d42
  'rgb-text-muted': '107 85 74', // #6b554a
  'rgb-badge-label': '41 32 28', // matching text-primary
  'rgb-text-warning': '161 66 7', // #a14207
  'rgb-text-destructive': '185 28 28', // #b91c1c (red-700)
  'rgb-shimmer-base': '41 32 28', // matching text-primary
  'rgb-shimmer-dip': '158 132 116', // #9e8474

  // Link and accent colors
  'rgb-link': '15 108 101', // #0f6c65 (teal)
  'rgb-link-hover': '17 87 82', // #115752
  'rgb-link-visited': '157 23 77', // #9d174d (pink-800)
  'rgb-link-prose': '15 108 101', // matching link
  'rgb-accent-primary': '15 108 101', // matching link
  'rgb-accent-primary-hover': '17 87 82', // matching link-hover

  // Ring colors
  'rgb-ring-primary': '194 65 12', // #c2410c (orange-700)
  'rgb-focus-outline': '154 52 18', // #9a3412 (orange-800)
  'rgb-focus-control': '194 65 12', // matching ring-primary

  // Controls and prose marks
  'rgb-surface-submit': '194 65 12', // #c2410c (orange-700)
  'rgb-surface-submit-hover': '154 52 18', // #9a3412 (orange-800)
  'rgb-prose-bullet': '200 84 24', // #c85418
  'rgb-prose-quote-bar': '28 134 124', // #1c867c (teal)
  /** Also the checked switch track, which has to stand 3:1 off the unchecked one, so it stays
   *  near-black (warm) rather than taking the teal of the primary button. */
  'rgb-surface-inverted': '41 32 28', // #29201c, matching text-primary
  'rgb-surface-inverted-hover': '66 52 45', // #42342d
  'rgb-surface-inverted-pressed': '66 52 45', // matching surface-inverted-hover
  'rgb-button-primary': '17 87 82', // #115752 (deep teal)
  'rgb-button-primary-hover': '15 108 101', // #0f6c65, matching link

  // Field edges
  'rgb-border-control': '150 118 96', // #967660, 3:1 on every canvas
  'rgb-border-field-focus': '194 65 12', // matching focus-control

  // Brand colors
  'rgb-avatar-text': '41 32 28', // matching text-primary
  'rgb-illustration-subtle': '253 205 160', // #fdcda0
  'rgb-illustration': '245 132 66', // #f58442
  'rgb-illustration-strong': '194 65 12', // #c2410c

  // Code syntax highlighting
  'rgb-syntax-text': '41 32 28', // matching text-primary
  'rgb-syntax-comment': '99 77 66', // matching text-tertiary
  'rgb-syntax-meta': '84 64 54', // matching text-secondary

  'rgb-switch-unchecked': '140 118 104', // #8c7668, 3:1 against the thumb and the checked track
  'rgb-table-header-text': '84 64 54', // matching text-secondary
};

export const journeyTheme: ThemeDefinition = Object.freeze({
  version: 1,
  name: 'journey',
  modes: {
    light: { colors: journeyLightTheme },
  },
});
