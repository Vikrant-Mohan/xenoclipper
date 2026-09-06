import { aspectLabel, formatBytes, formatDuration } from '../lib/format'
import type { VideoSource } from '../types'

interface VideoPanelProps {
  video: VideoSource
  /** Called as <video> metadata loads (duration / resolution). */
  onMetadata: (patch: Partial<VideoSource>) => void
  /** Re-open the file picker to choose a different video. */
  onReplace: () => void
}

export function VideoPanel({ video, onMetadata, onReplace }: VideoPanelProps) {
  const ext = video.name.split('.').pop()?.toUpperCase() ?? 'VIDEO'

  const metaRows: Array<[string, string, boolean]> = [
    ['Duration', formatDuration(video.durationSec), video.durationSec === null],
    ['Resolution', video.width ? `${video.width} × ${video.height}` : '—', !video.width],
    ['Aspect ratio', aspectLabel(video.width, video.height), !video.width],
    ['Size', formatBytes(video.sizeBytes), false],
    ['Container', ext, false],
    ['Type', video.type || 'unknown (probed later by FFmpeg)', false],
  ]

  return (
    <section className="animate-rise mx-auto w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] italic font-normal text-zinc-100" title={video.name}>
              {video.name}
            </p>
            <p className="text-xs text-zinc-500">
              Ingest complete · local file loaded, nothing uploaded
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReplace}
          className="shrink-0 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-white/30 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Replace video
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Preview */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video
            key={video.url}
            src={video.url}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget
              onMetadata({
                durationSec: Number.isFinite(el.duration) ? el.duration : null,
                width: el.videoWidth || null,
                height: el.videoHeight || null,
                previewFailed: false,
              })
            }}
            onError={() => onMetadata({ previewFailed: true })}
          />
        </div>

        {/* Metadata */}
        <div className="flex flex-col gap-4">
          {video.previewFailed && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="mt-0.5 size-4 shrink-0" aria-hidden="true">
                <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              Your browser can't decode this container for preview. That's fine — FFmpeg (Phase 5) handles nearly every codec during rendering.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3 lg:grid-cols-2">
            {metaRows.map(([label, value, loading]) => (
              <div key={label} className="bg-[#0b100d] px-3 py-2.5">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  {label}
                </dt>
                <dd
                  className={`mt-0.5 text-sm text-zinc-200 ${loading ? 'animate-pulse text-zinc-500' : ''}`}
                >
                  {loading ? 'reading…' : value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
            <span className="font-medium text-zinc-300">What happens next (locally):</span>{' '}
            Whisper extracts word-level timestamps → Groq picks the viral
            15–60&nbsp;s window → face tracking computes the 9:16 crop →
            FFmpeg burns in karaoke captions.
          </div>
        </div>
      </div>

    </section>
  )
}
