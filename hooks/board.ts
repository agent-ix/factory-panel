import type { EngineInterface } from 'claude-code'

import type { FocusFailure, FocusProject } from '../types'
import { keyOf } from './progress'
import type { ProgressRecord, Records } from './progress'
import { after, errorText } from './shared'

// Progress of a focus per selector. One ix-board call over every selector first; when that
// call fails on a selector's account, one call for each selector, so one bad ticket takes away only
// its own part of the view.

export type SelectorKind = 'initiative' | 'project' | 'milestone' | 'ticket'

/** One initiative, project, milestone or ticket of the shown focus. */
export type Selector = { kind: SelectorKind; ref: string; /** the milestone's project */ project?: string; label?: string }

export const COMBINED_TIMEOUT_MS = 15_000
export const SINGLE_TIMEOUT_MS = 5_000
export const REFRESH_BUDGET_MS = 30_000
export const CONCURRENCY = 4

export const SUMMED_NOTE = 'summed from parts; overlapping selectors may count twice'

export const selectorKey = (s: Selector): string => keyOf(s.kind, s.ref, s.project)

/** Names ix-board gave a selector in an earlier answer, by key, for the rows that have no answer now. */
const learned = new Map<string, string>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The label drawn for a selector: its own, else the name ix-board gave it, else its kind and ref (a UUID cut to 8). */
export const selectorName = (s: Selector): string => s.label ?? learned.get(selectorKey(s)) ?? `${s.kind} ${UUID.test(s.ref) ? s.ref.slice(0, 8) : s.ref}`

/** The key of a focus's own record: the aggregate of a successful combined call. */
export const focusKey = (id: string): string => `focus:${id}`

/** The argument of one `ix-board focus status` call for a selector; a milestone is asked alone, by its ref. */
export const selectorArgs = (s: Selector): string[] => [s.kind === 'ticket' ? '--issue' : `--${s.kind}`, s.ref]

/** The selectors of a lead's work report scope: its initiatives, projects and tickets. */
export const selectorsOfScope = (scope: { initiatives?: string[]; projects?: string[]; tickets?: string[] } | null | undefined): Selector[] => [
  ...(scope?.initiatives ?? []).map((ref): Selector => ({ kind: 'initiative', ref })),
  ...(scope?.projects ?? []).map((ref): Selector => ({ kind: 'project', ref })),
  ...(scope?.tickets ?? []).map((ref): Selector => ({ kind: 'ticket', ref })),
]

export type Progress = { done: number; total: number; inProgress: number; ready: number }
type Row = { name: string; done: number; total: number; inProgress: number }

export type Outcome = ({ ok: true; at: number; name: string | null } & Progress) | { ok: false; error: string }

/** What one refresh found: the combined call's rows, or why it fell back, and each selector's call. */
export type Refresh = {
  at: number
  combined: { rows: Row[]; ready: number; fetchedAt: number | null } | null
  combinedError: string | null
  outcomes: Record<string, Outcome>
}

/** A failure of ix-board itself: it could not start, timed out, or refused the caller. No selector is to blame. */
export class SourceFailure extends Error {}

type Status = { fetched_at?: number; ready_queue?: unknown[]; projects?: { name: string; progress?: { done?: number; total?: number }; in_progress?: unknown[] }[] }

const AUTH = /authenticat|authoris|authoriz|unauthori|forbidden|permission denied|credential|not logged in|api key|\b40[13]\b/i
/** Linear's own rate limit holds the whole workspace, not one selector. */
const RATE = /rate limit/i

const lastLine = (text: string): string => text.trim().split('\n').filter(Boolean).pop() ?? ''

function parse(text: string): Status {
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
  return parsed as Status
}

const rowsOf = (status: Status): Row[] =>
  (status.projects ?? []).map(p => {
    const done = p.progress?.done ?? 0
    const total = p.progress?.total ?? 0
    return { name: p.name, done, total, inProgress: Math.max(0, Math.min(p.in_progress?.length ?? 0, total - done)) }
  })

const sum = (rows: Row[]): Omit<Progress, 'ready'> => rows.reduce((a, r) => ({ done: a.done + r.done, total: a.total + r.total, inProgress: a.inProgress + r.inProgress }), { done: 0, total: 0, inProgress: 0 })

const argv = (args: string[]): string[] => ['ix-board', '--json', 'focus', 'status', ...args]

/** Asks ix-board once for every selector, then for each selector alone when that is the selector's fault. */
export async function refreshProgress($: EngineInterface, selectors: readonly Selector[], endsAt?: number): Promise<Refresh> {
  const deadline = endsAt ?? (await $.clock.now()) + REFRESH_BUDGET_MS

  let ran
  try {
    ran = await $.process.run(argv(selectors.flatMap(selectorArgs)), { timeoutMs: COMBINED_TIMEOUT_MS })
  } catch (error) {
    throw new SourceFailure(errorText(error))
  }
  if (ran.exitCode === 0) {
    let status: Status
    try {
      status = parse(ran.stdout)
    } catch {
      throw new SourceFailure('ix-board printed text that is not JSON')
    }
    const at = await $.clock.now()
    return { at, combined: { rows: rowsOf(status), ready: status.ready_queue?.length ?? 0, fetchedAt: typeof status.fetched_at === 'number' ? status.fetched_at * 1000 : null }, combinedError: null, outcomes: {} }
  }
  const stderr = ran.stderr.trim()
  if (stderr === '') throw new SourceFailure(`ix-board exited ${ran.exitCode}`)
  if (AUTH.test(stderr) || RATE.test(stderr)) throw new SourceFailure(stderr.split('\n').filter(Boolean).pop() ?? stderr)
  const combinedError = lastLine(stderr)

  const outcomes: Record<string, Outcome> = {}
  const single = async (s: Selector): Promise<Outcome> => {
    const left = deadline - (await $.clock.now())
    if (left <= 0) return { ok: false, error: 'timed out' }
    try {
      const done = await $.process.run(argv(selectorArgs(s)), { timeoutMs: Math.min(SINGLE_TIMEOUT_MS, left) })
      if (done.exitCode !== 0) return { ok: false, error: lastLine(done.stderr) || lastLine(done.stdout) || `ix-board exited ${done.exitCode}` }
      let status: Status
      try {
        status = parse(done.stdout)
      } catch {
        return { ok: false, error: 'ix-board printed text that is not JSON' }
      }
      const rows = rowsOf(status)
      if (rows.length === 1) learned.set(selectorKey(s), rows[0]!.name)
      return { ok: true, at: await $.clock.now(), name: rows.length === 1 ? rows[0]!.name : null, ...sum(rows), ready: status.ready_queue?.length ?? 0 }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  }
  let ended = false
  const queue = [...selectors]
  const worker = async (): Promise<void> => {
    for (let s = queue.shift(); s !== undefined && !ended; s = queue.shift()) {
      const outcome = await single(s)
      if (!ended) outcomes[selectorKey(s)] = outcome
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, selectors.length) }, worker)
  await Promise.race([Promise.all(workers), after($, Math.max(0, deadline - (await $.clock.now())))])
  ended = true
  for (const s of selectors) outcomes[selectorKey(s)] ??= { ok: false, error: 'timed out' }
  return { at: await $.clock.now(), combined: null, combinedError, outcomes }
}

/** The records this refresh writes: each success, and each selector shown that has a record, seen now. */
export function recordsOf(selectors: readonly Selector[], refresh: Refresh | null, disk: Records, now: number, focus?: string): Records {
  const mine: Records = {}
  if (focus !== undefined) {
    if (refresh?.combined != null) mine[focus] = { at_ms: refresh.at, seen_ms: now, ...sum(refresh.combined.rows), ready: refresh.combined.ready }
    else if (disk[focus] !== undefined) mine[focus] = { ...disk[focus]!, seen_ms: now }
  }
  for (const s of selectors) {
    const key = selectorKey(s)
    const outcome = refresh?.outcomes[key]
    if (outcome?.ok === true) mine[key] = { at_ms: outcome.at, seen_ms: now, done: outcome.done, total: outcome.total, inProgress: outcome.inProgress, ready: outcome.ready }
    else if (refresh?.combined != null && selectors.length === 1) {
      // The combined call over one selector is that selector's call.
      const t = sum(refresh.combined.rows)
      mine[key] = { at_ms: refresh.at, seen_ms: now, ...t, ready: refresh.combined.ready }
    } else if (disk[key] !== undefined) mine[key] = { ...disk[key]!, seen_ms: now }
  }
  return mine
}

export type Composed = {
  projects: FocusProject[]
  failures: FocusFailure[]
  counts: { fresh: number; old: number; failed: number }
  partial: boolean
  notes: string[]
  ready: number
  fetchedAt: number | null
}

const rowOf = (name: string, r: Progress, at: number | null, old: boolean, error: string | null): FocusProject => ({ name, done: r.done, total: r.total, inProgress: r.inProgress, ready: r.ready, at, old, error })

const recordProgress = (r: ProgressRecord): Progress => ({ done: r.done, total: r.total, inProgress: r.inProgress, ready: r.ready })

/**
 * The view of a refresh: each selector's fresh result, else its record marked old, else its error.
 * `refresh` is null when ix-board itself failed (`sourceError`), which leaves every selector to its record.
 */
export function compose(selectors: readonly Selector[], refresh: Refresh | null, sourceError: string | null, records: Records, focus?: { key: string; name: string }): Composed {
  const n = selectors.length
  if (refresh?.combined != null) {
    const c = refresh.combined
    const only = n === 1 ? records[selectorKey(selectors[0]!)] : undefined
    // A record of the same selector that is newer than this answer wins: the answer is the older one.
    if (only !== undefined && only.at_ms > refresh.at)
      return { projects: [rowOf(selectorName(selectors[0]!), recordProgress(only), only.at_ms, false, null)], failures: [], counts: { fresh: 1, old: 0, failed: 0 }, partial: false, notes: [], ready: only.ready, fetchedAt: only.at_ms }
    return {
      projects: c.rows.map(r => rowOf(r.name, { ...r, ready: 0 }, null, false, null)),
      failures: [],
      counts: { fresh: n, old: 0, failed: 0 },
      partial: false,
      notes: [],
      ready: c.ready,
      fetchedAt: c.fetchedAt ?? refresh.at,
    }
  }
  const projects: FocusProject[] = []
  const failures: FocusFailure[] = []
  const counts = { fresh: 0, old: 0, failed: 0 }
  for (const s of selectors) {
    const key = selectorKey(s)
    const outcome = refresh?.outcomes[key]
    const record = records[key]
    if (outcome?.ok === true) {
      counts.fresh++
      // A result older than the record it would replace is ignored: the record is the newer success.
      if (record !== undefined && record.at_ms > outcome.at) projects.push(rowOf(selectorName(s), recordProgress(record), record.at_ms, false, null))
      else projects.push(rowOf(s.label ?? outcome.name ?? selectorName(s), outcome, outcome.at, false, null))
      continue
    }
    const error = outcome?.ok === false ? outcome.error : sourceError
    if (record !== undefined) {
      counts.old++
      projects.push(rowOf(selectorName(s), recordProgress(record), record.at_ms, true, outcome?.ok === false ? outcome.error : null))
    } else {
      counts.failed++
      if (outcome?.ok === false) failures.push({ name: selectorName(s), error: error ?? 'failed' })
    }
  }
  // Nothing of any selector to show: the focus's own record of its last good aggregate stands in, marked old.
  const whole = projects.length === 0 && focus !== undefined ? records[focus.key] : undefined
  if (whole !== undefined) {
    projects.push(rowOf(focus!.name, recordProgress(whole), whole.at_ms, true, null))
    counts.old = n
    counts.failed = 0
  }
  const partial = counts.old > 0 || counts.failed > 0
  return {
    projects,
    failures,
    counts,
    partial,
    notes: !partial && refresh?.combinedError != null ? [SUMMED_NOTE] : [],
    ready: projects.reduce((a, p) => a + p.ready, 0),
    fetchedAt: refresh?.at ?? null,
  }
}
