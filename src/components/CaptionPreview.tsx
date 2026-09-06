import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { chunkWords } from '../render/ass'
import {
  fontFor,
  positionFor,
  sizeFor,
  themeFor,
  type CaptionStyle,
} from '../render/caption'
import type { Word } from '../transcription/types'

interface CaptionPreviewProps {
  /** Words with any user timing corrections already applied. */
  words: Word[]
  style: CaptionStyle
  /** Indices (into `words`) the user has re-timed. */
  adjusted: Set<number>
  /** Shift one word's start+end by `deltaSec`. */
  onAdjust: (index: number, deltaSec: number) => void
  /** Drop all corrections. */
  onResetAll: () => void
}

const fmtTime = (sec: number): string => {
  const t = Math.max(0, sec)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const d = Math.floor((t - Math.floor(t)) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}

/**
 * A small 9:16 mock of the rendered clip: the transcript words play through
 * as caption lines in the *exact* style that will be burned in (same chunking,
 * same theme palette, same size/position math), so the user can judge the
 * look before committing to a render.
 *
 * Words can also be re-timed here: click one to select it, drag it sideways
 * (or use the ±0.1 s buttons) and the correction flows into the render.
 */
export function CaptionPreview({
  words,
  style,
  adjusted,
  onAdjust,
  onResetAll,
}: CaptionPreviewProps) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  /** Chunk grouping frozen while a word is being dragged (word indices), so
   *  re-chunking mid-drag can't unmount the word under the pointer. */
  const [dragLock, setDragLock] = useState<number[][] | null>(null)
  const timeRef = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ lastX: number; secPerPx: number } | null>(null)
  const lastEnd = useMemo(
    () => (words.length ? words[words.length - 1].end : 0),
    [words],
  )

  // Advance the cursor in real time while playing.
  useEffect(() => {
    if (!playing || lastEnd <= 0) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const nt = Math.min(lastEnd, timeRef.current + dt)
      timeRef.current = nt
      setTime(nt)
      if (nt >= lastEnd) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, lastEnd])

  const theme = themeFor(style)
  const size = sizeFor(style)
  const pos = positionFor(style)
  const font = fontFor(style)
  const spotlight = style.highlight === 'spotlight'

  const liveChunks = useMemo(() => chunkWords(words), [words])
  const chunks = useMemo(() => {
    if (!dragLock) return liveChunks
    return dragLock.map((ids) => ids.map((i) => words[i]).filter(Boolean))
  }, [dragLock, liveChunks, words])
  const active =
    chunks.find((c) => time >= c[0].start && time < c[c.length - 1].end) ??
    (chunks.length ? chunks[chunks.length - 1] : null)

  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (timeRef.current >= lastEnd - 0.01) {
      timeRef.current = 0
      setTime(0)
    }
    setPlaying(true)
  }

  const seek = (v: number) => {
    timeRef.current = v
    setTime(v)
  }

  const startDrag = (index: number, e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    // Keep dragging alive if the pointer leaves the word (real pointers only;
    // synthetic / odd states throw NotFoundError — capture is a nicety).
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    setSelected(index)
    setDragging(index)
    setPlaying(false)
    setDragLock(liveChunks.map((c) => c.map((w) => words.indexOf(w))))
    const w = boxRef.current?.clientWidth ?? 280
    dragRef.current = { lastX: e.clientX, secPerPx: 8 / w } // full width ≈ 8 s
  }

  const moveDrag = (index: number, e: ReactPointerEvent<HTMLSpanElement>) => {
    if (dragging !== index || !dragRef.current) return
    const dx = e.clientX - dragRef.current.lastX
    if (dx === 0) return
    dragRef.current.lastX = e.clientX
    onAdjust(index, dx * dragRef.current.secPerPx)
  }

  const endDrag = () => {
    setDragging(null)
    setDragLock(null)
    dragRef.current = null
  }

  if (!words.length || !active) return null

  const boxH = 340
  const fontSize = Math.round(boxH * size.fontScale * font.opticalScale)
  const stroke = Math.max(0.5, fontSize * 0.05)
  const shadowY = Math.max(0.5, fontSize * 0.055)

  const justify =
    pos.id === 'bottom' ? 'justify-end' : pos.id === 'top' ? 'justify-start' : 'justify-center'
  const padStyle =
    pos.id === 'bottom'
      ? { paddingBottom: `${Math.round(pos.marginVFrac * 100)}%` }
      : pos.id === 'top'
        ? { paddingTop: `${Math.round(pos.marginVFrac * 100)}%` }
        : undefined

  const selectedWord = selected !== null ? words[selected] : null

  return (
    <div className="mt-4">
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-2xl border border-white/10"
        style={{
          height: boxH,
          background:
            'linear-gradient(160deg, #10201a 0%, #081310 45%, #040706 100%)',
        }}
      >
        {/* fake footage: soft blurred blobs + grain + vignette */}
        <div className="absolute -left-10 -top-12 size-44 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="absolute -bottom-16 -right-8 size-52 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/10 blur-2xl" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0 2px, #fff 2px 3px)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(0,0,0,0.6) 100%)',
          }}
        />

        {/* caption line, anchored by the chosen position */}
        <div
          className={`relative flex h-full flex-col items-center ${justify} px-3`}
          style={padStyle}
        >
          <p
            className="max-w-full text-center leading-tight"
            style={{
              fontFamily: font.cssFamily,
              fontWeight: font.bold ? 700 : 400,
              fontSize,
              letterSpacing: '0.01em',
            }}
          >
            {active.map((w, i) => {
              const wordIndex = words.indexOf(w)
              const isSel = selected === wordIndex
              const isDrag = dragging === wordIndex
              const isAdj = adjusted.has(wordIndex)
              // fill mode: already-spoken words stay the theme fill color.
              // spotlight mode: only the word being spoken NOW is tinted, the
              // rest stay white.
              const spoken = spotlight ? w.start <= time && time < w.end : w.end <= time
              const color = spotlight
                ? spoken
                  ? style.highlightColor
                  : '#FFFFFF'
                : spoken
                  ? theme.fill
                  : theme.base
              return (
                <span
                  key={i}
                  onPointerDown={(e) => startDrag(wordIndex, e)}
                  onPointerMove={(e) => moveDrag(wordIndex, e)}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="transition-colors duration-150"
                  style={{
                    color,
                    WebkitTextStroke: `${stroke}px ${theme.outline}`,
                    textShadow: `0 ${shadowY}px ${Math.max(1, shadowY * 1.5)}px ${theme.shadow}`,
                    cursor: isDrag ? 'grabbing' : 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    background:
                      isSel || isDrag ? 'rgba(255,255,255,0.12)' : 'transparent',
                    borderRadius: 3,
                    position: 'relative',
                  }}
                >
                  {w.word}{' '}
                  {isAdj && (
                    <span
                      className="pointer-events-none"
                      style={{
                        position: 'absolute',
                        left: '50%',
                        bottom: -4,
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        transform: 'translateX(-50%)',
                        background: '#fbbf24',
                        boxShadow: '0 0 4px rgba(251,191,36,0.8)',
                      }}
                    />
                  )}
                </span>
              )
            })}
          </p>
        </div>

        <span className="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
          9:16
        </span>
      </div>

      {/* transport */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md shadow-purple-950/40 transition-transform hover:scale-105"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 size-3" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={lastEnd}
          step={0.05}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-indigo-400"
          aria-label="Preview position"
        />
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
          {fmtTime(time)} / {fmtTime(lastEnd)}
        </span>
      </div>

      {/* word timing tools */}
      {(selectedWord || adjusted.size > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2.5">
          {selectedWord ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
              <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-medium text-zinc-300">
                “{selectedWord.word.trim()}”
              </span>
              <span className="font-mono tabular-nums">
                {fmtTime(selectedWord.start)}–{fmtTime(selectedWord.end)}
              </span>
              <button
                type="button"
                onClick={() => onAdjust(selected!, -0.1)}
                className="rounded-md border border-white/15 px-1.5 py-0.5 font-medium text-zinc-300 transition-colors hover:bg-white/10"
                title="Shift earlier by 0.1 s"
              >
                −0.1 s
              </button>
              <button
                type="button"
                onClick={() => onAdjust(selected!, 0.1)}
                className="rounded-md border border-white/15 px-1.5 py-0.5 font-medium text-zinc-300 transition-colors hover:bg-white/10"
                title="Shift later by 0.1 s"
              >
                +0.1 s
              </button>
              <span className="hidden text-zinc-600 sm:inline">or drag the word sideways</span>
            </div>
          ) : null}
          {adjusted.size > 0 && (
            <button
              type="button"
              onClick={onResetAll}
              className="ml-auto rounded-md border border-amber-400/25 bg-amber-400/[0.08] px-2 py-0.5 font-medium text-amber-300 transition-colors hover:bg-amber-400/15"
            >
              Reset {adjusted.size} word{adjusted.size === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}