/**
 * Vendors the FFmpeg.wasm runtime into `public/ffmpeg/` so it can be loaded
 * same-origin under COEP:require-corp (CDN fetches would be blocked).
 *
 * Copied from the installed packages so versions always match:
 *   - @ffmpeg/core:     ffmpeg-core.js + ffmpeg-core.wasm (single-thread ESM)
 *   - @ffmpeg/ffmpeg:   worker.js (class worker) + its tiny imports
 *                       (const.js, errors.js) — all three land next to each
 *                       other so the worker's relative imports resolve.
 *
 * The app calls `ffmpeg.load({ classWorkerURL: '/ffmpeg/worker.js',
 * coreURL: '/ffmpeg/ffmpeg-core.js' })`; the worker dynamic-imports the core
 * and the core fetches its .wasm via the fragment-encoded wasmURL — all
 * same-origin.
 *
 * Note: the multithreaded @ffmpeg/core-mt build (parallel x264) was evaluated
 * but its pthread dispatch deadlocks in current Chrome with this worker setup
 * (workers spawn + complete the handshake, `run` is never dispatched, the
 * encode hangs). The single-thread core is used for now; revisit when the
 * upstream worker/pthread path is fixed.
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'public', 'ffmpeg')

const coreDir = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const ffmpegDir = path.join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm')

await rm(dest, { recursive: true, force: true })
await mkdir(dest, { recursive: true })

// single-thread core (the only core the app loads — see note above)
await cp(path.join(coreDir, 'ffmpeg-core.js'), path.join(dest, 'ffmpeg-core.js'))
await cp(path.join(coreDir, 'ffmpeg-core.wasm'), path.join(dest, 'ffmpeg-core.wasm'))

// class worker + its static imports (same relative layout as the package)
for (const f of ['worker.js', 'const.js', 'errors.js']) {
  await cp(path.join(ffmpegDir, f), path.join(dest, f))
}

const mb = async (p) => Math.round((await readFile(path.join(dest, p))).length / 1024 / 1024)
console.log(
  `copied ffmpeg runtime → public/ffmpeg/ (${await mb('ffmpeg-core.wasm')} MB wasm + class worker)`,
)