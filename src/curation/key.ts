/**
 * Per-provider credentials & settings.
 *
 * XenoClipper has no backend, so curation calls go straight from this tab to
 * the chosen provider. Keys are persisted only in localStorage on the user's
 * device and are sent only to that provider's API domain. Env vars
 * (VITE_GROQ_API_KEY etc.) can pre-bake keys for hosted demos.
 */

import type { ProviderId } from './providers'

const KEY_STORAGE = 'xenoclipper.apiKeys' // Record<ProviderId, string>
const ACTIVE_STORAGE = 'xenoclipper.activeProvider'
const MODEL_STORAGE = 'xenoclipper.modelByProvider' // Record<ProviderId, string>

// Kept for backward compatibility with pre-multi-provider installs.
const LEGACY_KEY = 'xenoclipper.groqApiKey'

type KeyMap = Partial<Record<ProviderId, string>>
type ModelMap = Partial<Record<ProviderId, string>>

function readJson<T>(storageKey: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(storageKey: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // storage full / private mode — settings just won't persist
  }
}

/** Migrates the old single `xenoclipper.groqApiKey` into the new key map. */
function migrateLegacyKey(): void {
  try {
    if (!localStorage.getItem(LEGACY_KEY)) return
    const map = readJson<KeyMap>(KEY_STORAGE) ?? {}
    if (!map.groq) {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy && legacy.trim()) {
        map.groq = legacy.trim()
        writeJson(KEY_STORAGE, map)
      }
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // ignore
  }
}

export function getApiKey(id: ProviderId): string | null {
  migrateLegacyKey()
  return readJson<KeyMap>(KEY_STORAGE)?.[id] ?? null
}

export function saveApiKey(id: ProviderId, key: string): void {
  const map = readJson<KeyMap>(KEY_STORAGE) ?? {}
  map[id] = key.trim()
  writeJson(KEY_STORAGE, map)
}

export function clearApiKey(id: ProviderId): void {
  const map = readJson<KeyMap>(KEY_STORAGE) ?? {}
  delete map[id]
  writeJson(KEY_STORAGE, map)
}

export function getActiveProvider(): ProviderId {
  const v = readJson<{ id?: string }>(ACTIVE_STORAGE)
  return (v?.id as ProviderId) ?? 'groq'
}

export function saveActiveProvider(id: ProviderId): void {
  writeJson(ACTIVE_STORAGE, { id })
}

/** The user's explicit per-provider model override, if any. */
export function getSavedModel(id: ProviderId): string | null {
  return readJson<ModelMap>(MODEL_STORAGE)?.[id] ?? null
}

export function saveModel(id: ProviderId, model: string): void {
  const map = readJson<ModelMap>(MODEL_STORAGE) ?? {}
  if (model.trim()) map[id] = model.trim()
  else delete map[id]
  writeJson(MODEL_STORAGE, map)
}

function envKeyFor(id: ProviderId): string | null {
  const names: Record<ProviderId, string | null> = {
    groq: 'VITE_GROQ_API_KEY',
    gemini: 'VITE_GEMINI_API_KEY',
    openai: 'VITE_OPENAI_API_KEY',
    anthropic: 'VITE_ANTHROPIC_API_KEY',
    openrouter: 'VITE_OPENROUTER_API_KEY',
    ollama: null,
    lmstudio: null,
  }
  const name = names[id]
  if (!name) return null
  const v = (import.meta.env as Record<string, string | undefined>)[name]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Saved key for a provider, falling back to a build-time env key. */
export function currentKeyFor(id: ProviderId): string | null {
  return getApiKey(id) ?? envKeyFor(id)
}

/** The effective setup: active provider + its key + its model override. */
export interface ActiveConfig {
  providerId: ProviderId
  apiKey: string
  model: string | null
}

export function currentConfig(): ActiveConfig {
  const providerId = getActiveProvider()
  return {
    providerId,
    apiKey: currentKeyFor(providerId) ?? '',
    model: getSavedModel(providerId),
  }
}
