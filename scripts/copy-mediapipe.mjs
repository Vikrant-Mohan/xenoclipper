/**
 * Vendors the @mediapipe/tasks-vision WASM runtime next to the app so it
 * loads same-origin. COEP: require-corp blocks no-cors CDN fetches, and
 * tasks-vision loads its runtime by path (FilesetResolver.forVisionTasks).
 *
 * Runs on `npm install` (postinstall, alongside copy-ort.mjs). Output:
 * public/mediapipe/ (gitignored — regenerated on every install; Netlify /
 * Vercel run postinstall before building, so deploys get it too).
 *
 * We mirror every `vision_wasm*` {.js,.wasm} pair the installed package
 * ships (standard, _module and _nosimd variants) — whichever loader the
 * runtime selects will be present. Stale files from a previous version are
 * cleared first.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'mediapipe')

function findWasmDir() {
  const entry = require.resolve('@mediapipe/tasks-vision')
  const wasm = join(dirname(entry), 'wasm')
  if (!existsSync(wasm)) throw new Error('Could not locate @mediapipe/tasks-vision/wasm')
  return wasm
}

const srcDir = findWasmDir()
const files = readdirSync(srcDir).filter(
  (f) => f.startsWith('vision_wasm') && /\.(js|wasm)$/.test(f),
)
if (files.length === 0) {
  throw new Error(`No vision_wasm files found in ${srcDir}`)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let totalBytes = 0
for (const file of files) {
  copyFileSync(join(srcDir, file), join(outDir, file))
  totalBytes += statSync(join(srcDir, file)).size
}
console.log(
  `[copy-mediapipe] vendored ${files.length} mediapipe files to public/mediapipe/ (${(totalBytes / 1048576).toFixed(1)} MB)`,
)
