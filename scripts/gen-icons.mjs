/**
 * Generates the PWA icon set as PNGs without any dependencies.
 *
 * Output (written to public/):
 *   icons/pwa-192x192.png            app icon, rounded square
 *   icons/pwa-512x512.png            app icon, rounded square
 *   icons/maskable-512x512.png       full-bleed (no rounded corners) for
 *                                    OS masks; glyph kept inside the
 *                                    central 80% safe zone
 *   icons/apple-touch-icon-180x180.png
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')

// ---------------------------------------------------------------- palette
const TOP = [99, 102, 241] // indigo-500
const MID = [168, 85, 247] // purple-500
const BOT = [236, 72, 153] // pink-500

const GLYPH = {
  // White play triangle (centroid at 50% / 50%), inside the maskable
  // safe zone (x: 0.10–0.90, y: 0.10–0.90).
  a: [0.35, 0.29],
  b: [0.35, 0.71],
  c: [0.8, 0.5],
}

const SS = 2 // supersampling factor for smooth edges

// ------------------------------------------------------------------- png
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------ draw
const lerp = (a, b, t) => a + (b - a) * t

function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

function sign(p1, p2, p3) {
  return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
}

/** Sample one pixel: returns [r, g, b, a] with straight alpha. */
function colorAt(x, y, size, radius) {
  // Rounded-rect mask (radius 0 == full bleed, used for maskable).
  if (radius > 0) {
    const cx = Math.min(Math.max(x, radius), size - 1 - radius)
    const cy = Math.min(Math.max(y, radius), size - 1 - radius)
    const dx = x - cx
    const dy = y - cy
    if (Math.sqrt(dx * dx + dy * dy) > radius) return [0, 0, 0, 0]
  }

  // Vertical gradient background.
  const t = size > 1 ? y / (size - 1) : 0
  const base = t < 0.5 ? mix3(TOP, MID, t * 2) : mix3(MID, BOT, (t - 0.5) * 2)

  // White play triangle on top.
  const p = [x, y]
  const [ax, ay] = [GLYPH.a[0] * size, GLYPH.a[1] * size]
  const [bx, by] = [GLYPH.b[0] * size, GLYPH.b[1] * size]
  const [cx, cy] = [GLYPH.c[0] * size, GLYPH.c[1] * size]
  const d1 = sign(p, [ax, ay], [bx, by])
  const d2 = sign(p, [bx, by], [cx, cy])
  const d3 = sign(p, [cx, cy], [ax, ay])
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  if (!(hasNeg && hasPos)) return [255, 255, 255, 246]

  return [base[0], base[1], base[2], 255]
}

function render(size, { maskable }) {
  const radius = maskable ? 0 : size * 0.22
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const [cr, cg, cb, ca] = colorAt(px, py, size, radius)
          // Straight-alpha averaging (background is opaque, glyph near-opaque).
          r += cr
          g += cg
          b += cb
          a += ca
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      rgba[i] = r / n
      rgba[i + 1] = g / n
      rgba[i + 2] = b / n
      rgba[i + 3] = a / n
    }
  }
  return encodePng(size, rgba)
}

// ----------------------------------------------------------------- main
mkdirSync(outDir, { recursive: true })
const targets = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon-180x180.png', size: 180, maskable: false },
]
for (const t of targets) {
  const png = render(t.size, { maskable: t.maskable })
  writeFileSync(join(outDir, t.file), png)
  console.log(`wrote public/icons/${t.file} (${png.length} bytes)`)
}
