import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FocusMeta, FocusView, WorkActivity, WorkAgent, WorkBoard, WorkFeed, WorkIssue, WorkLanes, WorkLead, WorkPr, WorkRoleEvent } from '../types'
import { parseRef } from './focuschoice'
import { isUuid } from './progress'

// The model of the Work tab: what each lead has in hand, from the relay's work reports, joined with what
// ix-board's focus status says of the tickets and of what was merged lately.

/** The ticket and activity facts of every focus status answer, by progress key; hooks/progressview.ts fills it. */
const workBoards = atom({ plugin: 'factory-panel', key: 'workBoards' } as const, {} as Record<string, WorkBoard>, { shape: 'workBoards-2' })
/** What `ix-board issues` says of the reported tickets no focus status names; hooks/workview.tsx fills it. */
const workTickets = atom({ plugin: 'factory-panel', key: 'workTickets' } as const, null as WorkBoard | null, { shape: 'workTickets-1' })

/** The focus status answers held. */
export async function focusBoards($: EngineInterface): Promise<WorkBoard[]> {
  return Object.values(await read($, workBoards))
}

/** Every answer held: those of the focuses, then the read of single tickets. */
export async function readBoards($: EngineInterface): Promise<WorkBoard[]> {
  const tickets = await read($, workTickets)
  return [...(await focusBoards($)), ...(tickets === null ? [] : [tickets])]
}

export async function holdTickets($: EngineInterface, change: (held: WorkBoard | null) => WorkBoard | null): Promise<void> {
  await update($, workTickets, change)
}

/** What one progress read of a focus said: its answer where it has one, when that was read, and why it failed. */
export type BoardRead = { board: WorkBoard | null; at: number | null; error: string | null }

/**
 * Holds what a focus's progress read said. A read with no answer keeps the one held, with its age, and says why; a
 * focus that never answered is held too, so that its merges are known to be missing.
 */
export async function holdBoard($: EngineInterface, key: string, got: BoardRead): Promise<void> {
  await update($, workBoards, held => {
    const prior = held[key]
    const next: WorkBoard = got.board !== null ? { ...got.board, at: got.at, error: got.error } : prior !== undefined ? { ...prior, error: got.error ?? prior.error ?? null } : { issues: [], activity: null, at: null, error: got.error }
    return { ...held, [key]: next }
  })
}

/** Drops the answers of focuses that are no longer shown. */
export async function keepBoards($: EngineInterface, keys: ReadonlySet<string>): Promise<void> {
  await update($, workBoards, held => Object.fromEntries(Object.entries(held).filter(([k]) => keys.has(k))))
}

// ---------------------------------------------------------------- reading ix-board's answer

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const KINDS = ['merged', 'closed', 'opened'] as const

/** The most entries ix-board puts in `activity[]`, newest first; an answer this long may have left older ones out. */
export const ACTIVITY_CAP = 200

/** Milliseconds since the epoch of a number or an ISO time; null for anything else. */
const timeOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

const prOf = (v: unknown): WorkPr | null => {
  const o = obj(v)
  if (o === null) return null
  return { url: str(o.url), repo: str(o.repo), number: typeof o.number === 'number' ? o.number : null, status: str(o.status) || 'unknown', draft: o.draft === true }
}

const issueOf = (v: unknown): WorkIssue | null => {
  const o = obj(v)
  const identifier = str(o?.identifier)
  if (o === null || identifier === '') return null
  return { identifier, title: str(o.title), state: str(o.state), prs: Array.isArray(o.prs) ? o.prs.flatMap(p => prOf(p) ?? []) : null }
}

/** An id of an answer: null where it says there is none, absent where it says nothing. */
const idOf = (o: Record<string, unknown>, key: string): string | null | undefined => (o[key] === null ? null : str(o[key]) || undefined)

const activityOf = (v: unknown): WorkActivity | null => {
  const o = obj(v)
  const at = timeOf(o?.at)
  const kind = KINDS.find(k => k === o?.kind)
  if (o === null || at === null || kind === undefined) return null
  const pr = obj(o.pr)
  return { at, kind, identifier: str(o.identifier), title: str(o.title), project: str(o.project), repo: pr === null ? null : str(pr.repo) || null, number: typeof pr?.number === 'number' ? pr.number : null }
}

/**
 * The tickets and activity of one `ix-board --json focus status` answer: the started and recently closed tickets of every
 * project, milestone and unmilestoned group, and the top-level `activity[]`. An answer wrapped in a stale `result` key is
 * read as the object inside. `activity` is null where the answer has no such key (an ix-board older than 0.9.0).
 */
export function boardOf(answer: unknown): WorkBoard {
  const top = obj(answer)
  const status = obj(top?.result) ?? top
  const issues = new Map<string, WorkIssue>()
  const take = (items: unknown): void => {
    for (const item of list(items)) {
      const issue = issueOf(item)
      if (issue === null) continue
      const had = issues.get(issue.identifier)
      issues.set(issue.identifier, had === undefined || (had.prs === null && issue.prs !== null) ? issue : had)
    }
  }
  for (const p of list(status?.projects)) {
    const project = obj(p)
    if (project === null) continue
    const groups = [project, obj(project.unmilestoned), ...list(project.milestones).map(obj)]
    for (const g of groups) {
      take(g?.in_progress)
      take(g?.recently_closed)
    }
  }
  const activity = Array.isArray(status?.activity) ? status.activity.flatMap(a => activityOf(a) ?? []).sort((a, b) => b.at - a.at) : null
  const isCut = Array.isArray(status?.activity) && status.activity.length >= ACTIVITY_CAP
  const oldest = activity?.at(-1)?.at
  return { issues: [...issues.values()], activity, ...(isCut && oldest !== undefined ? { cutAt: oldest } : {}) }
}

/** An answer read longer ago than this is old: the gate asks again after 30 minutes. */
export const BOARD_OLD_MS = 35 * 60 * 1000
/** A lead's report older than this says what it did, not what it does. */
export const REPORT_OLD_MS = 2 * 60 * 60 * 1000

export const isOldAt = (at: number | null | undefined, now: number): boolean => at !== null && at !== undefined && now - at > BOARD_OLD_MS
export const isOldReport = (reportedAt: number | null, now: number): boolean => reportedAt !== null && now - reportedAt > REPORT_OLD_MS

/**
 * The union of several answers: a ticket once, from the newest answer that has its PRs, with that answer's time;
 * activity once, newest first.
 */
export function mergeBoards(boards: readonly WorkBoard[]): WorkBoard {
  const issues = new Map<string, WorkIssue>()
  // An answer with no time of its own is one just read.
  const newestFirst = [...boards].sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity))
  for (const b of newestFirst)
    for (const i of b.issues) {
      const had = issues.get(i.identifier)
      if (had === undefined || (had.prs === null && i.prs !== null)) issues.set(i.identifier, b.at === undefined ? i : { ...i, at: b.at })
    }
  const withActivity = boards.filter(b => b.activity !== null)
  const seen = new Set<string>()
  const activity = withActivity.length === 0 ? null : withActivity.flatMap(b => b.activity!).filter(a => {
    const key = `${a.kind} ${a.identifier} ${a.repo}#${a.number} ${a.at}`
    return seen.has(key) ? false : (seen.add(key), true)
  }).sort((a, b) => b.at - a.at)
  // One cut answer leaves the union short from its own cut on back.
  const cuts = boards.flatMap(b => b.cutAt ?? [])
  return { issues: [...issues.values()], activity, ...(cuts.length === 0 ? {} : { cutAt: Math.max(...cuts) }) }
}

/** What `ix-board issues` takes: a ticket identifier; a lead may report other words. */
export const TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/

/** The identifiers an `ix-board --json issues` answer says Linear has no record of. */
export function unknownOf(answer: unknown): string[] {
  const top = obj(answer)
  const missing = (obj(top?.result) ?? top)?.missing
  return Array.isArray(missing) ? missing.flatMap(v => str(v) || []) : []
}

/** The tickets of one `ix-board --json issues` answer. A ticket whose attachments are cut short says nothing of its PRs. */
export function issuesOf(answer: unknown): WorkIssue[] {
  const top = obj(answer)
  const body = obj(top?.result) ?? top
  if (!Array.isArray(body?.issues)) throw new Error('the answer is not a list of issues')
  return list(body.issues).flatMap(v => {
    const o = obj(v)
    if (o === null) return []
    const issue = issueOf({ ...o, state: str(o.state_name) || str(o.state), prs: o.attachments_complete === false ? null : o.pull_requests })
    const prTimes = list(o.pull_requests).flatMap(p => [timeOf(obj(p)?.created_at), timeOf(obj(p)?.merged_at)]).filter((t): t is number => t !== null)
    return issue === null ? [] : [{ ...issue, project: idOf(o, 'project_id'), milestone: idOf(o, 'project_milestone_id'), stateType: str(o.state_type), updatedAt: timeOf(o.updated_at), prAt: prTimes.length === 0 ? null : Math.max(...prTimes) }]
  })
}

// ---------------------------------------------------------------- composing the view

/** Where a ticket stands: `unread` where nothing says, which is never guessed. */
export type TicketState = 'done' | 'review' | 'working' | 'new' | 'unread' | 'canceled'

/** The states a bar draws, in its order. A canceled ticket is neither work done nor work left: it is not drawn. */
export const BAR_STATES = ['done', 'review', 'working', 'new', 'unread'] as const
export type BarState = (typeof BAR_STATES)[number]

/** The order tickets are listed in under their project: those moving first, those finished last. */
const LISTED: Record<TicketState, number> = { working: 0, review: 1, new: 2, unread: 3, done: 4, canceled: 5 }

export type WorkTicket = {
  id: string
  state: TicketState
  /** its project's id; null in none, undefined where not said */
  project?: string | null
  title: string
  /** why there is no title, where ix-board has answered or failed: unknown to Linear, or not read; else null */
  why: string | null
  badges: string[]
  /** when the ticket was last acted on or named; null where nothing says */
  at: number | null
}

/** `tickets` are every ticket the lead reports, the finished ones among them. */
export type WorkLeadView = {
  address: string
  status: string
  at: number | null
  /** the tickets of the focus */
  tickets: WorkTicket[]
  /** the tickets that may or may not be of the focus: their project is unknown */
  unplaced: WorkTicket[]
  /** how many of its tickets are not of the focus */
  outside: number
  summary: string
  error: string | null
  readAt: number | null
}

// ---------------------------------------------------------------- the focus filter

/** Where a ticket stands to the focus: `unknown` where its project, or what the focus is made of, is not known. */
export type Place = 'in' | 'out' | 'unknown'

/**
 * What the focus narrows the tickets to. `unread` is a focus whose members are not known at all, so every ticket is
 * shown, with `why`.
 */
export type FocusFilter =
  | { kind: 'all' }
  | { kind: 'unread'; why: string }
  | { kind: 'named'; place: (id: string) => Place }

export const ALL_TICKETS: FocusFilter = { kind: 'all' }

const placeOf = (filter: FocusFilter, id: string): Place => (filter.kind === 'named' ? filter.place(id) : 'in')

const lower = (s: string): string => s.toLowerCase()

/** The place the focus gives a ticket no answer over it lists, by the ticket's project. */
function placeIn(f: FocusView, issue: WorkIssue | undefined): Place {
  if (issue === undefined || issue.project === undefined) return 'unknown'
  // A ticket in no project is in no project or initiative.
  if (issue.project === null) return 'out'
  const rows = [...f.initiatives.flatMap(i => i.projects), ...f.loose]
  const own = f.selectors.filter(s => s.kind === 'project').map(s => s.ref)
  const ids = new Set([...rows.flatMap(p => p.id ?? []), ...own].map(lower))
  if (ids.has(lower(issue.project))) return 'in'
  // Out only where every project of the focus is known.
  const isWhole = own.length > 0 || (f.initiatives.length > 0 && f.initiatives.every(i => i.failed === null && i.projects.every(p => p.id !== null)))
  return isWhole ? 'out' : 'unknown'
}

/**
 * The filter of a focus choice, from the focuses held. `key` is what a read for this choice and these teams is asked
 * for. A ticket is of the focus where an answer of ix-board over it lists the ticket, or the ticket's project is it or
 * one of its initiative's. A choice that is no focus filters nothing.
 */
export function focusFilter(choice: string, key: string, meta: Partial<FocusMeta>, focuses: readonly FocusView[], boards: readonly WorkBoard[]): FocusFilter {
  if (parseRef(choice) === null) return ALL_TICKETS
  const unread: FocusFilter = { kind: 'unread', why: 'focus not read: all tickets shown' }
  if (meta.heldFor !== key || meta.chosen === undefined) return unread
  if (!meta.chosen.known) return ALL_TICKETS
  const f = focuses.find(v => v.via === 'chosen' && v.address === choice)
  if (f === undefined) return unread
  const listed = new Set(boards.filter(b => b.ticketsOnly !== true).flatMap(b => b.issues.map(i => lower(i.identifier))))
  const singles = new Map(boards.filter(b => b.ticketsOnly === true).flatMap(b => b.issues.map(i => [i.identifier, i] as const)))
  return { kind: 'named', place: id => (listed.has(lower(id)) ? 'in' : placeIn(f, singles.get(id))) }
}

/** The leads with only the tickets of the focus. */
const narrowed = (leads: readonly WorkLead[], filter: FocusFilter): WorkLead[] =>
  leads.map(l => ({
    ...l,
    agents: l.agents.filter(a => placeOf(filter, a.ticket) === 'in'),
    focus: l.focus === null ? null : { ...l.focus, tickets: l.focus.tickets.filter(t => placeOf(filter, t) === 'in') },
  }))

/**
 * The counts of `workCounts` for the tickets of the focus, with how many tickets in hand of current reports have an
 * unknown project and so are in none of them.
 */
export function focusCounts(leads: readonly WorkLead[], boards: readonly WorkBoard[], now: number, leadsRead: boolean, listed: number, filter: FocusFilter): WorkCounts & { unplaced: number } {
  const current = leads.filter(l => l.readAt !== null && !isOldReport(l.reportedAt, now))
  const unplaced = leadsRead ? activeIds(current).filter(id => placeOf(filter, id) === 'unknown').length : 0
  return { ...workCounts(narrowed(leads, filter), boards, now, leadsRead, listed), unplaced }
}

/** Whether an event is of a lead of `teams`; null is every team. */
const isOfTeams = (e: WorkRoleEvent, teams: readonly string[] | null): boolean => teams === null || teams.some(t => lower(t) === lower(e.address.split(':')[1] ?? ''))

/**
 * The role events of the focus among those of the leads of `teams`, and how many of theirs were left out because their
 * ticket's project is unknown. The activity of the focus statuses is that of the focus already.
 */
export function focusEvents(all: readonly WorkRoleEvent[], filter: FocusFilter, teams: readonly string[] | null): { events: WorkRoleEvent[]; unplaced: number } {
  const events = all.filter(e => isOfTeams(e, teams))
  return { events: events.filter(e => placeOf(filter, e.ticket) === 'in'), unplaced: events.filter(e => placeOf(filter, e.ticket) === 'unknown').length }
}

/** A focus status that has answered: the read of single tickets and a focus never answered are not one. */
const isAnswer = (b: WorkBoard): boolean => b.ticketsOnly !== true && b.at !== null

/**
 * What ix-board's held answers lack: `oldAt` is when the oldest old focus status was read, `isShort` true where a
 * focus never answered, its latest refresh failed in whole or part or its merges are of an old answer, and `errors`
 * why the latest reads failed.
 */
export function boardNotes(boards: readonly WorkBoard[], now: number): { oldAt: number | null; isShort: boolean; errors: string[] } {
  const old = boards.filter(b => isOldAt(b.at, now)).map(b => b.at!)
  const focuses = boards.filter(b => b.ticketsOnly !== true)
  return {
    oldAt: old.length === 0 ? null : Math.min(...old),
    isShort: focuses.some(b => b.at === null || b.activity === null || Boolean(b.error) || isOldAt(b.at, now)),
    errors: [...new Set(boards.flatMap(b => (b.error ? [b.error] : [])))],
  }
}

export type WorkView = {
  leads: WorkLeadView[]
  /** null where ix-board is too old to say; newest first */
  activity: WorkActivity[] | null
  /** see WorkBoard */
  cutAt?: number
  /** whether any focus status answer has been read */
  hasBoard: boolean
}

const has = (role: string, word: string): boolean => role.toLowerCase().includes(word)

const isOpenPr = (p: WorkPr): boolean => p.status === 'open' || p.status === 'draft'

/** The distinct tickets one lead reports: those of its agents and those its focus names. */
export const ticketsOf = (lead: WorkLead): string[] => [...new Set([...lead.agents.map(a => a.ticket), ...(lead.focus?.tickets ?? [])].filter(t => t !== ''))]

/** A ticket every agent of which has finished, and that the lead's focus does not name, is no longer in hand. */
function isFinished(lead: WorkLead, id: string): boolean {
  const agents = lead.agents.filter(a => a.ticket === id)
  return agents.length > 0 && agents.every(a => a.status === 'done' || a.status === 'canceled') && !(lead.focus?.tickets ?? []).includes(id)
}

/** The distinct tickets of all the leads, finished ones among them. */
export const ticketIds = (leads: readonly WorkLead[]): string[] => [...new Set(leads.flatMap(ticketsOf))]

/** The distinct tickets the leads have in hand. */
export const activeIds = (leads: readonly WorkLead[]): string[] => [...new Set(leads.flatMap(l => ticketsOf(l).filter(id => !isFinished(l, id))))]

const badgesOf = (all: readonly WorkAgent[], issue: WorkIssue | undefined): string[] => {
  // A finished agent keeps no badge: only those still running or waiting count.
  const agents = all.filter(a => a.status === 'running' || a.status === 'waiting')
  const badges: string[] = []
  if (issue?.prs?.some(isOpenPr)) badges.push('[pr]')
  const reviewers = agents.filter(a => has(a.role, 'review')).length
  if (reviewers > 0) badges.push(reviewers === 1 ? '[review]' : `[review×${reviewers}]`)
  if (agents.some(a => has(a.role, 'spec')) || ['Specify', 'Specced'].includes(issue?.state ?? '')) badges.push('[spec]')
  if (agents.some(a => has(a.role, 'gate'))) badges.push('[gate]')
  return badges
}

/**
 * Where a ticket stands, from what ix-board says of it: finished as Linear has it; in review where Linear says so or a PR
 * of it is open; being worked on where Linear has it started or an agent runs on it; else not started.
 */
export function stateOf(issue: WorkIssue | undefined, isRunning: boolean): TicketState {
  if (issue?.stateType === undefined || issue.stateType === '') return 'unread'
  if (issue.stateType === 'completed') return 'done'
  if (issue.stateType === 'canceled') return 'canceled'
  if (/review/i.test(issue.state) || issue.prs?.some(isOpenPr)) return 'review'
  return issue.stateType === 'started' || isRunning ? 'working' : 'new'
}

/** What `ix-board issues` said of each ticket asked for: it alone says where a ticket stands. */
export const singlesOf = (boards: readonly WorkBoard[]): Map<string, WorkIssue> => new Map(boards.filter(b => b.ticketsOnly === true).flatMap(b => b.issues.map(i => [i.identifier, i] as const)))

/** The cells of a bar of at most this many. */
export const BAR_CELLS = 20

/**
 * The cells of each state in a bar: one a ticket up to BAR_CELLS; above that the bar is shared in proportion, and every
 * state that has a ticket keeps a cell.
 */
export function barCells(states: readonly TicketState[], cells = BAR_CELLS): { state: BarState; cells: number }[] {
  const counts = BAR_STATES.map(state => ({ state, count: states.filter(s => s === state).length })).filter(c => c.count > 0)
  const total = counts.reduce((n, c) => n + c.count, 0)
  if (total <= cells) return counts.map(c => ({ state: c.state, cells: c.count }))
  // A state whose share is under a cell takes the one it keeps; the rest of the bar is shared among the others, and
  // again where that leaves another under a cell.
  const given = new Map<BarState, number>()
  let rest = counts
  let room = cells
  for (;;) {
    const sum = rest.reduce((n, c) => n + c.count, 0)
    const small = rest.filter(c => (c.count * room) / sum < 1)
    if (small.length === 0) break
    for (const c of small) given.set(c.state, 1)
    rest = rest.filter(c => !small.includes(c))
    room -= small.length
  }
  // Largest remainders, a greater count first where they are equal, so that more tickets never draw fewer cells.
  const sum = rest.reduce((n, c) => n + c.count, 0)
  const shares = rest.map(c => ({ ...c, whole: Math.floor((c.count * room) / sum), over: (c.count * room) % sum }))
  let spare = room - shares.reduce((n, c) => n + c.whole, 0)
  for (const c of [...shares].sort((a, b) => b.over - a.over || b.count - a.count)) given.set(c.state, c.whole + (spare-- > 0 ? 1 : 0))
  return counts.map(c => ({ state: c.state, cells: given.get(c.state)! }))
}

/** A lead that needs a look: stuck, or churning; `since` is when that began, at the latest. */
export type Flag = { kind: 'stuck' | 'churning'; since: number | null; why: string }

/** A working lane with no change of ticket, role or PR for this long is churning. */
export const CHURN_MS = 2 * 60 * 60 * 1000
/** Lane states older than this say nothing of now. */
const LANES_OLD_MS = 5 * 60 * 1000
/** The tickets are read every 5 minutes and the events every 30 seconds: an answer this old has missed its reads. */
const TICKETS_CURRENT_MS = 10 * 60 * 1000
const EVENTS_CURRENT_MS = 5 * 60 * 1000

/**
 * Whether what is held of tickets and events can say that nothing has changed: both read lately, the last read of each
 * without error, and the events read to the end of the stream (a read still catching up is held as an error).
 */
export function readsCurrent(tickets: WorkBoard | undefined, feed: Pick<WorkFeed, 'at' | 'error'>, now: number): boolean {
  if (tickets === undefined || tickets.at === undefined || tickets.at === null || (tickets.error ?? null) !== null || now - tickets.at > TICKETS_CURRENT_MS) return false
  return feed.at !== undefined && feed.error === null && now - feed.at <= EVENTS_CURRENT_MS
}

const REASONS: Record<string, string> = { permission: 'blocked on a permission request', dialog: 'blocked on a dialog', question: 'blocked on a question', queued_question: 'blocked on a queued question', login: 'blocked on a login', usage_limit: 'usage limit' }

/**
 * What is wrong with a lead, where the data says. Stuck: its lane waits on a question, a login or a permission, or a tool
 * call ran past its limit. Churning: its lane works, and for CHURN_MS no agent of it changed role, status or ticket
 * (`turnAt`, from the events), Linear updated none of its tickets and no PR of them was opened or merged. With any of
 * those unknown, or not current (`isCurrent`, of `readsCurrent`, and the lead's own report), nothing is said.
 */
export function flagOf(lead: WorkLead, lanes: WorkLanes | null, singles: ReadonlyMap<string, WorkIssue>, turnAt: number | undefined, now: number, isCurrent: boolean): Flag | null {
  const lane = lanes === null || now - lanes.at > LANES_OLD_MS ? undefined : lanes.lanes[lead.address]
  if (lane === undefined) return null
  if (lane.isStuck) return { kind: 'stuck', since: lane.since, why: lane.reason === null ? 'a tool call ran past its limit' : (REASONS[lane.reason] ?? lane.reason) }
  if (lane.state !== 'working' || turnAt === undefined || !isCurrent || lead.error !== null) return null
  const issues = ticketsOf(lead).filter(id => TICKET_ID.test(id)).map(id => singles.get(id))
  if (issues.length === 0 || issues.some(i => i === undefined || i.updatedAt === undefined || i.updatedAt === null || i.prs === null)) return null
  // With every ticket finished there is nothing for the lane to move.
  if (issues.every(i => i!.stateType === 'completed' || i!.stateType === 'canceled')) return null
  const last = Math.max(turnAt, ...issues.flatMap(i => [i!.updatedAt!, i!.prAt ?? 0]))
  return now - last < CHURN_MS ? null : { kind: 'churning', since: last, why: 'the lane is working, and no ticket, role or PR of it has changed' }
}

/**
 * Notes when an agent of each lead last changed: its role, status or ticket, or its removal. A report that repeats the
 * same is no change.
 */
export function foldTurns(events: readonly unknown[], held: Pick<WorkFeed, 'turns' | 'marks'>): { turns: Record<string, number>; marks: Record<string, string> } {
  const turns = { ...held.turns }
  const marks = { ...held.marks }
  for (const e of events) {
    const event = obj(e)
    const at = typeof event?.at_ms === 'number' ? event.at_ms : null
    const address = str(obj(event?.binding)?.address)
    const change = obj(event?.change)
    if (at === null || address === '' || change === null) continue
    const agent = obj(change.agent)
    const key = `${address}\u0000${str(change.agent_id) || str(agent?.agent_id) || str(agent?.name)}`
    const mark = change.kind === 'remove' ? 'removed' : `${str(agent?.role)}|${str(agent?.status)}|${str(agent?.ticket)}`
    if (marks[key] === mark) continue
    marks[key] = mark
    turns[address] = Math.max(at, turns[address] ?? at)
  }
  return { turns, marks }
}

/**
 * Joins the leads' agents with the ticket facts. Only tickets a lead's agents report are listed under it; a started
 * ticket no lead reports is already on the Focus tab. A ticket's time is that of the latest transition of an agent on
 * it, else of the latest report of one.
 */
export function composeWork(leads: readonly WorkLead[], last: Record<string, number>, boards: readonly WorkBoard[], filter: FocusFilter = ALL_TICKETS): WorkView {
  const board = mergeBoards(boards)
  const byId = new Map(board.issues.map(i => [i.identifier, i]))
  const singles = singlesOf(boards)
  const unknown = new Set(boards.flatMap(b => b.unknown ?? []))
  // The tickets a read of single tickets left out, or could not read.
  const left = new Set(boards.flatMap(b => b.left ?? []))
  /** Why a ticket has no title, where ix-board has answered that or failed. */
  const whyOf = (id: string, issue: WorkIssue | undefined): string | null => {
    if (issue !== undefined) return null
    if (unknown.has(id)) return 'not in Linear'
    return left.has(id) ? 'state not read' : null
  }
  const views = leads.map((lead): WorkLeadView => {
    const tickets = ticketsOf(lead).map((id): WorkTicket => {
      const agents = lead.agents.filter(a => a.ticket === id)
      const issue = byId.get(id)
      const reports = agents.flatMap(a => a.reportedAt ?? [])
      // A ticket only the focus names is as old as the focus.
      const named = lead.focus?.tickets.includes(id) ? lead.focus.at : null
      const at = last[`${lead.address}\u0000${id}`] ?? (reports.length === 0 ? named : Math.max(...reports))
      const single = singles.get(id)
      const state = stateOf(single, agents.some(a => a.status === 'running'))
      return { id, state, project: single?.project, title: issue?.title ?? '', why: whyOf(id, issue), badges: badgesOf(agents, issue), at }
    })
    tickets.sort((a, b) => LISTED[a.state] - LISTED[b.state] || (b.at ?? 0) - (a.at ?? 0) || a.id.localeCompare(b.id))
    const mine = tickets.filter(t => placeOf(filter, t.id) === 'in')
    const unplaced = tickets.filter(t => placeOf(filter, t.id) === 'unknown')
    const outside = tickets.length - mine.length - unplaced.length
    return { address: lead.address, status: lead.status, at: lead.reportedAt, tickets: mine, unplaced, outside, summary: lead.focus?.summary ?? '', error: lead.error, readAt: lead.readAt }
  })
  views.sort((a, b) => a.address.localeCompare(b.address))
  return { leads: views, activity: board.activity, cutAt: board.cutAt, hasBoard: boards.some(isAnswer) }
}

/** The time of the latest agent transition per (lead, ticket) of an `agent-msg work events` page, merged into `into`. */
export function lastOfEvents(events: readonly unknown[], into: Record<string, number>): void {
  for (const e of events) {
    const event = obj(e)
    const at = typeof event?.at_ms === 'number' ? event.at_ms : null
    const address = str(obj(event?.binding)?.address)
    const ticket = str(obj(obj(event?.change)?.agent)?.ticket)
    if (at === null || address === '' || ticket === '') continue
    const key = `${address}\u0000${ticket}`
    into[key] = Math.max(at, into[key] ?? at)
  }
}

/** The roles whose starts and finishes are listed under Recent; null for every other role. A spec reviewer reviews. */
export const eventRole = (role: string): WorkRoleEvent['role'] | null => (has(role, 'review') ? 'review' : has(role, 'gate') ? 'gate' : has(role, 'spec') ? 'spec' : null)

/** The latest role events the feed keeps. */
export const FEED_CAP = 200

/**
 * Folds an `agent-msg work events` page into the feed, in stream order. A start is the first `running` report of an
 * assignment (lead, agent, ticket) that is not already running, so a repeated report and a resume after `waiting`
 * add nothing; `done` is listed once. `failed`, `canceled` and the removal of the agent end the assignment unlisted.
 */
export function foldFeed(events: readonly unknown[], feed: Pick<WorkFeed, 'events' | 'phase'>): Pick<WorkFeed, 'events' | 'phase'> {
  const listed = [...feed.events]
  const phase = { ...feed.phase }
  for (const e of events) {
    const event = obj(e)
    const at = typeof event?.at_ms === 'number' ? event.at_ms : null
    const address = str(obj(event?.binding)?.address)
    const change = obj(event?.change)
    if (at === null || address === '' || change === null) continue
    if (change.kind === 'remove') {
      const prefix = `${address}\u0000${str(change.agent_id)}\u0000`
      for (const key of Object.keys(phase)) if (key.startsWith(prefix)) delete phase[key]
      continue
    }
    const agent = obj(change.agent)
    const ticket = str(agent?.ticket)
    const role = eventRole(str(agent?.role))
    if (agent === null || ticket === '' || role === null) continue
    const key = `${address}\u0000${str(agent.agent_id) || str(agent.name)}\u0000${ticket}`
    const status = str(agent.status)
    if (status === 'running' && phase[key] !== 'running') {
      phase[key] = 'running'
      listed.push({ at, role, step: 'start', ticket, address })
    } else if (status === 'done' && phase[key] !== 'done') {
      phase[key] = 'done'
      listed.push({ at, role, step: 'done', ticket, address })
    } else if (status === 'failed' || status === 'canceled') delete phase[key]
  }
  return { events: listed.slice(-FEED_CAP), phase }
}

/** One row of Recent: a ticket or PR event of ix-board, or a role event of the relay. */
export type RecentEntry = { at: number; activity: WorkActivity; event?: undefined } | { at: number; event: WorkRoleEvent; activity?: undefined }

/** The rows of `all` held for the role events, however much newer activity there is. */
export const ROLE_ROWS = 5

/**
 * The first `rows` of Recent. Role events and activity each have their share of the rows (ROLE_ROWS to the events),
 * a share one does not fill goes to the other, and the rows chosen are listed together, newest first.
 */
export function recentRows(entries: readonly RecentEntry[], rows: number): RecentEntry[] {
  const roles = entries.filter(e => e.event !== undefined)
  const other = entries.length - roles.length
  const keptRoles = Math.min(roles.length, Math.max(ROLE_ROWS, rows - other))
  const kept = new Set<RecentEntry>(roles.slice(0, keptRoles))
  let room = rows - kept.size
  return entries.filter(e => (e.event !== undefined ? kept.has(e) : room-- > 0))
}

/**
 * What Recent can list, newest first: the merges; with `all`, every activity and the role events of the leads of
 * `teams` (null: every lead).
 */
export function recentOf(activity: readonly WorkActivity[] | null, events: readonly WorkRoleEvent[], all: boolean, teams: readonly string[] | null): RecentEntry[] {
  const rows: RecentEntry[] = [
    ...(activity ?? []).filter(a => all || a.kind === 'merged').map(a => ({ at: a.at, activity: a })),
    // Newest first before the sort, so that events of the same moment keep that order.
    ...(all ? events.filter(e => isOfTeams(e, teams)).reverse().map(event => ({ at: event.at, event })) : []),
  ]
  return rows.sort((a, b) => b.at - a.at)
}

/** The numbers of the band's work cell; null is unknown. */
export type WorkCounts = {
  /** why `prsOpen` and `merged` are unknown; null where they are known */
  prsWhy: string | null
  mergedWhy: string | null
  /** the tickets in hand of the leads with a current report */
  tickets: number | null
  /** the tickets in hand of the leads whose report is old and that no current report holds */
  oldTickets: number
  /** the leads with a current report, of `listed` */
  reporting: number
  listed: number
  /** the open PRs of `tickets` */
  prsOpen: number | null
  /** true where some of those tickets' PRs are unknown, so `prsOpen` is a lower bound */
  prsPartial: boolean
  merged: number | null
  /** true where merges may be missing from `merged`, so it is a lower bound */
  mergedPartial: boolean
  /** when the oldest old answer behind the PRs or merges was read */
  oldAt: number | null
}

/**
 * Tickets the leads have in hand, the open or draft PRs of those tickets and the merges of the last 24 hours. A lead
 * whose report is older than REPORT_OLD_MS says nothing of now. With `leadsRead` false nothing is known of the leads.
 * A PR count is unknown where no ticket has its PRs said.
 */
export function workCounts(leads: readonly WorkLead[], boards: readonly WorkBoard[], now: number, leadsRead: boolean, listed = leads.length): WorkCounts {
  const board = mergeBoards(boards)
  const notes = boardNotes(boards, now)
  const merged = board.activity === null ? null : mergedSince(board.activity, now, 24)
  const mergedPartial = merged !== null && (isCutWithin(board.cutAt, now, 24) || notes.isShort)
  const mergedOld = merged === null ? null : boardNotes(boards.filter(b => b.ticketsOnly !== true), now).oldAt
  const current = leads.filter(l => l.readAt !== null && !isOldReport(l.reportedAt, now))
  const base = { reporting: current.length, listed: Math.max(listed, current.length), merged, mergedPartial }
  const focuses = boards.filter(b => b.ticketsOnly !== true)
  const unread = (some: readonly WorkBoard[]): string => (some.some(b => b.error) ? 'ix-board could not be read' : 'ix-board not read yet')
  const mergedWhy = merged !== null ? null : focuses.length === 0 ? 'no focus status read' : focuses.every(b => b.at === null) ? unread(focuses) : 'merges need ix-board ≥0.9.0'
  if (!leadsRead) return { ...base, tickets: null, oldTickets: 0, prsOpen: null, prsPartial: false, oldAt: mergedOld, prsWhy: 'leads not read', mergedWhy }
  const ids = activeIds(current)
  const oldTickets = activeIds(leads.filter(l => isOldReport(l.reportedAt, now))).filter(id => !ids.includes(id)).length
  const byId = new Map(board.issues.map(i => [i.identifier, i]))
  const known = ids.flatMap(id => {
    const issue = byId.get(id)
    return issue === undefined || issue.prs === null ? [] : [issue]
  })
  const open = new Set(known.flatMap(i => i.prs!).filter(isOpenPr).map(p => p.url || `${p.repo}#${p.number}`))
  // With no ticket in hand there is no PR to count, once ix-board has answered.
  const isSaid = known.length > 0 || (ids.length === 0 && boards.some(isAnswer))
  const prsOld = known.flatMap(i => (isOldAt(i.at, now) ? [i.at!] : []))
  const ages = [...(mergedOld === null ? [] : [mergedOld]), ...prsOld]
  const prsWhy = isSaid ? null : boards.length === 0 ? 'no focus status read' : boards.every(b => b.at === null) ? unread(boards) : 'ix-board names no PRs of these tickets'
  return { ...base, tickets: ids.length, oldTickets, prsOpen: isSaid ? open.size : null, prsPartial: isSaid && known.length < ids.length, oldAt: ages.length === 0 ? null : Math.min(...ages), prsWhy, mergedWhy }
}

/** Whether activity of the last `hours` was left out by the cut. */
export const isCutWithin = (cutAt: number | undefined, now: number, hours: number): boolean => cutAt !== undefined && now - cutAt < hours * 3_600_000

/** Counts the PRs merged in the last `hours`: a PR of two tickets is one, and an entry that names no PR counts by itself. */
export const mergedSince = (activity: readonly WorkActivity[] | null, now: number, hours: number): number =>
  new Set(
    (activity ?? [])
      .filter(a => a.kind === 'merged' && now - a.at <= hours * 3_600_000)
      .map(a => (a.repo === null || a.number === null ? `${a.identifier} ${a.at}` : `${a.repo}#${a.number}`)),
  ).size
