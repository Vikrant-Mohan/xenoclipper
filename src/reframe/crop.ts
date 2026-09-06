import type { CropKeyframe, FaceSample, ReframeResult } from './types'

/** Target aspect: vertical short-form video, w:h = 9:16. */
const TARGET_ASPECT = 9 / 16

/** Largest crop dimension (both sides kept even for FFmpeg). */
const toEven = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/**
 * The 9:16 crop-box size inside the source frame, and which axis must pan.
 * Landscape sources crop horizontally (y fixed, face X drives); portrait
 * sources crop vertically (x fixed, face Y drives).
 */
export function cropGeometry(
  srcW: number,
  srcH: number,
): { cropWidth: number; cropHeight: number; trackX: boolean } {
  if (srcW / srcH >= TARGET_ASPECT) {
    return {
      cropWidth: toEven(srcH * TARGET_ASPECT),
      cropHeight: srcH,
      trackX: true,
    }
  }
  return {
    cropWidth: srcW,
    cropHeight: toEven(srcW / TARGET_ASPECT),
    trackX: false,
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Interpolates missing samples (null = no face) over short gaps, smooths the
 * track, and emits one keyframe per second of clip time. When no face is ever
 * found the path falls back to the frame center.
 */
export function computeCropPath(
  samples: FaceSample[],
  srcW: number,
  srcH: number,
  durationSec: number,
): ReframeResult {
  const { cropWidth, cropHeight, trackX } = cropGeometry(srcW, srcH)
  const facesDetected = samples.filter((s) => s.cx !== null).length
  const mode = facesDetected === 0 ? 'fallback-center' : 'face-tracked'

  const keyframes: CropKeyframe[] = []
  const seconds = Math.max(1, Math.ceil(durationSec))

  if (facesDetected === 0) {
    for (let t = 0; t < seconds; t += 1) {
      keyframes.push({ t, cx: 0.5, cy: 0.5, fromFace: false })
    }
    return {
      sourceWidth: srcW,
      sourceHeight: srcH,
      cropWidth,
      cropHeight,
      keyframes,
      totalFrames: samples.length,
      facesDetected,
      mode,
    }
  }

  // 1) Fill nulls. Gaps ≤ 2 s are bridged linearly; anything longer reverts
  //    to frame center between the two face sightings.
  const filled = samples.map((s) => ({ t: s.t, v: trackX ? s.cx : s.cy }))
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i].v !== null) continue
    let j = i
    while (j < filled.length && filled[j].v === null) j += 1
    const gapEnd = j >= filled.length ? null : filled[j]
    const gapStart = i - 1 >= 0 ? filled[i - 1] : null
    const gapLen = gapEnd ? gapEnd.t - (gapStart ? gapStart.t : filled[i].t) : Infinity
    if (gapLen <= 2 && gapStart && gapEnd) {
      for (let k = i; k < j; k += 1) {
        const span = gapEnd.t - gapStart.t
        const f = span > 0 ? (filled[k].t - gapStart.t) / span : 0.5
        filled[k].v = (gapStart.v ?? 0.5) * (1 - f) + (gapEnd.v ?? 0.5) * f
      }
    } else {
      for (let k = i; k < j; k += 1) filled[k].v = 0.5
    }
    i = j
  }

  // 2) Moving average (±0.5 s) over a 0.25 s grid for a camera-like glide.
  const step = 0.25
  const n = Math.max(1, Math.floor((filled[filled.length - 1].t + step) / step))
  const smoothed: number[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = Math.min(filled[filled.length - 1].t, i * step)
    // bracketing samples
    let lo = 0
    let hi = filled.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (filled[mid].t <= t) lo = mid
      else hi = mid
    }
    const a = filled[lo]
    const b = filled[hi]
    const span = b.t - a.t
    const frac = span > 0 ? (t - a.t) / span : 0
    const v = (a.v ?? 0.5) * (1 - frac) + (b.v ?? 0.5) * frac
    // average samples within ±0.5s (uses v at grid point approximation)
    smoothed.push(v)
  }
  const ma = smoothed.map((_, i) => {
    const win = Math.round(0.5 / step) // ±0.5 s
    let sum = 0
    let count = 0
    for (let k = Math.max(0, i - win); k <= Math.min(n, i + win); k += 1) {
      sum += smoothed[k]
      count += 1
    }
    return sum / count
  })

  // 3) Emit per-second keyframes with the box center clamped so the crop
  //    stays inside the frame (center may legally sit off-face near edges).
  for (let t = 0; t < seconds; t += 1) {
    const idx = Math.min(n, Math.round(t / step))
    const v = ma[idx]
    const fromFace = mode === 'face-tracked'
    if (trackX) {
      const minCenter = cropWidth / 2 / srcW
      const maxCenter = 1 - cropWidth / 2 / srcW
      keyframes.push({
        t,
        cx: clamp01(Math.min(maxCenter, Math.max(minCenter, v))),
        cy: 0.5,
        fromFace,
      })
    } else {
      const minCenter = cropHeight / 2 / srcH
      const maxCenter = 1 - cropHeight / 2 / srcH
      keyframes.push({
        t,
        cx: 0.5,
        cy: clamp01(Math.min(maxCenter, Math.max(minCenter, v))),
        fromFace,
      })
    }
  }

  return {
    sourceWidth: srcW,
    sourceHeight: srcH,
    cropWidth,
    cropHeight,
    keyframes,
    totalFrames: samples.length,
    facesDetected,
    mode,
  }
}
