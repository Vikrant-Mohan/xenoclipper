import type { ViralClip } from './types'
import { compileTranscriptForLlm } from './transcript'
import type { Transcript } from '../transcription/types'
import { needsBrowserAccessHeader, providerById, type ProviderId } from './providers'

/**
 * Phase 3 — the viral engine, provider-agnostic.
 *
 * Sends the word-timestamped transcript to the user's chosen provider
 * (Groq / Gemini / OpenAI / Anthropic / OpenRouter / local Ollama / LM Studio)
 * and asks for a strict JSON list of viral clips. Everything runs in the
 * browser; the only thing that leaves the machine is the transcript text plus
 * the user's own key, sent directly to the provider (no intermediary server).
 */

const SYSTEM_PROMPT = `You are a senior short-form video editor who turns long talking-head and creator videos into viral vertical clips (like OpusClip). Given a timestamped transcript, identify the moments most likely to perform as standalone short vertical clips.

Rules:
- Return ONLY a JSON object of the form {"clips": [...]} — no prose, no markdown fences.
- Each clip object MUST have exactly these keys:
  "start_time": number (seconds into the video),
  "end_time": number (seconds into the video),
  "viral_score": integer 1–100 (confidence this moment goes viral),
  "hook_text": string (the exact spoken line that should open the clip),
  "rationale": string (one sentence: why this moment works — emotion, conflict, payoff, surprise, strong opinion, etc.)
- Clips must be 15–60 seconds long, with a target average of about 30 seconds across your suggestions: aim for tight, punchy 15–30s cuts when the moment is self-contained, and stretch toward 45–60s only when the story genuinely needs the build-up. Avoid both ultra-short fragments and sprawling multi-minute spans.
- Each clip must be self-contained: a clear hook, a build, and a satisfying ending. If the video is too short for 15s, still pick the most complete moment available.
- Prefer emotionally charged, opinionated, story-driven, or payoff moments over neutral exposition.
- Rank the clips: put the strongest first. Suggest 3–6 clips, no duplicates, clips may not overlap.
- Clamp all times to the video's actual duration. Keep hook_text verbatim from the transcript where possible.
- Use the [m:ss] timestamps in the transcript to ground start_time/end_time; they are exact word timings.`

export interface ClipResult {
  clips: ViralClip[]
  /** Raw model response, for debugging. */
  raw: string
  /** Token usage from the API, when the provider reports it. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = 'LlmApiError'
  }
}

export class LlmParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message)
    this.name = 'LlmParseError'
  }
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : fallback
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback

/**
 * Validates/normalizes the model's JSON into ViralClip[] and rejects garbage.
 */
export function parseClips(raw: string, maxDurationSec: number | null): ViralClip[] {
  let text = raw.trim()
  // tolerate markdown fences the model occasionally adds despite instructions
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fence) text = fence[1].trim()

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new LlmParseError('The model did not return valid JSON.', raw)
  }

  let list: unknown
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object') {
    list = (data as Record<string, unknown>).clips
    if (!Array.isArray(list)) throw new LlmParseError('Missing "clips" array.', raw)
  } else {
    throw new LlmParseError('Unexpected JSON shape.', raw)
  }

  const clips: ViralClip[] = []
  for (const item of list as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const start = num(o.start_time, NaN)
    const end = num(o.end_time, NaN)
    const hook = str(o.hook_text, '')
    const rationale = str(o.rationale, '')
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (end <= start) continue
    if (maxDurationSec !== null && maxDurationSec > 0 && end > maxDurationSec + 2) continue
    clips.push({
      startTime: Math.max(0, start),
      endTime:
        maxDurationSec !== null && maxDurationSec > 0 ? Math.min(end, maxDurationSec) : end,
      viralScore: Math.min(100, Math.max(1, Math.round(num(o.viral_score, 50)))),
      hookText: hook,
      rationale,
    })
  }
  return clips
}

export interface LlmCallOptions {
  transcript: Transcript
  providerId: ProviderId
  apiKey: string
  /** Explicit model override; null/undefined → the provider's default chain. */
  model?: string | null
  signal?: AbortSignal
}

type ChatMessages = Array<{ role: string; content: string }>

/** OpenAI gpt-5 / o-series reject max_tokens and temperature — use the new knobs. */
function isOpenAiStrictModel(model: string): boolean {
  return /^gpt-5/.test(model) || /^o[1-4]/.test(model)
}

function openAiBody(model: string, messages: ChatMessages): Record<string, unknown> {
  if (isOpenAiStrictModel(model)) {
    return {
      model,
      max_completion_tokens: 4000,
      messages,
      response_format: { type: 'json_object' },
    }
  }
  return {
    model,
    temperature: 0.6,
    max_tokens: 4000,
    messages,
    response_format: { type: 'json_object' },
  }
}

function authHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (providerId === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    // Anthropic requires this explicit opt-in for direct browser calls (CORS).
    if (needsBrowserAccessHeader(providerId)) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }
    return headers
  }
  // OpenAI flavor: Bearer — omitted entirely for keyless local runtimes.
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function extractOpenAiText(body: unknown): string {
  const b = body as { choices?: Array<{ message?: { content?: string } }> } | null
  return b?.choices?.[0]?.message?.content ?? ''
}

function extractOpenAiUsage(body: unknown): ClipResult['usage'] {
  const b = body as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  } | null
  if (!b?.usage) return null
  return {
    promptTokens: b.usage.prompt_tokens ?? 0,
    completionTokens: b.usage.completion_tokens ?? 0,
    totalTokens: b.usage.total_tokens ?? 0,
  }
}

function extractAnthropicText(body: unknown): string {
  const b = body as { content?: Array<{ type?: string; text?: string }> } | null
  if (!b?.content) return ''
  return b.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('')
}

function extractAnthropicUsage(body: unknown): ClipResult['usage'] {
  const b = body as {
    usage?: { input_tokens?: number; output_tokens?: number }
  } | null
  if (!b?.usage) return null
  const prompt = b.usage.input_tokens ?? 0
  const completion = b.usage.output_tokens ?? 0
  return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion }
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new LlmApiError(
      `Could not reach the provider: ${err instanceof Error ? err.message : String(err)}`,
      null,
    )
  }
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    // non-JSON body
  }
  return { status: res.status, body: parsed }
}

/** Human-readable error text from either wire flavor. */
function errorDetail(body: unknown): string {
  const b = body as { error?: { message?: string } | string; message?: string } | null
  if (!b?.error) return b?.message ?? ''
  if (typeof b.error === 'string') return b.error
  return b.error.message ?? ''
}

/** True when the failure means "this model name doesn't exist here". */
function isModelMissing(status: number, body: unknown): boolean {
  if (status === 404) return true
  if (status !== 400) return false
  const detail = errorDetail(body).toLowerCase()
  return (
    (detail.includes('model') &&
      (detail.includes('not found') ||
        detail.includes('does not exist') ||
        detail.includes('unknown') ||
        detail.includes('invalid'))) ||
    detail.includes('no models loaded') ||
    detail.includes('model_not_found')
  )
}

function friendlyHttpError(
  label: string,
  keyUrl: string | null,
  status: number,
  detail: string,
): LlmApiError {
  const at = keyUrl ? ` Check your key at ${keyUrl.replace(/^https?:\/\//, '')}.` : ''
  const hint =
    status === 401 || status === 403
      ? ` — ${label} rejected the API key.${at}`
      : status === 429
        ? ` — ${label} rate limit reached. Wait a few seconds and try again.`
        : status === 402
          ? ` — ${label} says this key has no credit/quota left.${at}`
          : ''
  return new LlmApiError(
    `${label} returned HTTP ${status}${hint}${detail ? ` (${detail})` : ''}`,
    status,
  )
}

/**
 * Runs one curation request against the chosen provider. Throws LlmApiError
 * (HTTP) or LlmParseError. When no explicit model is given, the provider's
 * default model chain is tried in order so catalog drift degrades gracefully.
 */
export async function callLlm({
  transcript,
  providerId,
  apiKey,
  model,
  signal,
}: LlmCallOptions): Promise<ClipResult> {
  const info = providerById(providerId)
  const candidates = model && model.trim() ? [model.trim()] : info.defaultModels

  const payload = compileTranscriptForLlm(transcript)
  const userMessage = [
    `Video duration: ${Math.round(transcript.audioDurationSec ?? 0)} seconds.`,
    '',
    'Timestamped transcript:',
    payload,
  ].join('\n')
  const messages: ChatMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]

  let lastError: LlmApiError | null = null

  for (const candidate of candidates) {
    let res: { status: number; body: unknown }
    if (info.auth === 'anthropic') {
      res = await post(
        `${info.endpoint}/v1/messages`,
        authHeaders(providerId, apiKey),
        {
          model: candidate,
          max_tokens: 4000,
          temperature: 0.6,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        },
        signal,
      )
    } else {
      res = await post(
        `${info.endpoint}/chat/completions`,
        authHeaders(providerId, apiKey),
        openAiBody(candidate, messages),
        signal,
      )
    }

    const { status, body } = res
    if (status !== 200) {
      const detail = errorDetail(body)
      if ((status === 404 || status === 400) && isModelMissing(status, body) && candidates.length > 1) {
        // model retired / not on this key — try the next candidate
        lastError = new LlmApiError(
          `${info.label} rejected model "${candidate}"${detail ? ` (${detail})` : ''}`,
          status,
        )
        continue
      }
      throw friendlyHttpError(info.label, info.keyUrl, status, detail)
    }

    const raw = info.auth === 'anthropic' ? extractAnthropicText(body) : extractOpenAiText(body)
    if (!raw) throw new LlmParseError(`${info.label} returned an empty response.`, raw)
    return {
      clips: parseClips(raw, transcript.audioDurationSec),
      raw,
      usage: info.auth === 'anthropic' ? extractAnthropicUsage(body) : extractOpenAiUsage(body),
    }
  }

  // Every candidate 404'd — surface the last model error.
  throw lastError ?? new LlmApiError(`${info.label} rejected all model candidates.`, null)
}

/**
 * Lists models from an OpenAI-compatible `/models` endpoint. Used by the UI to
 * auto-detect locally-served models (Ollama, LM Studio) — works for any
 * provider that exposes the route.
 */
export async function listModels(
  endpoint: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(`${endpoint}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new LlmApiError(
      `Could not reach ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      null,
    )
  }
  if (!res.ok) throw new LlmApiError(`HTTP ${res.status} from ${endpoint}/models`, res.status)
  const body = (await res.json()) as { data?: Array<{ id?: string }> } | null
  const ids = (body?.data ?? [])
    .map((m) => (typeof m?.id === 'string' ? m.id : ''))
    .filter(Boolean)
  return [...new Set(ids)].sort()
}
