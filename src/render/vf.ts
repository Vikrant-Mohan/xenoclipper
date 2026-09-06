import type { ReframeResult } from '../reframe/types'

/** Smallest encoded height; smaller crop boxes are upscaled to this. */
const MIN_OUT_H = 720

const toEven = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/**
 * Turns one ReframeResult into a single-pass ffmpeg filter chain:
 *
 *   crop=<cw>:<ch>:x='<piecewise-linear(t)>':y='…',subtitles=subs.ass:fontsdir=fonts[,scale=-2:720]
 *
 * The crop box follows the face-tracked pan path (piecewise-linear through
 * the 1/sec Phase 4 keyframes, evaluated per output frame via `t`), then the
 * .ass karaoke captions are burned into the *cropped* frame so they stay
 * fixed on screen while the frame pans beneath them.
 *
 * Times are authored in clip-relative seconds (keyframe `kf.t` already runs
 * 0…duration): trimming uses input seeking (`-ss` before `-i`), and ffmpeg
 * re-bases the decoded PTS to 0 in this build, so the crop expression and
 * the .ass share one 0-based timeline.
 */
export function buildFilterGraph(reframe: ReframeResult): { vf: string; outWidth: number; outHeight: number } {
  const { sourceWidth: srcW, sourceHeight: srcH, cropWidth: cw, cropHeight: ch } = reframe
  const trackX = cw < srcW // horizontal pan on landscape sources

  const clampEven = (raw: number, max: number): number => {
    const v = Math.min(max, Math.max(0, raw))
    return toEven(v) > max ? toEven(v) - 2 : toEven(v)
  }

  // Per-keyframe left/top offsets (even, clamped inside the frame).
  const xs = reframe.keyframes.map((k) => {
    const centerPx = k.cx * srcW
    return trackX
      ? clampEven(centerPx - cw / 2, srcW - cw)
      : clampEven((srcW - cw) / 2, srcW - cw)
  })
  const ys = reframe.keyframes.map((k) => {
    const centerPx = k.cy * srcH
    return trackX
      ? clampEven((srcH - ch) / 2, srcH - ch)
      : clampEven(centerPx - ch / 2, srcH - ch)
  })

  /** Piecewise-linear expression over the keyframes, evaluated at frame t. */
  const segExpr = (values: number[]): string => {
    const keys = reframe.keyframes.map((k, i) => ({
      t: k.t,
      v: values[i],
    }))
    if (keys.length === 0) return '0'
    if (keys.length === 1) return String(keys[0].v)
    let expr = String(keys[keys.length - 1].v)
    for (let i = keys.length - 2; i >= 0; i -= 1) {
      const a = keys[i]
      const b = keys[i + 1]
      const span = b.t - a.t
      const lerp =
        span > 0
          ? `${a.v}+(${b.v}-(${a.v}))*(t-(${a.t}))/(${b.t}-(${a.t}))`
          : String(b.v)
      expr = `if(between(t,${a.t},${b.t}),${lerp},${expr})`
    }
    return expr
  }

  const xExpr = segExpr(xs)
  const yExpr = segExpr(ys)

  const parts = [`crop=${cw}:${ch}:x='${xExpr}':y='${yExpr}'`]
  let outWidth = cw
  let outHeight = ch
  if (ch < MIN_OUT_H) {
    // Upscale small crop boxes to a usable vertical resolution.
    const target = ch > 0 ? Math.round((cw * MIN_OUT_H) / ch) : cw
    outWidth = toEven(target)
    outHeight = MIN_OUT_H
    parts.push(`scale=${outWidth}:${outHeight}`)
  }
  parts.push('subtitles=subs.ass:fontsdir=fonts')

  return { vf: parts.join(','), outWidth, outHeight }
}
