import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { TicketsAnswer, WorkAgent, WorkBoard, WorkFeed, WorkLead, WorkMeta, WorkPicker } from '../types'
import { CALL_TIMEOUT_MS, limited } from './board'
import { choiceApplied, focusHeld, focusWasRead, pollFocus } from './focus'
import { gatedBoard } from './linear'
import { CARD_BG, ago, agoShort, errorText, failureText, pausedText, runJson, spawn } from './shared'
import { LEAD_REUSE_MS, RELAY_TIMEOUT_MS, listLeads, readLead, twice } from './leads'
import type { LeadRead, WorkReport } from './leads'
import { focusTeams, statusOf, teamOf } from './band/modules'
import { NOT_A_FOCUS, focusNotice, labelOf, namesOf, parseRef } from './focuschoice'
import { lanesHeld, pollLanes } from './worklane'
import { markStale, track } from './schedule'
import type { SourceId } from './schedule'
import { ALL, getSelection, scopeKeyOf, scopeOf, selectionReady, writeChoice } from './selection'
import type { Picked } from './selection'
import { sourceClear, sourceFailed, sourceOk } from './sources'
import { TICKET_ID, activeIds, boardNotes, composeWork, focusCounts, focusEvents, focusFilter, foldFeed, foldTurns, flagOf, readsCurrent, barCells, BAR_CELLS, singlesOf, holdTickets, isOldReport, issuesOf, lastOfEvents, readBoards, recentOf, recentRows, ticketIds, unknownOf } from './work'
import type { RecentEntry, TicketState, WorkTicket } from './work'
import type { Options } from './shared'

// The Work pane: where each code lead's work stands, and which leads are stuck or going nowhere. It opens as one line
// for each host: a bar of its tickets by state, how many, and its alerts. A host opens to the same line for each lead,
// and a lead to its tickets under their Linear projects. The closed lines read the leads' work reports and events from
// the relay, the lanes' states from Prometheus and one `ix-board issues` of every reported ticket, which the sessions
// share. Project names are read when a lead is opened, Recent's focus status when Recent is opened, and the focus
// choices when their list is opened. A chosen focus needs its focus status to say which tickets are its own.

const PANE = 'work'
const TITLE = 'Work'
export const PANE_SPEC = { id: PANE, title: TITLE }
/** The events are read in pages of this size, at most EVENT_PAGES of them: the stream starts at the oldest transition. */
const EVENT_LIMIT = 1000
const EVENT_PAGES = 5
const RECENT_ROWS = 10
/** The version of what a tickets answer holds; a cached answer of another is read again. */
const TICKETS_SHAPE = 3
/** The reported tickets are read again this long after they were last read. */
const TICKETS_AGAIN_MS = 5 * 60 * 1000
/** At most this many tickets go into one call, and at most this many calls into one read. */
const TICKETS_PER_CALL = 100
const TICKET_CALLS = 10

const workLeads = atom({ plugin: 'factory-panel', key: 'workLeads' } as const, [] as WorkLead[], { shape: 'workLeads-3' })
const workLast = atom({ plugin: 'factory-panel', key: 'workLast' } as const, {} as Record<string, number>, { shape: 'workLast-2' })
const workMeta = atom({ plugin: 'factory-panel', key: 'workMeta' } as const, { at: null, busy: false, error: null, relayError: null, listed: 0, silent: [], pending: 0, teams: [] } as WorkMeta, { shape: 'workMeta-6' })
const EMPTY_FEED: WorkFeed = { events: [], phase: {}, error: null }
const workFeed = atom({ plugin: 'factory-panel', key: 'workFeed' } as const, EMPTY_FEED, { shape: 'workFeed-1' })
const workAll = atom({ plugin: 'factory-panel', key: 'workAll' } as const, false)
const workWarnings = atom({ plugin: 'factory-panel', key: 'workWarnings' } as const, false)
/** The choice open under the header, and the focus names it offers. */
const workPicker = atom({ plugin: 'factory-panel', key: 'workPicker' } as const, { open: null, error: null } as WorkPicker, { shape: 'workPicker-2' })
/**
 * What is open, remembered for the session: `host:<host>`, `lead:<address>`, `old:<host>`, `silent:<host>`,
 * `outside:<host>`, `unplaced-<address>` and `recent`.
 */
const workOpen = atom({ plugin: 'factory-panel', key: 'workOpen' } as const, [] as string[])
/** The names of the projects of the opened leads' tickets, by id; null where none could be read. */
const workProjects = atom({ plugin: 'factory-panel', key: 'workProjects' } as const, {} as Record<string, string | null>)
/** Why a project's name could not be read at the last try; one of the footer's warnings. */
const workNameError = atom({ plugin: 'factory-panel', key: 'workNameError' } as const, null as string | null)

// ---------------------------------------------------------------- data

const agentsOf = (report: WorkReport): WorkAgent[] =>
  (report.agents ?? []).map(a => ({ name: a.name ?? '', ticket: a.ticket ?? '', role: a.role ?? '', status: a.status ?? '', reportedAt: typeof a.reported_at_ms === 'number' ? a.reported_at_ms : null }))

const leadOf = (address: string, report: WorkReport): Omit<WorkLead, 'error' | 'readAt'> => {
  const agents = agentsOf(report)
  const times = [...agents.map(a => a.reportedAt), report.focus?.reported_at_ms, report.scope?.reported_at_ms].filter((t): t is number => typeof t === 'number')
  return { address: report.binding?.address ?? address, status: statusOf(report.agents), reportedAt: times.length === 0 ? null : Math.max(...times), agents, focus: focusOf(report) }
}

const focusOf = ({ focus }: WorkReport): WorkLead['focus'] =>
  focus ? { summary: focus.summary ?? '', tickets: (focus.tickets ?? []).filter(t => typeof t === 'string' && t !== ''), at: typeof focus.reported_at_ms === 'number' ? focus.reported_at_ms : null } : null

/**
 * The leads to draw while `reads` come in: one not yet answered keeps what was drawn of it, one that has reported
 * nothing is left out, and one that could not be read is drawn as last read, else as unread.
 */
function leadsOf(addresses: readonly string[], reads: ReadonlyMap<string, LeadRead>, drawn: readonly WorkLead[]): WorkLead[] {
  return addresses.flatMap((address): WorkLead[] => {
    const read = reads.get(address)
    // A lead being read, here or by another session, keeps what was drawn of it.
    if (read === undefined || (read.pending === true && read.report === undefined)) return drawn.filter(l => l.address === address)
    if (read.report) return [{ ...leadOf(address, read.report), error: read.error, readAt: read.at }]
    // A report of nothing is a report too: such a lead that stops answering is old, and one never read has no age.
    return read.error === null ? [] : [{ address, status: 'unknown', reportedAt: null, agents: [], focus: null, error: read.error, readAt: read.at }]
  })
}

type EventPage = { events?: unknown[]; has_more?: boolean; next_cursor?: string }

const STREAM_START = '0-0'
/** Where the last read of the event stream ended: the next read asks only for what came after. */
let eventCursor = STREAM_START

type Feed = Pick<WorkFeed, 'events' | 'phase' | 'turns' | 'marks'>
type Read = { last: Record<string, number>; feed: Feed; cursor: string; truncated: boolean }

/**
 * The time of the latest transition of each (lead, ticket), folded into `prior`, and the role events, folded into `held`. The
 * stream starts at its oldest event, so a read resumes after the cursor the last one ended at, at most EVENT_PAGES
 * pages at a time. Where the cap is reached with more to come, `truncated` is true and the next read carries on from
 * where this one stopped.
 */
async function readEvents($: EngineInterface, prior: Record<string, number>, held: WorkFeed): Promise<Read> {
  const last = { ...prior }
  // A read from the start of the stream tells the whole story again: nothing held is added to.
  let feed: Feed = eventCursor === STREAM_START ? EMPTY_FEED : held
  let cursor = eventCursor
  let more = false
  for (let page = 0; page < EVENT_PAGES; page++) {
    const answer = await twice(() => runJson<EventPage>($, ['agent-msg', 'work', 'events', '--limit', String(EVENT_LIMIT), '--after', cursor], RELAY_TIMEOUT_MS, 'events'))
    const events = Array.isArray(answer.events) ? answer.events : []
    lastOfEvents(events, last)
    feed = { ...foldFeed(events, feed), ...foldTurns(events, feed) }
    if (typeof answer.next_cursor === 'string') cursor = answer.next_cursor
    more = answer.has_more === true && typeof answer.next_cursor === 'string'
    if (!more) break
  }
  return { last, feed, cursor, truncated: more }
}

let running: Promise<boolean> | null = null

/** Reads the leads and their work reports; one read at a time. False when the relay could not be read. */
export function pollWork($: EngineInterface, manual = false): Promise<boolean> {
  running ??= track($, 'work', () => refreshWork($, manual ? 0 : LEAD_REUSE_MS)).finally(() => {
    running = null
  })
  return running
}

let runningEvents: Promise<boolean> | null = null

/** Reads the events that came since the last read; one read at a time. False when they could not be read. */
export function pollEvents($: EngineInterface): Promise<boolean> {
  runningEvents ??= track($, 'events', () => refreshEvents($)).finally(() => {
    runningEvents = null
  })
  return runningEvents
}

/** Forgets the reads under way; the tests start each session from nothing. */
export function resetWork(): void {
  lastTickets = ''
  running = null
  runningEvents = null
  eventCursor = STREAM_START
}

/** The tickets the leads reported at the last read, as one string. */
let lastTickets = ''

async function runIssues($: EngineInterface, ids: string[]): Promise<TicketsAnswer> {
  const answer: TicketsAnswer = { shape: TICKETS_SHAPE, at: 0, asked: ids, issues: [], unknown: [] }
  for (let i = 0; i < ids.length; i += TICKETS_PER_CALL) {
    const some = ids.slice(i, i + TICKETS_PER_CALL)
    const ran = await spawn($, ['ix-board', '--json', 'issues', ...some], CALL_TIMEOUT_MS, 'tickets')
    if (ran.exitCode === 2 && ran.stderr.includes("unrecognized subcommand 'issues'")) throw new Error('this ix-board has no `issues` command')
    // Where Linear has none of the tickets asked for, ix-board answers all the same and exits 3 with nothing to say.
    if (ran.exitCode !== 0 && !(ran.exitCode === 3 && ran.stderr.trim() === '')) throw new Error(failureText(ran.stderr, ran.exitCode))
    if (ran.isStdoutTruncated) throw new Error('the answer was cut at 4 MiB')
    const body: unknown = JSON.parse(ran.stdout)
    answer.issues.push(...issuesOf(body))
    answer.unknown.push(...unknownOf(body))
  }
  answer.at = await $.clock.now()
  return answer
}

const hostOf = (address: string): string => address.split(':')[0] ?? ''

/** The leads whose tickets are on screen: opened, under an opened host, and under its opened `old` line where old. */
const openLeads = (leads: readonly WorkLead[], opened: readonly string[], now: number): WorkLead[] =>
  leads.filter(l => {
    const host = hostOf(l.address)
    return opened.includes(`lead:${l.address}`) && opened.includes(`host:${host}`) && (!isOldLead(l, now) || opened.includes(`old:${host}`))
  })

/** A lead whose report is old: it is folded under its host. */
const isOldLead = (l: { readAt: number | null; reportedAt: number | null }, now: number): boolean => l.readAt !== null && isOldReport(l.reportedAt, now)

/** What the Work pane reads for what is now open and chosen in it (hooks/visible.ts). */
export async function workSources($: EngineInterface, isWidget: boolean): Promise<SourceId[]> {
  // A chosen focus needs its tickets' membership for every count.
  const isFiltered = parseRef(getSelection().focus.value) !== null
  if (isWidget) return ['selection', 'work', ...(isFiltered ? (['membership', 'tickets'] as const) : [])]
  const [leads, opened, picker] = await Promise.all([read($, workLeads), read($, workOpen), read($, workPicker)])
  const isLeadOpen = openLeads(leads, opened, await $.clock.now()).length > 0
  return [
    'selection',
    'work',
    // The closed lines need where each ticket stands, each lane's state and each lead's latest change.
    'tickets',
    'workLanes',
    'events',
    ...(isFiltered ? (['membership'] as const) : []),
    ...(isLeadOpen ? (['projects'] as const) : []),
    ...(opened.includes('recent') ? (['focus'] as const) : []),
    ...(picker.open === 'focus' ? (['choices'] as const) : []),
  ]
}

/**
 * Reads the titles, states and PRs of every reported ticket in one read, which the sessions share; false when that failed.
 */
export function pollTickets($: EngineInterface): Promise<boolean> {
  return track($, 'tickets', async () => {
    const [meta, leads] = await Promise.all([read($, workMeta), read($, workLeads)])
    // The leads have to be read first.
    if (meta.at === null) {
      markStale('tickets')
      return true
    }
    // Where there are more than can be asked for, those in hand come first.
    const askable = (ids: string[]) => ids.filter(id => TICKET_ID.test(id)).sort()
    const inHand = askable(activeIds(leads))
    const every = [...inHand, ...askable(ticketIds(leads)).filter(id => !inHand.includes(id))]
    const wanted = every.slice(0, TICKETS_PER_CALL * TICKET_CALLS).sort()
    if (wanted.length === 0) {
      await holdTickets($, () => null)
      sourceClear('ix-board issues')
      return true
    }
    const teams = focusTeams(scopeOf(getSelection()))
    const now = await $.clock.now()
    const got = await gatedBoard($, `tickets:${teams === null ? '*' : teams.join(',').toLowerCase()}`, () => limited(() => runIssues($, wanted)), {
      outdated: (answer: TicketsAnswer) => answer.shape !== TICKETS_SHAPE || now - answer.at >= TICKETS_AGAIN_MS,
    })
    const error = got.backoffUntil !== null ? pausedText(got.backoffUntil, now) : got.error
    await holdTickets($, held => {
      const data = got.data
      // A read another session is making says nothing yet; a failed one leaves what was held.
      if (data === null) return held === null && error === null ? null : { ...(held ?? { issues: [], activity: null, at: null, ticketsOnly: true as const }), error, left: held === null ? every : held.left }
      return { issues: data.issues, activity: null, at: data.at, error, ticketsOnly: true, unknown: data.unknown, asked: data.asked, left: every.filter(id => !data.asked.includes(id)) }
    })
    if (error !== null) sourceFailed('ix-board issues', error)
    else if (got.data !== null) sourceOk('ix-board issues', await $.clock.now())
    return error === null
  })
}

/** Reads the names of the projects of the opened leads' tickets: the headings under them. */
export function pollProjects($: EngineInterface): Promise<boolean> {
  return track($, 'projects', async () => {
    const [leads, opened, boards] = await Promise.all([read($, workLeads), read($, workOpen), readBoards($)])
    const singles = singlesOf(boards)
    const ids = [...new Set(openLeads(leads, opened, await $.clock.now()).flatMap(l => ticketIds([l]).flatMap(id => singles.get(id)?.project ?? [])))]
    // Until the tickets are read there is no project to name.
    if (ids.length === 0) {
      markStale('projects')
      // Written only on a change: a write draws the pane again, which asks for this read again.
      if ((await read($, workNameError)) !== null) await update($, workNameError, () => null)
      return true
    }
    const failed: string[] = []
    const names = await namesOf($, ids.map(id => `project:${id}`), why => failed.push(why))
    // A project no name could be read for is headed by its id; a name read earlier stays.
    await update($, workProjects, held => ({ ...held, ...Object.fromEntries(ids.map(id => [id, names.find(n => n.id === id)?.name ?? held[id] ?? null])) }))
    // A lead closed while the names were read leaves no heading to warn about.
    const isStillOpen = openLeads(await read($, workLeads), await read($, workOpen), await $.clock.now()).length > 0
    await update($, workNameError, () => (isStillOpen ? (failed[0] ?? null) : null))
    if (failed.length > 0) sourceFailed('ix-board', failed[0]!)
    return failed.length === 0
  })
}

/** The events are a source of their own: they wait on no lead's report, and where they fail the tickets still show. */
async function refreshEvents($: EngineInterface): Promise<boolean> {
  try {
    const answer = await readEvents($, await read($, workLast), await read($, workFeed))
    eventCursor = answer.cursor
    await update($, workLast, () => answer.last)
    const note = answer.truncated ? `agent-msg work events: more than ${EVENT_PAGES * EVENT_LIMIT} events behind, catching up` : null
    const at = await $.clock.now()
    await update($, workFeed, () => ({ ...answer.feed, error: note, at }))
    return true
  } catch (error) {
    await update($, workFeed, f => ({ ...f, error: `agent-msg work events: ${errorText(error)}` }))
    return false
  }
}

async function refreshWork($: EngineInterface, reuseMs: number): Promise<boolean> {
  // The first drawing shows that a read is under way before anything has answered.
  await update($, workMeta, m => ({ ...m, busy: true }))
  try {
    await selectionReady()
    const teams = focusTeams(scopeOf(getSelection()))
    let addresses: string[]
    let known: string[]
    try {
      const all = await listLeads($, reuseMs === 0 ? 0 : undefined)
      known = [...new Set(all.map(teamOf).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      addresses = all.filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
    } catch (error) {
      sourceFailed('agent-msg work', errorText(error))
      // With no list nothing is read: every lead drawn is as it was last read.
      await update($, workLeads, drawn => drawn.map(l => ({ ...l, error: errorText(error) })))
      throw error
    }
    const reads = new Map<string, LeadRead>()
    // Each lead is drawn as it answers: those on this machine do not wait for those reached through ssh.
    await Promise.all(
      addresses.map(async address => {
        reads.set(address, await readLead($, address, reuseMs))
        await update($, workLeads, drawn => leadsOf(addresses, reads, drawn))
      }),
    )
    await update($, workLeads, drawn => leadsOf(addresses, reads, drawn))
    const failed = [...reads.values()].filter(r => r.error !== null).sort((a, b) => a.address.localeCompare(b.address)).map(r => `${r.address}: ${r.error}`)
    // Some leads failing is told lead by lead; the source has failed where none answered.
    const failure = failed.length > 0 && failed.length === reads.size ? failed.join(' · ') : null
    if (failure === null) sourceOk('agent-msg work', await $.clock.now())
    else sourceFailed('agent-msg work', failure)
    const now = await $.clock.now()
    const relayError = failure === null ? null : `no lead could be read, ${failed[0]}`
    const silent = [...reads.values()].filter(r => r.error === null && r.report === null).map(r => r.address).sort((a, b) => a.localeCompare(b))
    const pending = [...reads.values()].filter(r => r.pending === true && r.report === undefined).length
    await update($, workMeta, () => ({ at: now, busy: false, error: failed.length === 0 ? null : failed.join(' · '), relayError, listed: reads.size, silent, pending, teams: known }))
    const reported = ticketIds(await read($, workLeads)).sort().join()
    if (reported !== lastTickets) markStale('tickets')
    lastTickets = reported
    return failure === null
  } catch (error) {
    await update($, workMeta, m => ({ ...m, busy: false, error: errorText(error), relayError: errorText(error) }))
    return false
  }
}

// ---------------------------------------------------------------- pane

/** What each state is drawn with: a shade of its own, so that states are told apart without colour, and a colour. */
export const STATE_MARKS: Record<TicketState, { mark: string; color: string }> = {
  done: { mark: '█', color: 'success' },
  review: { mark: '▓', color: 'warning' },
  working: { mark: '▒', color: 'suggestion' },
  new: { mark: '░', color: 'inactive' },
  unread: { mark: '?', color: 'subtle' },
  canceled: { mark: '×', color: 'inactive' },
}

const KIND_MARKS = { merged: { mark: '✓', color: 'success' }, closed: { mark: '●', color: 'warning' }, opened: { mark: '○', color: 'subtle' } } as const
const STEP_MARKS = { start: { mark: '◐', color: 'claude' }, done: { mark: '✓', color: 'success' } } as const

const repoName = (repo: string | null) => (repo === null ? '' : repo.split('/').pop() ?? repo)

/** The text of one Recent row after its mark: age, then the PR and ticket of an activity, or the role, ticket and lead. */
export function recentLine(row: RecentEntry, now: number): string {
  const age = agoShort(row.at, now).padEnd(3)
  if (row.event !== undefined) return `${age} ${`${row.event.role} ${row.event.step}`.padEnd(12)}  ${row.event.ticket}  ${row.event.address}`
  const a = row.activity
  const ref = a.repo === null || a.number === null ? '' : `${repoName(a.repo)}#${a.number}  `
  return `${age} ${ref}${a.identifier} ${a.title}`
}

const clip = (t: string, cells: number): string => (t.length > cells ? `${t.slice(0, Math.max(1, cells - 1))}…` : t)

/** The columns of the age at the right of a ticket row. */
const AGE_CELLS = 4

/**
 * One ticket line: `   QSL-1240 Coding proof gate…  [pr][review×2]    4m`. The age keeps a column at the right, the badges
 * stand before it and the title takes the room left. A ticket with no title says why in its place.
 */
export function ticketLine(t: WorkTicket, now: number, width: number): string {
  const left = `   ${t.id} `
  const age = t.at === null ? '' : agoShort(t.at, now)
  const badges = t.badges.length === 0 ? '' : `  ${t.badges.join('')}`
  const right = `${badges}  ${age.padStart(AGE_CELLS)}`
  const room = Math.max(0, width - left.length - right.length)
  const text = room >= 6 ? clip(t.title || (t.why ?? ''), room) : ''
  return `${left}${text.padEnd(room)}${right}`.trimEnd()
}

// ---------------------------------------------------------------- the two choices

/** The longest a choice's value reads in the header. */
const VALUE_CELLS = 18

/** `QSL, quoin`, `all`, or how many where the names do not fit. */
const teamsText = (teams: readonly string[]): string => {
  if (teams.length === 0) return ALL
  const names = teams.join(', ')
  return names.length <= VALUE_CELLS ? names : `${teams.length} teams`
}

/** The teams after one is pressed: added or removed; every team where all or none is left. */
export function toggledTeams(selected: readonly string[], team: string): string[] {
  if (team === ALL) return [ALL]
  const isOn = selected.some(t => t.toLowerCase() === team.toLowerCase())
  const next = isOn ? selected.filter(t => t.toLowerCase() !== team.toLowerCase()) : [...selected, team]
  return next.length === 0 ? [ALL] : next
}

/** Saves a choice to the user's choices file, as `/factory teams` and `/factory focus` do, and reads for it. */
async function choose($: EngineInterface, change: (c: Picked) => Picked): Promise<void> {
  try {
    await writeChoice($, change)
  } catch (error) {
    await update($, workPicker, p => ({ ...p, error: `Could not save your choice: ${errorText(error)}` }))
    return
  }
  await choiceApplied($, false)
}

/** Opens a choice under the header, or closes it. */
async function openPicker($: EngineInterface, which: 'teams' | 'focus'): Promise<void> {
  // The focus choices are read when their list is opened.
  if (which === 'focus') markStale('choices')
  await update($, workPicker, p => ({ open: p.open === which ? null : which, error: null }))
}

/** Opens what `key` names, or closes it; what an opening shows is read at the next drawing. */
async function toggle($: EngineInterface, key: string): Promise<void> {
  // The events and Recent keep their own intervals: a source never read is due at once.
  markStale('projects')
  await update($, workOpen, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
  // With no lead open no project is read again, so a warning of the last read would stay after ix-board recovers.
  if (openLeads(await read($, workLeads), await read($, workOpen), await $.clock.now()).length === 0) await update($, workNameError, () => null)
}

/** The `r` key: the leads, then what is open, whatever was last read. */
async function refresh($: EngineInterface, options: Options): Promise<void> {
  await pollWork($, true)
  const sources = await workSources($, false)
  await Promise.all(
    sources.map(async s => {
      if (s === 'events') await pollEvents($)
      if (s === 'tickets') await pollTickets($)
      if (s === 'workLanes') await pollLanes($, options)
      if (s === 'membership') await pollFocus($, true, true, true)
      if (s === 'focus') await pollFocus($, true)
    }),
  )
}

export function registerWork(on: On, config: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const [leads, last, meta, feed, boards, opened, all, warnOpen, isFocusRead] = await Promise.all([read($, workLeads), read($, workLast), read($, workMeta), read($, workFeed), readBoards($), read($, workOpen), read($, workAll), read($, workWarnings), focusWasRead($)])
    const [picker, focusNow, lanes, projects, nameError] = await Promise.all([read($, workPicker), focusHeld($), lanesHeld($), read($, workProjects), read($, workNameError)])
    const ticketsError = boards.find(b => b.ticketsOnly === true)?.error ?? null
    const sel = getSelection()
    const scope = scopeOf(sel)
    const filter = focusFilter(scope.focus, scopeKeyOf(scope), focusNow.meta, focusNow.focuses, boards)
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const view = composeWork(leads, last, boards, filter)
    const counts = focusCounts(leads, boards, now, true, meta.listed, filter)
    const singles = singlesOf(boards)
    const isCurrent = readsCurrent(boards.find(b => b.ticketsOnly === true), feed, now)
    // Under a focus, a lead that was read and holds nothing of it, nor anything that may be of it, is folded away.
    const isOutside = (l: (typeof view.leads)[number]) => filter.kind === 'named' && l.readAt !== null && l.error === null && l.tickets.length + l.unplaced.length === 0
    const notes = boardNotes(boards, now)
    const oldAge = notes.oldAt === null ? null : agoShort(notes.oldAt, now)
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    // A lead is active where its report is not old and it has running work.
    const running = new Set(leads.filter(l => l.readAt !== null && l.error === null && !isOldReport(l.reportedAt, now) && l.agents.some(a => a.status === 'running')).map(l => l.address))
    // With no lead drawn and no read ended, nothing is known of them: no number is given.
    const unknown = view.leads.length > 0 ? null : meta.relayError !== null ? 'The leads could not be read.' : meta.at === null ? 'Reading the leads’ work reports…' : null

    if (e.props.placement === 'widget') {
      const isShort = counts.reporting < counts.listed
      const isBound = isShort || counts.unplaced > 0
      // With none known where some may be missing there is no number to give.
      const known = isBound && (counts.tickets ?? 0) === 0 ? '— tickets' : `${isBound ? '≥' : ''}${plural(counts.tickets ?? 0, 'ticket')}`
      const tickets = `${known}${counts.unplaced > 0 ? ` · +${counts.unplaced} unknown project` : ''}`
      const failed = view.leads.filter(l => l.readAt === null || l.error !== null).length
      const old = view.leads.filter(l => l.readAt !== null && l.error === null && isOldReport(l.at, now)).length
      const alerts = [failed > 0 ? `▲ ${failed}` : '', old > 0 ? `⏱ ${old}` : ''].filter(Boolean).map(t => ` · ${t}`).join('')
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{unknown ?? `${plural(view.leads.filter(l => !isOutside(l)).length, 'lead')} · ${running.size} active · ${tickets}${alerts}${filter.kind === 'unread' ? ' · focus not read' : ''}`}</Text>
        </Box>
      )
    }

    const isOpen = (key: string) => opened.includes(key)
    const flip = (key: string) => () => void toggle($, key)
    const fold = (key: string, label: string) => <Button key={key} plain label={`${isOpen(key) ? '▾' : '▸'} ${label}`} onPress={flip(key)} />
    // The host is the group: a lead is named by its workspace and tab.
    const leadName = (address: string) => address.split(':').slice(1).join(':')
    const hosts = [...new Set([...view.leads.map(l => l.address), ...meta.silent].map(hostOf))].sort((a, b) => a.localeCompare(b))

    // One column of names, so that every bar, count and alert starts at the same cell, whatever is open.
    const COUNT_CELLS = 4
    const ALERT_CELLS = 12
    const longest = Math.max(0, ...hosts.map(h => h.length + 2), ...view.leads.map(l => leadName(l.address).length + 4))
    const nameCells = Math.max(8, Math.min(longest, width - BAR_CELLS - COUNT_CELLS - ALERT_CELLS - 3))

    type Alert = { text: string; color?: string; words: string }
    /** What is to be said of a lead, the worst first: its row shows the first. */
    const alertsOf = (l: (typeof view.leads)[number]): Alert[] => {
      const raw = leads.find(r => r.address === l.address)!
      const said: Alert[] = []
      if (l.readAt === null) said.push({ text: '▲', color: 'warning', words: `report not read: ${l.error ?? 'no answer yet'}` })
      else if (l.error !== null) said.push({ text: `▲ ${agoShort(l.readAt, now)}`, color: 'warning', words: `report last read ${ago(l.readAt, now)}: ${l.error}` })
      const flag = flagOf(raw, lanes, singles, feed.turns?.[l.address], now, isCurrent)
      const since = flag === null || flag.since === null ? '' : ` ${agoShort(flag.since, now)}`
      if (flag?.kind === 'stuck') said.push({ text: `⚠${since}`, color: 'error', words: `⚠ stuck: ${flag.why}${since === '' ? '' : `, for${since}`}` })
      if (l.error === null && isOldReport(l.at, now)) said.push({ text: `⏱ ${agoShort(l.at!, now)}`, words: `⏱ old report: the lead last reported ${ago(l.at, now)}` })
      else if (flag?.kind === 'churning') said.push({ text: `⏱${since}`, color: 'warning', words: `⏱ no movement for${since}: ${flag.why}` })
      return said
    }

    /** Whether a lead may hold tickets that are not counted: its report never read, or tickets of unknown place. */
    const isShortOf = (l: (typeof view.leads)[number]) => l.readAt === null || l.unplaced.length > 0

    /**
     * The bar and count of some tickets, each drawn once; a canceled one is not drawn. Where some may be missing
     * (`isShort`) the count reads `≥N`, and `—` where none is known at all.
     */
    const barOf = (tickets: readonly WorkTicket[], key: string, isDim: boolean, isShort: boolean) => {
      const states = new Map<string, TicketState>()
      for (const t of tickets) if (t.state !== 'canceled' && (!states.has(t.id) || states.get(t.id) === 'new')) states.set(t.id, t.state)
      return [
        <Box key={`${key}-bar`} flexDirection="row" width={BAR_CELLS} flexShrink={0}>
          {barCells([...states.values()]).map(c => (
            <Text key={`${key}-${c.state}`} color={STATE_MARKS[c.state].color} dimColor={isDim}>{STATE_MARKS[c.state].mark.repeat(c.cells)}</Text>
          ))}
        </Box>,
        <Box key={`${key}-count`} flexDirection="row" width={COUNT_CELLS} justifyContent="flex-end" flexShrink={0}>
          <Text dimColor={isDim} tabular>{!isShort ? String(states.size) : states.size === 0 ? '—' : `≥${states.size}`}</Text>
        </Box>,
      ]
    }

    const leadBlock = (l: (typeof view.leads)[number]) => {
      const key = `lead:${l.address}`
      const isShown = isOpen(key)
      const isOld = isOldReport(l.at, now)
      const said = alertsOf(l)
      const row = said[0]
      const every = [...l.tickets, ...l.unplaced]
      const ticket = (t: WorkTicket) => (
        <Box key={`${l.address}-${t.id}`} flexDirection="row">
          <Box flexDirection="row" paddingLeft={3}>
            <Text color={STATE_MARKS[t.state].color} dimColor={isOld}>{STATE_MARKS[t.state].mark}</Text>
          </Box>
          <Text dimColor={isOld} wrap="truncate-end">{ticketLine(t, now, width - 2).slice(2)}</Text>
        </Box>
      )
      // Each project over its tickets, in the order the first of each is listed.
      const heading = (id: string | null | undefined) => (id === null ? 'no project' : id === undefined ? 'project unknown' : (projects[id] ?? (id in projects ? `project ${id.slice(0, 8)}` : 'project …')))
      const groups = [...new Set(l.tickets.map(t => t.project))]
      const unread = every.filter(t => t.state === 'unread').length
      return (
        <Box key={`lead-${l.address}`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Box flexDirection="row" width={nameCells} flexShrink={0} paddingLeft={2} gap={1}>
              <Button key={key} plain label={isShown ? '▾' : '▸'} onPress={flip(key)} />
              <Text dimColor={isOld} wrap="truncate-end">{clip(leadName(l.address), nameCells - 4)}</Text>
            </Box>
            {barOf(l.tickets, l.address, isOld, isShortOf(l))}
            {row !== undefined && <Text color={row.color} dimColor={row.color === undefined}>{row.text}</Text>}
          </Box>
          {isShown && said.map((a, i) => <Text key={`said-${l.address}-${i}`} color={a.color} dimColor={a.color === undefined} wrap="wrap">{`    ${a.words}`}</Text>)}
          {isShown && groups.map(id => (
            <Box key={`group-${l.address}-${id}`} flexDirection="column">
              <Box flexDirection="row" paddingLeft={3}>
                <Text weight="semibold" wrap="truncate-end">{heading(id)}</Text>
              </Box>
              {l.tickets.filter(t => t.project === id).map(ticket)}
            </Box>
          ))}
          {isShown && unread > 0 && <Text dimColor wrap="wrap">{`    ? ${plural(unread, 'ticket')} with no state: ${ticketsError ?? 'ix-board has not said'}`}</Text>}
          {isShown && l.readAt !== null && every.length === 0 && <Text dimColor>{l.outside > 0 ? '    no ticket in this focus' : '    no ticket reported'}</Text>}
          {isShown && every.length === 0 && l.summary !== '' && <Text dimColor wrap="truncate-end">{`    focus: ${l.summary}`}</Text>}
          {isShown && l.unplaced.length > 0 && <Box flexDirection="row" paddingLeft={3}>{fold(`unplaced-${l.address}`, `${plural(l.unplaced.length, 'ticket')} with unknown project`)}</Box>}
          {isShown && isOpen(`unplaced-${l.address}`) && l.unplaced.map(ticket)}
        </Box>
      )
    }

    const hostBlock = (host: string) => {
      const key = `host:${host}`
      const mine = view.leads.filter(l => hostOf(l.address) === host)
      const silent = meta.silent.filter(a => hostOf(a) === host)
      const inside = mine.filter(l => !isOutside(l))
      const outside = mine.filter(isOutside)
      const oldLeads = inside.filter(l => isOldLead({ readAt: l.readAt, reportedAt: l.at }, now))
      const fresh = inside.filter(l => !oldLeads.includes(l))
      const shown = inside.map(l => alertsOf(l)[0]?.text ?? '')
      // Every stuck lead of the host, whatever its row shows first, those folded away under a focus among them.
      const stuck = mine.filter(l => alertsOf(l).some(a => a.text.startsWith('⚠'))).length
      const late = shown.filter(t => t.startsWith('⏱')).length
      const unread = shown.filter(t => t.startsWith('▲')).length
      return (
        <Box key={`host-block-${host}`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Box flexDirection="row" width={nameCells} flexShrink={0}>
              <Button key={key} plain label={`${isOpen(key) ? '▾' : '▸'} ${clip(host, nameCells - 2)}`} onPress={flip(key)} />
            </Box>
            {barOf(inside.flatMap(l => l.tickets), host, false, inside.some(isShortOf))}
            {stuck > 0 && <Text color="error">{`⚠ ${stuck}`}</Text>}
            {late > 0 && <Text color="warning">{`⏱ ${late}`}</Text>}
            {unread > 0 && <Text color="warning">{`▲ ${unread}`}</Text>}
          </Box>
          {isOpen(key) && fresh.map(leadBlock)}
          {isOpen(key) && oldLeads.length > 0 && <Box flexDirection="row" paddingLeft={2}>{fold(`old:${host}`, `⏱ ${oldLeads.length}`)}</Box>}
          {isOpen(key) && isOpen(`old:${host}`) && oldLeads.map(leadBlock)}
          {isOpen(key) && outside.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              <Box flexDirection="row">{fold(`outside:${host}`, `${plural(outside.length, 'lead')} with nothing in this focus`)}</Box>
              {isOpen(`outside:${host}`) && outside.map(l => <Text key={`outside-${l.address}`} dimColor wrap="truncate-end">{`   ${l.address} · ${l.outside === 0 ? 'no ticket reported' : `${plural(l.outside, 'ticket')} outside the focus`}`}</Text>)}
            </Box>
          )}
          {isOpen(key) && silent.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              <Box flexDirection="row">{fold(`silent:${host}`, `${silent.length} ${silent.length === 1 ? 'lead reports' : 'leads report'} no work`)}</Box>
              {isOpen(`silent:${host}`) && <Text dimColor wrap="wrap">{silent.join(', ')}</Text>}
            </Box>
          )}
        </Box>
      )
    }

    const events = focusEvents(feed.events, filter, focusTeams(scope))
    const rows = recentRows(recentOf(view.activity, events.events, all, focusTeams(scope)), RECENT_ROWS)
    // Why ix-board's part of Recent is not there; the relay's events show without it.
    const focuses = boards.filter(b => b.ticketsOnly !== true)
    const none = focuses.some(b => b.error) ? 'ix-board’s focus status could not be read.' : isFocusRead && focuses.length === 0 ? 'No focus names a project or ticket, so there is no focus status to read merges from.' : 'Waiting for ix-board’s focus status…'
    const missing = !view.hasBoard ? none : view.activity === null ? 'needs ix-board ≥0.9.0' : null
    const isRecent = isOpen('recent')
    const nothing = oldAge !== null ? 'Nothing merged in that answer.' : all ? 'Nothing happened lately.' : 'Nothing merged lately.'
    const recent = () => (
      <Box flexDirection="column">
        {oldAge !== null && <Text color="warning" size="caption">{`⏱ ${oldAge}`}</Text>}
        {rows.map((row, i) => {
          const m = row.event !== undefined ? STEP_MARKS[row.event.step] : KIND_MARKS[row.activity.kind]
          return (
            <Box key={`act-${i}-${row.at}`} flexDirection="row" gap={1}>
              <Text color={m.color}>{m.mark}</Text>
              <Text wrap="truncate-end">{recentLine(row, now)}</Text>
            </Box>
          )
        })}
        {all && events.unplaced > 0 && <Text dimColor>{`${plural(events.unplaced, 'event')} of tickets with unknown project not listed`}</Text>}
        {missing !== null && <Text dimColor>{missing}</Text>}
        {missing === null && rows.length === 0 && <Text dimColor>{nothing}</Text>}
      </Box>
    )

    const warnings = [...[meta.error, feed.error].flatMap(e => (e === null ? [] : e.split(' · '))), ...[...new Set([...notes.errors, ...(nameError === null ? [] : [nameError])])].map(e => `ix-board: ${e}`)]
    const isHeld = focusNow.meta.heldFor === scopeKeyOf(scope)
    const notice = isHeld ? focusNotice(focusNow.meta.chosen) : null
    // A stored value that is no focus was said when the files were read.
    const ignored = scope.focus === ALL ? sel.notes.filter(n => n.includes(NOT_A_FOCUS)) : []
    const filterNotes = [...ignored, ...(notice === null ? [] : [notice]), ...(filter.kind === 'unread' ? [filter.why] : [])]
    const teams = focusTeams(scope) ?? []
    const isOn = (value: boolean) => (value ? '✓ ' : '  ')
    const known = [...teams, ...meta.teams].filter((t, i, list) => list.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i).sort((a, b) => a.localeCompare(b))
    // A choice that is no focus is all.
    const chosen = isHeld && focusNow.meta.chosen?.value === scope.focus ? focusNow.meta.chosen : undefined
    const focus = chosen !== undefined && !chosen.known ? ALL : scope.focus
    const offered = focusNow.meta.options
    // The chosen focus is listed although no lead of these teams reports it.
    const extra = focus === ALL || (offered ?? []).some(o => o.value === focus) ? [] : [{ value: focus, kind: parseRef(focus)?.kind ?? 'project', name: chosen?.name ?? null }]
    const listed = [...(offered ?? []), ...extra]
    const nameOf = (value: string) => labelOf(value, listed.find(o => o.value === value)?.name)
    const focusName = focus === ALL ? ALL : nameOf(focus)
    const choices = [
      { value: ALL, label: ALL },
      // An initiative and a project of one name are told apart.
      ...listed.map(o => ({ value: o.value, label: listed.filter(p => nameOf(p.value) === nameOf(o.value)).length > 1 ? `${nameOf(o.value)} (${o.kind})` : nameOf(o.value) })),
    ]
    const pickTeam = (t: string) => () => void choose($, c => ({ ...c, teams: toggledTeams(teams, t) }))
    const options =
      picker.open === 'teams' ? (
        <Box key="teams-picker" flexDirection="column" paddingLeft={2}>
          <Button key="team-option-all" plain label={`${isOn(teams.length === 0)}all teams`} onPress={pickTeam(ALL)} />
          {known.map(t => (
            <Button key={`team-option-${t}`} plain label={`${isOn(teams.some(o => o.toLowerCase() === t.toLowerCase()))}${t}`} onPress={pickTeam(t)} />
          ))}
        </Box>
      ) : picker.open === 'focus' ? (
        <Box key="focus-picker" flexDirection="column" paddingLeft={2}>
          {choices.map(o => (
            <Button key={`focus-option-${o.value}`} plain label={`${isOn(o.value === focus)}${o.label}`} onPress={() => void choose($, c => ({ ...c, focus: o.value })).then(() => update($, workPicker, p => ({ ...p, open: null })))} />
          ))}
          {offered === undefined && <Text dimColor size="caption">not read yet</Text>}
          {offered?.length === 0 && <Text dimColor size="caption">no lead reports an initiative or project</Text>}
        </Box>
      ) : null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">Work</Text>
            <Button key="teams-choice" plain label={`Teams: ${teamsText(teams)} ▾`} onPress={() => void openPicker($, 'teams')} />
            <Button key="focus-choice" plain label={`Focus: ${clip(focusName, VALUE_CELLS)} ▾`} onPress={() => void openPicker($, 'focus')} />
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void refresh($, config)} />
        </Box>
        {(options !== null || picker.error !== null || filterNotes.length > 0) && (
          <Box flexDirection="column">
            {options}
            {picker.error !== null && <Text color="warning" size="caption">{picker.error}</Text>}
            {filterNotes.map((t, i) => <Text key={`filter-${i}`} color="warning" size="caption">{t}</Text>)}
          </Box>
        )}

        {/* A read that failed says nothing of who has reported. */}
        {view.leads.length === 0 && <Text dimColor>{unknown ?? (meta.busy ? 'Reading the leads’ work reports…' : 'No lead has reported work.')}</Text>}

        {hosts.length > 0 && (
          <Box flexDirection="column" backgroundColor={CARD_BG}>
            {hosts.map(hostBlock)}
          </Box>
        )}
        {meta.pending > 0 && <Text dimColor>{`${plural(meta.pending, 'lead')} being read by another session`}</Text>}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            {fold('recent', 'Recent')}
            {isRecent && (
              <Box flexDirection="row" gap={1}>
                <Text dimColor size="caption">{all ? 'all ·' : 'merges ·'}</Text>
                <Button key="kinds" plain label={all ? 'a merges' : 'a all'} hotkey="a" onPress={() => void update($, workAll, v => !v)} />
              </Box>
            )}
          </Box>
          {isRecent && recent()}
        </Box>

        {warnings.length > 0 && warnOpen && (
          <Box key="warnings" flexDirection="column">
            {warnings.map((t, i) => <Text key={`w-${i}`} color="warning" size="caption">{t}</Text>)}
          </Box>
        )}
        <Box flexDirection="row" justifyContent="flex-end" gap={2} alignItems="center">
          {warnings.length > 0 && (
            <Box key="warnings-chip" flexDirection="row" gap={1}>
              <Text color="warning">⚠</Text>
              <Button key="warnings-toggle" plain label={String(warnings.length)} onPress={() => void update($, workWarnings, v => !v)} />
            </Box>
          )}
          <Text color="subtle" size="caption">{meta.busy ? 'refreshing…' : `updated ${ago(meta.at, now)}`}</Text>
        </Box>
        {e.props.placement === 'inline' && <Text dimColor size="caption">Type a band number to switch views · r refresh · a all events · Esc close</Text>}
      </Box>
    )
  })
}
