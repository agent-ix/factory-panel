import type { EngineInterface } from 'claude-code'

// When each read of a source is next due. Nothing here starts a read: hooks/visible.ts asks, from a
// drawing of a view, which of its sources are due. A source that fails or answers slowly is asked
// half as often each time, up to five minutes apart, until it answers well again.

export type SourceId =
  | 'selection'
  | 'whoami'
  | 'prometheus'
  | 'herdr'
  | 'relay'
  | 'board'
  | 'focus'
  | 'escalations'
  | 'announcements'
  | 'team'
  | 'work'
  | 'events'
  | 'retro'
  | 'roles'
  | 'capacity'

const MINUTE = 60 * 1000
/** The longest a failing or slow source is left alone, unless its own interval is longer. */
export const BACKOFF_CAP_MS = 5 * MINUTE
/** A timer that fires this much early still counts. */
const EARLY_MS = 500

let refreshMs = 15 * 1000

/** Takes the person's refresh setting; session start calls it. */
export const setRefresh = (seconds: number): void => void (refreshMs = seconds * 1000)

/** How often a source is read while a view that draws it is on screen. */
export const intervalOf = (id: SourceId): number => {
  switch (id) {
    // Local files, and Prometheus, which is cheap to ask: the person's setting.
    case 'selection':
    case 'whoami':
    case 'prometheus':
      return refreshMs
    // `herdr api snapshot` and `agent-msg doctor`: once a minute at most.
    case 'herdr':
    case 'relay':
      return Math.max(MINUTE, refreshMs)
    case 'focus':
      return 2 * MINUTE
    // The relay's event stream: cheap to ask, and a review has to show within a minute of its report.
    case 'events':
      return 30 * 1000
    // The stored retro snapshots change when a retro runs: every few minutes is often enough.
    case 'retro':
      return 5 * MINUTE
    // 'roles' among them: a look at the shared gate, which runs the evaluation itself far less often.
    default:
      return MINUTE
  }
}

/** A read that takes longer than this counts against the source; null where a long read is normal. */
const slowAfter = (id: SourceId): number | null => {
  switch (id) {
    case 'prometheus':
    case 'team':
      return 2_500
    case 'herdr':
    case 'escalations':
    case 'announcements':
      return 5_000
    case 'relay':
      return 10_000
    default:
      return null
  }
}

type State = { startedAt: number | null; failures: number; running: number }

const states = new Map<SourceId, State>()

const stateOf = (id: SourceId): State => {
  let s = states.get(id)
  if (s === undefined) {
    s = { startedAt: null, failures: 0, running: 0 }
    states.set(id, s)
  }
  return s
}

/** How long after the last read started the next one is due. */
export const waitOf = (id: SourceId): number => {
  const base = intervalOf(id)
  const { failures } = stateOf(id)
  return failures === 0 ? base : Math.min(base * 2 ** failures, Math.max(base, BACKOFF_CAP_MS))
}

/** True when a source has no read under way and its data is older than its wait. */
export const isDue = (id: SourceId, now: number): boolean => {
  const s = stateOf(id)
  return s.running === 0 && (s.startedAt === null || now - s.startedAt >= waitOf(id) - EARLY_MS)
}

/** Runs one read and records when it started and whether the source answered well (`run` returns false when it did not). */
export async function track($: EngineInterface, id: SourceId, run: () => Promise<boolean>): Promise<boolean> {
  const s = stateOf(id)
  // Counted before the first wait, so a second drawing in the same moment does not start another.
  s.running++
  let ok = false
  let startedAt: number | null = null
  try {
    startedAt = await $.clock.now()
    s.startedAt = startedAt
    ok = await run()
    return ok
  } finally {
    s.running--
    const slow = slowAfter(id)
    const wasSlow = slow !== null && startedAt !== null && (await $.clock.now()) - startedAt > slow
    s.failures = ok && !wasSlow ? 0 : s.failures + 1
  }
}

/** What these sources hold no longer fits what is asked of them: the next drawing reads them again. */
export const markStale = (...ids: SourceId[]): void => {
  for (const id of ids) {
    const s = stateOf(id)
    s.startedAt = null
    s.failures = 0
  }
}

/** Forgets every read: a new session has asked nothing. */
export const resetSchedule = (): void => states.clear()
