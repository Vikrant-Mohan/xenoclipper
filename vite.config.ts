import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Runtime WASM dirs that get dynamically imported / fetched by loaders
 * (onnxruntime-web → `/ort/`, MediaPipe tasks-vision → `/mediapipe/`,
 * FFmpeg.wasm → `/ffmpeg/`). These live in `public/` and are copied to
 * `dist/` verbatim.
 */
const RUNTIME_DIRS = ['/ort/', '/mediapipe/', '/ffmpeg/']

/**
 * Dev-only workaround: Vite rewrites dynamic imports in served code to carry
 * a `?import` query, and its transform middleware then rejects those requests
 * for files in `public/` ("should not be imported from source code").
 * onnxruntime and MediaPipe both load their runtimes that way in dev, so this
 * middleware rewrites `/ort/*` and `/mediapipe/*` `?import` requests to
 * Vite's static server (which serves public files with the right MIME), and
 * serves plain (non-import) fetches raw. Production/preview servers serve
 * public files statically, so this only affects `vite dev`.
 */
function serveRuntimeWasmRaw(): Plugin {
  const MIME: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
  }
  return {
    name: 'serve-runtime-wasm-raw',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url ?? ''
        const [url] = raw.split('?')
        const prefix = RUNTIME_DIRS.find((p) => url.startsWith(p))
        if (!prefix) return next()
        // publicDir is Vite-normalized with '/' separators; align to platform.
        const publicDir = server.config.publicDir.replaceAll('/', path.sep)
        const subdir = prefix.slice(1, -1)
        const file = path.join(publicDir, subdir, url.slice(prefix.length))
        if (!file.startsWith(publicDir + path.sep)) {
          res.statusCode = 403
          res.end()
          return
        }
        const exists = await readFile(file)
          .then(() => true)
          .catch(() => false)
        if (!exists) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        const ext = path.extname(file)
        if (raw.includes('?import') || ext !== '.wasm') {
          // Module-script fetches (incl. Vite's `?import` rewrites) must come
          // from Vite's own static public-dir serving — hand-written responses
          // get ERR_BLOCKED_BY_RESPONSE inside workers under COEP. Drop any
          // query and hand off; plain GETs of public .js/.mjs files are served
          // statically by Vite with the correct MIME.
          req.url = url
          next()
          return
        }
        // Plain .wasm fetches — serve raw with the wasm MIME.
        try {
          const data = await readFile(file)
          res.setHeader('Content-Type', MIME['.wasm'])
          res.setHeader('Content-Length', String(data.length))
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
          res.statusCode = 200
          res.end(data)
        } catch {
          res.statusCode = 404
          res.end('not found')
        }
      })
    },
  }
}

/**
 * Cross-origin isolation is REQUIRED by FFmpeg.wasm (SharedArrayBuffer)
 * and by the multithreaded Whisper worker later in the pipeline.
 *
 * These two headers must be present on the HTML document and on every
 * deployment target:
 *   - dev / preview servers: configured below via `server`/`preview`
 *   - Netlify: public/_headers
 *   - Vercel: vercel.json
 *
 * Note: with COEP: require-corp, all cross-origin subresources must be
 * CORP- or CORS-enabled. We intentionally avoid Google Fonts and other
 * third-party assets so nothing gets blocked. Model / API fetches in
 * later phases (Hugging Face, Groq) are plain CORS requests, which COEP
 * permits.
 */
const ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

export default defineConfig({
  plugins: [
    serveRuntimeWasmRaw(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'XenoClipper — AI Clips, 100% In Your Browser',
        short_name: 'XenoClipper',
        description:
          'Turn long videos into vertical viral clips: local Whisper transcription, LLM clip curation, face-tracked 9:16 crops and karaoke captions — all client-side, free, no uploads.',
        theme_color: '#040605',
        background_color: '#040605',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell + fonts precached at install (~3.5 MB). The 100 MB of
        // runtime WASM is NOT precached (it would delay `install` massively);
        // it's runtime-cached CacheFirst below, so the first online visit
        // populates the cache and every later visit — including offline —
        // loads from disk instantly.
        globPatterns: ['**/*.{js,css,html,svg,png,ttf,woff2,webmanifest}'],
        globIgnores: ['**/ort/**', '**/mediapipe/**', '**/ffmpeg/**'],
        runtimeCaching: [
          {
            urlPattern: /\/ort\/|\/mediapipe\/|\/ffmpeg\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'xenoclipper-wasm-v1',
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
})
