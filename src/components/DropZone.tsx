import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { isVideoFile } from '../lib/files'

interface DropZoneProps {
  /** Opens the hidden file input (click / keyboard activation). */
  onOpenPicker: () => void
  /** Called with a validated video file. */
  onFile: (file: File) => void
}

export function DropZone({ onOpenPicker, onFile }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const errorTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(errorTimer.current), [])

  function showError(message: string) {
    setError(message)
    window.clearTimeout(errorTimer.current)
    errorTimer.current = window.setTimeout(() => setError(null), 6000)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!isVideoFile(file)) {
      showError('That doesn\u2019t look like a video. Try MP4, MOV, WebM, MKV\u2026')
      return
    }
    setError(null)
    onFile(file)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpenPicker()
    }
  }

  const activeStyles = dragging
    ? 'border-indigo-400/70 bg-indigo-500/[0.08]'
    : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a video: drag and drop a file here, or press Enter to browse"
      onClick={onOpenPicker}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDrop={handleDrop}
      className={`animate-rise flex w-full cursor-pointer flex-col items-center gap-4 rounded-3xl border-2 border-dashed px-6 py-14 text-center outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 sm:py-16 ${activeStyles}`}
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-lg shadow-purple-950/50">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-8 text-white"
          aria-hidden="true"
        >
          <path d="M12 16V6m0 0l-4.5 4.5M12 6l4.5 4.5" />
          <path d="M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5" />
        </svg>
      </div>

      <div className="space-y-1.5">
        <p className="font-display text-[22px] italic font-normal leading-snug text-zinc-100">
          {dragging ? 'Drop it — nothing leaves your device' : 'Drag & drop your video'}
        </p>
        <p className="text-sm text-zinc-400">
          or{' '}
          <span className="font-medium text-indigo-300 underline decoration-indigo-400/40 underline-offset-4">
            browse files
          </span>{' '}
          — MP4, MOV, WebM, MKV and more
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-zinc-500">
        {['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].map((ext) => (
          <span
            key={ext}
            className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono uppercase"
          >
            {ext}
          </span>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-rose-300">
          {error}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-3.5 text-emerald-400" aria-hidden="true">
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Your video is never uploaded — processing happens locally in this tab.
        </span>
      </p>
    </div>
  )
}
