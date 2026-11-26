import type { EngineInterface } from 'claude-code'

import type { FocusHeader, FocusInitiative, FocusProject, FocusWarning, WorkBoard } from '../types'
import { gatedBoard } from './linear'
import { MEMBERSHIP_MS, RETRY_MS, findRecord, isUsable, isUuid, keyOf, nameFor, projectKey, readBad, saveBad } from './progress'
import type { Bad, BadEntry, Initiatives, Member, Membership, ProgressFile, ProgressRecord, ProjectRef, Records } from './progress'
import { after, errorText } from './shared'
import { boardOf, mergeBoards } from './work'

// Progress of a focus: one combined `ix-board focus status` call over all its healthy projects. An
// initiative is first expanded to its projects (the membership remembered in progress.json, else the
// roadmap or one initiative call). A project that makes the combined call fail is searched for, remembered
// as known bad, left out of the combined call and asked again on its own now and then.

export type SelectorKind = 'initiative' | 'project' | 'milestone' | 'ticket'

/** One initiative, project, milestone or ticket of the shown focus. */
export type Selector = { kind: SelectorKind; ref: string; /** the milestone's project */ project?: string; label?: string }

// ix-board answered 19 projects together in 2.7 to 4.6 s, one in up to 7 s and the roadmap in 3.4 s when measured, so a call may take 20 s.
export const CALL_TIMEOUT_MS = 20_000
export const REFRESH_BUDGET_MS = 60_000
export const CONCURRENCY = 4
/** The most further calls one refresh makes to find the projects that fail a combined call. */
export const SEARCH_CALLS = 12

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

/** Runs `run`, which starts one ix-board process, when one of the CONCURRENCY places is free. */
export async function limited<T>(run: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await run()
  } finally {
    release()
  }
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
  /** by call key: `project:<ref>` for each project asked for or answered by an initiative call, else the selector key */
  outcomes: Record<string, Outcome>
  /** distinct open blockers over every status answer of the refresh; null where an answer did not say */
  blockers: number | null
  /** true where another session is reading the roadmap and nothing of it is at hand: the refresh is asked again soon */
  pending?: boolean
  /** true where the source error is inferred from refusals that could as well be a project's doing */
  unproven?: boolean
  /** the tickets and activity of every status answer of the refresh, for the Work tab; absent where none answered */
  board?: WorkBoard
  /** the WORK_SHAPE of the build that made the refresh; absent from an older one */
  work?: number
}

/**
 * The version of what a refresh keeps for the Work tab. A cached refresh of another version, such as one a session
 * running an older build wrote to the shared gate, is read again. Raise it when `board` gains something.
 */
export const WORK_SHAPE = 1

/** A rate limit of Linear: it holds the whole workspace, so it is thrown for the gate to hold every call. */
export class SourceFailure extends Error {
  /** What the refresh had answered before the rate limit, so it is drawn and recorded. */
  partial: Refresh | null = null
}

type StatusProject = { id?: string; identifier?: string; name?: string; progress?: { done?: number; total?: number }; in_progress?: unknown[]; open_by_state?: { state?: string; count?: number }[] }
type Blocker = { identifier?: string; classification?: string }
type Status = { fetched_at?: number; ready_queue?: { project?: string }[]; blocker_layers?: Blocker[][]; projects?: StatusProject[] }

// Only explicit words: a ticket id such as QSL-403 is not an authorisation failure.
const AUTH = /unauthori[sz]ed|forbidden|authenticat|authori[sz]ation|api key|\btoken\b|not logged in|credential/i
const RATE = /rate limit/i
const TIMEOUT = /timed out/i
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** The project an ix-board error names, as in `references unavailable milestone m in project <uuid>`. */
const NAMED_PROJECT = /in project ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
/** Whether an initiative call's error says that the initiative itself is not found, and not some other thing that is. */
const notFoundInitiative = (error: string): boolean => /initiative/i.test(error) && /not found|no such|unknown/i.test(error)

const lastLine = (text: string): string => text.trim().split('\n').filter(Boolean).pop() ?? ''

function parse(text: string): Status {
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
  // An older ix-board wrapped the answer in a `result` key.
  const inner = (parsed as { result?: unknown }).result
  if (!('projects' in parsed) && typeof inner === 'object' && inner !== null && !Array.isArray(inner)) return inner as Status
  return parsed as Status
}

/** The blocker entries not classified Completed, or null where the answer has no blocker layers. */
const openBlockers = (status: Status): Blocker[] | null =>
  Array.isArray(status.blocker_layers) ? status.blocker_layers.flat().filter(e => e?.classification !== 'Completed') : null

const stagesOf = (p: StatusProject): Record<string, number> | null => {
  if (!Array.isArray(p.open_by_state)) return null
  const stages: Record<string, number> = {}
  for (const s of p.open_by_state) if (typeof s?.state === 'string' && typeof s.count === 'number') stages[s.state] = (stages[s.state] ?? 0) + s.count
  return stages
}

/**
 * The rows of an answer. `alone` is an answer to a call for one project that holds one project: the whole ready queue
 * and every blocker are its own. Otherwise the ready queue is split by project name (not at all where two projects share
 * one, nor where an entry names none) and no blocker is given to a project, since an answer does not say whose a blocker is.
 */
function rowsOf(status: Status, alone: boolean): Row[] {
  const projects = status.projects ?? []
  const blocked = openBlockers(status)
  return projects.map(p => {
    const done = p.progress?.done ?? 0
    const total = p.progress?.total ?? 0
    const shared = projects.filter(o => o.name === p.name).length > 1
    const queue = Array.isArray(status.ready_queue) ? status.ready_queue : null
    const ready = queue === null ? null : alone ? queue.length : shared || queue.some(r => typeof r?.project !== 'string') ? null : queue.filter(r => r.project === p.name).length
    return {
      id: typeof p.id === 'string' ? p.id : null,
      identifier: typeof p.identifier === 'string' ? p.identifier : null,
      name: p.name ?? 'project',
      done,
      total,
      inProgress: Math.max(0, Math.min(p.in_progress?.length ?? 0, total - done)),
      ready,
      blocked: alone && blocked !== null ? blocked.length : null,
      stages: stagesOf(p),
    }
  })
}

/** A sum that is only known where every part is: a count with a part missing would read as the whole. */
const sumAll = (values: (number | null)[]): number | null => (values.length === 0 || values.some(v => v === null) ? null : values.reduce<number>((a, v) => a + v!, 0))

/** A milestone or ticket answer is one row: the sum of the projects it touches, with the answer's own queue and blockers. */
function unitRow(status: Status, name: string): Row {
  const rows = rowsOf(status, false)
  return {
    id: null,
    identifier: null,
    name,
    done: rows.reduce((a, r) => a + r.done, 0),
    total: rows.reduce((a, r) => a + r.total, 0),
    inProgress: rows.reduce((a, r) => a + r.inProgress, 0),
    ready: Array.isArray(status.ready_queue) ? status.ready_queue.length : null,
    blocked: openBlockers(status)?.length ?? null,
    stages: null,
  }
}

// ---------------------------------------------------------------- roadmap

type RoadmapProject = { id?: unknown; identifier?: unknown; name?: unknown; also_in?: unknown }
type RoadmapInitiative = { id?: unknown; identifier?: unknown; name?: unknown; projects?: RoadmapProject[] }
/** What one roadmap read left for every session: the initiatives, or why there are none. */
type RoadmapRead = { list?: RoadmapInitiative[]; error?: string }

const ROADMAP_KEY = 'roadmap'

const text = (v: unknown): v is string => typeof v === 'string' && v !== ''

/** The initiatives of a roadmap answer, with only the keys the mod reads. */
function roadmapInitiatives(json: unknown): RoadmapInitiative[] {
  const root = (json as { result?: unknown } | null)?.result ?? json
  const list = (root as { initiatives?: unknown } | null)?.initiatives
  if (!Array.isArray(list)) return []
  return (list as RoadmapInitiative[])
    .filter(i => typeof i === 'object' && i !== null && text(i.name))
    .map(i => ({ id: i.id, identifier: i.identifier, name: i.name, projects: (i.projects ?? []).map(p => ({ id: p.id, identifier: p.identifier, name: p.name, also_in: p.also_in })) }))
}

const projectRef = (p: RoadmapProject & { name: string }): ProjectRef => ({ ref: text(p.id) ? p.id : text(p.identifier) ? p.identifier : p.name, id: text(p.id) ? p.id : '', name: p.name })
const alsoIn = (p: RoadmapProject, name: unknown): boolean => Array.isArray(p.also_in) && (p.also_in as unknown[]).includes(name)

const projectsOf = (i: RoadmapInitiative): ProjectRef[] => (i.projects ?? []).flatMap(p => (text(p.name) ? [projectRef(p as RoadmapProject & { name: string })] : []))

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

/** What an initiative that failed lately is drawn as, with no call: its membership, else the guess of rule 4c, else why not. */
function expandHeld(s: Selector, memory: Initiatives, entry: BadEntry): Expansion {
  if (memory[s.ref] === undefined && entry.found !== undefined)
    return { key: selectorKey(s), collapseKey: entry.found.collapseKey, name: s.label ?? entry.found.name, via: 'identified', reason: null, error: null, projects: entry.found.projects }
  return { ...expandFromCache(s, memory, entry.notFound === true ? NOT_FOUND : null), error: entry.error }
}

const initiativeName = (s: Selector): string => s.label ?? `initiative ${short(s.ref)}`

/** The Linear names `ix-board roadmap` gives its initiatives and projects, by focus value; none where it cannot be read. Shared with the progress reads. */
export async function roadmapNames($: EngineInterface): Promise<Map<string, string>> {
  const read = await gatedBoard($, ROADMAP_KEY, async (): Promise<RoadmapRead> => {
    const ran = await limited(() => $.process.run(['ix-board', '--json', 'roadmap'], { timeoutMs: CALL_TIMEOUT_MS }))
    if (ran.exitCode !== 0) {
      const stderr = lastLine(ran.stderr)
      if (AUTH.test(stderr) || RATE.test(stderr)) throw new Error(stderr)
      return { error: stderr || lastLine(ran.stdout) || `ix-board exited ${ran.exitCode}` }
    }
    try {
      return { list: roadmapInitiatives(JSON.parse(ran.stdout)) }
    } catch {
      return { error: 'ix-board printed text that is not JSON' }
    }
  })
  const names = new Map<string, string>()
  for (const i of read.data?.list ?? []) {
    if (text(i.id)) names.set(`initiative:${i.id.toLowerCase()}`, String(i.name))
    for (const p of i.projects ?? []) if (text(p.id) && text(p.name)) names.set(`project:${p.id.toLowerCase()}`, p.name)
  }
  return names
}

/** The name `ix-board project-chunk` gives a project; null where it gives none. */
export async function projectName($: EngineInterface, id: string): Promise<string | null> {
  const read = await gatedBoard($, `project-name:${id}`, async (): Promise<{ name: string | null }> => {
    const ran = await limited(() => $.process.run(['ix-board', '--json', 'project-chunk', id], { timeoutMs: CALL_TIMEOUT_MS }))
    if (ran.exitCode !== 0) return { name: null }
    try {
      const chunk = JSON.parse(ran.stdout) as { name?: unknown }
      return { name: text(chunk.name) ? chunk.name : null }
    } catch {
      return { name: null }
    }
  })
  return read.data?.name ?? null
}

// ---------------------------------------------------------------- the refresh

const argv = (args: string[]): string[] => ['ix-board', '--json', ...args]

type Result = { ok: true; stdout: string } | { ok: false; error: string; timedOut?: true }
/** A selector that failed on its own in this refresh: it is remembered as known bad where the failure is its doing. */
type Suspect = { key: string; ref: string; project: boolean; error: string; named: boolean }

/**
 * Expands the initiatives, asks ix-board for all healthy projects in one call, and asks for each milestone, ticket and
 * known-bad selector that is due on its own: at most four processes at a time, the whole within the refresh budget. A
 * failing combined call is searched for the projects that fail it, in at most SEARCH_CALLS further calls. A source
 * error (ix-board missing, refusing the caller, rate limiting, or not answering) stops every further call and is
 * never laid on a selector. A manual refresh asks known-bad selectors and initiative memberships again.
 */
export async function refreshProgress($: EngineInterface, selectors: readonly Selector[], file: ProgressFile, endsAt?: number, manual = false): Promise<Refresh> {
  const memory = file.initiatives
  const started = await $.clock.now()
  const deadline = endsAt ?? started + REFRESH_BUDGET_MS
  const bad = await readBad($)
  const outcomes: Record<string, Outcome> = {}
  let sourceError: string | null = null
  /** Set with `sourceError` where it is inferred and not said by ix-board's own words. */
  let isUnproven = false
  let roadmapError: string | null = null
  let pending = false
  let answered = 0
  /** Names learned on the way for projects that may fail, by name. */
  const hints = new Map<string, Named>()
  /** Changes to the known-bad memory this refresh makes at its end. */
  const mark: Bad = {}
  const clear = new Set<string>()
  const touch = new Set<string>()
  /** Entries claimed for another try: put back where the try never happened because of a source error. */
  const claimed: Bad = {}

  const held = (entry: BadEntry): boolean => !manual && started - entry.at_ms < RETRY_MS
  /** Claims entries for a try now, so that no other session tries them in the same hour. */
  const claim = async (keys: readonly string[]): Promise<void> => {
    const set: Bad = {}
    for (const key of keys) {
      claimed[key] = bad[key]!
      set[key] = { ...bad[key]!, at_ms: started, seen_ms: started }
    }
    await saveBad($, started, { set })
  }

  /** One ix-board process, within the call timeout and the budget; a source error is recorded and stops the rest. */
  const ask = async (args: string[], many = false): Promise<Result> => {
    await acquire()
    try {
      if (sourceError !== null) return { ok: false, error: sourceError }
      const left = deadline - (await $.clock.now())
      if (left <= 0) return { ok: false, error: 'timed out', timedOut: true }
      let ran
      try {
        ran = await $.process.run(argv(args), { timeoutMs: Math.min(CALL_TIMEOUT_MS, left) })
      } catch (error) {
        const message = errorText(error)
        // A call for one thing that timed out after others answered is that thing's failure. A timed out call for
        // several projects is nobody's, and before any answer ix-board is not answering.
        if (TIMEOUT.test(message) && answered > 0 && !many) return { ok: false, error: 'timed out', timedOut: true }
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

  /** The name `ix-board project-chunk` gives a project, which works where its status call does not. */
  const chunkName = async (ref: string): Promise<Named | null> => {
    const result = await ask(['project-chunk', ref])
    if (!result.ok) return null
    try {
      const chunk = JSON.parse(result.stdout) as { name?: unknown; identifier?: unknown; id?: unknown }
      if (!text(chunk.name)) return null
      const identifier = typeof chunk.identifier === 'string' ? chunk.identifier : null
      const id = typeof chunk.id === 'string' ? chunk.id : isUuid(ref) ? ref : identifier !== null && isUuid(identifier) ? identifier : null
      return { id, identifier, name: chunk.name }
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- initiatives

  /**
   * The roadmap, read at most once in the gate's interval across all sessions. Null where it cannot be had: its own
   * failure is `roadmapError`, a source error stops the refresh, and a read another session holds leaves it pending.
   */
  const readRoadmap = async (): Promise<RoadmapInitiative[] | null> => {
    const read = await gatedBoard(
      $,
      ROADMAP_KEY,
      async (): Promise<RoadmapRead> => {
        const result = await ask(['roadmap'])
        if (result.ok) {
          try {
            return { list: roadmapInitiatives(JSON.parse(result.stdout)) }
          } catch {
            return { error: 'ix-board printed text that is not JSON' }
          }
        }
        if (sourceError !== null) throw new Error(sourceError)
        return { error: result.error }
      },
      { manual },
    )
    if (read.backoffUntil !== null) sourceError ??= `Linear rate limited; retry in ${Math.max(1, Math.ceil((read.backoffUntil - started) / 1000))}s`
    else if (read.error !== null) sourceError ??= read.error
    if (sourceError !== null) return null
    if (read.data === null) {
      pending = true
      return null
    }
    roadmapError = read.data.error ?? null
    return read.data.list ?? null
  }

  const initiatives = selectors.filter(s => s.kind === 'initiative')
  const resolved = new Map<string, Expansion>()
  const need: Selector[] = []
  for (const s of initiatives) {
    const key = selectorKey(s)
    const entry = bad[key]
    const known = memory[s.ref]
    if (!manual && known !== undefined && started - known.at_ms < MEMBERSHIP_MS) resolved.set(key, expandFromCache(s, memory, null))
    else if (entry !== undefined && held(entry)) {
      const expansion = expandHeld(s, memory, entry)
      const hint = entry.found === undefined ? undefined : entry.found.hint
      if (hint !== undefined) hints.set(hint.name, { id: hint.id, identifier: null, name: hint.name })
      resolved.set(key, expansion)
      touch.add(key)
    } else need.push(s)
  }

  let roadmap: RoadmapInitiative[] | null = null
  if (need.length > 0) roadmap = await readRoadmap()

  /**
   * Rule 4c. The roadmap initiative that holds the project an initiative call's error names, only when it is the one
   * initiative that holds it and is not itself selected. It is a guess, so it is drawn and never stored as membership.
   */
  const identify = async (s: Selector, error: string, list: RoadmapInitiative[]): Promise<{ found: NonNullable<BadEntry['found']> } | null> => {
    const named = NAMED_PROJECT.exec(error)
    if (named === null) return null
    const chunk = await chunkName(named[1]!)
    if (chunk === null) return null
    const name = chunk.name
    // An initiative holds the project when it lists it, or another initiative lists it as also_in this one.
    const holds = (i: RoadmapInitiative): boolean => (i.projects ?? []).some(p => p.name === name) || list.some(o => (o.projects ?? []).some(p => p.name === name && alsoIn(p, i.name)))
    const holders = list.filter(holds)
    if (holders.length !== 1) return null
    const found = holders[0]!
    if (selectors.some(o => o.kind === 'initiative' && o.ref !== s.ref && matchRoadmap(list, o.ref) === found)) return null
    hints.set(name, { id: named[1]!, identifier: null, name })
    const projects = projectsOf(found)
    for (const o of list)
      for (const p of o.projects ?? [])
        if (text(p.name) && alsoIn(p, found.name) && !projects.some(q => q.name === p.name)) projects.push({ ref: p.name, id: '', name: p.name })
    return { found: { name: String(found.name), collapseKey: isUuid(s.ref) ? s.ref : String(found.name), projects, hint: { id: named[1]!, name } } }
  }

  /** The rule 3 selectors: an id or identifier the roadmap does not place. */
  const third: Selector[] = []
  for (const s of need) {
    const key = selectorKey(s)
    const matched = sourceError !== null || roadmap === null ? undefined : matchRoadmap(roadmap, s.ref)
    if (matched !== undefined) {
      const projects = projectsOf(matched)
      // A project the roadmap lists under another initiative also_in this one belongs here too.
      for (const other of roadmap ?? [])
        for (const p of other.projects ?? [])
          if (text(p.name) && alsoIn(p, matched.name) && !projects.some(q => q.name === p.name)) projects.push(projectRef(p as RoadmapProject & { name: string }))
      resolved.set(key, { key, collapseKey: isUuid(s.ref) ? s.ref : String(matched.name), name: s.label ?? String(matched.name), via: 'roadmap', reason: null, error: null, projects })
      clear.add(key)
    } else if (sourceError !== null || roadmap === null) resolved.set(key, expandFromCache(s, memory, null))
    else if (isUuid(s.ref) || IDENTIFIER.test(s.ref)) third.push(s)
    else resolved.set(key, expandFromCache(s, memory, NOT_FOUND))
  }

  let blockers: Set<string> | null = new Set<string>()
  let statusAnswers = 0
  let succeeded = 0
  const answers: WorkBoard[] = []
  const collect = (status: Status): void => {
    answers.push(boardOf(status))
    statusAnswers++
    succeeded++
    const open = openBlockers(status)
    if (open === null) blockers = null
    else for (const e of open) blockers?.add(e.identifier ?? JSON.stringify(e))
  }

  // Rule 3: one initiative call for each selector the roadmap cannot place; its projects come with their progress.
  await claim(third.map(selectorKey).filter(k => bad[k] !== undefined))
  await all(
    third.map(async s => {
      const key = selectorKey(s)
      const result = await ask(['focus', 'status', '--initiative', s.ref])
      if (result.ok) {
        let status: Status | null = null
        try {
          status = parse(result.stdout)
        } catch {
          // falls through to the memory below
        }
        if (status !== null) {
          collect(status)
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
          resolved.set(key, { key, collapseKey: s.ref, name: s.label ?? (named !== undefined ? String(named.name) : initiativeName(s)), via: 'rule3', reason: null, error: null, projects })
          clear.add(key)
          return
        }
      }
      const error = result.ok ? 'ix-board printed text that is not JSON' : result.error
      const remembered = expandFromCache(s, memory, notFoundInitiative(error) ? NOT_FOUND : null)
      // Rule 4c: the error names the project with the dangling milestone; the initiative that holds a project of that name is this one.
      const guess = sourceError === null && remembered.via === 'none' && roadmap !== null ? await identify(s, error, roadmap) : null
      const entry: BadEntry = { at_ms: started, seen_ms: started, error, ...(remembered.reason === NOT_FOUND ? { notFound: true } : {}), ...(guess ?? {}) }
      if (sourceError !== null) {
        if (claimed[key] !== undefined) mark[key] = claimed[key]!
      } else if (result.ok || result.timedOut !== true) mark[key] = entry
      resolved.set(key, guess !== null ? expandHeld(s, memory, entry) : { ...remembered, error })
    }),
  )
  const expansions = initiatives.map(s => resolved.get(selectorKey(s)) ?? { ...expandFromCache(s, memory, null), error: 'timed out' })

  // ---------------------------------------------------------------- projects, milestones and tickets

  /** Every distinct project ref, with what the expansion that lists it knows of it. */
  const members = new Map<string, ProjectRef | null>()
  for (const s of selectors) if (s.kind === 'project') members.set(s.ref, null)
  for (const e of expansions) for (const p of e.projects) if (members.get(p.ref) == null) members.set(p.ref, p)

  const idOf = (ref: string): string => (isUuid(ref) ? ref : members.get(ref)?.id || nameFor(file, ref)?.id || hints.get(ref)?.id || '')
  const nameOf = (ref: string): string | undefined => members.get(ref)?.name ?? nameFor(file, ref)?.name ?? [...hints.values()].find(h => h.id === ref)?.name ?? hints.get(ref)?.name
  /** The known-bad entries of a project, under whichever of its id and name they were made. */
  const badKeys = (ref: string): string[] => {
    const id = idOf(ref).toLowerCase()
    return Object.entries(bad)
      .filter(([key, e]) => key.startsWith('project:') && (key === projectKey(ref) || (id !== '' ? e.id?.toLowerCase() === id || key.toLowerCase() === projectKey(id) : e.name === ref)))
      .map(([key]) => key)
  }

  const healthy: string[] = []
  const retries: string[] = []
  /** A name ref whose project is also listed by id: asked once, by the id. */
  const twins = new Map<string, string>()
  for (const ref of members.keys()) {
    if (outcomes[projectKey(ref)] !== undefined) {
      for (const k of badKeys(ref)) clear.add(k)
      continue
    }
    const id = idOf(ref)
    if (!isUuid(ref) && id !== '' && id !== ref && members.has(id)) {
      twins.set(ref, id)
      continue
    }
    const keys = badKeys(ref)
    if (keys.length === 0) {
      healthy.push(ref)
      continue
    }
    const latest = keys.map(k => bad[k]!).reduce((a, b) => (b.at_ms > a.at_ms ? b : a))
    if (held(latest)) {
      const name = latest.name ?? nameOf(ref)
      outcomes[projectKey(ref)] = { ok: false, error: latest.error, ...(name === undefined ? {} : { named: { id: latest.id ?? null, identifier: null, name } }) }
      for (const k of keys) touch.add(k)
    } else retries.push(ref)
  }

  const units: Selector[] = []
  for (const s of selectors) {
    if (s.kind !== 'milestone' && s.kind !== 'ticket') continue
    const key = selectorKey(s)
    const entry = bad[key]
    if (entry !== undefined && held(entry)) {
      outcomes[key] = { ok: false, error: entry.error }
      touch.add(key)
    } else units.push(s)
  }

  const suspects: Suspect[] = []
  const suspect = (ref: string, error: string, named: boolean): void => {
    outcomes[projectKey(ref)] = { ok: false, error }
    suspects.push({ key: projectKey(ref), ref, project: true, error, named })
  }
  const fail = (refs: readonly string[], error: string): void => {
    for (const ref of refs) outcomes[projectKey(ref)] ??= { ok: false, error }
  }
  const notIsolated = (error: string): string => `not isolated: ${error}`

  /** Records the answer to a call for these projects. */
  const answer = async (refs: readonly string[], status: Status): Promise<void> => {
    collect(status)
    const rows = rowsOf(status, refs.length === 1 && status.projects?.length === 1)
    const at = await $.clock.now()
    const taken = new Set<Row>()
    const matches = new Map<string, Row>()
    if (refs.length === 1) {
      if (rows.length === 1) matches.set(refs[0]!, rows[0]!)
      else fail(refs, rows.length === 0 ? 'ix-board answered no project' : `ix-board answered ${rows.length} projects for ${refs[0]}`)
    } else {
      const take = (ref: string, row: Row | undefined): void => {
        if (row === undefined || matches.has(ref)) return
        matches.set(ref, row)
        taken.add(row)
      }
      for (const ref of refs) take(ref, rows.find(r => !taken.has(r) && ((r.id !== null && same(r.id, ref)) || r.identifier === ref)))
      for (const ref of refs) take(ref, rows.find(r => !taken.has(r) && r.name === ref))
      // ix-board accepts refs it does not repeat; one ref and one project left over belong together.
      const unmatched = refs.filter(r => !matches.has(r))
      const spare = rows.filter(r => !taken.has(r))
      if (unmatched.length === 1 && spare.length === 1) take(unmatched[0]!, spare[0])
      for (const ref of refs) if (!matches.has(ref)) fail([ref], `ix-board answered no project for ${ref}`)
    }
    for (const [ref, row] of matches) {
      const ok: Outcome = { ok: true, at, rows: [row] }
      outcomes[projectKey(ref)] = ok
      for (const k of [row.id, row.identifier]) if (k !== null) outcomes[projectKey(k)] ??= ok
      for (const k of badKeys(ref)) clear.add(k)
    }
  }

  let spent = 0
  /** Takes calls from the search's allowance, all or none. */
  const spend = (calls: number): boolean => {
    if (spent + calls > SEARCH_CALLS) return false
    spent += calls
    return true
  }
  const group = (refs: readonly string[]): Promise<Result> => ask(['focus', 'status', ...refs.flatMap(r => ['--project', r])], refs.length > 1)

  /** Several projects whose one call was refused. */
  type Refused = { refs: readonly string[]; error: string }
  type Call = { refs: readonly string[]; result: Result }

  /** What follows one call for these projects: their answers, the failure of the one, or the several still to be searched. */
  const settle = async (refs: readonly string[], result: Result): Promise<Refused | null> => {
    if (result.ok) {
      let status: Status | null = null
      try {
        status = parse(result.stdout)
      } catch {
        fail(refs, 'ix-board printed text that is not JSON')
      }
      if (status !== null) await answer(refs, status)
      return null
    }
    if (sourceError !== null) return null
    if (result.timedOut === true) fail(refs, 'timed out')
    else if (refs.length === 1) suspect(refs[0]!, result.error, false)
    else return { refs, error: result.error }
    return null
  }

  /** The one ref among these that the error names as the project at fault, by id or else by that project's name. */
  const offender = async (refs: readonly string[], error: string): Promise<string | null> => {
    const named = NAMED_PROJECT.exec(error)
    if (named === null) return null
    const id = named[1]!
    const byId = refs.find(r => same(idOf(r), id))
    if (byId !== undefined) return byId
    // Only a ref with no known id can still be that project, under its name.
    const open = refs.filter(r => idOf(r) === '')
    if (open.length === 0) return null
    let name = nameFor(file, id)?.name ?? [...hints.values()].find(h => h.id === id)?.name
    if (name === undefined && spend(1)) {
      const chunk = await chunkName(id)
      if (chunk !== null) name = chunk.name
    }
    if (name === undefined) return null
    const byName = open.filter(r => r === name || members.get(r)?.name === name)
    if (byName.length !== 1) return null
    hints.set(byName[0]!, { id, identifier: null, name })
    return byName[0]!
  }

  /** The calls that take a refused group apart: the others without the project its error names, else its two halves. */
  const split = async ({ refs, error }: Refused): Promise<Call[]> => {
    const guilty = await offender(refs, error)
    if (sourceError !== null) return []
    if (guilty !== null) suspect(guilty, error, true)
    const middle = Math.ceil(refs.length / 2)
    const parts = guilty !== null ? [refs.filter(r => r !== guilty)] : [refs.slice(0, middle), refs.slice(middle)]
    if (!spend(parts.length)) {
      fail(parts.flat(), notIsolated(error))
      return []
    }
    return Promise.all(parts.map(async part => ({ refs: part, result: await group(part) })))
  }

  /**
   * Finds the projects that fail a call for several, one level of splits at a time. While no status call has answered,
   * a second or later level refused throughout with the very same words, which name nothing, is ix-board's trouble
   * and not a project's, and the search ends there. The first level proves nothing: one bad project in each half
   * reads the same.
   */
  const search = async (first: Refused): Promise<void> => {
    let level = [first]
    for (let depth = 1; level.length > 0; depth++) {
      const calls = (await Promise.all(level.map(split))).flat()
      // The answers of a level are recorded before its refusals are judged, and before a source error ends the search.
      for (const c of calls) if (c.result.ok) await settle(c.refs, c.result)
      if (sourceError !== null) return
      const refusals = calls.flatMap(c => (!c.result.ok && c.result.timedOut !== true ? [c.result.error] : []))
      const alike = refusals.length > 1 && refusals.length === calls.length && refusals.every(e => e === refusals[0]) && !UUID_IN.test(refusals[0]!)
      if (depth > 1 && succeeded === 0 && alike) {
        sourceError ??= refusals[0]!
        isUnproven = true
        return
      }
      level = []
      for (const c of calls) {
        if (c.result.ok) continue
        const refused = await settle(c.refs, c.result)
        if (refused !== null) level.push(refused)
      }
    }
  }

  /** The error of the call for all healthy projects, where ix-board refused it. */
  let refusal: string | null = null
  const combined = async (refs: readonly string[]): Promise<void> => {
    const result = await group(refs)
    if (!result.ok && result.timedOut !== true && sourceError === null) refusal = result.error
    const refused = await settle(refs, result)
    if (refused !== null) await search(refused)
  }
  /** Whether an error itself shows this project to be at fault: it names it, by its id or a ref long enough to mean it. */
  const provenBy = (x: Suspect): boolean => {
    const token = (x.project ? idOf(x.ref) : '') || x.ref
    return x.named || (token.length >= 8 && x.error.includes(token))
  }

  const unit = async (s: Selector): Promise<void> => {
    const key = selectorKey(s)
    const result = await ask(['focus', 'status', ...selectorArgs(s)])
    if (!result.ok) {
      if (sourceError !== null) return
      outcomes[key] = { ok: false, error: result.error }
      if (result.timedOut !== true) suspects.push({ key, ref: s.ref, project: false, error: result.error, named: false })
      return
    }
    let status: Status
    try {
      status = parse(result.stdout)
    } catch {
      outcomes[key] = { ok: false, error: 'ix-board printed text that is not JSON' }
      return
    }
    collect(status)
    const rows = status.projects ?? []
    const name = s.label ?? (rows.length === 1 && rows[0]!.name !== undefined ? rows[0]!.name : selectorName(s))
    learned.set(key, name)
    outcomes[key] = { ok: true, at: await $.clock.now(), rows: [unitRow(status, name)] }
    clear.add(key)
  }

  if (sourceError === null) {
    await claim([...new Set(retries.flatMap(badKeys)), ...units.map(selectorKey).filter(k => bad[k] !== undefined)])
    await all([
      ...(healthy.length === 0 ? [] : [combined(healthy)]),
      ...retries.map(ref => group([ref]).then(r => settle([ref], r))),
      ...units.map(unit),
    ])
  }

  // The healthy projects were refused and no status call of the refresh answered: unless the errors themselves name
  // every one of them, nothing shows a project to be at fault. That is a source error: nothing is laid on or
  // remembered of any.
  if (sourceError === null && refusal !== null && succeeded === 0 && !healthy.every(ref => suspects.some(x => x.project && x.ref === ref && provenBy(x)))) {
    sourceError = refusal
    isUnproven = true
    suspects.length = 0
    for (const ref of healthy) delete outcomes[projectKey(ref)]
  }

  // A project nobody has ever named is asked for its name alone, once.
  const unnamed = suspects.filter(x => x.project && nameFor(file, x.ref) === undefined && hints.get(x.ref) === undefined && ![...hints.values()].some(h => h.id === x.ref))
  const chunks = new Map<string, Named>()
  if (sourceError === null)
    await all(
      unnamed.map(async x => {
        const chunk = await chunkName(x.ref)
        if (chunk !== null) chunks.set(x.ref, chunk)
      }),
    )

  const at = await $.clock.now()
  // A selector is known bad where it failed on its own and the failure is shown to be its doing: the error names it,
  // or ix-board answered another status call of this refresh.
  for (const x of suspects) {
    const learnt = x.project ? (chunks.get(x.ref) ?? hints.get(x.ref) ?? [...hints.values()].find(h => h.id === x.ref)) : undefined
    const name = x.project ? (learnt?.name ?? nameOf(x.ref)) : undefined
    const id = x.project ? idOf(x.ref) || learnt?.id || '' : ''
    if (x.project && name !== undefined) outcomes[x.key] = { ok: false, error: x.error, named: { id: id === '' ? null : id, identifier: learnt?.identifier ?? null, name } }
    const known = x.project ? badKeys(x.ref).length > 0 : bad[x.key] !== undefined
    const token = id !== '' ? id : x.ref
    if (known || x.named || succeeded > 0 || (token.length >= 8 && x.error.includes(token)))
      mark[x.key] = { at_ms: at, seen_ms: at, error: x.error, ...(id === '' ? {} : { id }), ...(name === undefined ? {} : { name }) }
  }
  // A try that a source error cut off did not happen: its claim is put back.
  if (sourceError !== null)
    for (const [key, entry] of Object.entries(claimed)) if (mark[key] === undefined && !clear.has(key)) mark[key] = entry
  for (const key of clear) delete mark[key]
  await saveBad($, at, { set: mark, clear: [...clear].filter(k => bad[k] !== undefined), touch: [...touch] })

  // A project or unit unanswered at the end of the budget has failed.
  if (sourceError === null) for (const ref of members.keys()) if (!twins.has(ref)) outcomes[projectKey(ref)] ??= { ok: false, error: 'timed out' }
  for (const [ref, id] of twins) if (outcomes[projectKey(id)] !== undefined) outcomes[projectKey(ref)] = outcomes[projectKey(id)]!
  if (sourceError === null) for (const s of selectors) if (s.kind === 'milestone' || s.kind === 'ticket') outcomes[selectorKey(s)] ??= { ok: false, error: 'timed out' }

  const refresh: Refresh = { work: WORK_SHAPE, at, roadmapError, sourceError, expansions, outcomes, blockers: statusAnswers === 0 || blockers === null ? null : (blockers as Set<string>).size, ...(pending ? { pending: true } : {}), ...(isUnproven ? { unproven: true } : {}), ...(answers.length > 0 ? { board: mergeBoards(answers) } : {}) }
  if (sourceError !== null && RATE.test(sourceError)) {
    const limited = new SourceFailure(sourceError)
    limited.partial = refresh
    throw limited
  }
  return refresh
}

// ---------------------------------------------------------------- records

const recordOf = (r: Row, at: number, now: number): ProgressRecord => ({
  at_ms: at,
  seen_ms: now,
  done: r.done,
  total: r.total,
  inProgress: r.inProgress,
  ...(r.ready !== null ? { ready: r.ready } : {}),
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
        mine[projectKey(n.id)] = { at_ms: refresh.at, seen_ms: now, done: 0, total: 0, inProgress: 0, unknown: true, id: n.id, ...(n.identifier !== null ? { identifier: n.identifier } : {}), name: n.name }
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
      return { id: row?.id ?? namedOf(refresh, p)?.id ?? p.id, name: p.name }
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

const recordRow = (r: ProgressRecord) => ({ done: r.done, total: r.total, inProgress: r.inProgress, ready: r.ready ?? null, blocked: r.blocked ?? null })

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
      ready: sumAll(counted.map(r => r.ready)),
      blocked: sumAll(counted.map(r => r.blocked)),
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
      ready: sumAll(counted.map(r => r.ready)),
      // One project's own count, else the distinct open blockers of this refresh's answers, which cover every row only
      // while none of them is drawn from a record.
      blocked: counted.length === 1 && counted[0]!.blocked !== null ? counted[0]!.blocked : counted.every(r => !r.old) ? (refresh?.blockers ?? null) : null,
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
