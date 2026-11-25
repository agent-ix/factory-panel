import type { EngineInterface } from 'claude-code'

import { factoryDir } from './selection'

// The last good progress of each selector: one file, `~/.ix/factory-panel/progress.json`,
// shared by every session on the machine. A refresh of a selector that fails shows its record,
// marked old, beside the error.

export type ProgressRecord = { at_ms: number; seen_ms: number; done: number; total: number; inProgress: number; ready: number }
export type Records = Record<string, ProgressRecord>

/** A record older than this is labelled stale; exactly this old it is old and not stale. */
export const STALE_MS = 30 * 60 * 1000
/** A record not seen in a refresh for this long is deleted at the next write. */
export const PRUNE_MS = 24 * 60 * 60 * 1000

const FILE = 'progress.json'

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

const isRecord = (v: unknown): v is ProgressRecord => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return ['at_ms', 'seen_ms'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number)) && ['done', 'total', 'inProgress', 'ready'].every(k => count(o[k]))
}

/** The records in the file's text: none when it is not a JSON object, and a malformed entry is left out alone. */
export function parseRecords(text: string): Records {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return {}
  const records: Records = {}
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) if (isRecord(value)) records[key] = { ...value }
  return records
}

/** The key of a selector: `kind:ref`, and `milestone:ref:project` for a milestone. */
export const keyOf = (kind: string, ref: string, project?: string): string => (kind === 'milestone' ? `milestone:${ref}:${project ?? ''}` : `${kind}:${ref}`)

/** How old a record is; a time in the future is no age at all. */
export const ageOf = (record: ProgressRecord, now: number): number => Math.max(0, now - record.at_ms)

export const isStale = (record: ProgressRecord, now: number): boolean => ageOf(record, now) > STALE_MS

export async function readRecords($: EngineInterface): Promise<Records> {
  try {
    return parseRecords(await $.fs.read(`${await factoryDir($)}/${FILE}`))
  } catch {
    return {}
  }
}

/** Keeps the newer at_ms with its numbers, and the newer seen_ms, each independently. */
export function mergeRecords(disk: Records, mine: Records): Records {
  const merged: Records = {}
  for (const key of new Set([...Object.keys(disk), ...Object.keys(mine)])) {
    const a = disk[key]
    const b = mine[key]
    if (a === undefined || b === undefined) {
      merged[key] = { ...(a ?? b)! }
      continue
    }
    const newer = b.at_ms >= a.at_ms ? b : a
    merged[key] = { ...newer, seen_ms: Math.max(a.seen_ms, b.seen_ms) }
  }
  return merged
}

/** Deletes the records not seen for 24 hours. */
export function prune(records: Records, now: number): Records {
  return Object.fromEntries(Object.entries(records).filter(([, r]) => now - r.seen_ms <= PRUNE_MS))
}

/**
 * Re-reads the file, merges this refresh's records into it by selector, prunes, and writes it by
 * writing a temporary file and renaming it, so a reader sees the old file or the new one. Returns the
 * merged records; a failed write leaves the previous file and still returns what was merged.
 */
export async function saveRecords($: EngineInterface, now: number, mine: Records): Promise<Records> {
  const merged = prune(mergeRecords(await readRecords($), mine), now)
  try {
    const path = `${await factoryDir($)}/${FILE}`
    const temp = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`
    await $.fs.write(temp, `${JSON.stringify(merged, null, 2)}\n`)
    const moved = await $.process.run(['mv', '-f', temp, path], { timeoutMs: 5_000 })
    if (moved.exitCode !== 0) {
      await $.process.run(['rm', '-f', temp], { timeoutMs: 5_000 }).catch(() => undefined)
      throw new Error(moved.stderr.trim() || 'mv failed')
    }
  } catch {
    // The file is a convenience: a refresh that cannot save still shows what it read.
  }
  return merged
}
