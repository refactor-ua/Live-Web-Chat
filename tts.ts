import OpenAI from 'openai'
import { loadEnv } from './env.ts'

loadEnv()
const openai = new OpenAI()

export async function synthesize(
  text: string,
  voice: string = 'nova',
  speed: number = 1.0,
): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: voice as 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer',
    input: text,
    speed,
    response_format: 'mp3',
  })
  return Buffer.from(await response.arrayBuffer())
}
