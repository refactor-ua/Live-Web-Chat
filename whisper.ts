import OpenAI from 'openai'
import { loadEnv } from './env.ts'

loadEnv()

type Provider = 'openai' | 'groq'

interface ProviderConfig {
  baseURL?: string
  apiKeyEnv: string
  defaultModel: string
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'whisper-1',
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'whisper-large-v3-turbo',
  },
}

function getProvider(): Provider {
  const v = (process.env.VOICE_PROVIDER ?? 'openai').toLowerCase()
  if (v !== 'openai' && v !== 'groq') {
    throw new Error(`Unknown VOICE_PROVIDER '${v}'. Use 'openai' or 'groq'.`)
  }
  return v
}

export async function transcribe(
  audioBuffer: Buffer,
  language: string = 'uk',
  mime: string = 'audio/webm',
  prompt?: string,
): Promise<string> {
  const provider = getProvider()
  const cfg = PROVIDERS[provider]
  const apiKey = process.env[cfg.apiKeyEnv]
  if (!apiKey) {
    throw new Error(`${cfg.apiKeyEnv} not set (required for provider '${provider}')`)
  }

  const model = process.env.VOICE_TRANSCRIBE_MODEL || cfg.defaultModel
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL })

  const ext =
    mime.includes('wav') ? 'wav' :
    mime.includes('mp4') || mime.includes('m4a') ? 'mp4' :
    mime.includes('ogg') ? 'ogg' :
    mime.includes('mp3') || mime.includes('mpeg') ? 'mp3' :
    mime.includes('flac') ? 'flac' :
    'webm'
  const file = new File([audioBuffer], `audio.${ext}`, { type: mime })
  const result = await client.audio.transcriptions.create({
    model,
    file,
    language: language === 'auto' ? undefined : language,
    temperature: 0,
    ...(prompt ? { prompt } : {}),
  })
  return result.text
}
