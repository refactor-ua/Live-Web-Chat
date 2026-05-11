import OpenAI from 'openai'
import { loadEnv } from './env.ts'

loadEnv()
const openai = new OpenAI()

export async function transcribe(
  audioBuffer: Buffer,
  language: string = 'uk',
  mime: string = 'audio/webm',
  prompt?: string,
): Promise<string> {
  const ext =
    mime.includes('wav') ? 'wav' :
    mime.includes('mp4') || mime.includes('m4a') ? 'mp4' :
    mime.includes('ogg') ? 'ogg' :
    mime.includes('mp3') || mime.includes('mpeg') ? 'mp3' :
    mime.includes('flac') ? 'flac' :
    'webm'
  const file = new File([audioBuffer], `audio.${ext}`, { type: mime })
  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: language === 'auto' ? undefined : language,
    temperature: 0,
    ...(prompt ? { prompt } : {}),
  })
  return result.text
}
