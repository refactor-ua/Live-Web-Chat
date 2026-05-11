import OpenAI from 'openai'
import { loadEnv } from './env.ts'

loadEnv()

type Provider = 'openai' | 'groq'

const OPENAI_VOICES = [
  'alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer',
]

// Groq PlayAI English voices (use playai-tts model).
const GROQ_VOICES = [
  'Arista-PlayAI', 'Atlas-PlayAI', 'Basil-PlayAI', 'Briggs-PlayAI', 'Calum-PlayAI',
  'Celeste-PlayAI', 'Cheyenne-PlayAI', 'Chip-PlayAI', 'Cillian-PlayAI', 'Deedee-PlayAI',
  'Fritz-PlayAI', 'Gail-PlayAI', 'Indigo-PlayAI', 'Mamaw-PlayAI', 'Mason-PlayAI',
  'Mikail-PlayAI', 'Mitch-PlayAI', 'Quinn-PlayAI', 'Thunder-PlayAI',
]

interface ProviderConfig {
  baseURL?: string
  apiKeyEnv: string
  defaultModel: string
  defaultVoice: string
  voices: string[]
  supportsSpeed: boolean
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'tts-1',
    defaultVoice: 'nova',
    voices: OPENAI_VOICES,
    supportsSpeed: true,
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'playai-tts',
    defaultVoice: 'Arista-PlayAI',
    voices: GROQ_VOICES,
    supportsSpeed: false,
  },
}

function getProvider(): Provider {
  const v = (process.env.VOICE_PROVIDER ?? 'openai').toLowerCase()
  if (v !== 'openai' && v !== 'groq') {
    throw new Error(`Unknown VOICE_PROVIDER '${v}'. Use 'openai' or 'groq'.`)
  }
  return v
}

export async function synthesize(
  text: string,
  voice: string = 'nova',
  speed: number = 1.0,
): Promise<Buffer> {
  const provider = getProvider()
  const cfg = PROVIDERS[provider]
  const apiKey = process.env[cfg.apiKeyEnv]
  if (!apiKey) {
    throw new Error(`${cfg.apiKeyEnv} not set (required for provider '${provider}')`)
  }

  // Voice from config may not match the active provider — fall back to provider
  // default rather than failing, since the config UI is provider-agnostic.
  let resolvedVoice = voice
  if (!cfg.voices.includes(resolvedVoice)) {
    process.stderr.write(
      `live-web-chat: voice '${voice}' not available on provider '${provider}', ` +
      `falling back to '${cfg.defaultVoice}'\n`,
    )
    resolvedVoice = cfg.defaultVoice
  }

  const model = process.env.VOICE_TTS_MODEL || cfg.defaultModel
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL })

  const params: Parameters<typeof client.audio.speech.create>[0] = {
    model,
    voice: resolvedVoice as any,
    input: text,
    response_format: 'mp3',
  }
  if (cfg.supportsSpeed) {
    params.speed = speed
  }

  const response = await client.audio.speech.create(params)
  return Buffer.from(await response.arrayBuffer())
}
