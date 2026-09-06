import { computeCropPath } from './crop'
import { getFaceDetector, modelDownloadFraction } from './mediapipe'
import type { FaceSample, ReframeResult } from './types'
import type { ViralClip } from '../curation/types'
import type { VideoSource } from '../types'

export interface ReframeEvents {
  /** Fired as the run progresses through its phases. */
  onProgress(p: {
    phase: 'preparing' | 'tracking' | 'computing'
    done?: number
    total?: number
    label?: string
  }): void
}

export interface ReframeController {
  promise: Promise<ReframeResult>
  cancel(): void
}

export class ReframeCancelledError extends Error {
  constructor() {
    super('Reframe cancelled')
    this.name = 'ReframeCancelledError'
  }
}

export class NoVideoTrackError extends Error {
  constructor() {
    super(
      'No video track found in this file — face tracking needs actual picture. ' +
        'Try an MP4/WebM/MOV with a visible subject.',
    )
    this.name = 'NoVideoTrackError'
  }
}

const MAX_FRAME_WIDTH = 960

function waitForEvent(
  el: EventTarget,
  event: string,
  timeoutMs: number,
  rejectMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = 0
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      fn()
    }
    const ok = () => settle(resolve)
    const bad = () => settle(() => reject(new Error(rejectMessage)))
    timer = window.setTimeout(() => settle(() => reject(new Error('Timed out: ' + rejectMessage))), timeoutMs)
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', bad, { once: true })
  })
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      fn()
    }
    const onSeeked = () => settle(resolve)
    timer = window.setTimeout(() => settle(resolve), 3000)
    video.addEventListener('seeked', onSeeked, { once: true })
    try {
      video.currentTime = time
    } catch {
      settle(resolve)
    }
    if (Math.abs(video.currentTime - time) < 0.05) settle(resolve)
  })
}

/**
 * Picks sample times (count 20-90 over the clip, i.e. ~1.5-3 fps for
 * 30-60 s clips). Returns clip-relative times plus absolute video times.
 */
export function sampleTimes(start: number, end: number): { t: number; absolute: number }[] {
  const dur = Math.max(0.001, end - start)
  const count = Math.min(90, Math.max(20, Math.round(dur * 2.5)))
  const out: { t: number; absolute: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : (i / (count - 1)) * dur
    out.push({ t, absolute: start + t })
  }
  return out
}

/**
 * Runs the full Phase 4 pipeline for one selected clip:
 *   1. opens the file in a hidden <video> (a private object URL, revoked on
 *      completion — the app's preview URL is never touched)
 *   2. plays the clip through once at an accelerated rate, sampling frames at
 *      ~1.5-3 fps via requestVideoFrameCallback (no seek storms — real-time
 *      decode works on every container)
 *   3. MediaPipe FaceDetector finds the dominant (largest) face per frame
 *   4. the track is smoothed into a 9:16 crop path (fallback: center crop)
 */
export function runReframe(
  videoSource: VideoSource,
  clip: ViralClip,
  events: ReframeEvents,
): ReframeController {
  let cancelled = false
  let videoEl: HTMLVideoElement | null = null
  let tempUrl: string | null = null

  const promise = new Promise<ReframeResult>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const fail = (err: Error) => settle(() => reject(err))
    const succeed = (result: ReframeResult) => settle(() => resolve(result))

    const cleanup = () => {
      if (videoEl) {
        videoEl.pause()
        videoEl.removeAttribute('src')
        videoEl.load()
      }
      videoEl = null
      if (tempUrl) URL.revokeObjectURL(tempUrl)
      tempUrl = null
    }

    void (async () => {
      try {
        // ---------------- open the video ------------------------------------
        events.onProgress({ phase: 'preparing', label: 'Decoding video' })
        tempUrl = URL.createObjectURL(videoSource.file)
        const video = document.createElement('video')
        videoEl = video
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = tempUrl
        await waitForEvent(video, 'loadedmetadata', 15000, 'Could not decode this video.')
        if (cancelled) throw new ReframeCancelledError()

        const srcW = video.videoWidth
        const srcH = video.videoHeight
        if (!srcW || !srcH) throw new NoVideoTrackError()

        // ---------------- mediapipe runtime ----------------------------------
        const faceDetector = await getFaceDetector(() => {
          const frac = modelDownloadFraction()
          events.onProgress({
            phase: 'preparing',
            label:
              frac === null
                ? 'Loading face detector…'
                : 'Downloading face model…',
            done: frac === null ? 0 : Math.round(frac * 100),
            total: 100,
          })
        })
        if (cancelled) throw new ReframeCancelledError()

        // ---------------- capture pass ----------------------------------------
        const times = sampleTimes(clip.startTime, clip.endTime)
        const clipDur = Math.max(0.001, clip.endTime - clip.startTime)
        const samples: FaceSample[] = []
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, MAX_FRAME_WIDTH / srcW)
        canvas.width = Math.max(2, Math.round(srcW * scale))
        canvas.height = Math.max(2, Math.round(srcH * scale))
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('Canvas 2D unavailable')

        // Aim for wall-clock capture of roughly clipDur/6 (max 8×, min 1×) so
        // sampling cadence stays ≥ the frame callback rate of ~24-60 fps.
        const nominalFps = 30
        const targetSamplesPerSec = Math.min(5, times.length / clipDur)
        const rate = Math.min(8, Math.max(1, Math.floor(nominalFps / (targetSamplesPerSec * 1.5))))
        video.playbackRate = rate

        const grabSample = (clipT: number) => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          let dominant: { cx: number; cy: number; area: number } | null = null
          const detections = faceDetector.detect(canvas).detections ?? []
          for (const d of detections) {
            const box = d.boundingBox
            if (!box) continue
            const cx = (box.originX + box.width / 2) / canvas.width
            const cy = (box.originY + box.height / 2) / canvas.height
            const area = box.width * box.height
            if (!dominant || area > dominant.area) dominant = { cx, cy, area }
          }
          samples.push({
            t: clipT,
            cx: dominant ? dominant.cx : null,
            cy: dominant ? dominant.cy : null,
            faceCount: detections.length,
          })
          return dominant
        }

        const doneSamples = await new Promise<'ok' | 'cancelled'>((resolveCap) => {
          let next = 0
          let finished = false
          const finish = (out: 'ok' | 'cancelled') => {
            if (finished) return
            finished = true
            window.clearTimeout(flowWatcher)
            resolveCap(out)
          }
          let flowWatcher = 0

          const report = (dominant: { cx: number; cy: number; area: number } | null) => {
            if (next % 3 === 0 || next === times.length) {
              events.onProgress({
                phase: 'tracking',
                done: next,
                total: times.length,
                label: dominant ? 'Face locked' : 'No face yet',
              })
            }
          }

          const grab = () => {
            const dominant = grabSample(times[next].t)
            next += 1
            return dominant
          }

          /** Mode B: no compositor frames available (hidden tab / Safari) —
           *  seek to each sample time and draw. Works anywhere. */
          const runSeekFallback = () => {
            video.pause()
            void seekTo(video, clip.startTime).then(() => {
              const step = () => {
                if (cancelled) return finish('cancelled')
                if (next >= times.length) return finish('ok')
                const dominant = grab()
                report(dominant)
                window.setTimeout(step, 0)
              }
              step()
            })
          }

          /** Mode A: accelerated play-through with requestVideoFrameCallback. */
          const capture = () => {
            try {
              if (cancelled) return finish('cancelled')
              if (next >= times.length) return finish('ok')
              const target = times[next]
              if (video.ended || video.currentTime >= clip.endTime + 0.1) {
                // flush remaining targets at current position
                while (next < times.length) grab()
                return finish('ok')
              }
              if (video.currentTime >= target.absolute - 0.05) {
                const dominant = grab()
                report(dominant)
              }
              try {
                video.requestVideoFrameCallback(capture)
              } catch {
                window.setTimeout(capture, 50)
              }
            } catch (err) {
              // never let a callback exception leave the run hanging
              settle(() => reject(err instanceof Error ? err : new Error(String(err))))
            }
          }
          try {
            video.requestVideoFrameCallback(capture)
          } catch {
            window.setTimeout(capture, 50)
          }
          // If no frame has been sampled shortly after playback starts, the
          // compositor isn't presenting (hidden tab) — switch to seek+draw.
          flowWatcher = window.setTimeout(() => {
            if (next === 0 && !finished && !cancelled) runSeekFallback()
          }, 2500)
          // global watchdog: resolve 'ok' with whatever we captured so far
          window.setTimeout(() => finish('ok'), 60000)
          // kick playback
          video.play().catch(() => runSeekFallback())
        })

        if (doneSamples === 'cancelled' || cancelled) throw new ReframeCancelledError()
        if (samples.length < 1) throw new Error('No frames could be sampled from this clip.')

        // ---------------- crop path -------------------------------------------
        events.onProgress({ phase: 'computing', label: 'Smoothing the 9:16 path' })
        const result = computeCropPath(samples, srcW, srcH, clipDur)
        succeed(result)
      } catch (err) {
        if (err instanceof ReframeCancelledError) fail(new ReframeCancelledError())
        else fail(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })

  return {
    promise,
    cancel() {
      cancelled = true
    },
  }
}
