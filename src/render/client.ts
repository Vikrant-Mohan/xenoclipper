import { FFmpeg } from '@ffmpeg/ffmpeg'
import { buildKaraokeAss } from './ass'
import { CAPTION_FONTS, DEFAULT_CAPTION_STYLE, type CaptionStyle } from './caption'
import type { RenderResult } from './types'
import { buildFilterGraph } from './vf'
import type { ViralClip } from '../curation/types'
import type { ReframeResult } from '../reframe/types'
import type { Word } from '../transcription/types'
import type { VideoSource } from '../types'

export interface RenderEvents {
  /** Phase + progress updates as the run moves through the pipeline. */
  onProgress(p: {
    phase: 'loading-ffmpeg' | 'preparing' | 'encoding'
    label?: string
    /** 0..100 during `encoding` (null while indeterminate). */
    percent?: number | null
  }): void
}

export interface RenderController {
  promise: Promise<RenderResult>
  cancel(): void
}

export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled')
    this.name = 'RenderCancelledError'
  }
}

/** Same-origin copies of the FFmpeg.wasm runtimes (see scripts/copy-ffmpeg.mjs). */
const CLASS_WORKER_URL = '/ffmpeg/worker.js'
const ST_CORE_URL = '/ffmpeg/ffmpeg-core.js'

// Note: the multithreaded @ffmpeg/core-mt build (parallel x264) deadlocks in
// current Chrome with this worker setup — its pthread workers spawn and
// complete the handshake but `run` is never dispatched and the encode hangs.
// Only the single-thread core is loaded (see scripts/copy-ffmpeg.mjs).

/** Every OFL caption face written into FFmpeg's FS for libass (fontsdir).
 *  libass resolves the Style's Fontname by family name, so each run writes
 *  the full set — the active font is always present regardless of selection. */
const FONT_FILES = [
  { fsPath: 'fonts/Lato-Regular.ttf', url: '/fonts/Lato-Regular.ttf' },
  ...CAPTION_FONTS.map((f) => ({ fsPath: `fonts/${f.file}`, url: `/fonts/${f.file}` })),
]

const REVOKE_ME: string[] = []
export function disposeRenderUrl(url: string): void {
  URL.revokeObjectURL(url)
  const i = REVOKE_ME.indexOf(url)
  if (i >= 0) REVOKE_ME.splice(i, 1)
}

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null
let fontCache: Uint8Array[] | null = null

/** Fetch the bundled caption fonts once per session. */
async function getFonts(): Promise<Uint8Array[]> {
  if (fontCache) return fontCache
  fontCache = await Promise.all(
    FONT_FILES.map(async (f) => {
      const res = await fetch(f.url)
      if (!res.ok) throw new Error(`Could not load caption font (${res.status}).`)
      return new Uint8Array(await res.arrayBuffer())
    }),
  )
  return fontCache
}

/**
 * Returns the shared FFmpeg instance, loading the WASM runtime on first use
 * (worker + core are same-origin under COEP). After a cancel() the worker is
 * terminated, so the next call re-initializes it.
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg
  if (!loadPromise) {
    loadPromise = (async () => {
      const inst = ffmpeg ?? new FFmpeg()
      ffmpeg = inst
      await inst.load({
        classWorkerURL: CLASS_WORKER_URL,
        coreURL: ST_CORE_URL,
      })
      return inst
    })().finally(() => {
      loadPromise = null
    })
  }
  return loadPromise
}

/** Best-effort probe: does the source have a decodable audio stream? */
async function hasAudioTrack(inst: FFmpeg): Promise<boolean> {
  try {
    const ret = await inst.exec([
      '-v', 'error',
      '-i', 'in.mp4',
      '-map', '0:a:0',
      '-map', '0:v:0',
      '-c', 'copy',
      '-f', 'null', '-',
    ])
    return ret === 0
  } catch {
    return false
  }
}

/**
 * Renders one selected clip end-to-end in FFmpeg.wasm:
 * trim (-ss/-t) → face-tracked 9:16 pan (crop x(t):y(t) over keyframes) →
 * karaoke .ass burn-in (subtitles filter) → optional upscale → H.264+AAC mp4.
 * Every input is written to and read from FFmpeg's virtual FS; the source
 * file is only read into memory for the duration of the run.
 */
export function renderClip(
  video: VideoSource,
  clip: ViralClip,
  reframe: ReframeResult,
  words: Word[],
  events: RenderEvents,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
): RenderController {
  let aborted = false
  let inst: FFmpeg | null = null
  const controller = new AbortController()
  const clipDur = Math.max(0.001, clip.endTime - clip.startTime)

  const promise = (async (): Promise<RenderResult> => {
    let progressCb: ((p: { progress: number; time: number }) => void) | null = null
    try {
      // ------------------------------------------------ runtime -----------
      events.onProgress({
        phase: 'loading-ffmpeg',
        label: 'Starting FFmpeg.wasm (first run only)',
      })
      inst = await getFFmpeg()

      // ------------------------------------------------ prepare -----------
      events.onProgress({ phase: 'preparing', label: 'Building captions & crop path' })
      const fonts = await getFonts()
      const ass = buildKaraokeAss(
        words,
        clip.startTime,
        clip.endTime,
        reframe.cropWidth,
        reframe.cropHeight,
        style,
      )
      const { vf, outWidth, outHeight } = buildFilterGraph(reframe)

      events.onProgress({ phase: 'preparing', label: 'Writing inputs to the virtual disk' })
      await inst.createDir('fonts').catch(() => {}) // idempotent
      // writeFile transfers the buffer to the worker (detaching it), so always
      // hand over a fresh copy — the font cache must survive multiple runs.
      for (let i = 0; i < FONT_FILES.length; i += 1) {
        await inst.writeFile(FONT_FILES[i].fsPath, fonts[i].slice())
      }
      await inst.writeFile('subs.ass', new TextEncoder().encode(ass.content))
      const sourceBytes = new Uint8Array(await video.file.arrayBuffer())
      await inst.writeFile('in.mp4', sourceBytes)

      const hasAudio = await hasAudioTrack(inst)

      // ------------------------------------------------ encode ------------
      events.onProgress({ phase: 'encoding', label: 'Encoding…', percent: null })
      progressCb = ({ progress }) => {
        const pct = progress > 0 ? Math.min(99, Math.round(progress * 100)) : null
        events.onProgress({
          phase: 'encoding',
          label: pct === null ? 'Encoding…' : `Encoding ${pct}%`,
          percent: pct,
        })
      }
      inst.on('progress', progressCb)

      const ret = await inst.exec(
        [
          '-ss', String(clip.startTime),
          '-t', String(clipDur),
          '-i', 'in.mp4',
          '-vf', vf,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '21',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          'out.mp4',
        ],
        -1,
        { signal: controller.signal },
      )
      if (ret !== 0) throw new Error(`FFmpeg exited with code ${ret}.`)
      if (aborted) throw new RenderCancelledError()

      const bytes = (await inst.readFile('out.mp4')) as Uint8Array
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'video/mp4' }),
      )
      REVOKE_ME.push(url)

      return {
        url,
        sizeBytes: bytes.length,
        width: outWidth,
        height: outHeight,
        durationSec: clipDur,
        captionCount: ass.captionCount,
        captionLines: ass.captionLines,
        hasAudio,
        cropMode: reframe.mode,
      }
    } catch (err) {
      if (aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new RenderCancelledError()
      }
      const message = err instanceof Error && err.message ? err.message : String(err)
      throw new Error(
        message.includes('Memory') || message.includes('emscripten')
          ? 'The source file is too large to fit in FFmpeg\'s memory — try a shorter source clip.'
          : message,
      )
    } finally {
      if (progressCb && inst) inst.off('progress', progressCb)
      if (inst && !aborted) {
        // free the virtual disk (source can be hundreds of MB)
        const paths = ['out.mp4', 'in.mp4', 'subs.ass', ...FONT_FILES.map((f) => f.fsPath)]
        for (const p of paths) await inst.deleteFile(p).catch(() => {})
        await inst.deleteDir('fonts').catch(() => {})
      }
    }
  })()

  return {
    promise,
    cancel() {
      aborted = true
      controller.abort()
      // A live encode can't be interrupted mid-exec, so terminate the worker;
      // the next run re-initializes the (cached) runtime.
      ffmpeg?.terminate()
    },
  }
}
