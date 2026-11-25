import type { EngineInterface } from 'claude-code'

import type { FocusHeader, FocusInitiative, FocusProject, FocusWarning } from '../types'
import { findRecord, isUsable, isUuid, keyOf, projectKey } from './progress'
import type { Initiatives, Member, Membership, ProgressFile, ProgressRecord, Records } from './progress'
import { nameFor } from './progress'
import { after, errorText } from './shared'

// Progress of a focus: one `ix-board focus status` call per project, so a project with bad data fails
// alone. An initiative is first expanded to its projects (the roadmap, one initiative call, or the
// membership remembered in progress.json), the projects are called by id, and the answers are rolled up.

export type SelectorKind = 'initiative' | 'project' | 'milestone' | 'ticket'

/** One initiative, project, milestone or ticket of the shown focus. */
export type Selector = { kind: SelectorKind; ref: string; /** the milestone's project */ project?: string; label?: string }

// ix-board answered a project in 3.5 to 5.7 s and the roadmap in 2 s when measured, so a call may take 20 s.
export const CALL_TIMEOUT_MS = 20_000
export const REFRESH_BUDGET_MS = 60_000
export const CONCURRENCY = 4

export const PROJECTS_UNKNOWN = 'projects unknown'
export const NOT_FOUND = 'initiative not found'

export const selectorKey = (s: Selector): string => keyOf(s.kind, s.ref, s.project)

/** Names ix-board gave a selector in an earlier answer, by key, for the rows that have no answer now. */
const learned = new Map<string, string>()

const short = (ref: string): string => (isUuid(ref) ? ref.slice(0, 8) : ref)

/** The label drawn for a selector: its own, else the name ix-board gave it, else its kind and ref (a UUID cut to 8). */
export const selectorName = (s: Selector): string => s.label ?? learned.get(selectorKey(s)) ?? `${s.kind} ${short(s.ref)}`

// At most CONCURRENCY ix-board processes run at once in this session, whatever the number of focuses.
let running = 0
const waiting: (() => void)[] = []
const acquire = (): Promise<void> => (running < CONCURRENCY ? (running++, Promise.resolve()) : new Promise<void>(resolve => waiting.push(resolve)))
const release = (): void => {
  const next = waiting.shift()
  if (next === undefined) running--
  else next()
}

/** Forgets what an earlier session learned. */
export function resetBoard(): void {
  learned.clear()
  running = 0
  waiting.length = 0
}

/** The argument of one `ix-board focus status` call for a selector; a milestone is asked alone, by its ref. */
export const selectorArgs = (s: Selector): string[] => [s.kind === 'ticket' ? '--issue' : `--${s.kind}`, s.ref]

/** The selectors of a lead's work report scope: its initiatives, projects and tickets. */
export const selectorsOfScope = (scope: { initiatives?: string[]; projects?: string[]; tickets?: string[] } | null | undefined): Selector[] => [
  ...(scope?.initiatives ?? []).map((ref): Selector => ({ kind: 'initiative', ref })),
  ...(scope?.projects ?? []).map((ref): Selector => ({ kind: 'project', ref })),
  ...(scope?.tickets ?? []).map((ref): Selector => ({ kind: 'ticket', ref })),
]

// ---------------------------------------------------------------- answers

/** What one project (or milestone, or ticket) answer carries. `null` is a key the answer lacks. */
export type Row = {
  id: string | null
  identifier: string | null
  name: string
  done: number
  total: number
  inProgress: number
  ready: number | null
  blocked: number | null
  stages: Record<string, number> | null
}

/** A failed call may still know what the project is called, from `project-chunk`. */
export type Named = { id: string | null; identifier: string | null; name: string }
export type Outcome = { ok: true; at: number; rows: Row[] } | { ok: false; error: string; named?: Named }

/** One initiative's expansion into the projects to call. `id` is '' where only the name is known. */
export type Expansion = {
  /** the selector key of the initiative */
  key: string
  /** the id when the selector is a UUID, else the name */
  collapseKey: string
  name: string
  via: 'roadmap' | 'rule3' | 'memory' | 'none' | 'identified'
  /** Set when the initiative could not be expanded: `projects unknown` or `initiative not found`. */
  reason: string | null
  error: string | null
  projects: { ref: string; id: string; name: string }[]
}

/** What one refresh found. A source error stops it: the answers so far are kept. */
export type Refresh = {
  at: number
  roadmapError: string | null
  sourceError: string | null
  expansions: Expansion[]
  /** by call key: `project:<ref>` for each project call and each project of an initiative call, else the selector key */
  outcomes: Record<string, Outcome>
}

/** A rate limit of Linear: it holds the whole workspace, so it is thrown for the gate to hold every call. */
export class SourceFailure extends Error {
  /** What the refresh had answered before the rate limit, so it is drawn and recorded. */
  partial: Refresh | null = null
}

type StatusProject = { id?: string; identifier?: string; name?: string; progress?: { done?: number; total?: number }; in_progress?: unknown[]; open_by_state?: { state?: string; count?: number }[] }
type Status = { fetched_at?: number; ready_queue?: { project?: string }[]; blocker_layers?: { classification?: string }[][]; projects?: StatusProject[] }

// Only explicit words: a ticket id such as QSL-403 is not an authorisation failure.
const AUTH = /unauthori[sz]ed|forbidden|authenticat|authori[sz]ation|api key|\btoken\b|not logged in|credential/i
const RATE = /rate limit/i
const TIMEOUT = /timed out/i
/** Whether an initiative call's error says that the initiative itself is not found, and not some other thing that is. */
const notFoundInitiative = (error: string): boolean => /initiative/i.test(error) && /not found|no such|unknown/i.test(error)

const lastLine = (text: string): string => text.trim().split('\n').filter(Boolean).pop() ?? ''

function parse(text: string): Status {
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
  return parsed as Status
}

const blockedOf = (status: Status): number | null =>
  Array.isArray(status.blocker_layers) ? status.blocker_layers.flat().filter(e => e?.classification !== 'Completed').length : null

const stagesOf = (p: StatusProject): Record<string, number> | null => {
  if (!Array.isArray(p.open_by_state)) return null
  const stages: Record<string, number> = {}
  for (const s of p.open_by_state) if (typeof s?.state === 'string' && typeof s.count === 'number') stages[s.state] = (stages[s.state] ?? 0) + s.count
  return stages
}

/** The rows of an answer. In an initiative's answer the ready queue is split by project name and no blocker belongs to one project. */
function rowsOf(status: Status, whole: boolean): Row[] {
  const projects = status.projects ?? []
  const blocked = blockedOf(status)
  return projects.map(p => {
    const done = p.progress?.done ?? 0
    const total = p.progress?.total ?? 0
    const ready = !Array.isArray(status.ready_queue) ? null : whole ? status.ready_queue.length : status.ready_queue.filter(r => r?.project === p.name).length
    return {
      id: typeof p.id === 'string' ? p.id : null,
      identifier: typeof p.identifier === 'string' ? p.identifier : null,
      name: p.name ?? 'project',
      done,
      total,
      inProgress: Math.max(0, Math.min(p.in_progress?.length ?? 0, total - done)),
      ready,
      blocked: whole ? blocked : null,
      stages: stagesOf(p),
    }
  })
}

const sumNullable = (values: (number | null)[]): number | null => (values.every(v => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0))

/** A milestone or ticket answer is one row: the sum of the projects it touches. */
function unitRow(rows: Row[], name: string): Row {
  return {
    id: null,
    identifier: null,
    name,
    done: rows.reduce((a, r) => a + r.done, 0),
    total: rows.reduce((a, r) => a + r.total, 0),
    inProgress: rows.reduce((a, r) => a + r.inProgress, 0),
    ready: sumNullable(rows.map(r => r.ready)),
    blocked: sumNullable(rows.map(r => r.blocked)),
    stages: null,
  }
}

// ---------------------------------------------------------------- roadmap

type RoadmapProject = { id?: unknown; identifier?: unknown; name?: unknown; also_in?: unknown }
type RoadmapInitiative = { id?: unknown; identifier?: unknown; name?: unknown; projects?: RoadmapProject[] }

const text = (v: unknown): v is string => typeof v === 'string' && v !== ''

function roadmapInitiatives(json: unknown): RoadmapInitiative[] {
  const root = (json as { result?: unknown } | null)?.result ?? json
  const list = (root as { initiatives?: unknown } | null)?.initiatives
  return Array.isArray(list) ? (list as RoadmapInitiative[]).filter(i => typeof i === 'object' && i !== null && text(i.name)) : []
}

const projectsOf = (i: RoadmapInitiative): { ref: string; id: string; name: string }[] =>
  (i.projects ?? []).flatMap(p => (text(p.name) ? [{ ref: text(p.id) ? p.id : text(p.identifier) ? p.identifier : p.name, id: text(p.id) ? p.id : '', name: p.name }] : []))

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The roadmap initiative a selector names: by id or identifier (rule 1), else by exact name (rule 2). */
function matchRoadmap(list: RoadmapInitiative[], ref: string): RoadmapInitiative | undefined {
  return list.find(i => (text(i.id) && same(i.id, ref)) || (text(i.identifier) && same(i.identifier, ref))) ?? list.find(i => i.name === ref)
}

/** An initiative's expansion from the membership remembered for it, or none. */
export function expandFromCache(s: Selector, memory: Initiatives, why: string | null): Expansion {
  const remembered: Membership | undefined = memory[s.ref]
  const collapseKey = isUuid(s.ref) ? s.ref : (s.label ?? s.ref)
  if (remembered === undefined) return { key: selectorKey(s), collapseKey, name: isUuid(s.ref) ? initiativeName(s) : (s.label ?? s.ref), via: 'none', reason: why === NOT_FOUND ? NOT_FOUND : PROJECTS_UNKNOWN, error: null, projects: [] }
  return { key: selectorKey(s), collapseKey, name: s.label ?? remembered.name ?? initiativeName(s), via: 'memory', reason: null, error: null, projects: remembered.projects.map(p => ({ ref: p.id !== '' ? p.id : p.name, id: p.id, name: p.name })) }
}

const initiativeName = (s: Selector): string => s.label ?? `initiative ${short(s.ref)}`

// ---------------------------------------------------------------- the refresh

const argv = (args: string[]): string[] => ['ix-board', '--json', ...args]

/**
 * Expands the initiatives and asks ix-board once for each project, four at a time, each for at most 5 seconds,
 * the whole in at most 30 seconds. A source error (ix-board missing, refusing the caller, rate limiting, or
 * saying nothing before its first call timed out) stops every further call.
 */
export async function refreshProgress($: EngineInterface, selectors: readonly Selector[], file: ProgressFile, endsAt?: number): Promise<Refresh> {
  const memory = file.initiatives
  const deadline = endsAt ?? (await $.clock.now()) + REFRESH_BUDGET_MS
  const outcomes: Record<string, Outcome> = {}
  let sourceError: string | null = null
  let roadmapError: string | null = null
  let answered = 0
  /** Names learned on the way (rule 4c) for projects whose own call may fail. */
  const hints = new Map<string, Named>()

  type Result = { ok: true; stdout: string } | { ok: false; error: string }
  /** One ix-board process, within the call timeout and the budget; a source error is recorded and stops the rest. */
  const ask = async (args: string[]): Promise<Result> => {
    await acquire()
    try {
      if (sourceError !== null) return { ok: false, error: sourceError }
      const left = deadline - (await $.clock.now())
      if (left <= 0) return { ok: false, error: 'timed out' }
      let ran
      try {
        ran = await $.process.run(argv(args), { timeoutMs: Math.min(CALL_TIMEOUT_MS, left) })
      } catch (error) {
        const message = errorText(error)
        // A call that timed out after others answered is that project's failure; before any answer ix-board is not answering.
        if (TIMEOUT.test(message) && answered > 0) return { ok: false, error: 'timed out' }
        sourceError ??= message
        return { ok: false, error: message }
      }
      if (ran.exitCode === 0) {
        answered++
        return { ok: true, stdout: ran.stdout }
      }
      const stderr = ran.stderr.trim()
      if (stderr === '') {
        // ix-board ran and refused with no text: that call failed; the text of its stdout is its error when it has one.
        answered++
        return { ok: false, error: lastLine(ran.stdout) || `ix-board exited ${ran.exitCode}` }
      }
      if (AUTH.test(stderr) || RATE.test(stderr)) {
        sourceError ??= lastLine(stderr)
        return { ok: false, error: sourceError }
      }
      answered++
      return { ok: false, error: lastLine(stderr) }
    } finally {
      release()
    }
  }

  /** Runs tasks together and returns at the end of the budget with what has finished. */
  const all = async (tasks: Promise<unknown>[]): Promise<void> => {
    await Promise.race([Promise.all(tasks), after($, Math.max(0, deadline - (await $.clock.now())))])
  }

  const call = async (key: string, selector: Selector, whole: boolean, label?: string): Promise<void> => {
    const result = await ask(['focus', 'status', ...selectorArgs(selector)])
    if (!result.ok) {
      // A source error is the one warning; a project not called because of it has failed nothing.
      if (sourceError !== null) return
      outcomes[key] ??= { ok: false, error: result.error }
      // A project nobody has ever named is asked for its name alone: project-chunk works where the status call does not.
      const hinted = hints.get(selector.ref)
      if (hinted !== undefined) outcomes[key] = { ok: false, error: result.error, named: hinted }
      else if (selector.kind === 'project' && sourceError === null && nameFor(file, selector.ref) === undefined) {
        const named = await ask(['project-chunk', selector.ref])
        if (named.ok) {
          try {
            const chunk = JSON.parse(named.stdout) as { name?: unknown; identifier?: unknown; id?: unknown }
            if (typeof chunk.name === 'string' && chunk.name !== '') {
              const ident = typeof chunk.identifier === 'string' ? chunk.identifier : null
              const id = typeof chunk.id === 'string' ? chunk.id : isUuid(selector.ref) ? selector.ref : ident !== null && isUuid(ident) ? ident : null
              outcomes[key] = { ok: false, error: result.error, named: { id, identifier: ident, name: chunk.name } }
            }
          } catch {
            // the name stays unknown
          }
        }
      }
      return
    }
    let status: Status
    try {
      status = parse(result.stdout)
    } catch {
      outcomes[key] ??= { ok: false, error: 'ix-board printed text that is not JSON' }
      return
    }
    const rows = rowsOf(status, whole)
    const at = await $.clock.now()
    if (selector.kind === 'project') {
      if (rows.length !== 1) outcomes[key] ??= { ok: false, error: rows.length === 0 ? 'ix-board answered no project' : `ix-board answered ${rows.length} projects for ${selector.ref}` }
      else outcomes[key] = { ok: true, at, rows }
      return
    }
    const name = label ?? (rows.length === 1 ? rows[0]!.name : selectorName(selector))
    learned.set(selectorKey(selector), name)
    outcomes[key] = { ok: true, at, rows: [unitRow(rows, name)] }
  }

  const initiatives = selectors.filter(s => s.kind === 'initiative')
  const expansions: Expansion[] = []
  let roadmap: RoadmapInitiative[] | null = null

  if (initiatives.length > 0) {
    const result = await ask(['roadmap'])
    if (result.ok) {
      try {
        roadmap = roadmapInitiatives(JSON.parse(result.stdout))
      } catch {
        roadmapError = 'ix-board printed text that is not JSON'
      }
    } else if (sourceError === null) roadmapError = result.error
  }

  if (sourceError === null) {
    const pending: Selector[] = []
    for (const s of initiatives) {
      const matched = roadmap === null ? undefined : matchRoadmap(roadmap, s.ref)
      if (matched !== undefined) {
        const projects = projectsOf(matched)
        // A project the roadmap lists under another initiative also_in this one belongs here too.
        for (const other of roadmap ?? [])
          for (const p of other.projects ?? [])
            if (text(p.name) && Array.isArray(p.also_in) && (p.also_in as unknown[]).includes(matched.name) && !projects.some(q => q.name === p.name))
              projects.push({ ref: text(p.id) ? p.id : text(p.identifier) ? p.identifier : p.name, id: text(p.id) ? p.id : '', name: p.name })
        expansions.push({ key: selectorKey(s), collapseKey: isUuid(s.ref) ? s.ref : String(matched.name), name: s.label ?? String(matched.name), via: 'roadmap', reason: null, error: null, projects })
      } else if (roadmap === null) expansions.push(expandFromCache(s, memory, null))
      else if (isUuid(s.ref) || IDENTIFIER.test(s.ref)) pending.push(s)
      else expansions.push(expandFromCache(s, memory, NOT_FOUND))
    }

  /**
   * Rule 4c. The roadmap initiative that holds the project an initiative call's error names, only when it is the one
   * initiative that holds it and is not itself selected. It is a guess, so it is drawn and never stored.
   */
  const identify = async (s: Selector, error: string, list: RoadmapInitiative[]): Promise<Expansion | null> => {
    const named = /in project ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(error)
    if (named === null) return null
    const chunk = await ask(['project-chunk', named[1]!])
    if (!chunk.ok) return null
    let name: unknown
    try {
      name = (JSON.parse(chunk.stdout) as { name?: unknown }).name
    } catch {
      return null
    }
    if (!text(name)) return null
    // An initiative holds the project when it lists it, or another initiative lists it as also_in this one.
    const holds = (i: RoadmapInitiative): boolean => (i.projects ?? []).some(p => p.name === name) || list.some(o => (o.projects ?? []).some(p => p.name === name && Array.isArray(p.also_in) && (p.also_in as unknown[]).includes(i.name)))
    const holders = list.filter(holds)
    if (holders.length !== 1) return null
    const found = holders[0]!
    if (selectors.some(o => o.kind === 'initiative' && o.ref !== s.ref && matchRoadmap(list, o.ref) === found)) return null
    hints.set(name, { id: named[1]!, identifier: null, name })
    const projects = projectsOf(found)
    for (const o of list)
      for (const p of o.projects ?? [])
        if (text(p.name) && Array.isArray(p.also_in) && (p.also_in as unknown[]).includes(found.name) && !projects.some(q => q.name === p.name)) projects.push({ ref: p.name, id: '', name: p.name })
    return { key: selectorKey(s), collapseKey: isUuid(s.ref) ? s.ref : String(found.name), name: s.label ?? String(found.name), via: 'identified', reason: null, error: null, projects }
  }

  // Rule 3: one initiative call for each selector the roadmap cannot place; its projects come with their progress.
    const third = new Map<string, Expansion>()
    await all(
      pending.map(async s => {
        const result = await ask(['focus', 'status', '--initiative', s.ref])
        if (result.ok) {
          let status: Status | null = null
          try {
            status = parse(result.stdout)
          } catch {
            // falls through to the memory below
          }
          if (status !== null) {
            const rows = rowsOf(status, false)
            const at = await $.clock.now()
            const projects = rows.map(r => ({ ref: r.id ?? r.name, id: r.id ?? '', name: r.name }))
            for (const r of rows) {
              const ok: Outcome = { ok: true, at, rows: [r] }
              for (const k of [r.id, r.identifier, r.name]) if (k !== null) outcomes[projectKey(k)] ??= ok
            }
            const names = new Set(rows.map(r => r.name))
            // The roadmap names the initiative only where exactly one initiative has the very projects of the answer.
            const equal = (roadmap ?? []).filter(i => projectsOf(i).length === names.size && projectsOf(i).every(p => names.has(p.name)))
            const named = equal.length === 1 ? equal[0] : undefined
            third.set(selectorKey(s), { key: selectorKey(s), collapseKey: isUuid(s.ref) ? s.ref : s.ref, name: s.label ?? (named !== undefined ? String(named.name) : initiativeName(s)), via: 'rule3', reason: null, error: null, projects })
            return
          }
        }
        const error = result.ok ? 'ix-board printed text that is not JSON' : result.error
        const remembered = expandFromCache(s, memory, notFoundInitiative(error) ? NOT_FOUND : null)
        // Rule 4c: the error names the project with the dangling milestone; the initiative that holds a project of that name is this one.
        const identified = remembered.via === 'none' && roadmap !== null ? await identify(s, error, roadmap) : null
        third.set(selectorKey(s), identified ?? { ...remembered, error })
      }),
    )
    for (const s of pending) expansions.push(third.get(selectorKey(s)) ?? { ...expandFromCache(s, memory, null), error: 'timed out' })
  } else for (const s of initiatives) expansions.push(expandFromCache(s, memory, null))

  // Each distinct project is called once, whichever selectors list it, unless an initiative call answered it already.
  const refs = new Set<string>()
  for (const s of selectors) if (s.kind === 'project') refs.add(s.ref)
  for (const e of expansions) for (const p of e.projects) refs.add(p.ref)
  const calls: Promise<void>[] = []
  for (const ref of sourceError === null ? refs : []) {
    const key = projectKey(ref)
    if (outcomes[key] !== undefined) continue
    calls.push(call(key, { kind: 'project', ref }, true))
  }
  for (const s of selectors)
    if (sourceError === null && (s.kind === 'milestone' || s.kind === 'ticket')) calls.push(call(selectorKey(s), s, true, s.label))
  if (sourceError === null) await all(calls)

  const at = await $.clock.now()
  if (sourceError !== null && RATE.test(sourceError)) {
    const held = new SourceFailure(sourceError)
    held.partial = { at, roadmapError, sourceError, expansions, outcomes }
    throw held
  }
  // A project unanswered at the end of the budget has failed.
  if (sourceError === null) for (const ref of refs) outcomes[projectKey(ref)] ??= { ok: false, error: 'timed out' }
  if (sourceError === null) for (const s of selectors) if (s.kind === 'milestone' || s.kind === 'ticket') outcomes[selectorKey(s)] ??= { ok: false, error: 'timed out' }
  return { at, roadmapError, sourceError, expansions, outcomes }
}

/** Whether a refresh is held for a few minutes and asked again at the next poll after them: anything in it failed. */
export const hasFailure = (r: Refresh): boolean =>
  r.sourceError !== null || r.roadmapError !== null || r.expansions.some(e => e.reason !== null || e.error !== null) || Object.values(r.outcomes).some(o => !o.ok)

// ---------------------------------------------------------------- records

const recordOf = (r: Row, at: number, now: number): ProgressRecord => ({
  at_ms: at,
  seen_ms: now,
  done: r.done,
  total: r.total,
  inProgress: r.inProgress,
  ready: r.ready ?? 0,
  ...(r.blocked !== null ? { blocked: r.blocked } : {}),
  ...(r.stages !== null ? { stages: r.stages } : {}),
  ...(r.id !== null ? { id: r.id } : {}),
  ...(r.identifier !== null ? { identifier: r.identifier } : {}),
  name: r.name,
})

/** The records this refresh writes: each project that answered, by its id, and each milestone and ticket. */
export function recordsOf(refresh: Refresh | null, now: number, existing: Records = {}): Records {
  const mine: Records = {}
  if (refresh === null) return mine
  for (const [key, outcome] of Object.entries(refresh.outcomes)) {
    if (!outcome.ok) {
      // A name resolved for a project that never answered is kept, unless a record of it exists.
      const n = outcome.named
      if (n?.id != null && existing[projectKey(n.id)] === undefined && mine[projectKey(n.id)] === undefined)
        mine[projectKey(n.id)] = { at_ms: refresh.at, seen_ms: now, done: 0, total: 0, inProgress: 0, ready: 0, unknown: true, id: n.id, ...(n.identifier !== null ? { identifier: n.identifier } : {}), name: n.name }
      continue
    }
    for (const r of outcome.rows) mine[r.id !== null ? projectKey(r.id) : key] = recordOf(r, outcome.at, now)
  }
  return mine
}

/** The membership this refresh writes for each initiative it resolved, and the one it used again (seen now). */
export function membershipsOf(selectors: readonly Selector[], refresh: Refresh | null, memory: Initiatives, now: number): Initiatives {
  const mine: Initiatives = {}
  if (refresh === null) return mine
  for (const s of selectors) {
    if (s.kind !== 'initiative') continue
    const e = refresh.expansions.find(x => x.key === selectorKey(s))
    if (e === undefined) continue
    if (e.via === 'memory') {
      if (memory[s.ref] !== undefined) mine[s.ref] = { ...memory[s.ref]!, seen_ms: now }
      continue
    }
    if (e.via === 'none' || e.via === 'identified') continue
    const members: Member[] = e.projects.map(p => {
      const row = answerOf(refresh, p)
      return { id: row?.id ?? p.id, name: p.name }
    })
    mine[s.ref] = { at_ms: refresh.at, seen_ms: now, projects: members, ...(e.name !== initiativeName(s) ? { name: e.name } : {}) }
  }
  return mine
}

const answerOf = (refresh: Refresh | null, p: { ref: string; id: string; name: string }): Row | null => {
  for (const k of [p.ref, p.id, p.name]) {
    const o = k === '' ? undefined : refresh?.outcomes[projectKey(k)]
    if (o?.ok === true) return o.rows[0] ?? null
  }
  return null
}

const namedOf = (refresh: Refresh | null, p: { ref: string; id: string; name: string }): Named | null => {
  for (const k of [p.ref, p.id, p.name]) {
    const o = k === '' ? undefined : refresh?.outcomes[projectKey(k)]
    if (o?.ok === false && o.named !== undefined) return o.named
  }
  return null
}

const failureOf = (refresh: Refresh | null, p: { ref: string; id: string; name: string }): string | null => {
  for (const k of [p.ref, p.id, p.name]) {
    const o = k === '' ? undefined : refresh?.outcomes[projectKey(k)]
    if (o?.ok === false) return o.error
  }
  return null
}

// ---------------------------------------------------------------- the view

export type Composed = {
  initiatives: FocusInitiative[]
  loose: FocusProject[]
  header: FocusHeader | null
  warnings: FocusWarning[]
  fetchedAt: number | null
  /** Keys of the records an old row was drawn from: they are seen in this refresh. */
  touched: string[]
}

const rowFrom = (name: string, key: string, ref: string, r: { done: number; total: number; inProgress: number; ready: number | null; blocked: number | null }, id: string | null, at: number | null, old: boolean): FocusProject => ({
  key,
  ref,
  id,
  name,
  failed: false,
  done: r.done,
  total: r.total,
  inProgress: r.inProgress,
  ready: r.ready,
  blocked: r.blocked,
  at,
  old,
  stages: null,
})

const recordRow = (r: ProgressRecord) => ({ done: r.done, total: r.total, inProgress: r.inProgress, ready: r.ready, blocked: r.blocked ?? null })

/**
 * The view of a refresh. A project shows its fresh answer, else its record of at most 24 hours marked old, else
 * a failed mark. `refresh` is null when ix-board itself failed to answer at all; every project is then drawn from
 * its record. The warnings carry every error, so no row does.
 */
export function compose(selectors: readonly Selector[], refresh: Refresh | null, sourceError: string | null, file: ProgressFile, now: number): Composed {
  const records = file.records
  const touched = new Set<string>()
  const warned = new Map<string, FocusWarning>()
  const identities = new Map<string, FocusProject>()

  const project = (m: { ref: string; id: string; name: string }, label: string | undefined): FocusProject => {
    const answer = answerOf(refresh, m)
    const failure = failureOf(refresh, m)
    const known = nameFor(file, m.ref) ?? (m.id !== '' ? nameFor(file, m.id) : undefined)
    const named = namedOf(refresh, m)
    const cachedName = named?.name ?? known?.name
    const found = findRecord(records, m.ref, now) ?? (m.id !== '' ? findRecord(records, m.id, now) : undefined) ?? findRecord(records, m.name, now)
    let row: FocusProject
    if (answer !== null) {
      const id = answer.id ?? (m.id !== '' ? m.id : null)
      const outcome = refresh!.outcomes[projectKey(answer.id ?? m.ref)] ?? refresh!.outcomes[projectKey(m.ref)]
      const at = outcome?.ok === true ? outcome.at : refresh!.at
      const newer = id !== null ? records[projectKey(id)] : undefined
      // A result older than the record it would replace is ignored: the record is the newer success.
      if (newer !== undefined && newer.at_ms > at) row = rowFrom(label ?? newer.name ?? m.name, projectKey(id!), m.ref, recordRow(newer), id, newer.at_ms, false)
      else row = rowFrom(label ?? answer.name, id !== null ? projectKey(id) : projectKey(m.ref), m.ref, answer, id, at, false)
      row.stages = answer.stages
    } else if (found !== undefined) {
      touched.add(found.key)
      row = rowFrom(label ?? found.record.name ?? cachedName ?? m.name, found.key, m.ref, recordRow(found.record), found.record.id ?? (m.id !== '' ? m.id : null), found.record.at_ms, true)
      row.stages = found.record.stages ?? null
    } else {
      const fid = m.id !== '' ? m.id : (named?.id ?? known?.id ?? null)
      row = { ...rowFrom(label ?? cachedName ?? m.name, projectKey(fid ?? m.ref), m.ref, { done: 0, total: 0, inProgress: 0, ready: null, blocked: null }, fid, null, false), failed: true }
    }
    const identity = row.id ?? `name:${row.name}`
    const error = answer === null ? failure : null
    // A failed call is a warning, drawn from a record or not; a project never called (a source error) is not one.
    if (error !== null && failure !== null) warned.set(identity, { kind: 'project', name: row.name, text: error, id: row.id })
    identities.set(identity, row)
    return row
  }

  const initiatives: FocusInitiative[] = []
  const inInitiative = { ids: new Set<string>(), names: new Set<string>() }
  const fromRoadmap = new Map((refresh?.expansions ?? []).map(e => [e.key, e]))
  for (const s of selectors) {
    if (s.kind !== 'initiative') continue
    const e = fromRoadmap.get(selectorKey(s)) ?? expandFromCache(s, file.initiatives, null)
    const name = e.name
    if (e.reason !== null) {
      const text = e.reason === NOT_FOUND ? NOT_FOUND : PROJECTS_UNKNOWN
      initiatives.push({ key: e.collapseKey, name, failed: text, projects: [], counted: 0, enumerated: 0, done: 0, total: 0, inProgress: 0, remaining: 0, ready: null, blocked: null, partial: true, oldestAt: null })
      warned.set(`initiative:${s.ref}`, { kind: 'initiative', name, text: e.error !== null ? `${text}: ${e.error}` : text, id: null })
      continue
    }
    const rows = e.projects.map(p => project(p, undefined))
    for (const r of rows) {
      if (r.id !== null) inInitiative.ids.add(r.id)
      inInitiative.names.add(r.name)
    }
    const counted = rows.filter(r => !r.failed)
    const olds = counted.filter(r => r.old && r.at !== null).map(r => r.at!)
    initiatives.push({
      key: e.collapseKey,
      name,
      failed: null,
      projects: rows,
      counted: counted.length,
      enumerated: rows.length,
      done: counted.reduce((a, r) => a + r.done, 0),
      total: counted.reduce((a, r) => a + r.total, 0),
      inProgress: counted.reduce((a, r) => a + r.inProgress, 0),
      remaining: counted.reduce((a, r) => a + r.total - r.done, 0),
      ready: sumNullable(counted.map(r => r.ready)),
      blocked: sumNullable(counted.map(r => r.blocked)),
      partial: counted.length < rows.length,
      oldestAt: olds.length === 0 ? null : Math.min(...olds),
    })
  }

  // Projects the focus lists directly, and its milestones and tickets, apart from those an initiative holds.
  const loose: FocusProject[] = []
  for (const s of selectors) {
    if (s.kind === 'project') {
      const row = project({ ref: s.ref, id: isUuid(s.ref) ? s.ref : '', name: s.label ?? `project ${short(s.ref)}` }, s.label)
      if (!((row.id !== null && inInitiative.ids.has(row.id)) || (row.id === null && inInitiative.names.has(row.name)))) loose.push(row)
    } else if (s.kind === 'milestone' || s.kind === 'ticket') {
      const key = selectorKey(s)
      const outcome = refresh?.outcomes[key]
      const found = records[key]
      const usable = found !== undefined && isUsable(found, now)
      const fail = outcome?.ok === false ? outcome.error : null
      let row: FocusProject
      if (outcome?.ok === true) row = rowFrom(s.label ?? outcome.rows[0]!.name, key, s.ref, outcome.rows[0]!, null, outcome.at, false)
      else if (usable) {
        touched.add(key)
        row = rowFrom(s.label ?? found.name ?? selectorName(s), key, s.ref, recordRow(found), null, found.at_ms, true)
      } else row = { ...rowFrom(selectorName(s), key, s.ref, { done: 0, total: 0, inProgress: 0, ready: null, blocked: null }, null, null, false), failed: true }
      if (fail !== null) warned.set(`unit:${key}`, { kind: 'project', name: row.name, text: fail, id: null })
      loose.push(row)
    }
  }

  const warnings: FocusWarning[] = []
  const src = refresh?.sourceError ?? sourceError
  if (src !== null) warnings.push({ kind: 'source', name: 'ix-board', text: src, id: null })
  if (refresh?.roadmapError != null) warnings.push({ kind: 'source', name: 'ix-board roadmap', text: refresh.roadmapError, id: null })
  warnings.push(...[...warned.values()].sort((a, b) => Number(a.kind === 'project') - Number(b.kind === 'project')))

  // The header sums each distinct project once.
  const counted = [...identities.values()].filter(r => !r.failed)
  const enumerated = identities.size
  const notExpanded = initiatives.filter(i => i.failed !== null).length
  let header: FocusHeader | null = null
  if (counted.length > 0) {
    const stages: Record<string, number> = {}
    for (const r of counted) for (const [k, v] of Object.entries(r.stages ?? {})) stages[k] = (stages[k] ?? 0) + v
    const olds = counted.filter(r => r.old && r.at !== null).map(r => r.at!)
    const done = counted.reduce((a, r) => a + r.done, 0)
    const total = counted.reduce((a, r) => a + r.total, 0)
    const partial = counted.length < enumerated || notExpanded > 0
    const oldestAt = olds.length === 0 ? null : Math.min(...olds)
    header = {
      done,
      total,
      inProgress: counted.reduce((a, r) => a + r.inProgress, 0),
      remaining: total - done,
      ready: sumNullable(counted.map(r => r.ready)),
      blocked: sumNullable(counted.map(r => r.blocked)),
      stages: Object.entries(stages),
      counted: counted.length,
      enumerated,
      notExpanded,
      partial,
      oldestAt,
      complete: !partial && oldestAt === null && total > 0 && done >= total,
    }
  }
  return { initiatives, loose, header, warnings, fetchedAt: refresh?.at ?? null, touched: [...touched] }
}

/** The key `/factory show` finds a warning's last success under: the record key of a project. */
export const projectKeyOfWarning = (w: FocusWarning): string => (w.id !== null ? projectKey(w.id) : `${w.kind}:${w.name}`)
