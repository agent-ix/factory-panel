import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { WorkAgent, WorkLast, WorkLead, WorkMeta } from '../types'
import { CARD_BG, ago, agoShort, errorText, runJson } from './shared'
import { WORK_TIMEOUT_MS, listLeads, readReport } from './focus'
import type { WorkReport } from './focus'
import { focusTeams, statusOf, teamOf } from './band/modules'
import { track } from './schedule'
import { getSelection, scopeOf, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'
import { composeWork, lastOfEvents, mergedSince, readBoards } from './work'
import type { WorkTicket } from './work'
import type { Options } from './shared'

// The Work pane: who works on what right now. One block per code lead, from the relay's work reports
// (`agent-msg who`, `agent-msg work --lead <a> show`, `agent-msg work events`), with each ticket's state, title and PRs
// from the focus status ix-board already answers for the Focus pane, then what merged lately.

const PANE = 'work'
const TITLE = 'Work'
export const PANE_SPEC = { id: PANE, title: TITLE }
/** The events are read in pages of this size, at most EVENT_PAGES of them: the stream starts at the oldest transition. */
const EVENT_LIMIT = 1000
const EVENT_PAGES = 5
const RECENT_ROWS = 10

const workLeads = atom({ plugin: 'factory-panel', key: 'workLeads' } as const, [] as WorkLead[], { shape: 'workLeads-1' })
const workLast = atom({ plugin: 'factory-panel', key: 'workLast' } as const, {} as Record<string, WorkLast>, { shape: 'workLast-1' })
const workMeta = atom({ plugin: 'factory-panel', key: 'workMeta' } as const, { at: null, busy: false, error: null } as WorkMeta, { shape: 'workMeta-1' })
export const workCollapsed = atom({ plugin: 'factory-panel', key: 'workCollapsed' } as const, [] as string[])
const workAll = atom({ plugin: 'factory-panel', key: 'workAll' } as const, false)
const workWarnings = atom({ plugin: 'factory-panel', key: 'workWarnings' } as const, false)

// ---------------------------------------------------------------- data

const agentsOf = (report: WorkReport): WorkAgent[] =>
  (report.agents ?? []).map(a => ({ name: a.name ?? '', ticket: a.ticket ?? '', role: a.role ?? '', status: a.status ?? '', reportedAt: typeof a.reported_at_ms === 'number' ? a.reported_at_ms : null }))

const leadOf = (address: string, report: WorkReport): WorkLead => {
  const agents = agentsOf(report)
  const times = [...agents.map(a => a.reportedAt), report.focus?.reported_at_ms, report.scope?.reported_at_ms].filter((t): t is number => typeof t === 'number')
  return { address: report.binding?.address ?? address, status: statusOf(report.agents), reportedAt: times.length === 0 ? null : Math.max(...times), agents }
}

type EventPage = { events?: unknown[]; has_more?: boolean; next_cursor?: string }

/** Where the last read of the event stream ended: the next read asks only for what came after. */
let eventCursor = '0-0'

/**
 * The latest transition of each (lead, ticket), folded into `prior`. The stream starts at its oldest event, so a read
 * resumes after the cursor the last one ended at, at most EVENT_PAGES pages at a time. Where the cap is reached with more to
 * come, `truncated` is true and the next read carries on from where this one stopped.
 */
async function readLast($: EngineInterface, prior: Record<string, WorkLast>): Promise<{ last: Record<string, WorkLast>; cursor: string; truncated: boolean }> {
  const last = { ...prior }
  let cursor = eventCursor
  let more = false
  for (let page = 0; page < EVENT_PAGES; page++) {
    const answer = await runJson<EventPage>($, ['agent-msg', 'work', 'events', '--limit', String(EVENT_LIMIT), '--after', cursor], WORK_TIMEOUT_MS)
    lastOfEvents(Array.isArray(answer.events) ? answer.events : [], last)
    if (typeof answer.next_cursor === 'string') cursor = answer.next_cursor
    more = answer.has_more === true && typeof answer.next_cursor === 'string'
    if (!more) break
  }
  return { last, cursor, truncated: more }
}

let running: Promise<boolean> | null = null

/** Reads the leads and their work reports; one read at a time. False when the relay could not be read. */
export function pollWork($: EngineInterface): Promise<boolean> {
  running ??= track($, 'work', () => refreshWork($)).finally(() => {
    running = null
  })
  return running
}

/** Forgets a read under way; the tests start each session from nothing. */
export function resetWork(): void {
  running = null
  eventCursor = '0-0'
}

function readLastHeld($: EngineInterface): Promise<Record<string, WorkLast>> {
  return read($, workLast)
}

async function refreshWork($: EngineInterface): Promise<boolean> {
  // The first drawing shows that a read is under way before anything has answered.
  await update($, workMeta, m => ({ ...m, busy: true }))
  const errors: string[] = []
  /** Warnings that are not failures of a source. */
  const notes: string[] = []
  try {
    await selectionReady()
    const teams = focusTeams(scopeOf(getSelection()))
    let addresses: string[]
    try {
      addresses = (await listLeads($)).filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
    } catch (error) {
      sourceFailed('agent-msg work', errorText(error))
      throw error
    }
    const reads = await Promise.all(addresses.map(async address => ({ address, read: await readReport($, address) })))
    const leads: WorkLead[] = []
    const failed: string[] = []
    for (const { address, read: r } of reads) {
      if ('error' in r) failed.push(`${address}: ${r.error}`)
      else if (r.report !== null) leads.push(leadOf(address, r.report))
    }
    // A lead with no live agent fails its read as a matter of course: that is a source error only where every read failed.
    if (failed.length > 0 && failed.length === reads.length) errors.push(failed.join(' · '))
    if (errors.length === 0) sourceOk('agent-msg work', await $.clock.now())
    else sourceFailed('agent-msg work', errors.join(' · '))
    await update($, workLeads, () => leads)
    // The last actions are a second source: where they fail the tickets still show, with the time of the agents' reports.
    try {
      const read = await readLast($, await readLastHeld($))
      eventCursor = read.cursor
      await update($, workLast, () => read.last)
      if (read.truncated) notes.push(`agent-msg work events: more than ${EVENT_PAGES * EVENT_LIMIT} events behind, catching up`)
    } catch (error) {
      errors.push(`agent-msg work events: ${errorText(error)}`)
    }
    const now = await $.clock.now()
    await update($, workMeta, () => ({ at: now, busy: false, error: errors.length + notes.length === 0 ? null : [...errors, ...notes].join(' · ') }))
    return errors.length === 0
  } catch (error) {
    await update($, workMeta, m => ({ ...m, busy: false, error: errorText(error) }))
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

const KIND_MARKS = { merged: { mark: '✓', color: 'success' }, closed: { mark: '●', color: 'warning' }, opened: { mark: '○', color: 'subtle' } } as const

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
    const [leads, last, meta, boards, collapsed, all, warnOpen] = await Promise.all([read($, workLeads), read($, workLast), read($, workMeta), readBoards($), read($, workCollapsed), read($, workAll), read($, workWarnings)])
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const view = composeWork(leads, last, boards)
    const tickets = view.leads.reduce((n, l) => n + l.tickets.length, 0)
    const merged = mergedSince(view.activity, now, 24)

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{`${view.leads.length} lead${view.leads.length === 1 ? '' : 's'} · ${tickets} ticket${tickets === 1 ? '' : 's'}${view.activity === null ? '' : ` · ${merged} merged 24h`}`}</Text>
        </Box>
      )
    }

    const leadBlock = (l: (typeof view.leads)[number]) => {
      const isOpen = !collapsed.includes(l.address)
      const m = MARKS[l.status] ?? UNKNOWN
      return (
        <Box key={`lead-${l.address}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1} alignItems="center">
              <Button key={`toggle-${l.address}`} plain label={isOpen ? '▾' : '▸'} onPress={() => void toggleCollapsed($, l.address)} />
              <Text color={m.color}>{m.mark}</Text>
              <Text wrap="truncate-end">{l.address}</Text>
              {!isOpen && <Text dimColor>{`(${l.tickets.length} ticket${l.tickets.length === 1 ? '' : 's'})`}</Text>}
            </Box>
            <Text dimColor size="caption" tabular>{l.at === null ? '—' : agoShort(l.at, now)}</Text>
          </Box>
          {isOpen && l.tickets.map(t => <Text key={`${l.address}-${t.id}`} wrap="truncate-end">{ticketLine(t, now, width)}</Text>)}
          {isOpen && l.tickets.length === 0 && <Text dimColor>   no ticket reported</Text>}
        </Box>
      )
    }

    const rows = (view.activity ?? []).filter(a => all || a.kind === 'merged').slice(0, RECENT_ROWS)
    const repoName = (repo: string | null) => (repo === null ? '' : repo.split('/').pop() ?? repo)
    const recent = () => {
      if (!view.hasBoard) return <Text dimColor>Waiting for ix-board’s focus status…</Text>
      if (view.activity === null) return <Text dimColor>needs ix-board ≥0.9.0</Text>
      if (rows.length === 0) return <Text dimColor>{all ? 'Nothing happened lately.' : 'Nothing merged lately.'}</Text>
      return (
        <Box flexDirection="column">
          {rows.map((a, i) => {
            const m = KIND_MARKS[a.kind]
            const ref = a.repo === null || a.number === null ? '' : `${repoName(a.repo)}#${a.number}  `
            return (
              <Box key={`act-${i}-${a.identifier}-${a.at}`} flexDirection="row" gap={1}>
                <Text color={m.color}>{m.mark}</Text>
                <Text wrap="truncate-end">{`${agoShort(a.at, now).padEnd(3)} ${ref}${a.identifier} ${a.title}`}</Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    const warnings = meta.error === null ? [] : meta.error.split(' · ')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">Work</Text>
            <Text dimColor size="caption">{view.leads.length} {view.leads.length === 1 ? 'lead' : 'leads'}</Text>
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollWork($)} />
        </Box>

        {view.leads.length === 0 && (
          <Text dimColor>{meta.busy || meta.at === null ? 'Reading the leads’ work reports…' : 'No lead has reported work.'}</Text>
        )}

        {view.leads.length > 0 && (
          <Box flexDirection="column" backgroundColor={CARD_BG}>
            {view.leads.map(leadBlock)}
          </Box>
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
