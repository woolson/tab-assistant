export type QuickSearchMaterial = 'classic' | 'frosted' | 'liquid'
export const QUICK_SEARCH_CORNER_RADIUS = 38

export interface QuickSearchAppearance {
  quickSearchMaterial: QuickSearchMaterial
  quickSearchTransparency: number
  quickSearchBlur: number
  theme: 'system' | 'light' | 'dark'
}

/** Normalize legacy settings and bound the cost/contrast of custom glass effects. */
export function quickSearchAppearance(value?: unknown): QuickSearchAppearance {
  const settings = value && typeof value === 'object' ? value as Partial<QuickSearchAppearance> : {}
  const number = (input: unknown, fallback: number, min: number, max: number) => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(max, Math.max(min, input))) : fallback
  return {
    // Liquid Glass is temporarily hidden; keep legacy backups compatible with frosted rendering.
    quickSearchMaterial: settings.quickSearchMaterial === 'classic' ? 'classic' : 'frosted',
    quickSearchTransparency: number(settings.quickSearchTransparency, 45, 20, 80),
    quickSearchBlur: number(settings.quickSearchBlur, 24, 8, 40),
    theme: settings.theme === 'dark' || settings.theme === 'light' ? settings.theme : 'system',
  }
}

export function quickSearchGlassVariables(appearance: QuickSearchAppearance): Record<string, string> {
  const density = 1 - appearance.quickSearchTransparency / 100
  const dark = appearance.theme === 'dark'
  const frosted = appearance.quickSearchMaterial === 'frosted'
  // Older backups retain their values, while frosted rendering uses theme-specific presets.
  const frostedOpacity = dark ? .76 : .72
  const opacity = appearance.quickSearchMaterial === 'classic' ? 1 : frosted ? frostedOpacity : density * .34
  const blur = frosted ? dark ? 28 : 24 : appearance.quickSearchBlur
  return { '--qs-glass-opacity': opacity.toFixed(2), '--qs-glass-blur': `${blur}px`, '--qs-corner-radius': `${QUICK_SEARCH_CORNER_RADIUS}px` }
}
