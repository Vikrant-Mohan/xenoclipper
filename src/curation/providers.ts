/**
 * Bring-your-own-model catalog for the curation stage.
 *
 * XenoClipper has no backend — curation calls go straight from this tab to the
 * provider's API with the user's own key. Two wire flavors cover everything:
 *  - `openai`    POST {endpoint}/chat/completions, `Authorization: Bearer`
 *  - `anthropic` POST {endpoint}/v1/messages, `x-api-key` + version header
 *
 * Local runtimes (Ollama / LM Studio) speak the OpenAI flavor on localhost and
 * need no key at all.
 */

export type ProviderId =
  | 'groq'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'

export type AuthFlavor = 'openai' | 'anthropic'

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** Short sub-label shown in the picker. */
  hint: string
  /** Chat-completions base URL (no trailing slash). */
  endpoint: string
  auth: AuthFlavor
  /** Models tried in order — later candidates absorb catalog drift. */
  defaultModels: string[]
  /** Where to get a key (null for local runtimes). */
  keyUrl: string | null
  /** Placeholder for the key input. */
  keyPlaceholder: string
  /** Local runtimes: no key needed; models are auto-detected at runtime. */
  local: boolean
  /** Inline instructions shown under the key field. */
  setup: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    label: 'Groq',
    hint: 'fastest · free tier',
    endpoint: 'https://api.groq.com/openai/v1',
    auth: 'openai',
    defaultModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'groq/compound'],
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    local: false,
    setup: 'Free key at console.groq.com/keys — stored only in this browser.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'AI Studio · free tier',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: 'openai',
    defaultModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza…',
    local: false,
    setup: 'Free key at aistudio.google.com/app/apikey — stored only in this browser.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-5 family · paid',
    endpoint: 'https://api.openai.com/v1',
    auth: 'openai',
    defaultModels: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    local: false,
    setup: 'Key at platform.openai.com/api-keys (pay-as-you-go) — stored only in this browser.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'Claude 4.5 · paid',
    endpoint: 'https://api.anthropic.com',
    auth: 'anthropic',
    defaultModels: [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-3-5-haiku-20241022',
    ],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    local: false,
    setup: 'Key at console.anthropic.com/settings/keys — stored only in this browser.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    hint: 'one key · 400+ models',
    endpoint: 'https://openrouter.ai/api/v1',
    auth: 'openai',
    defaultModels: [
      'google/gemini-2.5-flash',
      'anthropic/claude-haiku-4.5',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-…',
    local: false,
    setup: 'One key at openrouter.ai/settings/keys unlocks hundreds of models; many have free tiers.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    hint: 'local · no key',
    endpoint: 'http://localhost:11434/v1',
    auth: 'openai',
    defaultModels: ['llama3.2', 'qwen2.5', 'mistral'],
    keyUrl: null,
    keyPlaceholder: '',
    local: true,
    setup:
      'Run `OLLAMA_ORIGINS=* ollama serve`, then `ollama pull llama3.2`. Models are detected automatically.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    hint: 'local · no key',
    endpoint: 'http://localhost:1234/v1',
    auth: 'openai',
    defaultModels: ['local-model'],
    keyUrl: null,
    keyPlaceholder: '',
    local: true,
    setup:
      'In LM Studio: Developer tab → Start server, and enable CORS (or serve on 127.0.0.1). Models are detected automatically.',
  },
]

export function providerById(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

/**
 * Browser-side CORS reality check: which providers actually send permissive
 * CORS headers to a browser tab. Anthropic requires the (allowed) special
 * `anthropic-dangerous-direct-browser-access` header; local runtimes need
 * CORS enabled in their own config.
 */
export function needsBrowserAccessHeader(id: ProviderId): boolean {
  return id === 'anthropic'
}
