#!/usr/bin/env bun
/**
 * Live Web Chat v2 — unified local chat + voice channel for Claude Code.
 *
 * MCP server + HTTP + WebSocket. Browser UI sends audio/text/files.
 * Audio → Whisper transcription → Claude channel notification.
 * Claude responds via reply/speak/edit_message tools → browser UI.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { readFileSync, mkdirSync, statSync, copyFileSync, existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join, extname, basename } from 'path'
import type { ServerWebSocket } from 'bun'
import { loadEnv } from './env.ts'
import { loadConfig, saveConfig, ensureDirs, OUTBOX_DIR } from './config.ts'
import type { Config } from './config.ts'
import { transcribe } from './whisper.ts'
import { synthesize } from './tts.ts'
import { saveFile, getFilePath } from './files.ts'

loadEnv()
ensureDirs()

// Last-resort safety net
process.on('unhandledRejection', err => {
  process.stderr.write(`live-web-chat: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`live-web-chat: uncaught exception: ${err}\n`)
})

// ─── Config ──────────────────────────────────────────────────────────────────

let config = loadConfig()
const PORT = Number(process.env.LIVE_WEB_CHAT_PORT ?? config.port)

// ─── WebSocket clients ───────────────────────────────────────────────────────

type WSClient = ServerWebSocket<unknown>
const clients = new Set<WSClient>()
let seq = 0

function nextId() {
  return `m${Date.now()}-${++seq}`
}

function broadcast(data: unknown): void {
  const msg = typeof data === 'string' ? data : JSON.stringify(data)
  for (const ws of clients) {
    try {
      if (ws.readyState === 1) ws.send(msg)
    } catch {
      clients.delete(ws)
    }
  }
}

function mime(ext: string) {
  const m: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  }
  return m[ext] ?? 'application/octet-stream'
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

function hasVoiceSkill(): boolean {
  const userScope = join(homedir(), '.claude', 'skills', 'voice', 'SKILL.md')
  if (existsSync(userScope)) return true
  const cacheRoot = join(homedir(), '.claude', 'plugins', 'cache')
  try {
    for (const marketplace of readdirSync(cacheRoot)) {
      const skillDir = join(cacheRoot, marketplace, 'voice-skill')
      if (existsSync(skillDir)) return true
    }
  } catch {
    /* cache root missing — no plugins installed */
  }
  return false
}

const voiceSkillPresent = hasVoiceSkill()

const mcp = new Server(
  { name: 'live-web-chat', version: '2.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: [
      'The sender reads the live-web-chat UI, not this session. Anything you want them to see must go through the reply or speak tools — your transcript output never reaches the UI.',
      '',
      'Messages from the live-web-chat web UI arrive as <channel source="live-web-chat" chat_id="web" message_id="...">. If the tag has a file_path or image_path attribute, Read that file — it is an upload from the UI.',
      '',
      'Use the reply tool to send text responses (supports quote-reply and file attachments). Use the speak tool to send text that should be read aloud via TTS. Use edit_message to update a previously sent message.',
      '',
      'Voice & speed: do NOT pass voice/speed params to speak unless the user explicitly asks for a one-off override (e.g. comparing voices). The plugin honors the user\'s configured TTS Voice and TTS Speed from Settings, and any explicit param overrides that preference for that call. Default is "trust user config" — just send text. Same for tts.py in adjacent skills.',
      '',
      'If the user\'s "Speak replies" toggle is on in Settings, every plain `reply` already gets auto-TTS\'d server-side — so a separate `speak` call would double-voice the same text. Only call `speak` explicitly when you need audio AND the user has Speak replies off, or for permission prompts where text alone is insufficient.',
      '',
      'The live-web-chat UI renders a small set of HTML tags inline in assistant messages: <table>/<thead>/<tbody>/<tr>/<th>/<td> (with colspan/rowspan), <ul>/<ol>/<li>, <code>, <pre>, <b>/<strong>, <i>/<em>, <br>, <hr>, <p>. Use an HTML <table> for tabular data — Markdown table syntax (| --- |) is NOT parsed and will render as raw pipes. Other markup (headings, bold-via-asterisks, links) is not rendered either — keep messages plain unless you need structure.',
      '',
      ...(voiceSkillPresent
        ? []
        : [
            '⚠ The Voice-Skill plugin is NOT installed on this machine. Voice features (auto-routing user voice input to the speak tool, voice replies on Telegram) will be unavailable until the user installs it. If the user sends a voice message (text starting with 🎤) or asks for a voice reply, tell them to install it with:',
            '  /plugin install voice-skill@refactor-ua',
            'If `refactor-ua` marketplace is not yet added, they need:',
            '  /plugin marketplace add refactor-ua/Live-Web-Chat',
            '',
          ]),
      `UI is at http://localhost:${PORT}.`,
    ].join('\n'),
  },
)

// ─── Channel notification helper ─────────────────────────────────────────────

function deliver(content: string, meta: Record<string, string> = {}): void {
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      meta: {
        chat_id: 'web',
        message_id: `u${Date.now()}`,
        user: 'web',
        ts: new Date().toISOString(),
        ...meta,
      },
    },
  })
}

// ─── Permission relay ────────────────────────────────────────────────────────

mcp.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    const { request_id, tool_name, description, input_preview } = params

    // Auto-allow if enabled
    if (config.autoAllowAll) {
      broadcast({ type: 'permission_auto_allowed', id: request_id, tool_name })
      mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id, behavior: 'allow' },
      })
      return
    }

    broadcast({
      type: 'permission_request',
      id: request_id,
      tool_name,
      description,
      input_preview,
    })

    // Optionally speak the permission request
    if (config.ttsEnabled && config.ttsOnPermission) {
      try {
        const text = `Дозвіл: ${tool_name}. ${description}`
        const audio = await synthesize(text, config.ttsVoice, config.ttsSpeed)
        broadcast({ type: 'audio', data: audio.toString('base64'), mime: 'audio/mpeg' })
      } catch (err) {
        process.stderr.write(`live-web-chat: TTS for permission failed: ${err}\n`)
      }
    }

    // In confirmation mode, activate mic
    if (config.mode === 'confirmation') {
      broadcast({ type: 'status', action: 'activate_mic', reason: 'permission' })
    }
  },
)

// ─── Tools ───────────────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to the live-web-chat UI. Pass reply_to for quote-reply, files for attachments.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          reply_to: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent message.',
      inputSchema: {
        type: 'object',
        properties: { message_id: { type: 'string' }, text: { type: 'string' } },
        required: ['message_id', 'text'],
      },
    },
    {
      name: 'speak',
      description: 'Convert text to speech and play it in the browser. Use when you want the user to hear your response as audio. By default omit voice and speed — the plugin uses the user-configured TTS Voice and Speed from Settings. Only pass voice/speed for a one-off override the user explicitly requested (e.g. "speak this in fable" or comparing voices). Note: if the user has the "Speak replies" toggle on, plain `reply` already auto-TTSs — calling `speak` on the same text would double-voice it.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to synthesize and speak aloud.' },
          voice: { type: 'string', description: 'TTS voice (nova/alloy/echo/fable/onyx/shimmer). Omit unless the user explicitly asked for a specific voice on this call — otherwise the plugin uses the user\'s configured TTS Voice from Settings.' },
          speed: { type: 'number', description: 'Speech speed 0.25–4.0. Omit unless the user explicitly asked for a specific speed — otherwise the plugin uses the user\'s configured TTS Speed.' },
        },
        required: ['text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const text = args.text as string
        const replyTo = args.reply_to as string | undefined
        const files = (args.files as string[] | undefined) ?? []
        const ids: string[] = []

        // Copy first file to outbox for serving
        mkdirSync(OUTBOX_DIR, { recursive: true })
        let file: { url: string; name: string } | undefined
        if (files[0]) {
          const f = files[0]
          const st = statSync(f)
          if (st.size > 50 * 1024 * 1024) throw new Error(`file too large: ${f}`)
          const ext = extname(f).toLowerCase()
          const out = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
          copyFileSync(f, join(OUTBOX_DIR, out))
          file = { url: `/files/${out}`, name: basename(f) }
        }

        const id = nextId()
        broadcast({ type: 'msg', id, from: 'assistant', text, ts: Date.now(), replyTo, file })
        ids.push(id)

        // In on_completion mode, activate mic after reply
        if (config.mode === 'on_completion') {
          broadcast({ type: 'status', action: 'activate_mic', reason: 'completion' })
        }

        return { content: [{ type: 'text', text: `sent (${ids.join(', ')})` }] }
      }

      case 'edit_message': {
        broadcast({ type: 'edit', id: args.message_id as string, text: args.text as string })
        return { content: [{ type: 'text', text: 'ok' }] }
      }

      case 'speak': {
        const text = args.text as string
        const voice = (args.voice as string | undefined) ?? config.ttsVoice
        const speed = (args.speed as number | undefined) ?? config.ttsSpeed

        // Show text in UI
        const id = nextId()
        broadcast({ type: 'msg', id, from: 'assistant', text, ts: Date.now() })

        // Generate TTS sentence-by-sentence for low latency
        try {
          const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text]
          for (const sentence of sentences) {
            const trimmed = sentence.trim()
            if (!trimmed) continue
            const audio = await synthesize(trimmed, voice, speed)
            broadcast({ type: 'audio', data: audio.toString('base64'), mime: 'audio/mpeg' })
          }
        } catch (err) {
          process.stderr.write(`live-web-chat: TTS synthesis failed: ${err}\n`)
          return { content: [{ type: 'text', text: `TTS failed: ${err}. Text was shown in UI.` }] }
        }

        // In on_completion mode, activate mic after all sentences
        if (config.mode === 'on_completion') {
          broadcast({ type: 'status', action: 'activate_mic', reason: 'completion' })
        }

        return { content: [{ type: 'text', text: `sent (${id})` }] }
      }

      default:
        return { content: [{ type: 'text', text: `unknown: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `${req.params.name}: ${err instanceof Error ? err.message : err}` }], isError: true }
  }
})

// ─── WebSocket message handler ───────────────────────────────────────────────

// Whisper sniffs container by magic bytes regardless of filename/Content-Type.
// Reject malformed buffers locally — saves an API round-trip and gives a
// clearer error than the upstream "Invalid file format".
function detectAudioFormat(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'webm'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mp3'
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'mp3'
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  if (buf.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  return null
}

async function handleWsMessage(ws: WSClient, raw: string | Buffer | ArrayBuffer): Promise<void> {
  try {
    // Binary data = audio recording
    if (raw instanceof ArrayBuffer || Buffer.isBuffer(raw)) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)

      const fmt = detectAudioFormat(buf)
      if (!fmt) {
        const head = buf.subarray(0, 16).toString('hex')
        process.stderr.write(`live-web-chat: dropping audio with unrecognized header (${buf.length}B head=${head})\n`)
        broadcast({ type: 'error', message: 'Recording was malformed (no recognizable audio header). Try again.' })
        return
      }

      broadcast({ type: 'status', action: 'transcribing' })

      let text: string
      try {
        text = await transcribe(buf, config.language, `audio/${fmt}`, config.whisperPrompt)
      } catch (err) {
        process.stderr.write(`live-web-chat: transcription failed: ${err}\n`)
        broadcast({ type: 'error', message: `Transcription failed: ${err}` })
        return
      }

      // Show transcription in UI
      const id = `u${Date.now()}`
      broadcast({ type: 'msg', id, from: 'user', text: `🎤 ${text}`, ts: Date.now() })

      deliver(text)
      return
    }

    // Text/JSON messages
    const str = typeof raw === 'string' ? raw : raw.toString()
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(str)
    } catch {
      return
    }

    switch (msg.type) {
      case 'text': {
        const text = msg.text as string
        const files = (msg.files as Array<{ name: string; data: string; mime?: string }> | undefined) ?? []

        const meta: Record<string, string> = {}

        for (const f of files) {
          try {
            const data = Buffer.from(f.data, 'base64')
            const { path, isImage } = saveFile(data, f.name)
            if (isImage) {
              meta.image_path = path
            } else {
              meta.attachment_file_id = path
            }
          } catch (err) {
            process.stderr.write(`live-web-chat: failed to save file ${f.name}: ${err}\n`)
          }
        }

        deliver(text, meta)
        break
      }

      case 'file': {
        const name = msg.name as string
        const dataB64 = msg.data as string
        const caption = (msg.caption as string | undefined) ?? ''

        try {
          const data = Buffer.from(dataB64, 'base64')
          const { path, isImage } = saveFile(data, name)

          const meta: Record<string, string> = {}
          if (isImage) {
            meta.image_path = path
          } else {
            meta.attachment_file_id = path
          }

          const text = caption || `[File: ${name}]`
          deliver(text, meta)
        } catch (err) {
          process.stderr.write(`live-web-chat: failed to save file ${name}: ${err}\n`)
          broadcast({ type: 'error', message: `Failed to save file: ${err}` })
        }
        break
      }

      case 'permission_response': {
        const id = msg.id as string
        const allow = Boolean(msg.allow)
        mcp.notification({
          method: 'notifications/claude/channel/permission',
          params: { request_id: id, behavior: allow ? 'allow' : 'deny' },
        })
        break
      }

      case 'settings': {
        const settings = msg.settings as Partial<Config>
        config = { ...config, ...settings }
        saveConfig(config)
        broadcast({ type: 'config', config })
        break
      }

      default: {
        // Legacy upstream-fakechat wire format: { id, text } without type field
        if (msg.id && msg.text) {
          deliver(String(msg.text).trim())
        }
      }
    }
  } catch (err) {
    process.stderr.write(`live-web-chat: ws handler error: ${err}\n`)
  }
}

// ─── HTTP + WebSocket server ─────────────────────────────────────────────────

const UI_PATH = join(import.meta.dir, 'ui.html')

async function ensurePortFree(port: number): Promise<void> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (!resp.ok) return
  } catch {
    return
  }

  process.stderr.write(`live-web-chat: port ${port} busy, killing stale instance\n`)
  try {
    const isWin = process.platform === 'win32'
    if (isWin) {
      const ns = Bun.spawnSync({ cmd: ['netstat', '-ano'] })
      const lines = ns.stdout.toString().split('\n')
      for (const line of lines) {
        if (line.includes('LISTENING') && line.includes(`:${port}`)) {
          const parts = line.trim().split(/\s+/)
          const pid = parts[parts.length - 1]
          if (pid && /^\d+$/.test(pid) && pid !== String(process.pid)) {
            Bun.spawnSync({ cmd: ['taskkill', '/PID', pid, '/F'] })
            process.stderr.write(`live-web-chat: killed stale PID ${pid}\n`)
          }
        }
      }
    } else {
      const lsof = Bun.spawnSync({ cmd: ['lsof', '-ti', `tcp:${port}`] })
      const pids = lsof.stdout.toString().trim().split('\n').filter(Boolean)
      for (const pid of pids) {
        if (String(process.pid) !== pid) {
          Bun.spawnSync({ cmd: ['kill', '-9', pid] })
          process.stderr.write(`live-web-chat: killed stale PID ${pid}\n`)
        }
      }
    }
    await new Promise(r => setTimeout(r, 1000))
  } catch (err) {
    process.stderr.write(`live-web-chat: failed to free port: ${err}\n`)
  }
}
await ensurePortFree(PORT)

try {
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',

    fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === '/ws') {
        if (server.upgrade(req)) return undefined as unknown as Response
        return new Response('upgrade failed', { status: 400 })
      }

      if (url.pathname.startsWith('/files/')) {
        const f = decodeURIComponent(url.pathname.slice(7))
        if (f.includes('..')) return new Response('bad', { status: 400 })

        const outPath = join(OUTBOX_DIR, f)
        const inboxPath = getFilePath(f)
        let filePath: string | null = null
        try {
          statSync(outPath)
          filePath = outPath
        } catch {
          filePath = inboxPath
        }

        if (!filePath) return new Response('404', { status: 404 })
        try {
          return new Response(readFileSync(filePath), {
            headers: { 'content-type': mime(extname(f).toLowerCase()) },
          })
        } catch {
          return new Response('404', { status: 404 })
        }
      }

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', version: '2.0.0', mode: config.mode }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        try {
          return new Response(readFileSync(UI_PATH), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        } catch {
          return new Response('UI not found — ui.html missing', { status: 404 })
        }
      }

      return new Response('404', { status: 404 })
    },

    websocket: {
      open(ws) {
        clients.add(ws)
        ws.send(JSON.stringify({ type: 'config', config }))
      },
      close(ws) {
        clients.delete(ws)
      },
      async message(ws, raw) {
        await handleWsMessage(ws, raw as string | Buffer | ArrayBuffer)
      },
    },
  })
  process.stderr.write(`live-web-chat: http://localhost:${PORT}\n`)
} catch (err) {
  process.stderr.write(`live-web-chat: HTTP server failed (port ${PORT}): ${err}\n`)
  process.stderr.write(`live-web-chat: continuing MCP-only mode (no Web UI)\n`)
}

await mcp.connect(new StdioServerTransport())
