import { readFileSync } from 'fs'
import { join } from 'path'

const ENV_FILE = join(import.meta.dir, '.env')
let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^(\w+)=(.*)$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  } catch {}
}
