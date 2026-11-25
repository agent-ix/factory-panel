import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { WorkAgent, WorkFeed, WorkLast, WorkLead, WorkMeta } from '../types'
import { CARD_BG, ago, agoShort, errorText, runJson } from './shared'
import { LEAD_REUSE_MS, RELAY_TIMEOUT_MS, listLeads, readLead, twice } from './leads'
import type { LeadRead, WorkReport } from './leads'
import { focusTeams, statusOf, teamOf } from './band/modules'
import { track } from './schedule'
import { getSelection, scopeOf, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'
import { composeWork, foldFeed, isCutWithin, lastOfEvents, mergedSince, readBoards, recentOf, recentRows, ticketIds } from './work'
import type { RecentEntry, WorkTicket } from './work'
import type { Options } from './shared'

// The Work pane: who works on what right now. One block per code lead, from the relay's work reports
// (`agent-msg who`, `agent-msg work --lead <a> show`), with each ticket's state, title and PRs from the focus status
// ix-board already answers for the Focus pane, then what happened lately: the merges, and on `a` every ticket event
// and the review, spec and gate starts and finishes of `agent-msg work events`.

const PANE = 'work'
const TITLE = 'Work'
export const PANE_SPEC = { id: PANE, title: TITLE }
/** The events are read in pages of this size, at most EVENT_PAGES of them: the stream starts at the oldest transition. */
const EVENT_LIMIT = 1000
const EVENT_PAGES = 5
const RECENT_ROWS = 10

const workLeads = atom({ plugin: 'factory-panel', key: 'workLeads' } as const, [] as WorkLead[], { shape: 'workLeads-3' })
const workLast = atom({ plugin: 'factory-panel', key: 'workLast' } as const, {} as Record<string, WorkLast>, { shape: 'workLast-1' })
const workMeta = atom({ plugin: 'factory-panel', key: 'workMeta' } as const, { at: null, busy: false, error: null, relayError: null, listed: 0, silent: [] } as WorkMeta, { shape: 'workMeta-4' })
const EMPTY_FEED: WorkFeed = { events: [], phase: {}, error: null }
const workFeed = atom({ plugin: 'factory-panel', key: 'workFeed' } as const, EMPTY_FEED, { shape: 'workFeed-1' })
export const workCollapsed = atom({ plugin: 'factory-panel', key: 'workCollapsed' } as const, [] as string[])
const workAll = atom({ plugin: 'factory-panel', key: 'workAll' } as const, false)
const workWarnings = atom({ plugin: 'factory-panel', key: 'workWarnings' } as const, false)

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
    if (read === undefined) return drawn.filter(l => l.address === address)
    if (read.report) return [{ ...leadOf(address, read.report), error: read.error, readAt: read.at }]
    // A report of nothing is a report too: such a lead that stops answering is old, and one never read has no age.
    return read.error === null ? [] : [{ address, status: 'unknown', reportedAt: null, agents: [], focus: null, error: read.error, readAt: read.at }]
  })
}

type EventPage = { events?: unknown[]; has_more?: boolean; next_cursor?: string }

const STREAM_START = '0-0'
/** Where the last read of the event stream ended: the next read asks only for what came after. */
let eventCursor = STREAM_START

type Read = { last: Record<string, WorkLast>; feed: Pick<WorkFeed, 'events' | 'phase'>; cursor: string; truncated: boolean }

/**
 * The latest transition of each (lead, ticket), folded into `prior`, and the role events, folded into `held`. The
 * stream starts at its oldest event, so a read resumes after the cursor the last one ended at, at most EVENT_PAGES
 * pages at a time. Where the cap is reached with more to come, `truncated` is true and the next read carries on from
 * where this one stopped.
 */
async function readEvents($: EngineInterface, prior: Record<string, WorkLast>, held: WorkFeed): Promise<Read> {
  const last = { ...prior }
  // A read from the start of the stream tells the whole story again: nothing held is added to.
  let feed: Pick<WorkFeed, 'events' | 'phase'> = eventCursor === STREAM_START ? EMPTY_FEED : held
  let cursor = eventCursor
  let more = false
  for (let page = 0; page < EVENT_PAGES; page++) {
    const answer = await twice(() => runJson<EventPage>($, ['agent-msg', 'work', 'events', '--limit', String(EVENT_LIMIT), '--after', cursor], RELAY_TIMEOUT_MS))
    const events = Array.isArray(answer.events) ? answer.events : []
    lastOfEvents(events, last)
    feed = foldFeed(events, feed)
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
  running = null
  runningEvents = null
  eventCursor = STREAM_START
}

/** The events are a source of their own: they wait on no lead's report, and where they fail the tickets still show. */
async function refreshEvents($: EngineInterface): Promise<boolean> {
  try {
    const answer = await readEvents($, await read($, workLast), await read($, workFeed))
    eventCursor = answer.cursor
    await update($, workLast, () => answer.last)
    const note = answer.truncated ? `agent-msg work events: more than ${EVENT_PAGES * EVENT_LIMIT} events behind, catching up` : null
    await update($, workFeed, () => ({ ...answer.feed, error: note }))
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
    try {
      addresses = (await listLeads($)).filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
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
    const silent = [...reads.values()].filter(r => r.error === null && !r.report).map(r => r.address).sort((a, b) => a.localeCompare(b))
    await update($, workMeta, () => ({ at: now, busy: false, error: failed.length === 0 ? null : failed.join(' · '), relayError, listed: reads.size, silent }))
    return failure === null
  } catch (error) {
    await update($, workMeta, m => ({ ...m, busy: false, error: errorText(error), relayError: errorText(error) }))
    return false
  }
}

// ---------------------------------------------------------------- pane

const MARKS: Record<string, { mark: string; color: string }> = {
  running: { mark: '◐', color: 'claude' },
  waiting: { mark: '◌', color: 'warning' },
  failed: { mark: '✕', color: 'error' },
  done: { mark: '✓', color: 'success' },
}
const UNKNOWN = { mark: '◌', color: 'inactive' }
/** The mark of a lead whose report the last read did not get. */
const NOT_READ = { mark: '▲', color: 'warning' }

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

/**
 * One ticket line: `   QSL-1240 Coding proof gate…  [pr][review×2]  reviewer running 4m`, the title taking the room left. Where the
 * full last action leaves the title less than 10 cells it is cut to the role and the age.
 */
export function ticketLine(t: WorkTicket, now: number, width: number): string {
  const left = `   ${t.id}${t.state === null ? '' : ` ${t.state}`} `
  const make = (action: string): string => [t.badges.join(''), action].filter(Boolean).join('  ')
  const age = t.lastAction === null ? '' : agoShort(t.lastAction.at, now)
  const full = t.lastAction === null ? '' : `${t.lastAction.what} ${age}`
  const short = t.lastAction === null ? '' : `${t.lastAction.what.split(' ')[0]} ${age}`
  let right = make(full)
  if (width - left.length - right.length - 2 < 10) right = make(short)
  const room = width - left.length - right.length - 2
  const title = t.title === '' ? '' : room >= 6 ? clip(t.title, room).padEnd(room) : ''
  return `${left}${title}${title === '' && right !== '' ? '' : '  '}${right}`.trimEnd()
}

async function toggleCollapsed($: EngineInterface, address: string): Promise<void> {
  await update($, workCollapsed, list => (list.includes(address) ? list.filter(a => a !== address) : [...list, address]))
}

export function registerWork(on: On, _options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const [leads, last, meta, feed, boards, collapsed, all, warnOpen] = await Promise.all([read($, workLeads), read($, workLast), read($, workMeta), read($, workFeed), readBoards($), read($, workCollapsed), read($, workAll), read($, workWarnings)])
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const view = composeWork(leads, last, boards)
    const tickets = ticketIds(leads).length
    // A lead whose report was never read may hold more tickets; one drawn as last read is marked old on its row.
    const unread = view.leads.filter(l => l.readAt === null).length
    const old = view.leads.filter(l => l.readAt !== null && l.error !== null).length
    const notRead = [unread > 0 ? `${unread} not read` : '', old > 0 ? `${old} old` : ''].filter(Boolean).map(t => ` · ${t}`).join('')
    const merged = `${isCutWithin(view.cutAt, now, 24) ? '≥' : ''}${mergedSince(view.activity, now, 24)}`

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{`${view.leads.length} lead${view.leads.length === 1 ? '' : 's'} · ${unread > 0 ? '≥' : ''}${tickets} ticket${tickets === 1 ? '' : 's'}${view.activity === null ? '' : ` · ${merged} merged 24h`}${notRead}`}</Text>
        </Box>
      )
    }

    const leadBlock = (l: (typeof view.leads)[number]) => {
      const isOpen = !collapsed.includes(l.address)
      const isFailed = l.error !== null
      const m = isFailed ? NOT_READ : (MARKS[l.status] ?? UNKNOWN)
      const age = l.readAt === null ? 'not read' : isFailed ? `old ${agoShort(l.readAt, now)}` : l.at === null ? '—' : agoShort(l.at, now)
      return (
        <Box key={`lead-${l.address}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1} alignItems="center">
              <Button key={`toggle-${l.address}`} plain label={isOpen ? '▾' : '▸'} onPress={() => void toggleCollapsed($, l.address)} />
              <Text color={m.color}>{m.mark}</Text>
              <Text wrap="truncate-end">{l.address}</Text>
              {!isOpen && l.readAt !== null && <Text dimColor>{`(${l.tickets.length} ticket${l.tickets.length === 1 ? '' : 's'})`}</Text>}
            </Box>
            <Text dimColor size="caption" tabular>{age}</Text>
          </Box>
          {isOpen && l.tickets.map(t => <Text key={`${l.address}-${t.id}`} wrap="truncate-end">{ticketLine(t, now, width)}</Text>)}
          {isOpen && l.readAt !== null && l.tickets.length === 0 && <Text dimColor>   no ticket reported</Text>}
          {isOpen && l.tickets.length === 0 && l.summary !== '' && <Text dimColor wrap="truncate-end">{`   focus: ${l.summary}`}</Text>}
        </Box>
      )
    }

    const rows = recentRows(recentOf(view.activity, feed.events, all, focusTeams(scopeOf(getSelection()))), RECENT_ROWS)
    // Why ix-board's part of Recent is not there; the relay's events show without it.
    const missing = !view.hasBoard ? 'Waiting for ix-board’s focus status…' : view.activity === null ? 'needs ix-board ≥0.9.0' : null
    const recent = () => (
      <Box flexDirection="column">
        {rows.map((row, i) => {
          const m = row.event !== undefined ? STEP_MARKS[row.event.step] : KIND_MARKS[row.activity.kind]
          return (
            <Box key={`act-${i}-${row.at}`} flexDirection="row" gap={1}>
              <Text color={m.color}>{m.mark}</Text>
              <Text wrap="truncate-end">{recentLine(row, now)}</Text>
            </Box>
          )
        })}
        {missing !== null && <Text dimColor>{missing}</Text>}
        {missing === null && rows.length === 0 && <Text dimColor>{all ? 'Nothing happened lately.' : 'Nothing merged lately.'}</Text>}
      </Box>
    )

    const warnings = [meta.error, feed.error].flatMap(e => (e === null ? [] : e.split(' · ')))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">Work</Text>
            <Text dimColor size="caption">{`${view.leads.length} ${view.leads.length === 1 ? 'lead' : 'leads'}${notRead}`}</Text>
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void Promise.all([pollWork($, true), pollEvents($)])} />
        </Box>

        {/* A read that failed says nothing of who has reported. */}
        {view.leads.length === 0 && (
          <Text dimColor>{meta.relayError !== null ? 'The leads could not be read.' : meta.busy || meta.at === null ? 'Reading the leads’ work reports…' : 'No lead has reported work.'}</Text>
        )}

        {view.leads.length > 0 && (
          <Box flexDirection="column" backgroundColor={CARD_BG}>
            {view.leads.map(leadBlock)}
          </Box>
        )}

        {meta.silent.length > 0 && (
          <Text dimColor wrap="wrap">{`${meta.silent.length} ${meta.silent.length === 1 ? 'lead reports' : 'leads report'} no work: ${meta.silent.join(', ')}`}</Text>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text dimColor>── Recent ──</Text>
            <Box flexDirection="row" gap={1}>
              <Text dimColor size="caption">{all ? 'all ·' : 'merges ·'}</Text>
              <Button key="kinds" plain label={all ? 'a merges' : 'a all'} hotkey="a" onPress={() => void update($, workAll, v => !v)} />
            </Box>
          </Box>
          {recent()}
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
