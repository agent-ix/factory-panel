import type { EngineInterface } from 'claude-code'

import { meter, readMedian } from './meter'

// When each read of a source is next due. Nothing here starts a read: hooks/visible.ts asks, from a
// drawing of a view, which of its sources are due. A source that fails is asked half as often each
// time, up to five minutes apart, until it answers again. One that answers, however slowly, is not
// failing: Prometheus is across the LAN and several hosts are on wifi, so a slow answer only stretches
// the next wait, by half, and never more than doubles it.

export type SourceId =
  | 'selection'
  | 'whoami'
  | 'prometheus'
  | 'herdr'
  | 'relay'
  | 'board'
  | 'focus'
  | 'escalations'
  | 'escalationDetail'
  | 'announcements'
  | 'team'
  | 'work'
  | 'events'
  | 'tickets'
  | 'workLanes'
  | 'projects'
  | 'membership'
  | 'choices'
  | 'retro'
  | 'capacity'

const MINUTE = 60 * 1000
/** The longest a failing source is left alone, unless its own interval is longer. */
export const BACKOFF_CAP_MS = 5 * MINUTE
/** A timer that fires this much early still counts. */
const EARLY_MS = 500
/** A slow answer stretches the next wait by this much, and slow answers in a row by no more. */
export const SLOW_STRETCH = 1.5

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
    case 'membership':
      return 2 * MINUTE
    // The relay's event stream: cheap to ask, and a review has to show within a minute of its report.
    case 'events':
      return 30 * 1000
    // The stored retro snapshots change when a retro runs, and the team series move in 5 minute steps (STEP_SECS of
    // hooks/team.tsx): every 5 minutes is as often as either can change.
    case 'retro':
    case 'team':
      return 5 * MINUTE
    // 'tickets' among them: a look at the shared gate, which runs ix-board itself far less often.
    default:
      return MINUTE
  }
}

/**
 * A read that takes longer than this was slow; null where a long read is normal. A source asked across the network
 * is slow only against its own usual time: four times the median of its last reads, and at least `floor`.
 */
const slowAfter = (id: SourceId): number | null => {
  switch (id) {
    case 'prometheus':
    case 'team':
    case 'capacity':
    case 'workLanes':
      return Math.max(2_500, 4 * (readMedian(id) ?? 0))
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

type State = { startedAt: number | null; failures: number; isSlow: boolean; running: number }

const states = new Map<SourceId, State>()

const stateOf = (id: SourceId): State => {
  let s = states.get(id)
  if (s === undefined) {
    s = { startedAt: null, failures: 0, isSlow: false, running: 0 }
    states.set(id, s)
  }
  return s
}

/** How long after the last read started the next one is due. */
export const waitOf = (id: SourceId): number => {
  const base = intervalOf(id)
  const { failures, isSlow } = stateOf(id)
  if (failures > 0) return Math.min(base * 2 ** failures, Math.max(base, BACKOFF_CAP_MS))
  return isSlow ? base * SLOW_STRETCH : base
}

/** True when a source has no read under way and its data is older than its wait. */
export const isDue = (id: SourceId, now: number): boolean => {
  const s = stateOf(id)
  return s.running === 0 && (s.startedAt === null || now - s.startedAt >= waitOf(id) - EARLY_MS)
}

/** Runs one read and records when it started and whether the source answered (`run` returns false when it did not). */
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
    const took = startedAt === null ? 0 : (await $.clock.now()) - startedAt
    // Judged against the reads before this one, so that one slow read does not raise its own bar.
    const slow = slowAfter(id)
    const wasSlow = ok && slow !== null && startedAt !== null && took > slow
    meter.read(id, took, ok, wasSlow)
    s.failures = ok ? 0 : s.failures + 1
    s.isSlow = wasSlow
  }
}

/** What these sources hold no longer fits what is asked of them: the next drawing reads them again. */
export const markStale = (...ids: SourceId[]): void => {
  for (const id of ids) {
    const s = stateOf(id)
    s.startedAt = null
    s.failures = 0
    s.isSlow = false
  }
}

/** Forgets every read: a new session has asked nothing. */
export const resetSchedule = (): void => states.clear()
