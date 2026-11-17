/**
 * Typed references to the design tokens in `tokens.css` (T-1159). Values live only in the CSS
 * file; this module holds `var(--…)` strings so components cannot misspell a token name
 * (`test/uiTokens.test.ts` checks every reference resolves).
 */
const v = <T extends string>(name: T) => `var(--ov-${name})` as const;

export const color = {
  page: v('color-page'),
  surfaceLight: v('color-surface-light'),
  text: v('color-text'),
  textMuted: v('color-text-muted'),
  border: v('color-border'),
  danger: v('color-danger'),
  hud: v('color-hud'),
  hudText: v('color-hud-text'),
  hudTextMuted: v('color-hud-text-muted'),
  hudControl: v('color-hud-control'),
  hudBorder: v('color-hud-border'),
  hudDangerText: v('color-hud-danger-text'),
  hudDangerBg: v('color-hud-danger-bg'),
  hudDangerBorder: v('color-hud-danger-border'),
  alert: v('color-alert'),
  alertText: v('color-alert-text'),
  accent: v('color-accent'),
  onAccent: v('color-on-accent'),
  selected: v('color-selected'),
} as const;

export const space = {
  1: v('space-1'),
  2: v('space-2'),
  3: v('space-3'),
  4: v('space-4'),
  5: v('space-5'),
  6: v('space-6'),
} as const;

export const radius = { sm: v('radius-sm'), md: v('radius-md'), lg: v('radius-lg') } as const;

export const font = {
  family: v('font-family'),
  xs: v('font-size-xs'),
  sm: v('font-size-sm'),
  md: v('font-size-md'),
  lg: v('font-size-lg'),
  xl: v('font-size-xl'),
  regular: v('font-weight-regular'),
  medium: v('font-weight-medium'),
  bold: v('font-weight-bold'),
  lineHeight: v('line-height'),
} as const;

export const shadow = { 1: v('shadow-1'), 2: v('shadow-2') } as const;

/** Shared look of the dark HUD panels drawn over the 3D view. */
export const hudPanel = {
  color: color.hudText,
  background: color.hud,
  borderRadius: radius.md,
  boxShadow: shadow[1],
  fontFamily: font.family,
  lineHeight: font.lineHeight,
} as const;
