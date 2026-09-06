import { useEffect, useState } from 'react'
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
import { PROVIDERS, providerById } from '../curation/providers'

interface SettingsModalProps {
  onClose: () => void
  /** Fired after any change so the rest of the app re-reads the config. */
  onSaved: () => void
}

/**
 * The settings page — launched from the gear icon in the header. Lets the user
 * pick which AI provider curates clips, drop in that provider's key, and choose
 * a model (or a custom model id). Everything writes straight to localStorage
 * (see ../curation/key) and takes effect immediately; there is no server.
 */
export function SettingsModal({ onClose, onSaved }: SettingsModalProps) {
  const [activeId, setActiveId] = useState(() => getActiveProvider())
  const [keyDraft, setKeyDraft] = useState(() => currentKeyFor(getActiveProvider()) ?? '')
  const [modelChoice, setModelChoice] = useState(() => getSavedModel(getActiveProvider()) ?? '')
  const [custom, setCustom] = useState(false)
  const [detected, setDetected] = useState<Record<string, string[]>>({})
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)

  const info = providerById(activeId)

  const modelOptions = detected[activeId] ?? info.defaultModels

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const detect = async (id = activeId) => {
    const p = providerById(id)
    setDetecting(true)
    setDetectError(null)
    setCustom(true)
    try {
      const models = await listModels(p.endpoint, currentKeyFor(id) ?? '')
      setDetected((prev) => ({ ...prev, [id]: models }))
      if (models.length) {
        setModelChoice(models[0])
        saveModel(id, models[0])
        onSaved()
      }
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  const pickProvider = (id: typeof activeId) => {
    if (id === activeId) return
    setActiveId(id)
    saveActiveProvider(id)
    setKeyDraft(currentKeyFor(id) ?? '')
    setModelChoice(getSavedModel(id) ?? '')
    setCustom(false)
    setDetectError(null)
    onSaved()
  }

  const saveKey = () => {
    if (!keyDraft.trim()) return
    saveApiKey(activeId, keyDraft)
    setKeyDraft(keyDraft.trim())
    onSaved()
  }

  const clearKey = () => {
    saveApiKey(activeId, '')
    setKeyDraft('')
    onSaved()
  }

  const applyModel = (value: string) => {
    setModelChoice(value)
    saveModel(activeId, value)
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      {/* panel */}
      <div className="animate-rise relative w-full max-w-2xl rounded-3xl border border-white/12 bg-[#070a09] p-6 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl italic leading-none text-zinc-50">Settings</p>
            <p className="mt-1 text-xs text-zinc-500">
              Choose how viral clip curation is powered. Changes apply instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* provider picker */}
        <div className="mt-5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">AI provider</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProvider(p.id)}
                title={p.local ? p.setup : `${p.label} — ${p.hint}`}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  p.id === activeId
                    ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200'
                    : 'border-white/12 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-zinc-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* key */}
        {!info.local && (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {info.label} API key
              </p>
              <span className="text-[11px] text-zinc-500">
                {getApiKey(activeId) ? 'saved in this browser' : 'not set'}
              </span>
            </div>
            {info.keyUrl && (
              <a
                href={info.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs font-medium text-indigo-300 underline decoration-indigo-400/40 underline-offset-2 hover:text-indigo-200"
              >
                Get a {info.label} key →
              </a>
            )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && keyDraft.trim()) saveKey()
                }}
                placeholder={info.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400/60"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={!keyDraft.trim()}
                  className="rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {getApiKey(activeId) && (
                  <button
                    type="button"
                    onClick={clearKey}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* model */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Model</p>
            {info.local && (
              <button
                type="button"
                onClick={() => void detect()}
                disabled={detecting}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                {detecting ? 'detecting…' : 'detect local models'}
              </button>
            )}
          </div>

          {custom ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={modelChoice}
                onChange={(e) => {
                  setModelChoice(e.target.value)
                  saveModel(activeId, e.target.value)
                  onSaved()
                }}
                placeholder="provider/model id"
                autoFocus
                spellCheck={false}
                className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-400/60"
              />
              <button
                type="button"
                onClick={() => {
                  setCustom(false)
                  setModelChoice(getSavedModel(activeId) ?? '')
                }}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5"
              >
                Use a preset
              </button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <select
                value={modelChoice}
                onChange={(e) => {
                  if (e.target.value === '__custom') {
                    setCustom(true)
                    setModelChoice('')
                    return
                  }
                  applyModel(e.target.value)
                }}
                className="flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 font-mono text-sm text-zinc-300 outline-none focus:border-indigo-400/60"
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
            </div>
          )}

          {detectError && (
            <p className="mt-2 text-xs text-amber-300">
              Couldn't reach {info.label} ({detectError}). Start it, enable CORS, then retry.
            </p>
          )}
          {detected[activeId] && detected[activeId].length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              <span className="font-medium text-emerald-300">{detected[activeId].length} model{detected[activeId].length === 1 ? '' : 's'}</span>{' '}
              detected on your local server.
            </p>
          )}
        </div>

        {/* footer */}
        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <p className="text-[11px] text-zinc-600">
            Keys are stored only in this browser and sent only to the provider's API.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
