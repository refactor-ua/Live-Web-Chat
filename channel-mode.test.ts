import { describe, expect, test } from 'bun:test'
import {
  argsRequestChannel,
  decideChannelMode,
  findClaudeAncestor,
  isClaudeProcess,
  splitArgs,
  type ProcInfo,
} from './channel-mode.ts'

// Командні рядки зняті з реальних сесій Claude Code 2.1.312 на Windows (28.10.2026).
const HQ_CHANNEL = 'claude  --dangerously-load-development-channels plugin:live-web-chat@refactor-ua'
const TEST_CHANNEL =
  '"C:\\Users\\alexa\\.local\\bin\\claude.exe" --debug-file C:\\tmp\\debug-A.txt --channels plugin:live-web-chat@refactor-ua'
const PLAIN =
  '"C:\\Users\\alexa\\.local\\bin\\claude.exe" -n launcher --model opus --permission-mode auto --settings E:\\x\\launcher.settings.json "Крок 0: --channels plugin:live-web-chat@refactor-ua згадано лише в промпті"'

function table(claudeCmd: string): Map<number, ProcInfo> {
  const rows: ProcInfo[] = [
    { pid: 100, ppid: 1, name: 'WindowsTerminal.exe', cmd: 'wt.exe' },
    { pid: 200, ppid: 100, name: 'claude.exe', cmd: claudeCmd },
    { pid: 300, ppid: 200, name: 'bun.exe', cmd: 'bun run --cwd E:/x --shell=bun --silent start' },
    { pid: 400, ppid: 300, name: 'bun.exe', cmd: 'C:\\Users\\alexa\\.bun\\bin\\bun.exe server.ts' },
  ]
  return new Map(rows.map(r => [r.pid, r]))
}

describe('splitArgs', () => {
  test('лапки та подвійні пробіли', () => {
    expect(splitArgs('"C:\\a b\\claude.exe"  --x "y z"')).toEqual(['C:\\a b\\claude.exe', '--x', 'y z'])
  })
})

describe('argsRequestChannel', () => {
  test('--channels з нашим плагіном', () => {
    expect(argsRequestChannel(splitArgs(TEST_CHANNEL))).toBe(true)
  })
  test('--dangerously-load-development-channels', () => {
    expect(argsRequestChannel(splitArgs(HQ_CHANNEL))).toBe(true)
  })
  test('форма --channels=a,b і кілька значень після прапорця', () => {
    expect(argsRequestChannel(['claude', '--channels=plugin:telegram@x,plugin:live-web-chat@refactor-ua'])).toBe(true)
    expect(argsRequestChannel(['claude', '--channels', 'plugin:telegram@x', 'plugin:live-web-chat@m'])).toBe(true)
    expect(argsRequestChannel(['claude', '--channels', 'server:live-web-chat'])).toBe(true)
  })
  test('чужий канал або немає прапорця', () => {
    expect(argsRequestChannel(['claude', '--channels', 'plugin:telegram@claude-plugins-official'])).toBe(false)
    expect(argsRequestChannel(['claude', '--debug'])).toBe(false)
    expect(argsRequestChannel(['claude', '--channels', 'plugin:live-web-chat-x@m'])).toBe(false)
  })
  test('значення після іншого прапорця не рахується', () => {
    expect(argsRequestChannel(['claude', '--channels', 'plugin:telegram@x', '--model', 'plugin:live-web-chat@m'])).toBe(false)
  })
  test('згадка в тексті промпту — не прапорець', () => {
    expect(argsRequestChannel(splitArgs(PLAIN))).toBe(false)
  })
})

describe('isClaudeProcess / findClaudeAncestor', () => {
  test('нативний і npm-варіанти', () => {
    expect(isClaudeProcess({ pid: 1, ppid: 0, name: 'claude.exe', cmd: '' })).toBe(true)
    expect(isClaudeProcess({ pid: 1, ppid: 0, name: 'node', cmd: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --channels x' })).toBe(true)
    expect(isClaudeProcess({ pid: 1, ppid: 0, name: 'bun.exe', cmd: 'bun server.ts' })).toBe(false)
  })
  test('знаходить найближчого предка claude', () => {
    expect(findClaudeAncestor(table(PLAIN), 400)?.pid).toBe(200)
  })
  test('без предка claude — null, цикл не зависає', () => {
    const m = new Map<number, ProcInfo>([
      [1, { pid: 1, ppid: 2, name: 'a', cmd: 'a' }],
      [2, { pid: 2, ppid: 1, name: 'b', cmd: 'b' }],
    ])
    expect(findClaudeAncestor(m, 1)).toBeNull()
  })
})

describe('decideChannelMode', () => {
  test('сесія-канал', () => {
    expect(decideChannelMode(table(TEST_CHANNEL), 400, undefined).channel).toBe(true)
    expect(decideChannelMode(table(HQ_CHANNEL), 400, 'auto').channel).toBe(true)
  })
  test('звичайна сесія — не канал', () => {
    expect(decideChannelMode(table(PLAIN), 400, undefined).channel).toBe(false)
  })
  test('немає таблиці процесів або предка — не канал (безпечно)', () => {
    expect(decideChannelMode(null, 400, undefined).channel).toBe(false)
    expect(decideChannelMode(table(PLAIN), 999, undefined).channel).toBe(false)
  })
  test('LIVE_WEB_CHAT_MODE перевизначає', () => {
    expect(decideChannelMode(table(PLAIN), 400, 'channel').channel).toBe(true)
    expect(decideChannelMode(table(TEST_CHANNEL), 400, 'off').channel).toBe(false)
  })
})
