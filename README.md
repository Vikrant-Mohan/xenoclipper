# XenoClipper

An OpusClip-style **viral clip studio that runs 100% in the browser** — no backend,
no uploads, no GPU costs. Built as a free, open-source PWA.

| Pipeline stage | Tech | Status |
| --- | --- | --- |
| 1 · Ingest (drag & drop) | Vite + React + Tailwind, `vite-plugin-pwa` | ✅ done |
| 2 · Transcribe (word timings) | Whisper `Xenova/whisper-tiny.en` (q8) via `@huggingface/transformers` in a Web Worker | ✅ done |
| 3 · Curate (viral moments) | Groq free tier, `openai/gpt-oss-120b` | ✅ done |
| 4 · Reframe to 9:16 | MediaPipe Face Detection, face-tracked crop | ✅ done |
| 5 · Karaoke captions + render | `.ass` burn-in with `@ffmpeg/ffmpeg` (FFmpeg.wasm) | ✅ done |

**All five phases are complete.** The whole pipeline — ingest → transcribe →
curate → reframe → render — runs in the browser; see
[Phases & review](#phases--review-gates).

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build + local preview (also exercises the service worker):

```bash
npm run build        # typechecks, then emits dist/
npm run preview      # serves dist/ on http://localhost:4173
```

> **Why headers matter:** FFmpeg.wasm and the multithreaded Whisper worker need
> `SharedArrayBuffer`, which browsers only expose to **cross-origin-isolated**
> documents. Both dev/preview servers (via `vite.config.ts`) and the deployment
> configs (`vercel.json`, `public/_headers` for Netlify/Cloudflare Pages) send:

```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### Verify isolation

```bash
# dev server
curl -sI http://localhost:5173/ | grep -i cross-origin
# production preview
npm run build && npm run preview &   # then curl http://localhost:4173/
```

Then open the app and confirm the header badge says
**"Isolated · SharedArrayBuffer ready"** (it reflects `window.crossOriginIsolated`).
You can also check in DevTools:

```js
crossOriginIsolated  // true
```

A side effect of `COEP: require-corp` is that every cross-origin subresource must
be CORS/CORP-enabled. This project therefore deliberately avoids third-party
assets (fonts, CDNs, analytics). Model weights (Hugging Face) and the Groq API
are fetched with plain CORS requests, which COEP permits.

### Deploy (free tiers)

| Host | Config | Notes |
| --- | --- | --- |
| **Netlify** | `public/_headers` (already present) | publish dir: `dist` |
| **Vercel** | `vercel.json` (already present) | build `npm run build`, output `dist` |
| **Cloudflare Pages** | reads `_headers` too | build command `npm run build`, output dir `dist` |
| GitHub Pages | ✗ unsupported | cannot send custom headers |

## Phases & review gates

- **Phase 1 — Ingest (done).** PWA shell (manifest + service worker), isolation
  headers verified on dev and production servers, accessible drag-and-drop /
  file-picker ingestion with in-browser preview and metadata (duration,
  resolution, aspect, size). No video is uploaded anywhere.
- **Phase 2 — Transcription (done).** The browser's `decodeAudioData` extracts
  the audio track and resamples it to 16 kHz mono; a dedicated Web Worker runs
  Whisper `tiny.en` (q8, `@huggingface/transformers` v3 + onnxruntime-web
  WASM) and streams back `{ word, start, end }[]`. The quantized ONNX model
  (~40 MB) downloads once from Hugging Face and is browser-cached afterwards.
  The worker is terminated after each run to free the WASM heap. Verified
  end-to-end in the browser: a speech sample transcribed to
  *"We must find a new home in the stars."* with word timestamps on both the
  dev server and the production preview.
  **Why onnxruntime-web is pinned via transformers v3:** the v4 line (2026)
  ships an onnxruntime dev build whose graph optimizer rejects the older
  quantized-weight layout used by `Xenova/whisper-tiny.en` at session creation.
- **Phase 3 — AI curation (done, bring-your-own-model).** The transcript is
  compiled into compact timestamped rows (`[0:12] ...`) and sent straight
  from the tab to the user's chosen provider with a strict-JSON prompt. Seven
  providers ship out of the box (`src/curation/providers.ts`): **Groq**
  (default, free tier — `openai/gpt-oss-120b` with a fallback chain for
  catalog drift). Clip windows are **15–60 s with a target average of ~30 s**
  (tight, punchy cuts preferred; the prompt steers the model and the parse
  clamps to the source duration), **Google Gemini** (AI Studio free tier, OpenAI-compatible
  endpoint), **OpenAI** (gpt-5 family via `max_completion_tokens`),
  **Anthropic Claude** (native Messages API with the explicit
  browser-access CORS opt-in), **OpenRouter** (one key, hundreds of models),
  and two keyless **local runtimes** — **Ollama** and **LM Studio** — whose
  model lists are auto-detected from their `/v1/models` routes (any
  OpenAI-compatible endpoint supports the same detection). The provider,
  per-provider keys and per-provider model choice all persist in localStorage
  (pre-multi-provider Groq keys migrate automatically); a custom-model input
  accepts any model id. A **gear icon in the header** opens the settings page
  (`SettingsModal.tsx`) where the provider, key and model can be changed at
  any time — changes write through instantly and the curation card re-reads
  them. The model returns ranked clips with `start_time` /
  `end_time` / `viral_score` / `hook_text` / `rationale`; responses are
  validated and clamped to the video duration, then shown as selectable
  cards (score badge, exact in/out points, hook quote, rationale). Errors are
  provider-branded and actionable (bad key vs. rate limit vs. retired model).
  **Privacy model:** there is no XenoClipper server. Each provider's key is
  stored only in localStorage and sent only to that provider's API domain
  from the user's own tab (env vars `VITE_GROQ_API_KEY`,
  `VITE_GEMINI_API_KEY`, `VITE_OPENAI_API_KEY`, `VITE_ANTHROPIC_API_KEY`,
  `VITE_OPENROUTER_API_KEY` can pre-bake keys for hosted demos; local
  runtimes need no key at all).
  Verified in-browser end to end with a real key: a 19-second speech sample
  returned two ranked clips with grounded in/out points.
- **Phase 4 — Auto-reframe (done).** For the selected clip, XenoClipper
  opens the file in a hidden `<video>` and samples ~1.5-3 fps. Capture uses an
  accelerated play-through with `requestVideoFrameCallback` when frames are
  being presented, and transparently falls back to seek+draw when not
  (hidden tabs, odd containers). @mediapipe/tasks-vision `FaceDetector`
  (BlazeFace, ~225 KB model, WASM vendored same-origin) finds the dominant
  (largest) face per frame; the track is gap-filled, moving-average smoothed,
  and emitted as one crop keyframe per second. The 9:16 box is width-limited
  on landscape sources (face X drives, e.g. 1920×1080 → 608×1080) and
  height-limited on portrait sources (face Y drives). No face at all falls
  back to a center crop. Verified in-browser on a synthetic panning-face
  video: 20/20 frames tracked, correct crop geometry, smooth path. Runs are
  cancellable and clean up their temp object URLs.
- **Phase 5 — Karaoke captions + render (done).** A builder turns the
  word timestamps into a single `.ass` karaoke line set (one line per
  caption chunk, split at pauses, `\k` fill tags so upcoming words render in
  the theme's base color and each word flashes to the fill color as it is
  spoken). FFmpeg.wasm then runs one pass: input seek to the clip
  (`-ss`/`-t`), a piecewise-linear `crop=x(t):y(t)` following the Phase 4
  keyframes, the `subtitles` filter (libass, bundled OFL Lato fonts via
  `fontsdir`), optional upscale to a usable vertical size, and H.264+AAC
  output with `+faststart`. The runtime (worker + core, ~32 MB WASM) is
  vendored same-origin like the others and loaded once per session; the
  virtual FS (source file + subs + fonts) is deleted after each run, and
  cancel terminates the worker so nothing lingers.
  **Caption styles:** before rendering, the transcript panel offers a style
  picker — six caption fonts (Lato/Clean, Poppins/Rounded, Anton/Impact,
  Bangers/Comic, Bebas Neue/Tall, Luckiest Guy/Cartoon — all OFL, self-hosted,
  written into FFmpeg's fontsdir so libass resolves the exact family), four
  color themes (Sunset yellow/white, Mono, Neon pink/purple, Paper with white
  outline), two highlight modes — **Fill** (karaoke: each word flashes to the
  theme color as spoken) and **Spotlight** (the currently-spoken word is
  tinted with a user-chosen color — yellow/blue/green/pink/violet/orange —
  while every other word stays white, emitted as per-word Dialogue events with
  inline color overrides) — plus three font sizes and Bottom/Center/Top
  placement, with a live 9:16 preview that plays the transcript through in
  the chosen style (play/pause + scrub; same line chunking as the render).
  The choice flows straight into the `.ass` generator (`src/render/`), and
  the render card shows chips of the active style. Verified in-browser end
  to end: a synthetic panning clip was trimmed 1–3 s, reframed 152×270 →
  406×720, and pixel-checked — captions appear in sync with the words
  (Neon pink fill sweeps the line as it is spoken, anchored at the top of
  the frame for a Top-position render) in a playable, downloadable MP4.
  Second renders in the same session work (transferable-buffer copies keep
  the font cache reusable). A Spotlight/Anton/blue render was pixel-checked
  too: the tinted word moves with the speech (blue pixels at spoken-word
  frames, zero yellow, captions absent during between-chunk pauses).
  **Word re-timing:** Whisper tiny's timestamps can drift, so the caption
  preview doubles as a timing editor — click any word to select it, drag it
  sideways or use ±0.1 s buttons to shift its start/end, with an amber dot
  marking corrected words and a one-click reset. Corrections live in App
  state as per-word deltas (`wordDeltas`) and are applied to the exact word
  list the renderer burns in, so the preview and the MP4 always agree.

## Design: black + light green

The app chrome carries a **black + light-green identity**: a near-black
(`#040605`) canvas with soft green radial glows, and an accent ramp mapped
onto the green families — deep green buttons/rings, mint gradient heroes and
lime highlights (gradients now read green → mint → chartreuse). The retheme
is a single source of truth in `src/index.css`: Tailwind v4's `@theme` block
remaps the former `indigo`/`purple`/`pink` palettes onto green equivalents, so
every accent utility across the components re-themes without per-component
edits. Status colors keep their semantics (emerald = done, amber = warnings,
rose = errors).

Typography pairs an **italic display face — OFL-licensed Instrument Serif**
(self-hosted in `public/fonts/`, loaded via `@font-face`, so the PWA stays
third-party-free under COEP) — with the system sans body: the hero
headline, roadmap step labels, section headings and primary CTA labels all
render in italic serif, while body copy and captions stay sans (Lato for the
caption burn-in/preview) for legibility. The **wordmark breaks the pattern
deliberately**: bold, non-italic **Space Grotesk** (also self-hosted, OFL)
for a techy product-logo voice against the editorial serif.

## Architecture notes

- **Memory discipline (a core requirement):** object URLs are revoked on
  replacement; each transcription spawns a fresh worker that is terminated
  (WASM heap + model freed) as soon as it finishes or is cancelled; Groq runs
  are abortable fetches; renders clean FFmpeg's virtual FS (source file,
  subs, fonts) after every run, and cancel terminates the FFmpeg worker
  outright. Render blob URLs are disposed when a new render, clip selection
  or file replaces them. The UI exposes explicit loading states at every
  gate.
- **Curation is a direct browser→Groq fetch** with an abortable controller,
  strict JSON parsing (markdown-fence tolerant), per-field validation and
  duration clamping — garbage model output degrades to a readable error.
- **WASM runtimes are vendored, not CDN-served.** `COEP: require-corp`
  blocks no-cors CDN fetches, so `npm run postinstall` copies onnxruntime-web
  binaries into `public/ort/`, the @mediapipe/tasks-vision runtime into
  `public/mediapipe/`, and the FFmpeg.wasm core+worker into `public/ffmpeg/`
  (all gitignored; deploys run postinstall before building). The
  transcription worker points `env.backends.onnx.wasm.wasmPaths` at `/ort/`;
  MediaPipe's `FilesetResolver.forVisionTasks('/mediapipe/')` loads its
  runtime (BlazeFace model, ~225 KB, fetched from Google's CORS-enabled hub
  and cached); FFmpeg loads via
  `ffmpeg.load({ classWorkerURL: '/ffmpeg/worker.js', coreURL:
  '/ffmpeg/ffmpeg-core.js' })` — the worker and its imports are copied
  verbatim so the dynamic import stays same-origin. The OFL-licensed Lato
  faces live in `public/fonts/` and are written into FFmpeg's virtual FS for
  libass. The same Lato faces are loaded by the app page (`@font-face` in
  `src/index.css`) so the transcript caption preview is pixel-faithful to the
  burned-in render. None of the runtime dirs are precached by the service
  worker (`globIgnores`), keeping the SW small. Note: the multithreaded
  `@ffmpeg/core-mt` build was evaluated for faster x264 but its pthread
  dispatch deadlocks in current Chrome with this worker setup, so the
  single-thread core is used (see `scripts/copy-ffmpeg.mjs`).
- **Vite dev quirks handled:** onnxruntime and MediaPipe dynamically import
  their loaders, which Vite dev rewrites to `?import` requests that its
  transform middleware refuses for files in `public/`. Hand-written
  responses to module-script requests also get `ERR_BLOCKED_BY_RESPONSE` in
  workers under COEP, so a tiny middleware in `vite.config.ts` strips the
  query and hands `/ort/*`, `/mediapipe/*` and `/ffmpeg/*` `.js`/`.mjs`
  requests to Vite's static server (serving `.wasm` binaries raw), keeping
  `npm run dev` fully functional.
- **Codec reality check:** the `<video>` preview only decodes what the browser
  supports. Files like `.mkv` may warn but still render fine later, because
  FFmpeg.wasm does the real decoding in Phase 5.
- **Icons:** regenerable with `npm run icons`
  (`scripts/gen-icons.mjs`, zero-dependency PNG writer).

## Stack

Vite 8 · React 19 · TypeScript 7 · Tailwind CSS 4 · vite-plugin-pwa ·
`@huggingface/transformers` 3.x (Whisper in a Web Worker) · onnxruntime-web
(vendored WASM) · `@mediapipe/tasks-vision` FaceDetector (vendored WASM) ·
`@ffmpeg/ffmpeg` + `@ffmpeg/core` (FFmpeg.wasm, vendored WASM)
