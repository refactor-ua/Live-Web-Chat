import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import { INBOX_DIR } from './config.ts'

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

export function saveFile(data: Buffer, filename: string): { path: string; id: string; isImage: boolean } {
  const ext = extname(filename).toLowerCase() || '.bin'
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}`
  const storedName = `${id}${ext}`
  const fullPath = join(INBOX_DIR, storedName)
  writeFileSync(fullPath, data)
  return { path: fullPath, id: storedName, isImage: PHOTO_EXTS.has(ext) }
}

export function getFilePath(id: string): string | null {
  const fullPath = join(INBOX_DIR, id)
  if (!fullPath.startsWith(INBOX_DIR)) return null
  if (!existsSync(fullPath)) return null
  return fullPath
}

export function readFile(id: string): Buffer | null {
  const p = getFilePath(id)
  return p ? readFileSync(p) : null
}
