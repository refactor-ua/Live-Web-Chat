/**
 * Чи завантажено цей MCP-сервер як канал (`--channels` /
 * `--dangerously-load-development-channels`) у поточній сесії Claude Code.
 *
 * Плагін може бути увімкнений глобально (enabledPlugins), тоді його сервер
 * стартує в КОЖНІЙ сесії. Порт веб-чату має брати лише сесія-канал, інакше
 * звичайна сесія вбиває чат живого каналу.
 *
 * Сигнал — командний рядок найближчого предка-процесу claude. Клієнт не
 * повідомляє серверу про режим каналу: initialize (capabilities, clientInfo)
 * однаковий у канальній і звичайній сесії (перевірено на 2.1.312), окремих
 * повідомлень після initialize теж немає.
 *
 * Перевизначення: LIVE_WEB_CHAT_MODE=channel | off | auto (за замовчуванням auto).
 */

export const PLUGIN_NAME = 'live-web-chat'
const CHANNEL_FLAGS = ['--channels', '--dangerously-load-development-channels']

export type ProcInfo = { pid: number; ppid: number; name: string; cmd: string }

/** Розбиває командний рядок на аргументи з урахуванням подвійних лапок. */
export function splitArgs(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  let has = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (ch === '\\' && cmd[i + 1] === '"') {
      cur += '"'
      has = true
      i++
    } else if (ch === '"') {
      inQ = !inQ
      has = true
    } else if (!inQ && /\s/.test(ch)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/** Чи це запис нашого каналу: plugin:live-web-chat@<маркетплейс> або server:live-web-chat. */
export function isOwnChannelEntry(entry: string, name = PLUGIN_NAME): boolean {
  const e = entry.trim()
  return e.startsWith(`plugin:${name}@`) || e === `plugin:${name}` || e === `server:${name}`
}

/** Чи містять аргументи claude наш канал серед значень --channels / --dangerously-load-development-channels. */
export function argsRequestChannel(args: string[], name = PLUGIN_NAME): boolean {
  let inList = false
  for (const a of args) {
    const eq = a.indexOf('=')
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a
    if (CHANNEL_FLAGS.includes(flag)) {
      inList = true
      if (eq > 0 && a.startsWith('--')) {
        if (a.slice(eq + 1).split(',').some(v => isOwnChannelEntry(v, name))) return true
      }
      continue
    }
    if (a.startsWith('-')) {
      inList = false
      continue
    }
    if (inList && a.split(',').some(v => isOwnChannelEntry(v, name))) return true
  }
  return false
}

/** Чи схожий процес на CLI Claude Code (нативний claude[.exe] або node …/claude-code/cli.js). */
export function isClaudeProcess(p: ProcInfo): boolean {
  const base = (s: string) => s.replace(/^.*[\\/]/, '').toLowerCase()
  const name = base(p.name)
  if (name === 'claude' || name === 'claude.exe') return true
  const args = splitArgs(p.cmd)
  if (args.length && ['claude', 'claude.exe'].includes(base(args[0]))) return true
  return /@anthropic-ai[\\/]claude-code[\\/]/.test(p.cmd)
}

/** Найближчий предок-процес claude, починаючи з батька `pid`. */
export function findClaudeAncestor(procs: Map<number, ProcInfo>, pid: number, maxDepth = 10): ProcInfo | null {
  let cur = procs.get(pid)
  for (let i = 0; cur && i < maxDepth; i++) {
    const parent = procs.get(cur.ppid)
    if (!parent || parent.pid === cur.pid) return null
    if (isClaudeProcess(parent)) return parent
    cur = parent
  }
  return null
}

export type Decision = { channel: boolean; reason: string }

/** Чисте рішення за таблицею процесів і значенням LIVE_WEB_CHAT_MODE. */
export function decideChannelMode(
  procs: Map<number, ProcInfo> | null,
  pid: number,
  override: string | undefined,
): Decision {
  const o = (override ?? 'auto').trim().toLowerCase()
  if (o === 'channel' || o === 'on') return { channel: true, reason: 'LIVE_WEB_CHAT_MODE=channel' }
  if (o === 'off' || o === 'tools') return { channel: false, reason: `LIVE_WEB_CHAT_MODE=${o}` }
  if (!procs) return { channel: false, reason: 'process table unavailable' }
  const claude = findClaudeAncestor(procs, pid)
  if (!claude) return { channel: false, reason: 'no claude ancestor process found' }
  return argsRequestChannel(splitArgs(claude.cmd))
    ? { channel: true, reason: `claude PID ${claude.pid} was started with --channels for ${PLUGIN_NAME}` }
    : { channel: false, reason: `claude PID ${claude.pid} was started without --channels for ${PLUGIN_NAME}` }
}

/** Знімок таблиці процесів (Windows — CIM, інші ОС — ps). */
export function readProcessTable(): Map<number, ProcInfo> | null {
  try {
    const map = new Map<number, ProcInfo>()
    if (process.platform === 'win32') {
      const r = Bun.spawnSync({
        cmd: [
          'powershell', '-NoProfile', '-NonInteractive', '-Command',
          '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
        ],
        stdout: 'pipe',
        stderr: 'ignore',
      })
      const rows = JSON.parse(r.stdout.toString() || '[]')
      for (const x of Array.isArray(rows) ? rows : [rows]) {
        map.set(x.ProcessId, { pid: x.ProcessId, ppid: x.ParentProcessId, name: x.Name ?? '', cmd: x.CommandLine ?? '' })
      }
    } else {
      const r = Bun.spawnSync({ cmd: ['ps', '-A', '-o', 'pid=,ppid=,args='], stdout: 'pipe', stderr: 'ignore' })
      for (const line of r.stdout.toString().split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
        if (m) map.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: splitArgs(m[3])[0] ?? '', cmd: m[3] })
      }
    }
    return map.size ? map : null
  } catch {
    return null
  }
}

export function detectChannelMode(): Decision {
  const o = (process.env.LIVE_WEB_CHAT_MODE ?? 'auto').trim().toLowerCase()
  const needProcs = !['channel', 'on', 'off', 'tools'].includes(o)
  return decideChannelMode(needProcs ? readProcessTable() : null, process.pid, process.env.LIVE_WEB_CHAT_MODE)
}
