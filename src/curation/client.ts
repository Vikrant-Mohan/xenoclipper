import { callLlm, LlmApiError, LlmParseError } from './llm'
import type { ProviderId } from './providers'
import type { ViralClip } from './types'
import type { Transcript } from '../transcription/types'

export interface CurateEvents {
  onRunning(): void
}

export interface CurateController {
  promise: Promise<{ clips: ViralClip[]; usage: { totalTokens: number } | null }>
  cancel(): void
}

export class CurateCancelledError extends Error {
  constructor() {
    super('Curation cancelled')
    this.name = 'CurateCancelledError'
  }
}

/** Everything the curation call needs: provider, key and optional model. */
export interface CurateConfig {
  providerId: ProviderId
  apiKey: string
  /** Explicit model; null → the provider's default chain. */
  model: string | null
}

/**
 * Runs one curation request against the configured provider with an abortable
 * fetch. The request can be cancelled at any time; the abort is wired through
 * to the fetch.
 */
export function curateTranscript(
  transcript: Transcript,
  config: CurateConfig,
  events: CurateEvents,
): CurateController {
  const controller = new AbortController()

  const promise = (async () => {
    events.onRunning()
    try {
      const result = await callLlm({
        transcript,
        providerId: config.providerId,
        apiKey: config.apiKey,
        model: config.model,
        signal: controller.signal,
      })
      return {
        clips: result.clips,
        usage: result.usage,
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CurateCancelledError()
      }
      throw err
    }
  })()

  return {
    promise,
    cancel() {
      controller.abort()
    },
  }
}

export { LlmApiError, LlmParseError }
