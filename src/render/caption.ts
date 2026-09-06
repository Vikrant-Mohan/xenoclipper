/**
 * Caption styling for the karaoke burn-in: fonts, color themes, highlight
 * modes, font size and on-screen position. These are picked in the UI (live
 * preview on the transcript) and fed to the .ass generator at render time.
 */

export type CaptionSize = 'small' | 'medium' | 'large'
export type CaptionPosition = 'bottom' | 'center' | 'top'
export type CaptionThemeId = 'sunset' | 'mono' | 'neon' | 'paper'
export type CaptionFontId =
  | 'lato'
  | 'poppins'
  | 'anton'
  | 'bangers'
  | 'bebas'
  | 'luckiest'
export type HighlightMode = 'fill' | 'spotlight'

export interface CaptionFont {
  id: CaptionFontId
  name: string
  /** Family name libass must see inside the FFmpeg virtual FS. */
  assFamily: string
  /** CSS family for the page preview. */
  cssFamily: string
  /** File served from /fonts and written into FFmpeg's FS. */
  file: string
  /** Extra scale factor — condensed/display faces read smaller at equal px. */
  opticalScale: number
  /** Some display faces have no bold cut; libass synthetic bold looks bad. */
  bold: boolean
}

export const CAPTION_FONTS: CaptionFont[] = [
  {
    id: 'lato',
    name: 'Clean',
    assFamily: 'Lato',
    cssFamily: "'Lato', sans-serif",
    file: 'Lato-Bold.ttf',
    opticalScale: 1,
    bold: true,
  },
  {
    id: 'poppins',
    name: 'Rounded',
    assFamily: 'Poppins',
    cssFamily: "'Poppins', sans-serif",
    file: 'Poppins-Bold.ttf',
    opticalScale: 1,
    bold: true,
  },
  {
    id: 'anton',
    name: 'Impact',
    assFamily: 'Anton',
    cssFamily: "'Anton', sans-serif",
    file: 'Anton-Regular.ttf',
    opticalScale: 1.08,
    bold: false,
  },
  {
    id: 'bangers',
    name: 'Comic',
    assFamily: 'Bangers',
    cssFamily: "'Bangers', cursive",
    file: 'Bangers-Regular.ttf',
    opticalScale: 1.12,
    bold: false,
  },
  {
    id: 'bebas',
    name: 'Tall',
    assFamily: 'Bebas Neue',
    cssFamily: "'Bebas Neue', sans-serif",
    file: 'BebasNeue-Regular.ttf',
    opticalScale: 1.1,
    bold: false,
  },
  {
    id: 'luckiest',
    name: 'Cartoon',
    assFamily: 'Luckiest Guy',
    cssFamily: "'Luckiest Guy', cursive",
    file: 'LuckiestGuy-Regular.ttf',
    opticalScale: 1.06,
    bold: false,
  },
]

export interface CaptionTheme {
  id: CaptionThemeId
  name: string
  /** CSS hex (no alpha) — one source of truth for both the page preview and ASS. */
  /** Karaoke fill — the word turns this color as it is spoken. */
  fill: string
  /** Upcoming (not yet spoken) words. */
  base: string
  /** Text outline color (pops on busy footage). */
  outline: string
  /** Drop-shadow color. */
  shadow: string
}

export const CAPTION_THEMES: CaptionTheme[] = [
  {
    id: 'sunset',
    name: 'Sunset',
    fill: '#FFD60A', // yellow
    base: '#FFFFFF', // white
    outline: '#000000',
    shadow: '#000000',
  },
  {
    id: 'mono',
    name: 'Mono',
    fill: '#FFFFFF', // white
    base: '#9CA3AF', // gray
    outline: '#000000',
    shadow: '#000000',
  },
  {
    id: 'neon',
    name: 'Neon',
    fill: '#FF2E93', // hot pink
    base: '#FFFFFF',
    outline: '#3B0A6B', // deep purple
    shadow: '#1A0436',
  },
  {
    id: 'paper',
    name: 'Paper',
    fill: '#101828', // near-black
    base: '#344054',
    outline: '#FFFFFF', // white outline → pops on bright footage
    shadow: '#000000',
  },
]

const THEME_MAP = Object.fromEntries(
  CAPTION_THEMES.map((t) => [t.id, t]),
) as Record<CaptionThemeId, CaptionTheme>

/**
 * Highlight colors for `spotlight` mode: the currently-spoken word is tinted
 * with this color while every other word stays white. User-pickable.
 */
export const HIGHLIGHT_COLORS: string[] = [
  '#FFD60A', // yellow
  '#38BDF8', // sky blue
  '#4ADE80', // green
  '#FF2E93', // pink
  '#A78BFA', // violet
  '#FF6B35', // orange
]

export interface CaptionStyle {
  theme: CaptionThemeId
  font: CaptionFontId
  size: CaptionSize
  position: CaptionPosition
  /**
   * `fill` = karaoke: upcoming words in the theme base color, each word
   * flashes to the theme fill as it is spoken (classic pop-caption).
   * `spotlight` = every word white; the word being spoken right now is
   * tinted with `highlightColor`.
   */
  highlight: HighlightMode
  /** Spotlight tint (CSS hex). Ignored in `fill` mode. */
  highlightColor: string
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  theme: 'sunset',
  font: 'lato',
  size: 'medium',
  position: 'bottom',
  highlight: 'fill',
  highlightColor: HIGHLIGHT_COLORS[0],
}

export const SIZE_OPTIONS: {
  id: CaptionSize
  label: string
  /** ASS font size as a fraction of the output height. */
  fontScale: number
}[] = [
  { id: 'small', label: 'Small', fontScale: 0.052 },
  { id: 'medium', label: 'Medium', fontScale: 0.064 },
  { id: 'large', label: 'Large', fontScale: 0.084 },
]

export const POSITION_OPTIONS: {
  id: CaptionPosition
  label: string
  /** ASS Alignment (2 = bottom-center, 5 = middle, 8 = top-center). */
  alignment: number
  /** Safe margin from the chosen edge, as a fraction of output height. */
  marginVFrac: number
}[] = [
  { id: 'bottom', label: 'Bottom', alignment: 2, marginVFrac: 0.13 },
  { id: 'center', label: 'Center', alignment: 5, marginVFrac: 0.03 },
  { id: 'top', label: 'Top', alignment: 8, marginVFrac: 0.11 },
]

export const HIGHLIGHT_MODES: {
  id: HighlightMode
  label: string
  description: string
}[] = [
  {
    id: 'fill',
    label: 'Fill',
    description: 'words flash to the theme color as spoken',
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'current word tinted, rest white',
  },
]

export function themeFor(style: CaptionStyle): CaptionTheme {
  return THEME_MAP[style.theme] ?? THEME_MAP.sunset
}

export function fontFor(style: CaptionStyle): CaptionFont {
  return CAPTION_FONTS.find((f) => f.id === style.font) ?? CAPTION_FONTS[0]
}

export function sizeFor(style: CaptionStyle): (typeof SIZE_OPTIONS)[number] {
  return SIZE_OPTIONS.find((s) => s.id === style.size) ?? SIZE_OPTIONS[1]
}

export function positionFor(style: CaptionStyle): (typeof POSITION_OPTIONS)[number] {
  return POSITION_OPTIONS.find((p) => p.id === style.position) ?? POSITION_OPTIONS[0]
}

/** #RRGGBB → ASS &HAABBGGRR (A=00 opaque, BGR byte order). */
export function assColor(hex: string): string {
  const b = parseInt(hex.slice(5, 7), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const r = parseInt(hex.slice(1, 3), 16)
  const h = (v: number): string => v.toString(16).padStart(2, '0').toUpperCase()
  return `&H00${h(b)}${h(g)}${h(r)}`
}
