import type { EngineInterface } from 'claude-code'

import { isMetering, linearCounters, meter } from './meter'
import { errorText, spawn, writeWhole } from './shared'

// Every ix-board read refreshes ix-board's cache of the whole Linear workspace once it is five
// minutes old, and this mod loads in every session. So the panes share one gate, in a file every
// session on the machine reads: each read runs at most once per interval across all of them, its
// result is kept for the others, and when Linear says "rate limited; retry in N s" nobody calls
// ix-board again until then.
//
// The file is written whole (a temporary file, renamed), and a write drops what nobody uses any more.

/** Every gated read of Linear runs at most once in this long across all sessions. */
export const BOARD_INTERVAL_MS = 30 * 60 * 1000
/** A fetch another session claimed is trusted to finish within this long. */
const CLAIM_MS = 4 * 60 * 1000
/** A manual refresh still waits this long after the last read. */
const MANUAL_MIN_MS = 60 * 1000

/** An outcome a source error cut short is held this long, not the whole interval, and not asked again meanwhile. */
export const UNKEPT_TTL_MS = 5 * 60 * 1000
/** The longest an outcome that fails time after time in a way that proves nothing is held. */
export const REPEAT_HOLD_MAX_MS = 30 * 60 * 1000
/** An entry nobody has fetched or claimed for this long is dropped at the next write. */
export const ENTRY_UNUSED_MS = 24 * 60 * 60 * 1000
/**
 * The keys 0.7.0 gated progress under. Nothing reads them now; one is dropped once it has not been written for this
 * long, so a session still running 0.7.0 keeps the gate it is using.
 */
const OLD_KEY = 'focus:'
export const OLD_KEY_UNUSED_MS = 60 * 60 * 1000

type Entry = {
  at: number | null
  claimAt: number | null
  data: unknown
  /** an outcome a source error cut short, held for UNKEPT_TTL_MS */
  unkept?: boolean
  /** the error of a read that failed outright, shown while it is held */
  error?: string
  /** how many reads in a row, since the last that was kept, ended in an inferred source error */
  streak?: number
  /** how long such an outcome is held, and when it was read */
  holdMs?: number
  triedAt?: number
}
type GateFile = { backoffUntil: number | null; entries: Record<string, Entry> }

export type Gated<T> = {
  data: T | null
  /** ms since the epoch of the read that produced `data` */
  at: number | null
  /** True when `data` is the outcome of an earlier refresh that a source error cut short, held for a few minutes. */
  held?: boolean
  /** How long that outcome is held where it is an inferred source error, whose hold doubles each time. */
  holdMs?: number
  /** set while Linear's rate limit holds */
  backoffUntil: number | null
  error: string | null
}

/** The cache file, and the one an older version wrote, read once when the new one does not exist. */
const GATE_FILE = 'linear-gate.json'
let gatePath: string | null = null
let oldPath: string | null = null
let oldCache: GateFile | undefined
/** Reads under way in this process, by key: a second asker shares the first's. */
const inFlight = new Map<string, Promise<Gated<unknown>>>()

async function pathOf($: EngineInterface): Promise<string> {
  if (gatePath) return gatePath
  const ran = await spawn($, ['printenv', 'HOME'], 5_000)
  const home = ran.stdout.trim()
  oldPath = `${home}/.cache/factory-panel/${GATE_FILE}`
  gatePath = `${home}/.ix/factory-panel/${GATE_FILE}`
  return gatePath
}

async function load($: EngineInterface): Promise<GateFile> {
  const parse = (text: string): GateFile => {
    const parsed = JSON.parse(text) as Partial<GateFile>
    return { backoffUntil: parsed.backoffUntil ?? null, entries: parsed.entries ?? {} }
  }
  try {
    return parse(await $.fs.read(await pathOf($)))
  } catch {
    // With no new file the old cache is the initial one: read once, kept, and never written.
    if (oldCache === undefined) {
      try {
        oldCache = parse(await $.fs.read(oldPath ?? ''))
      } catch {
        oldCache = { backoffUntil: null, entries: {} }
      }
    }
    return structuredClone(oldCache)
  }
}

/**
 * The gate file is read, changed and written by every read in this process; two at once would lose each
 * other's claim. So its claims and writes run one after the other.
 */
let lock: Promise<unknown> = Promise.resolve()
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = lock.then(run, run)
  lock = next.catch(() => undefined)
  return next
}

/** The entries still in use: fetched or claimed within a day, or for a 0.7.0 key within the hour. */
function pruned(entries: Record<string, Entry>, now: number): Record<string, Entry> {
  const used = (e: Entry): number => Math.max(e.at ?? -Infinity, e.claimAt ?? -Infinity)
  return Object.fromEntries(Object.entries(entries).filter(([key, e]) => now - used(e) <= (key.startsWith(OLD_KEY) ? OLD_KEY_UNUSED_MS : ENTRY_UNUSED_MS)))
}

/** Re-reads the file before writing, so another session's entries in between survive, and drops the unused ones. */
async function save($: EngineInterface, change: (g: GateFile) => void): Promise<void> {
  const g = await load($)
  change(g)
  g.entries = pruned(g.entries, await $.clock.now())
  await writeWhole($, await pathOf($), JSON.stringify(g))
}

/** Linear's own wait, from ix-board's "Linear rate limited; retry in 3600.005s". */
export function retryAfterMs(message: string): number | null {
  const m = /rate limit\w*;?\s*retry in ([\d.]+)\s*s/i.exec(message)
  return m ? Math.ceil(Number(m[1]) * 1000) : null
}

export type GateOptions<T> = {
  manual?: boolean
  /** false holds a result for UNKEPT_TTL_MS only, not the whole interval */
  keep?: (data: T) => boolean
  /** true for a result not kept whose hold doubles each time in a row, up to REPEAT_HOLD_MAX_MS */
  repeats?: (data: T) => boolean
  /** true for a held result that lacks what this build draws, as an older build wrote it: it is read again as though due */
  outdated?: (data: T) => boolean
  /**
   * How long a result is shared before it is read again; BOARD_INTERVAL_MS unless given. A read that makes no Linear
   * call (`ix-board agents` reads herdr) is given its own, shorter one, and `linear: false`.
   */
  intervalMs?: number
  /** false for a read that makes no Linear call: Linear's rate limit neither holds it nor is set by it */
  linear?: boolean
}

/**
 * Runs `fetch` for `key` only when no session has in the last `intervalMs`, none is fetching it now,
 * and Linear is not rate limiting; otherwise answers what the last read left.
 */
export function gatedBoard<T>(
  $: EngineInterface,
  key: string,
  fetch: () => Promise<T>,
  opts: GateOptions<T> = {},
): Promise<Gated<T>> {
  const running = inFlight.get(key)
  if (running) return running as Promise<Gated<T>>
  // A failure of the gate itself (the home path, the gate file) is an answer, never a rejection.
  const started = gate($, key, fetch, opts)
    .catch((error): Gated<T> => ({ data: null, at: null, backoffUntil: null, error: errorText(error) }))
    .finally(() => inFlight.delete(key))
  inFlight.set(key, started)
  return started
}

/** The row a gate key is counted under: its kind (`agents`, `tickets`...), not the teams or projects after the colon. */
const gateName = (key: string): string => `gate:${key.split(':')[0]}`

/** Linear's counters as of the last sample; the first sample is only the baseline. */
let lastCounters: { requests: number; complexity: number } | null = null

/** After a gated Linear read really ran: what ix-board's cache status says it spent. Only where FACTORY_PANEL_METER is set. */
async function sampleLinear($: EngineInterface, name: string): Promise<void> {
  try {
    if (!(await isMetering($))) return
    const ran = await spawn($, ['ix-board', '--json', 'cache', 'status'], 10_000, 'meter')
    const now = linearCounters(ran.stdout)
    if (now === null) return
    // A counter that went down started a new window: what was spent since is not known, so nothing is added.
    if (lastCounters !== null) meter.linear(name, Math.max(0, now.requests - lastCounters.requests), Math.max(0, now.complexity - lastCounters.complexity))
    lastCounters = now
  } catch {
    // The meter is a side channel.
  }
}

/** Forgets the last Linear sample; a new session has none. */
export const resetLinearSample = (): void => void (lastCounters = null)

async function gate<T>(
  $: EngineInterface,
  key: string,
  fetch: () => Promise<T>,
  opts: GateOptions<T>,
): Promise<Gated<T>> {
  const name = gateName(key)
  const isLinear = opts.linear !== false
  const interval = opts.intervalMs ?? BOARD_INTERVAL_MS
  // A failure is held for UNKEPT_TTL_MS, or the whole interval where that is shorter.
  const unkeptTtl = Math.min(UNKEPT_TTL_MS, interval)
  const now = await $.clock.now()
  const g = await load($)
  const had = g.entries[key] ?? { at: null, claimAt: null, data: null }
  // A read that failed outright keeps saying so while it is held.
  const cached = (error: string | null = had.unkept === true ? (had.error ?? null) : null, backoffUntil = isLinear ? g.backoffUntil : null): Gated<T> => ({
    data: had.data as T | null,
    at: had.at,
    held: had.unkept === true,
    ...(had.unkept === true && had.holdMs !== undefined ? { holdMs: had.holdMs } : {}),
    backoffUntil: backoffUntil !== null && backoffUntil > now ? backoffUntil : null,
    error,
  })

  // Linear's rate limit holds every read that calls Linear; one that makes no Linear call is not held by it.
  const backoff = isLinear ? g.backoffUntil : null
  if (backoff !== null && backoff > now) return (meter.gate(name, 'backoff'), cached())
  // Only an answer that was kept: after a failure the hold protects ix-board, whichever build met it.
  const isOutdated = had.unkept !== true && had.data !== null && opts.outdated?.(had.data as T) === true
  const wait = opts.manual ? Math.min(MANUAL_MIN_MS, interval) : interval
  if (had.unkept === true && had.holdMs !== undefined && had.triedAt !== undefined) {
    // An inferred source error is held for its own time; a manual refresh asks it after 60 seconds.
    if (now - had.triedAt < (opts.manual ? MANUAL_MIN_MS : had.holdMs)) return (meter.gate(name, 'held'), cached())
  }
  // A manual refresh asks again at once when the last one was only held after a failure.
  else if (!isOutdated && had.at !== null && now - had.at < wait && !(opts.manual && had.unkept === true)) return (meter.gate(name, had.unkept === true ? 'held' : 'hit'), cached())
  if (had.claimAt !== null && now - had.claimAt < CLAIM_MS) return (meter.gate(name, 'claimed-elsewhere'), cached())

  const claim = now + Math.random() / 10
  // With the gate file unwritable no claim can be made or checked; this session fetches on its own.
  const taken = await exclusive(async () => {
    const claimed = await save($, f => {
      f.entries[key] = { ...had, claimAt: claim }
    }).then(
      () => true,
      () => false,
    )
    return !claimed || (await load($)).entries[key]?.claimAt === claim
  })
  if (!taken) return (meter.gate(name, 'claimed-elsewhere'), cached())
  meter.gate(name, 'fetched')
  try {
    const data = await fetch()
    if (isLinear) await sampleLinear($, name)
    const at = await $.clock.now()
    // A failed save must not throw the fetched data away: this session still shows it.
    // A result that is not to be kept is shown, held for UNKEPT_TTL_MS, and asked again after it.
    const keep = opts.keep?.(data) ?? true
    // Only a kept result ends a streak.
    const isRepeat = !keep && (opts.repeats?.(data) ?? false)
    const streak = keep ? 0 : (had.streak ?? 0) + (isRepeat ? 1 : 0)
    const holdMs = isRepeat ? Math.min(UNKEPT_TTL_MS * 2 ** (streak - 1), REPEAT_HOLD_MAX_MS) : undefined
    await exclusive(() =>
      save($, f => {
        f.entries[key] = keep
          ? { at, claimAt: null, data }
          : { at: at - (interval - (holdMs ?? unkeptTtl)), claimAt: null, data, unkept: true, ...(streak > 0 ? { streak } : {}), ...(holdMs === undefined ? {} : { holdMs, triedAt: at }) }
      }),
    ).catch(() => undefined)
    return { data, at, backoffUntil: null, error: null }
  } catch (error) {
    if (isLinear) await sampleLinear($, name)
    const text = errorText(error)
    const retry = isLinear ? retryAfterMs(text) : null
    const until = retry !== null ? now + retry : null
    await exclusive(() =>
      save($, f => {
        // A read that failed outright is held a few minutes like any source error; Linear's own wait holds every read.
        if (until === null) f.entries[key] = { data: had.data, at: now - (interval - unkeptTtl), claimAt: null, unkept: true, error: text, ...(had.streak === undefined ? {} : { streak: had.streak }) }
        else {
          f.entries[key] = { ...had, claimAt: null }
          f.backoffUntil = until
        }
      }),
    ).catch(() => undefined)
    return cached(until !== null ? null : text, until)
  }
}
