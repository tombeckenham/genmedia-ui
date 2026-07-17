import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Read + JSON.parse; returns null when the file doesn't exist. Callers
// narrow the unknown with zod.
export async function readJsonFile(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
  return JSON.parse(raw) as unknown
}

// Atomic write: temp file in the same directory, then rename. Both this app
// and the Claude agent write storyboard.json — rename keeps readers from ever
// seeing a half-written file.
export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await rename(tmp, path)
}
