import type { EngineInterface } from 'claude-code'

import { errorText } from './shared'

// Every ix-board read refreshes ix-board's cache of the whole Linear workspace once it is five
// minutes old, and this mod loads in every session. So the panes share one gate, in a file every
// session on the machine reads: each read runs at most once per interval across all of them, its
// result is kept for the others, and when Linear says "rate limited; retry in N s" nobody calls
// ix-board again until then.

/** Long enough that ix-board's five-minute cache serves most reads. */
export const BOARD_INTERVAL_MS = 15 * 60 * 1000
/** A fetch another session claimed is trusted to finish within this long. */
const CLAIM_MS = 4 * 60 * 1000
/** A manual refresh still waits this long after the last read. */
const MANUAL_MIN_MS = 60 * 1000

type Entry = { at: number | null; claimAt: number | null; data: unknown }
type GateFile = { backoffUntil: number | null; entries: Record<string, Entry> }

export type Gated<T> = {
  data: T | null
  /** ms since the epoch of the read that produced `data` */
  at: number | null
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
  const ran = await $.process.run(['printenv', 'HOME'], { timeoutMs: 5_000 })
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

/** Re-reads the file before writing, so another session's entries in between survive. */
async function save($: EngineInterface, change: (g: GateFile) => void): Promise<void> {
  const g = await load($)
  change(g)
  await $.fs.write(await pathOf($), JSON.stringify(g))
}

/** Linear's own wait, from ix-board's "Linear rate limited; retry in 3600.005s". */
export function retryAfterMs(message: string): number | null {
  const m = /rate limit\w*;?\s*retry in ([\d.]+)\s*s/i.exec(message)
  return m ? Math.ceil(Number(m[1]) * 1000) : null
}

/**
 * Runs `fetch` for `key` only when no session has in the last `intervalMs`, none is fetching it now,
 * and Linear is not rate limiting; otherwise answers what the last read left.
 */
export function gatedBoard<T>(
  $: EngineInterface,
  key: string,
  fetch: () => Promise<T>,
  opts: { manual?: boolean } = {},
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

async function gate<T>(
  $: EngineInterface,
  key: string,
  fetch: () => Promise<T>,
  opts: { manual?: boolean },
): Promise<Gated<T>> {
  const now = await $.clock.now()
  const g = await load($)
  const had = g.entries[key] ?? { at: null, claimAt: null, data: null }
  const cached = (error: string | null, backoffUntil = g.backoffUntil): Gated<T> => ({
    data: had.data as T | null,
    at: had.at,
    backoffUntil: backoffUntil !== null && backoffUntil > now ? backoffUntil : null,
    error,
  })

  if (g.backoffUntil !== null && g.backoffUntil > now) return cached(null)
  const wait = opts.manual ? MANUAL_MIN_MS : BOARD_INTERVAL_MS
  if (had.at !== null && now - had.at < wait) return cached(null)
  if (had.claimAt !== null && now - had.claimAt < CLAIM_MS) return cached(null)

  const claim = now + Math.random() / 10
  // With the gate file unwritable no claim can be made or checked; this session fetches on its own.
  const claimed = await save($, f => {
    f.entries[key] = { ...had, claimAt: claim }
  }).then(
    () => true,
    () => false,
  )
  if (claimed && (await load($)).entries[key]?.claimAt !== claim) return cached(null)
  try {
    const data = await fetch()
    const at = await $.clock.now()
    // A failed save must not throw the fetched data away: this session still shows it.
    await save($, f => {
      f.entries[key] = { at, claimAt: null, data }
    }).catch(() => undefined)
    return { data, at, backoffUntil: null, error: null }
  } catch (error) {
    const text = errorText(error)
    const retry = retryAfterMs(text)
    const until = retry !== null ? now + retry : null
    await save($, f => {
      f.entries[key] = { ...had, claimAt: null }
      if (until !== null) f.backoffUntil = until
    }).catch(() => undefined)
    return cached(until !== null ? null : text, until)
  }
}
