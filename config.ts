import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'live-web-chat')
const CONFIG_FILE = join(STATE_DIR, 'config.json')
export const INBOX_DIR = join(STATE_DIR, 'inbox')
export const OUTBOX_DIR = join(STATE_DIR, 'outbox')

export type ListenMode = 'off' | 'ptt' | 'confirmation' | 'on_completion' | 'always'

export type Config = {
  mode: ListenMode
  language: string
  ttsVoice: string
  ttsSpeed: number
  ttsEnabled: boolean
  ttsOnPermission: boolean
  ttsOnReply: boolean
  whisperPrompt: string
  sileroPositiveThreshold: number
  sileroNegativeThreshold: number
  sileroRedemptionFrames: number
  quietPeakThreshold: number
  autoAllowAll: boolean
  port: number
}

const DEFAULTS: Config = {
  mode: 'off',
  language: 'uk',
  ttsVoice: 'nova',
  ttsSpeed: 1.0,
  ttsEnabled: true,
  ttsOnPermission: false,
  ttsOnReply: false,
  whisperPrompt: 'Розмова українською. Claude Code, плагін, live web chat, VAD, Whisper, транскрибація.',
  sileroPositiveThreshold: 0.8,
  sileroNegativeThreshold: 0.4,
  sileroRedemptionFrames: 15,
  quietPeakThreshold: 0.05,
  autoAllowAll: false,
  port: 8787,
}

export function ensureDirs(): void {
  mkdirSync(STATE_DIR, { recursive: true })
  mkdirSync(INBOX_DIR, { recursive: true })
  mkdirSync(OUTBOX_DIR, { recursive: true })
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(cfg: Config): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}
