import type { EngineInterface } from 'claude-code'

import { factoryDir } from './selection'

// The last good progress of each selector: one file, `~/.ix/factory-panel/progress.json`,
// shared by every session on the machine. A refresh of a selector that fails shows its record,
// marked old, beside a warning. The reserved top-level key `initiatives` holds the membership of
// each initiative the mod resolved: the project ids and names it was made of.

export type ProgressRecord = {
  at_ms: number
  seen_ms: number
  done: number
  total: number
  inProgress: number
  ready: number
  /** Entries of the blocker layers not classified Completed; absent when the answer carried none. */
  blocked?: number
  /** Stage counts of the open work, by state, from `open_by_state`. */
  stages?: Record<string, number>
  /** True for a record that holds only the name of a project whose counts were never read: it draws nothing. */
  unknown?: boolean
  /** Aliases of a project record: its id, identifier and name. */
  id?: string
  identifier?: string
  name?: string
}
export type Records = Record<string, ProgressRecord>

export type Member = { id: string; name: string }
export type Membership = { at_ms: number; seen_ms: number; projects: Member[]; /** the initiative's name, where it was learned */ name?: string }
export type Initiatives = Record<string, Membership>
export type ProgressFile = { records: Records; initiatives: Initiatives }

/** A record older than this is labelled stale; exactly this old it is old and not stale. */
export const STALE_MS = 30 * 60 * 1000
/** A record not seen in a refresh for this long is deleted at the next write. */
export const PRUNE_MS = 24 * 60 * 60 * 1000
/** A record whose success is older than this is not used to draw a project. */
export const USABLE_MS = 24 * 60 * 60 * 1000

const FILE = 'progress.json'
export const INITIATIVES_KEY = 'initiatives'

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const str = (v: unknown): v is string => typeof v === 'string'

const isRecord = (v: unknown): v is ProgressRecord => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return ['at_ms', 'seen_ms'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number)) && ['done', 'total', 'inProgress', 'ready'].every(k => count(o[k]))
}

const isMembership = (v: unknown): v is Membership => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.at_ms === 'number' && Number.isFinite(o.at_ms) && typeof o.seen_ms === 'number' && Number.isFinite(o.seen_ms) && Array.isArray(o.projects) && o.projects.every(p => typeof p === 'object' && p !== null && str((p as Member).id) && str((p as Member).name))
  )
}

/** The records and the initiatives of the file's text: none when it is not a JSON object, and a malformed entry is left out alone. */
export function parseFile(text: string): ProgressFile {
  const empty: ProgressFile = { records: {}, initiatives: {} }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return empty
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return empty
  const file: ProgressFile = { records: {}, initiatives: {} }
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (key === INITIATIVES_KEY) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value))
        for (const [k, m] of Object.entries(value as Record<string, unknown>)) if (isMembership(m)) file.initiatives[k] = { at_ms: m.at_ms, seen_ms: m.seen_ms, projects: m.projects.map(p => ({ id: p.id, name: p.name })), ...(str((m as Membership).name) ? { name: (m as Membership).name } : {}) }
    } else if (isRecord(value)) file.records[key] = { ...value }
  }
  return file
}

/** The progress records in the file's text. */
export const parseRecords = (text: string): Records => parseFile(text).records

/** The key of a selector: `kind:ref`, and `milestone:ref:project` for a milestone. */
export const keyOf = (kind: string, ref: string, project?: string): string => (kind === 'milestone' ? `milestone:${ref}:${project ?? ''}` : `${kind}:${ref}`)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string): boolean => UUID.test(s)

/** The key of a project's record: its id. */
export const projectKey = (id: string): string => `project:${id}`

/**
 * Whether a record is one the mod draws from: a ticket, a milestone, or a project keyed by its id.
 * Records keyed by a project name, and `focus:` and `initiative:` records, are kept until pruned and never used.
 */
export const usableKey = (key: string): boolean => key.startsWith('project:') ? isUuid(key.slice('project:'.length)) : key.startsWith('ticket:') || key.startsWith('milestone:')

/** How old a record is; a time in the future is no age at all. */
export const ageOf = (record: { at_ms: number }, now: number): number => Math.max(0, now - record.at_ms)

export const isStale = (record: ProgressRecord, now: number): boolean => ageOf(record, now) > STALE_MS
/** Whether a record may still draw a project: its success is at most 24 hours old. */
export const isUsable = (record: ProgressRecord, now: number): boolean => ageOf(record, now) <= USABLE_MS

/**
 * The record of a project selector: the key `project:<ref>`, else a record whose identifier, id or name is the ref.
 * Returns the key with the record, or undefined when none is usable.
 */
export function findRecord(records: Records, ref: string, now: number): { key: string; record: ProgressRecord } | undefined {
  const direct = records[projectKey(ref)]
  if (direct !== undefined && usableKey(projectKey(ref)) && isUsable(direct, now) && direct.unknown !== true) return { key: projectKey(ref), record: direct }
  for (const [key, record] of Object.entries(records)) {
    if (!usableKey(key) || !key.startsWith('project:') || !isUsable(record, now) || record.unknown === true) continue
    if (record.id === ref || record.identifier === ref || record.name === ref) return { key, record }
  }
  return undefined
}

/** The name and identifier ever resolved for a project ref: from any record (even a name-only one, of any age), else the cached membership of an initiative. */
export function nameFor(file: ProgressFile, ref: string): { id: string | null; identifier: string | null; name: string } | undefined {
  for (const [key, r] of Object.entries(file.records)) {
    if (!key.startsWith('project:') || !usableKey(key) || r.name === undefined) continue
    if (key === projectKey(ref) || r.id === ref || r.identifier === ref || r.name === ref) return { id: key.slice('project:'.length), identifier: r.identifier ?? null, name: r.name }
  }
  for (const m of Object.values(file.initiatives)) {
    const hit = m.projects.find(p => p.id === ref)
    if (hit !== undefined) return { id: hit.id, identifier: null, name: hit.name }
  }
  return undefined
}

export async function readFile($: EngineInterface): Promise<ProgressFile> {
  try {
    return parseFile(await $.fs.read(`${await factoryDir($)}/${FILE}`))
  } catch {
    return { records: {}, initiatives: {} }
  }
}

export async function readRecords($: EngineInterface): Promise<Records> {
  return (await readFile($)).records
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

/** Merges initiative membership by key, keeping the newer seen_ms and the projects of the newer at_ms. */
export function mergeInitiatives(disk: Initiatives, mine: Initiatives): Initiatives {
  const merged: Initiatives = {}
  for (const key of new Set([...Object.keys(disk), ...Object.keys(mine)])) {
    const a = disk[key]
    const b = mine[key]
    if (a === undefined || b === undefined) {
      merged[key] = structuredClone((a ?? b)!)
      continue
    }
    const newer = b.at_ms >= a.at_ms ? b : a
    merged[key] = { ...structuredClone(newer), seen_ms: Math.max(a.seen_ms, b.seen_ms) }
  }
  return merged
}

/** Deletes the records not seen for 24 hours. */
export function prune(records: Records, now: number): Records {
  return Object.fromEntries(Object.entries(records).filter(([, r]) => now - r.seen_ms <= PRUNE_MS))
}

/** Deletes the initiative entries not seen for 24 hours. */
export function pruneInitiatives(initiatives: Initiatives, now: number): Initiatives {
  return Object.fromEntries(Object.entries(initiatives).filter(([, m]) => now - m.seen_ms <= PRUNE_MS))
}

/**
 * Re-reads the file, merges this refresh's records and memberships into it, prunes, and writes it by
 * writing a temporary file and renaming it, so a reader sees the old file or the new one. Returns the
 * merged file; a failed write leaves the previous file and still returns what was merged.
 */
export async function saveFile($: EngineInterface, now: number, mine: Records, initiatives: Initiatives = {}): Promise<ProgressFile> {
  const disk = await readFile($)
  const merged: ProgressFile = { records: prune(mergeRecords(disk.records, mine), now), initiatives: pruneInitiatives(mergeInitiatives(disk.initiatives, initiatives), now) }
  try {
    const path = `${await factoryDir($)}/${FILE}`
    const temp = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`
    const body: Record<string, unknown> = { ...merged.records }
    if (Object.keys(merged.initiatives).length > 0) body[INITIATIVES_KEY] = merged.initiatives
    await $.fs.write(temp, `${JSON.stringify(body, null, 2)}\n`)
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

export async function saveRecords($: EngineInterface, now: number, mine: Records, initiatives: Initiatives = {}): Promise<Records> {
  return (await saveFile($, now, mine, initiatives)).records
}
