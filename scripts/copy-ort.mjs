/**
 * Vendors the onnxruntime-web WASM binaries next to the app so they load
 * same-origin. This is REQUIRED: COEP: require-corp blocks the no-cors CDN
 * fetches transformers.js would otherwise make.
 *
 * Runs automatically on `npm install` (postinstall). Output: public/ort/
 * (gitignored — regenerated on every install; Netlify/Vercel run postinstall
 * before building, so deploys get it too).
 *
 * The loader file set changes between onnxruntime versions (asyncify builds,
 * jsep builds, plain threaded builds), so instead of hard-coding names we
 * mirror every `ort-wasm*` {.mjs,.wasm} pair the installed version ships —
 * whatever loader transformers.js asks for at runtime will be present, and
 * stale files from a previous version are cleared first.
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
const outDir = join(root, 'public', 'ort')

function findOrtDist() {
  // onnxruntime-web is a dependency of @huggingface/transformers. Its
  // package.json isn't exported, so resolve its entry module instead.
  try {
    const entry = require.resolve('onnxruntime-web')
    const dist = dirname(entry)
    if (existsSync(dist) && readdirSync(dist).some((f) => f.endsWith('.wasm'))) return dist
  } catch {
    // not hoisted — search inside transformers' node_modules
    try {
      const transformersEntry = require.resolve('@huggingface/transformers')
      const nested = join(dirname(transformersEntry), '..', 'node_modules', 'onnxruntime-web', 'dist')
      if (existsSync(nested)) return nested
    } catch {
      // fall through
    }
  }
  throw new Error('Could not locate onnxruntime-web/dist')
}

const srcDir = findOrtDist()
const files = readdirSync(srcDir).filter(
  (f) => f.startsWith('ort-wasm') && /\.(mjs|wasm)$/.test(f),
)
if (files.length === 0) {
  throw new Error(`No ort-wasm files found in ${srcDir}`)
}

// Clear stale binaries first so a version change can never leave orphaned
// loaders behind (e.g. an old asyncify build pointing at a newer .wasm).
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let totalBytes = 0
for (const file of files) {
  copyFileSync(join(srcDir, file), join(outDir, file))
  totalBytes += statSync(join(srcDir, file)).size
}
console.log(
  `[copy-ort] vendored ${files.length} onnxruntime files to public/ort/ (${(totalBytes / 1048576).toFixed(1)} MB)`,
)
