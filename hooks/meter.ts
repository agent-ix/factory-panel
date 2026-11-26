import type { EngineInterface } from 'claude-code'

// What the mod reads, counted in memory: for each source its reads, the processes it started, the HTTP
// calls it made, the bytes they brought back, failures, slow answers, the reads that were skipped and
// why, and what the 30 minute gate did. A ring of the last 64 durations gives p50, p95 and the longest.
// Nothing here starts a read or changes when one is made.

export type SkipReason = 'not-shown' | 'off-view' | 'no-endpoint'
export type GateOutcome = 'hit' | 'fetched' | 'claimed-elsewhere' | 'backoff' | 'held'

const RING = 64

export type Row = {
  reads: number
  spawns: number
  http: number
  bytes: number
  fail: number
  slow: number
  skips: Record<SkipReason, number>
  gate: Record<GateOutcome, number>
  /** Linear requests and query complexity ix-board counted around the gated reads that ran (FACTORY_PANEL_METER only). */
  linearRequests: number
  linearComplexity: number
  ring: number[]
}

const blank = (): Row => ({
  reads: 0,
  spawns: 0,
  http: 0,
  bytes: 0,
  fail: 0,
  slow: 0,
  skips: { 'not-shown': 0, 'off-view': 0, 'no-endpoint': 0 },
  gate: { hit: 0, fetched: 0, 'claimed-elsewhere': 0, backoff: 0, held: 0 },
  linearRequests: 0,
  linearComplexity: 0,
  ring: [],
})

const rows = new Map<string, Row>()
/** The durations of the last reads of each source alone, without its processes and calls: what a slow read is judged by. */
const readRings = new Map<string, number[]>()

const rowOf = (name: string): Row => {
  let r = rows.get(name)
  if (r === undefined) {
    r = blank()
    rows.set(name, r)
  }
  return r
}

const push = (r: Row, ms: number): void => {
  r.ring.push(ms)
  if (r.ring.length > RING) r.ring.shift()
}

/** The named share of the last durations, in ms; null with none. */
export const percentile = (ring: readonly number[], p: number): number | null => {
  if (ring.length === 0) return null
  const sorted = [...ring].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null
}

export const meter = {
  /** A source's read ended (its duration is the clock's, from schedule.ts). */
  read: (source: string, ms: number, ok: boolean, wasSlow: boolean): void => {
    const r = rowOf(source)
    r.reads++
    if (!ok) r.fail++
    if (wasSlow) r.slow++
    push(r, ms)
    const own = readRings.get(source) ?? []
    own.push(ms)
    if (own.length > RING) own.shift()
    readRings.set(source, own)
  },
  /** A host process was run. */
  spawn: (name: string, ms: number): void => {
    const r = rowOf(name)
    r.spawns++
    push(r, ms)
  },
  /** An HTTP call answered or failed. */
  http: (name: string, ms: number, bytes: number, ok: boolean): void => {
    const r = rowOf(name)
    r.http++
    r.bytes += bytes
    if (!ok) r.fail++
    push(r, ms)
  },
  skip: (source: string, reason: SkipReason): void => void rowOf(source).skips[reason]++,
  gate: (source: string, outcome: GateOutcome): void => void rowOf(source).gate[outcome]++,
  linear: (source: string, requests: number, complexity: number): void => {
    const r = rowOf(source)
    r.linearRequests += requests
    r.linearComplexity += complexity
  },
}

/** Everything counted so far, by name. */
export const snapshot = (): Record<string, Row & { p50: number | null; p95: number | null; max: number | null }> =>
  Object.fromEntries(
    [...rows].map(([name, r]) => [name, { ...r, ring: [...r.ring], p50: percentile(r.ring, 50), p95: percentile(r.ring, 95), max: r.ring.length === 0 ? null : Math.max(...r.ring) }]),
  )

/** The median duration of the last reads of a source, in ms; null before its first. */
export const readMedian = (source: string): number | null => percentile(readRings.get(source) ?? [], 50)

export const resetMeter = (): void => {
  rows.clear()
  readRings.clear()
}

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0)

/** The table `/factory show fetch` prints. */
export function fetchTable(): string {
  const snap = Object.entries(snapshot()).sort(([a], [b]) => a.localeCompare(b))
  if (snap.length === 0) return 'Fetch: nothing read yet.'
  const ms = (v: number | null): string => (v === null ? '-' : String(Math.round(v)))
  const head = ['source', 'reads', 'spawns', 'http', 'bytes', 'p50/p95 ms', 'fail', 'slow', 'skips', 'gate']
  const body = snap.map(([name, r]) => [
    name,
    String(r.reads),
    String(r.spawns),
    String(r.http),
    String(r.bytes),
    `${ms(r.p50)}/${ms(r.p95)}`,
    String(r.fail),
    String(r.slow),
    sum(r.skips) === 0 ? '-' : `${r.skips['not-shown']} not-shown, ${r.skips['off-view']} off-view, ${r.skips['no-endpoint']} no-endpoint`,
    sum(r.gate) === 0 ? '-' : (Object.entries(r.gate) as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', '),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(row => row[i]!.length)))
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd()
  const total = snap.reduce((t, [, r]) => ({ spawns: t.spawns + r.spawns, http: t.http + r.http, bytes: t.bytes + r.bytes }), { spawns: 0, http: 0, bytes: 0 })
  return ['Fetch since the session started:', line(head), ...body.map(line), `total: ${total.spawns} spawns, ${total.http} http, ${total.bytes} bytes`].join('\n')
}

// ---------------------------------------------------------------- the opt-in file and Linear sampling

let metering: boolean | undefined

/** True where `FACTORY_PANEL_METER` is set to anything but empty or 0; asked once. */
export async function isMetering($: EngineInterface): Promise<boolean> {
  if (metering !== undefined) return metering
  try {
    const v = await $.env.get('FACTORY_PANEL_METER')
    metering = v !== undefined && v !== '' && v !== '0'
  } catch {
    metering = false
  }
  return metering
}

export const FILE_EVERY_MS = 5 * 60 * 1000
let lastFileAt: number | null = null

/** Writes the meter file when metering is on and the last write is 5 minutes old; never throws. */
export async function maybeWriteFile($: EngineInterface, path: (session: string) => Promise<string>, write: (path: string, text: string) => Promise<void>): Promise<void> {
  try {
    if (!(await isMetering($))) return
    const now = await $.clock.now()
    if (lastFileAt !== null && now - lastFileAt < FILE_EVERY_MS) return
    lastFileAt = now
    await write(await path(await $.session.id()), `${JSON.stringify({ at: now, rows: snapshot() }, null, 2)}\n`)
  } catch {
    // The meter is a side channel: its failures are not the mod's.
  }
}

/** ix-board's spend in the current Linear window, from `ix-board --json cache status` (`quota.requests_used`, `quota.complexity_used`). */
export function linearCounters(stdout: string): { requests: number; complexity: number } | null {
  try {
    const quota = (JSON.parse(stdout) as { quota?: { requests_used?: unknown; complexity_used?: unknown } }).quota
    return typeof quota?.requests_used === 'number' && typeof quota.complexity_used === 'number' ? { requests: quota.requests_used, complexity: quota.complexity_used } : null
  } catch {
    return null
  }
}

export const resetMeterFile = (): void => {
  metering = undefined
  lastFileAt = null
}
