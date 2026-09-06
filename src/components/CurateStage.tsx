import { useEffect, useState } from 'react'
import type { CurateConfig } from '../curation/client'
import { listModels } from '../curation/llm'
import {
  currentKeyFor,
  getActiveProvider,
  getApiKey,
  getSavedModel,
  saveActiveProvider,
  saveApiKey,
  saveModel,
} from '../curation/key'
import { PROVIDERS, providerById, type ProviderId } from '../curation/providers'
import type { ViralClip, CurateState } from '../curation/types'
import type { Transcript } from '../transcription/types'

interface CurateStageProps {
  transcript: Transcript | null
  state: CurateState
  /** Suggested clips from the last successful run (null before first run). */
  clips: ViralClip[] | null
  selected: ViralClip | null
  onRun: (config: CurateConfig) => void
  onCancel: () => void
  onDismissError: () => void
  onSelect: (clip: ViralClip | null) => void
}

function useElapsed(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !startedAt) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [active, startedAt])
  return active && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0
}

const mss = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function scoreStyle(score: number): string {
  if (score >= 80) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
  if (score >= 60) return 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300'
  return 'border-white/15 bg-white/[0.04] text-zinc-300'
}

/** Small clickable provider chips used in every state of the card. */
function ProviderChips({
  activeId,
  disabled,
  onSelect,
}: {
  activeId: ProviderId
  disabled?: boolean
  onSelect: (id: ProviderId) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(p.id)}
          title={p.local ? p.setup : `${p.label} — ${p.hint}`}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            p.id === activeId
              ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200'
              : 'border-white/12 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-zinc-200'
          }`}
        >
          {p.label}
          <span className="ml-1 hidden text-[10px] text-zinc-500 sm:inline">{p.hint}</span>
        </button>
      ))}
    </div>
  )
}

export function CurateStage({
  transcript,
  state,
  clips,
  selected,
  onRun,
  onCancel,
  onDismissError,
  onSelect,
}: CurateStageProps) {
  const hasTranscript = transcript !== null && transcript.words.length > 0
  const [activeId, setActiveId] = useState<ProviderId>(() => getActiveProvider())
  const [keyDraft, setKeyDraft] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [modelChoice, setModelChoice] = useState<string>(() => getSavedModel(getActiveProvider()) ?? '')
  const [customModel, setCustomModel] = useState(false)
  const [detected, setDetected] = useState<Partial<Record<ProviderId, string[]>>>({})
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)

  const info = providerById(activeId)
  const busy = state.phase === 'running'
  const elapsed = useElapsed(state.startedAt, busy)
  const savedKey = getApiKey(activeId)
  const envKey = !savedKey && currentKeyFor(activeId) !== null
  const hasKey = currentKeyFor(activeId) !== null
  const canRun = hasKey || info.local

  const modelOptions = detected[activeId] ?? info.defaultModels

  const runConfig = (): CurateConfig => ({
    providerId: activeId,
    apiKey: currentKeyFor(activeId) ?? '',
    model: modelChoice.trim() || null,
  })

  const run = () => {
    if (!canRun) return
    saveModel(activeId, modelChoice)
    onRun(runConfig())
  }

  const selectProvider = (id: ProviderId) => {
    if (id === activeId || busy) return
    setActiveId(id)
    saveActiveProvider(id)
    setKeyDraft('')
    setEditingKey(false)
    setModelChoice(getSavedModel(id) ?? '')
    setCustomModel(false)
    setDetectError(null)
    // Local runtimes: probe their model list right away.
    const p = providerById(id)
    if (p.local && !detected[id]) void detectModels(id)
  }

  const detectModels = async (id: ProviderId = activeId) => {
    const p = providerById(id)
    setDetecting(true)
    setDetectError(null)
    try {
      const models = await listModels(p.endpoint, currentKeyFor(id) ?? '')
      setDetected((prev) => ({ ...prev, [id]: models }))
      if (models.length && !modelChoice) setModelChoice(models[0])
      if (models.length) saveModel(id, models[0])
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  useEffect(() => {
    const p = providerById(getActiveProvider())
    if (p.local) void detectModels(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!hasTranscript) return null

  const keyStatus = info.local
    ? 'no key needed'
    : savedKey
      ? 'key saved in this browser'
      : envKey
        ? 'build-time key'
        : 'no key yet'

  // ---------------------------------------------------------------- running
  if (busy) {
    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-purple-400/30 bg-purple-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5.5 animate-spin text-purple-300" style={{ animationDuration: '1.2s' }} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] italic font-normal text-zinc-100">
              {info.label} is hunting for viral moments
              {elapsed > 0 && <span className="ml-2 font-normal text-zinc-500">· {mss(elapsed)}</span>}
            </p>
            <p className="mt-0.5 truncate text-xs leading-relaxed text-zinc-400">
              Analyzing the timestamped transcript with{' '}
              <span className="font-mono">{modelChoice || info.defaultModels[0]}</span> for hooks,
              payoff and emotion. Usually takes a few seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
          >
            Cancel
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-purple-400 to-pink-400" />
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------------ error
  if (state.phase === 'error' && state.error) {
    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-rose-400/25 bg-rose-500/[0.06] p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4.5" aria-hidden="true">
              <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-200">Clip curation failed</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-300/90">{state.error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={run}
                disabled={!canRun}
                className="rounded-xl bg-rose-400/90 px-4 py-2 text-xs font-semibold text-rose-950 transition-colors hover:bg-rose-300 disabled:opacity-50"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onDismissError}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // -------------------------------------------------------------- done/idle
  const noClips = state.phase === 'done' && (clips === null || clips.length === 0)

  return (
    <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
      {/* config strip: provider + model + key status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3.5">
        <ProviderChips activeId={activeId} onSelect={selectProvider} />
        <div className="flex flex-wrap items-center gap-2">
          {customModel ? (
            <input
              type="text"
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              onBlur={() => saveModel(activeId, modelChoice)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveModel(activeId, modelChoice)
                  setCustomModel(false)
                }
              }}
              placeholder="provider/model id"
              autoFocus
              spellCheck={false}
              className="w-44 rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-400/60"
            />
          ) : (
            <select
              value={modelChoice}
              onChange={(e) => {
                if (e.target.value === '__custom') {
                  setCustomModel(true)
                  setModelChoice('')
                  return
                }
                setModelChoice(e.target.value)
                saveModel(activeId, e.target.value)
              }}
              className="max-w-52 rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-indigo-400/60"
              title="Model used for curation"
            >
              {!modelChoice && <option value="">default (auto-fallback)</option>}
              {modelChoice && !modelOptions.includes(modelChoice) && (
                <option value={modelChoice}>{modelChoice}</option>
              )}
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom">custom model…</option>
            </select>
          )}
          <span className="text-[11px] text-zinc-500">{keyStatus}</span>
          {!info.local && hasKey && (
            <button
              type="button"
              onClick={() => setEditingKey((v) => !v)}
              className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              {editingKey ? 'close' : 'change key'}
            </button>
          )}
        </div>
      </div>

      {/* inline key editor (also the gate when no key is set) */}
      {(!info.local && (!hasKey || editingKey)) && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs font-medium text-zinc-200">Add your {info.label} API key</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {info.setup} It is stored only in this browser (localStorage) and sent
            only to <span className="font-mono">{new URL(info.endpoint).hostname}</span>, straight
            from your tab. No XenoClipper server exists.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && keyDraft.trim()) {
                  saveApiKey(activeId, keyDraft)
                  setEditingKey(false)
                  run()
                }
              }}
              placeholder={info.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400/60 sm:w-96"
            />
            <button
              type="button"
              onClick={() => {
                if (!keyDraft.trim()) return
                saveApiKey(activeId, keyDraft)
                setKeyDraft('')
                setEditingKey(false)
                run()
              }}
              disabled={!keyDraft.trim()}
              className={
                keyDraft.trim()
                  ? 'shrink-0 rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]'
                  : 'shrink-0 cursor-not-allowed rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-zinc-500'
              }
            >
              Save key &amp; find clips
            </button>
          </div>
          {info.keyUrl && (
            <a
              href={info.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-medium text-indigo-300 underline decoration-indigo-400/40 underline-offset-2 hover:text-indigo-200"
            >
              Get a {info.label} key →
            </a>
          )}
        </div>
      )}

      {/* local runtime helper */}
      {info.local && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-200">
              {info.label} runs on this machine — no key, nothing leaves localhost
            </p>
            <button
              type="button"
              onClick={() => void detectModels()}
              disabled={detecting}
              className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {detecting ? 'detecting…' : 'detect models'}
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{info.setup}</p>
          {detected[activeId] && (
            <p className="mt-1.5 text-xs text-zinc-400">
              <span className="font-medium text-emerald-300">
                {detected[activeId]!.length} model{detected[activeId]!.length === 1 ? '' : 's'}
              </span>{' '}
              available — pick one above
              {detected[activeId]!.length === 0 ? ' once your local server is running' : ''}.
            </p>
          )}
          {detectError && (
            <p className="mt-1.5 text-xs text-amber-300">
              Couldn't reach {info.label} ({detectError}). Start it, enable CORS, then retry.
            </p>
          )}
        </div>
      )}

      {noClips ? (
        <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-display text-[15px] italic font-normal text-zinc-100">No viral moments found</p>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-400">
              {info.label} analyzed the transcript but returned no usable clips. Try
              a longer video, another model, or re-run for a fresh take.
            </p>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="shrink-0 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Re-run
          </button>
        </div>
      ) : clips && clips.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
                  <path d="M12 17.3l-3.5 2.1 1-3.9-3.2-2.7 4.1-.3L12 8.8l1.6 3.7 4.1.3-3.2 2.7 1 3.9z" />
                </svg>
              </span>
              <div>
                <p className="font-display text-[15px] italic font-normal text-zinc-100">
                  {clips.length} viral moment{clips.length === 1 ? '' : 's'} found
                </p>
                <p className="text-xs text-zinc-500">
                  {info.label} · ranked by predicted impact · render one below, or batch-render them all
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              Re-run
            </button>
          </div>

          <ul className="mt-4 space-y-2.5">
            {clips.map((clip, i) => {
              const isSelected = selected === clip
              return (
                <li key={`${clip.startTime}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : clip)}
                    className={`w-full rounded-2xl border p-4 text-left transition-all ${
                      isSelected
                        ? 'border-pink-400/50 bg-pink-500/[0.08] ring-1 ring-pink-400/40'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-zinc-500">#{i + 1}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${scoreStyle(clip.viralScore)}`}>
                        {clip.viralScore} viral
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                        {mss(clip.startTime)} – {mss(clip.endTime)} · {Math.round(clip.endTime - clip.startTime)}s
                      </span>
                      {isSelected && (
                        <span className="rounded-full bg-pink-400/20 px-2 py-0.5 text-[11px] font-semibold text-pink-200">
                          Selected — ready to reframe &amp; render
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[15px] font-medium leading-snug text-zinc-100">
                      “{clip.hookText}”
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{clip.rationale}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        !(!info.local && !hasKey) && (
          // idle with key ready — primary CTA
          <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4.5" aria-hidden="true">
                  <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <p className="font-display text-[15px] italic font-normal text-zinc-100">
                  Find your viral 15–60&nbsp;s moments
                </p>
                <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-400">
                  {info.label}
                  {modelChoice ? (
                    <>
                      {' '}<span className="font-mono">{modelChoice}</span>
                    </>
                  ) : (
                    <>’s default model</>
                  )}{' '}
                  scores the transcript for hooks, emotion and payoff, and returns
                  ranked clip suggestions with exact in/out points.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="shrink-0 rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
            >
              Find viral clips
            </button>
          </div>
        )
      )}
    </section>
  )
}
