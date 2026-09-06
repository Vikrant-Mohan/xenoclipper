import type { Word } from '../transcription/types'
import {
  assColor,
  DEFAULT_CAPTION_STYLE,
  fontFor,
  positionFor,
  sizeFor,
  themeFor,
  type CaptionStyle,
} from './caption'

/**
 * Groups a word list into on-screen caption lines: splits at natural pauses
 * (> ~0.55 s of silence) and keeps lines short enough for ~2 wrapped rows.
 * Shared by the .ass generator and the live transcript preview so both show
 * the exact same line breaks.
 */
export function chunkWords(words: Word[]): Word[][] {
  const chunks: Word[][] = []
  let cur: Word[] = []
  let curStart = 0
  let curChars = 0
  const MAX_CHARS = 56
  const MAX_SPAN = 5.5

  const flush = () => {
    if (cur.length) {
      chunks.push(cur)
      cur = []
      curChars = 0
    }
  }

  for (const w of words) {
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0
    const span = cur.length ? w.end - curStart : 0
    const tooLong = curChars + w.word.length > MAX_CHARS
    if (cur.length && (gap > 0.55 || span > MAX_SPAN || tooLong)) flush()
    if (!cur.length) curStart = w.start
    cur.push(w)
    curChars += w.word.length + 1
  }
  flush()
  return chunks
}

/**
 * Builds the .ass subtitle document for one clip, in one of two highlight
 * modes:
 *
 *  - `fill` (karaoke, default): every line uses ASS `\k` fill tags — upcoming
 *    words render in the theme's base color and each word flashes to the fill
 *    color as it is spoken (classic pop-caption look).
 *  - `spotlight`: every word is white and the word being spoken *right now*
 *    is tinted with `style.highlightColor` via per-word `{\c}` overrides —
 *    the "one word lit up" look.
 *
 * Colors, font, size and position come from the `style` param (see ./caption).
 *
 * @param words   word timestamps, in absolute source-video seconds
 * @param clipStart / clipEnd — the clip window (words are re-based to 0)
 * @param width / height — encoded output size (PlayRes matches the video)
 * @param style   caption look: theme palette, font, size, position, highlight
 * @param timeBase — added to every emitted timestamp. Feed the clip window
 *   re-based (0) times plus `timeBase = 0` for a timeline that starts at 0;
 *   pass the absolute `clipStart` to author on the source timeline.
 */
export function buildKaraokeAss(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  width: number,
  height: number,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  timeBase = 0,
): { content: string; captionCount: number; captionLines: number } {
  const dur = Math.max(0.001, clipEnd - clipStart)

  // Words overlapping the clip window, re-based to clip-relative seconds.
  const rel: Word[] = []
  for (const w of words) {
    if (w.end <= clipStart || w.start >= clipEnd) continue
    rel.push({
      word: w.word,
      start: Math.min(dur, Math.max(0, w.start - clipStart)),
      end: Math.min(dur, Math.max(0, w.end - clipStart)),
    })
  }

  const chunks = chunkWords(rel)

  // ---- sanitize one word for ASS (braces would inject tags) ----------------
  const esc = (s: string): string =>
    s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
  const clean = (w: Word): string => esc(w.word.trim())

  const fmt = (raw: number): string => {
    const sec = Math.max(0, raw + timeBase)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    const cs = Math.round((sec - Math.floor(sec)) * 100)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }

  // ---- style metrics relative to the output height --------------------------
  const theme = themeFor(style)
  const size = sizeFor(style)
  const pos = positionFor(style)
  const font = fontFor(style)
  const scale = height / 720
  const fontSize = Math.max(
    18,
    Math.round(height * size.fontScale * font.opticalScale),
  )
  const outline = Math.max(1, Math.round(2.4 * scale))
  const shadow = Math.max(1, Math.round(1.5 * scale))
  const marginV = Math.round(height * pos.marginVFrac)

  const lines: string[] = []
  if (style.highlight === 'spotlight') {
    // Spotlight: the line is shown as one Dialogue per word-window. Each word
    // is wrapped in an inline color override — white for the non-active words
    // and the user's chosen color for whichever word is currently spoken. The
    // full line stays put (no per-word reflow), so only the color moves.
    const tint = assColor(style.highlightColor)
    const white = assColor('#FFFFFF')
    const renderChunk = (chunk: Word[], activeIndex: number): string =>
      chunk
        .map((w, j) => {
          const text = clean(w)
          if (!text) return ''
          return `{\\c${j === activeIndex ? tint : white}}${text}`
        })
        .filter(Boolean)
        .join(' ')

    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i += 1) {
        // Window = this word until the next word begins (last word until the
        // chunk ends), so the highlight tracks the spoken word exactly.
        const start = Math.max(0, chunk[i].start)
        const end =
          i + 1 < chunk.length
            ? Math.min(dur, chunk[i + 1].start)
            : Math.min(dur, chunk[chunk.length - 1].end)
        const span = Math.max(0.02, end - start)
        const text = renderChunk(chunk, i)
        if (!text) continue
        lines.push(
          `Dialogue: 0,${fmt(start)},${fmt(start + span)},Cap,,0,0,0,,${text}`,
        )
      }
    }
  } else {
    // Karaoke fill: per-word `\k` durations in centiseconds, sequential from
    // the line start, using real inter-word spans.
    for (const chunk of chunks) {
      const parts: string[] = []
      for (let i = 0; i < chunk.length; i += 1) {
        const w = chunk[i]
        const text = clean(w)
        if (!text) continue
        let cs: number
        if (i < chunk.length - 1) cs = Math.round((chunk[i + 1].start - w.start) * 100)
        else cs = Math.round((chunk[chunk.length - 1].end - w.start) * 100)
        cs = Math.max(1, Math.min(600, cs)) // sane 0.01–6 s per word
        parts.push(`{\\k${cs}}${text}`)
      }
      if (!parts.length) continue
      const lineStart = chunk[0].start
      const lineEnd = chunk[chunk.length - 1].end
      lines.push(
        `Dialogue: 0,${fmt(lineStart)},${fmt(Math.min(dur, lineEnd))},Cap,,0,0,0,,${parts.join(' ')}`,
      )
    }
  }

  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // ASS karaoke draws the *filled* (already-sung) part in PrimaryColour and
    // the unfilled part in SecondaryColour — so in fill mode the theme fill =
    // spoken words, base = upcoming, and each word flashes as it is spoken.
    `Style: Cap,${font.assFamily},${fontSize},${assColor(theme.fill)},${assColor(theme.base)},${assColor(theme.outline)},${assColor(theme.shadow)},${font.bold ? -1 : 0},0,0,0,100,100,0,0,1,${outline},${shadow},${pos.alignment},30,30,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines,
  ].join('\n')

  return { content, captionCount: rel.length, captionLines: lines.length }
}
