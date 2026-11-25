import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { boardOf, composeWork, lastOfEvents, mergeBoards } from '../hooks/work'
import { runFactory } from '../hooks/router'
import { ticketLine } from '../hooks/workview'
import { VIEW_IDS } from '../hooks/views'
import { fake$, options, out, report, startSession, world } from './world'
import type { World } from './world'
import { ix } from './board-kit'

// Tests for the Work tab (FR-028): the leads and their tickets from the relay, the tickets' state, PRs and the recent
// activity from the focus status ix-board already answers.

const LEAD = 'draco:QSL:arch'
const IDLE = 'titan:QSL:code'
const NOW = Date.UTC(2026, 10, 24, 12, 0)
const MIN = 60_000
type $t = Parameters<TestBody>[0]

const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'work', props: { title: 'Work', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const

const agent = (name: string, ticket: string, role: string, status: string, ago: number) => ({ agent_id: name, name, ticket, role, status, pane: null, session: null, reported_at_ms: NOW - ago * MIN })

const pr = (status: string, number = 412, repo = 'agent-ix/filament-mltl') => ({ url: `https://github.com/${repo}/pull/${number}`, repo, number, status, draft: status === 'draft', created_at: null, merged_at: null })
const issue = (identifier: string, title: string, state: string, prs?: unknown[]) => ({ id: `id-${identifier}`, identifier, title, state, ...(prs === undefined ? {} : { assignee: null, started_at: null, completed_at: null, prs }) })
const act = (kind: string, identifier: string, title: string, ago: number, n: number | null = 412) => ({ at: new Date(NOW - ago * MIN).toISOString(), kind, identifier, title, project: 'Alpha', pr: n === null ? null : { url: `https://github.com/agent-ix/filament-mltl/pull/${n}`, repo: 'agent-ix/filament-mltl', number: n } })

/** `ix-board focus status` of the contract of ix-board 0.9.0: items, recently_closed and activity. */
const rich = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ready_queue: [],
    blocker_layers: [],
    projects: [
      {
        id: 'p1', identifier: 'p1', name: 'Alpha', membership: 'full_project', open_by_state: [], progress: { done: 1, total: 4 }, milestones: [],
        in_progress: [issue('QSL-1240', 'proof gate checks every obligation', 'Coding', [pr('open')]), issue('QSL-1251', 'residual defects', 'Specced', []), issue('QSL-1300', 'in progress but no lead reports it', 'Coding', [])],
        recently_closed: [issue('QSL-1238', 'timed clock', 'Done', [pr('merged')])],
        unmilestoned: { in_progress: [], recently_closed: [], open_by_state: [], progress: { done: 0, total: 0 } },
      },
    ],
    activity: [act('opened', 'QSL-1251', 'residual defects', 3, 415), act('merged', 'QSL-1238', 'timed clock', 6, 412), act('closed', 'QSL-1199', 'old thing', 20, null), act('merged', 'QSL-1111', 'earlier merge', 22, 400)],
    ...extra,
  })

/** The answer of an ix-board older than 0.9.0, inside the stale `result` wrapper. */
const old = () =>
  JSON.stringify({ result: { ready_queue: [], blocker_layers: [], projects: [{ id: 'p1', identifier: 'p1', name: 'Alpha', progress: { done: 1, total: 4 }, in_progress: [{ id: 'i1', identifier: 'QSL-1240', title: 'proof gate checks every obligation', state: 'Coding' }], open_by_state: [] }] } })

const events = (...rows: [string, string, string, string, number][]) =>
  JSON.stringify({ version: 1, truncated: false, has_more: false, next_cursor: '1-0', events: rows.map(([address, ticket, role, status, ago], i) => ({ id: `${i}-0`, at_ms: NOW - ago * MIN, binding: { address }, change: { kind: 'agent', agent: { agent_id: `a${i}`, name: `n${i}`, ticket, role, status, pane: null, session: null, reported_at_ms: NOW - ago * MIN } } })) })

async function setup($: $t, on: Parameters<TestBody>[1], answer: string | (() => ReturnType<typeof out>), eventsText: string | ((argv: string[]) => ReturnType<typeof out>) = events(), agents = true): Promise<World> {
  const w = world(on, true)
  const lead = report(LEAD, 'FSL alpha', ['running'], { projects: ['Alpha'] })
  w.leads.set(LEAD, agents ? { ...lead, agents: [agent('coder-a', 'QSL-1240', 'coder', 'running', 9), agent('rev-a', 'QSL-1240', 'reviewer', 'running', 5), agent('rev-b', 'QSL-1240', 'code-reviewer', 'waiting', 6), agent('spec-a', 'QSL-1251', 'spec-author', 'done', 12), agent('gate-a', 'QSL-1238', 'gate', 'running', 30)] } : lead)
  w.leads.set(IDLE, { ...report(IDLE, 'idle', ['waiting']), agents: [agent('c1', 'QSL-2', 'coder', 'waiting', 41), agent('c2', 'QSL-3', 'coder', 'waiting', 50), agent('c3', 'QSL-4', 'coder', 'waiting', 60)] })
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv.join(' ').startsWith('agent-msg work events')) return typeof eventsText === 'string' ? out(eventsText) : eventsText(argv)
    return prior?.(argv, init)
  }
  ix(w, { projects: { Alpha: () => (typeof answer === 'string' ? out(answer) : answer()) } })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(1000)
  await ui.unmount()
  return w
}

type Drawn = { lines: string[]; text: string; buttons: { key: string; label: string; hotkey?: string }[]; press: (key: string) => Promise<void>; unmount: () => Promise<void> }

async function draw($: $t, surface: 'terminal' | 'desktop' = 'terminal', placement = 'dock'): Promise<Drawn> {
  const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement } } as never)
  const d: Drawn = {
    lines: [], text: '', buttons: [],
    press: async key => {
      await ui.press({ key })
      await d.redraw()
    },
    unmount: () => ui.unmount(),
  } as Drawn & { redraw: () => Promise<void> }
  ;(d as Drawn & { redraw: () => Promise<void> }).redraw = async () => {
    d.lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    d.buttons = (await ui.findAll({ type: 'Button' })).map(b => ({ key: b.key ?? '', label: String((b.props as { label?: string }).label ?? ''), hotkey: (b.props as { hotkey?: string }).hotkey }))
    d.text = d.lines.join('\n')
  }
  await (d as Drawn & { redraw: () => Promise<void> }).redraw()
  return d
}
const m = (re: RegExp) => new RegExp(re.source, 'm')
const ticketRow = (d: Drawn, id: string) => d.lines.find(l => l.trim().startsWith(id)) ?? ''

// ---------------------------------------------------------------- FR-028 leads and tickets

test('a lead is listed with its status mark and age, and its tickets with state, title, badges and last action', async ($, on) => {
  trace('FR-028-AC-1')
  await setup($, on, rich(), events([LEAD, 'QSL-1240', 'coder', 'running', 4], [LEAD, 'QSL-1240', 'reviewer', 'running', 2]))
  const d = await draw($)
  expect(d.lines).toContain(LEAD)
  expect(d.lines).toContain(IDLE)
  // The latest transition of an agent on the ticket, 2 minutes ago.
  expect(ticketRow(d, 'QSL-1240')).toMatch(/^ {3}QSL-1240 Coding proof gate ?… +\[pr\]\[review×2\] {2}reviewer 2m$/)
  // No event for QSL-1251: the latest agent report (12 minutes ago) stands in.
  expect(ticketRow(d, 'QSL-1251')).toMatch(/Specced residual ?… +\[spec\] {2}spec-author done 12m$/)
  // The lead's age is its newest report (5 minutes) and a mark leads the row.
  expect(d.lines).toContain('◐')
  expect(d.lines).toContain('5m')
  await d.unmount()
})

test('the badges are pr for an open or draft PR only, review with the count of reviewers, spec and gate', async ($, on) => {
  trace('FR-028-AC-2')
  await setup($, on, rich(), events())
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/\[pr\]\[review×2\]/)
  expect(ticketRow(d, 'QSL-1238')).toMatch(/\[gate\]/)
  // A merged PR is no [pr] badge.
  expect(ticketRow(d, 'QSL-1238')).not.toMatch(/\[pr\]/)
  expect(ticketRow(d, 'QSL-1251')).toMatch(/\[spec\]/)
  await d.unmount()
  const board = boardOf(JSON.parse(rich()))
  const one = composeWork([{ address: LEAD, status: 'running', reportedAt: NOW, agents: [{ name: 'a', ticket: 'QSL-9', role: 'reviewer', status: 'running', reportedAt: NOW }, { name: 'b', ticket: 'QSL-9', role: 'coder', status: 'running', reportedAt: NOW }] }], {}, [{ issues: [{ identifier: 'QSL-9', title: 't', state: 'Specify', prs: [pr('draft')] }], activity: board.activity }])
  expect(one.leads[0]!.tickets[0]!.badges).toEqual(['[pr]', '[review]', '[spec]'])
  // Finished agents keep no badge.
  const done = composeWork([{ address: LEAD, status: 'done', reportedAt: NOW, agents: [{ name: 'a', ticket: 'QSL-9', role: 'reviewer', status: 'done', reportedAt: NOW }, { name: 'g', ticket: 'QSL-9', role: 'gate', status: 'failed', reportedAt: NOW }, { name: 's', ticket: 'QSL-9', role: 'spec-author', status: 'done', reportedAt: NOW }] }], {}, [])
  expect(done.leads[0]!.tickets[0]!.badges).toEqual([])
})

test('a ticket in progress that no lead reports is not listed under a lead', async ($, on) => {
  trace('FR-028-AC-3')
  await setup($, on, rich())
  const d = await draw($)
  expect(d.text).not.toMatch(/QSL-1300/)
  await d.unmount()
})

test('a lead collapses to its ticket count and expands again, and ticket rows fit 60 columns', async ($, on) => {
  trace('FR-028-AC-4')
  await setup($, on, rich())
  const d = await draw($)
  for (const l of d.lines.filter(l => /^ {3}QSL-/.test(l))) expect(l.length).toBeLessThanOrEqual(60)
  expect(d.buttons.filter(b => b.key.startsWith('toggle-')).map(b => b.label)).toEqual(['▾', '▾'])
  await d.press(`toggle-${LEAD}`)
  expect(d.text).toMatch(m(/^\(3 tickets\)$/))
  expect(ticketRow(d, 'QSL-1240')).toBe('')
  await d.press(`toggle-${LEAD}`)
  expect(ticketRow(d, 'QSL-1240')).not.toBe('')
  await d.unmount()
  expect(ticketLine({ id: 'QSL-1', title: 'x'.repeat(200), state: 'Coding', badges: ['[pr]', '[review×2]'], lastAction: { what: 'coder running', at: NOW - 4 * MIN } }, NOW, 60).length).toBeLessThanOrEqual(60)
})

// ---------------------------------------------------------------- FR-028 Recent

test('Recent lists merges newest first with repository, PR, ticket and title, and a toggles every kind', async ($, on) => {
  trace('FR-028-AC-5')
  await setup($, on, rich())
  const d = await draw($)
  const merged = d.lines.filter(l => /filament-mltl#/.test(l))
  expect(merged).toEqual(['6m  filament-mltl#412  QSL-1238 timed clock', '22m filament-mltl#400  QSL-1111 earlier merge'])
  expect(d.text).not.toMatch(/old thing/)
  expect(d.buttons.find(b => b.key === 'kinds')).toEqual({ key: 'kinds', label: 'a all', hotkey: 'a' })
  await d.press('kinds')
  expect(d.lines.filter(l => /QSL-1(251|238|199|111) /.test(l) && !/^ {3}/.test(l)).map(l => l.split(' ').slice(0, 1)[0])).toEqual(['3m', '6m', '20m', '22m'])
  expect(d.lines).toEqual(expect.arrayContaining(['✓', '●', '○']))
  expect(d.buttons.find(b => b.key === 'kinds')!.label).toBe('a merges')
  await d.press('kinds')
  expect(d.text).not.toMatch(/old thing/)
  await d.unmount()
})

test('an ix-board without activity and PRs shows the tickets without a PR badge and says what Recent needs', async ($, on) => {
  trace('FR-028-AC-6')
  await setup($, on, old())
  const d = await draw($)
  expect(d.text).toMatch(/needs ix-board ≥0\.9\.0/)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/Coding proof g/)
  expect(ticketRow(d, 'QSL-1240')).not.toMatch(/\[pr\]/)
  await d.unmount()
})

test('the stale result wrapper is read as the object inside, and the Work tab makes no ix-board call of its own', async ($, on) => {
  trace('FR-028-AC-7')
  const wrapped = JSON.stringify({ result: JSON.parse(rich()) })
  const w = await setup($, on, wrapped)
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/\[pr\]/)
  expect(d.lines.some(l => /filament-mltl#412/.test(l))).toBe(true)
  await d.unmount()
  expect(w.ran.filter(l => l.startsWith('ix-board'))).toEqual(['ix-board --json focus status --project Alpha'])
})

test('where the events cannot be read the tickets show with the age of the latest report and the footer warns once', async ($, on) => {
  trace('FR-028-AC-8')
  await setup($, on, rich(), () => out('', 1, 'redis down'))
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/reviewer (running )?5m$/)
  expect(d.buttons.find(b => b.key === 'warnings-toggle')?.label).toBe('1')
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/agent-msg work events: redis down/)
  await d.unmount()
})

test('the widget says how many leads, tickets and merges of the last 24 hours', async ($, on) => {
  trace('FR-028-AC-9')
  await setup($, on, rich())
  const d = await draw($, 'terminal', 'widget')
  expect(d.text).toBe('2 leads · 6 tickets · 2 merged 24h')
  await d.unmount()
})

test('Work follows Focus in the dock and /factory work opens it', async ($, on) => {
  trace('FR-028-AC-10')
  const w = world(on)
  await runFactory(fake$(w) as never, options(), 'work', true)
  expect(w.opens.at(-1)).toEqual({ id: 'work', focus: true, closeOnEscape: true, rows: undefined })
  expect(VIEW_IDS.slice(0, 3)).toEqual(['factory', 'focus', 'work'])
})

// ---------------------------------------------------------------- the model

test('the latest event of each lead and ticket wins, an answer is merged once and activity is newest first', () => {
  const last: Record<string, { role: string; status: string; at: number }> = {}
  lastOfEvents(JSON.parse(events([LEAD, 'QSL-1', 'coder', 'running', 10], [LEAD, 'QSL-1', 'reviewer', 'done', 3], [LEAD, 'QSL-1', 'coder', 'running', 8])).events, last)
  expect(last[`${LEAD}\u0000QSL-1`]).toEqual({ role: 'reviewer', status: 'done', at: NOW - 3 * MIN })
  const a = boardOf(JSON.parse(rich()))
  const merged = mergeBoards([a, a, boardOf(JSON.parse(old()))])
  expect(merged.activity!.map(x => x.identifier)).toEqual(['QSL-1251', 'QSL-1238', 'QSL-1199', 'QSL-1111'])
  expect(merged.issues.find(i => i.identifier === 'QSL-1240')!.prs).toHaveLength(1)
  expect(boardOf(JSON.parse(old())).activity).toBeNull()
})

// ---------------------------------------------------------------- the event stream

const page = (rows: [string, string, string, string, number][], cursor: string, more: boolean) => JSON.stringify({ ...JSON.parse(events(...rows)), next_cursor: cursor, has_more: more })
const eventCalls = (w: World) => w.ran.filter(l => l.startsWith('agent-msg work events'))

const afterOf = (argv: string[]) => argv[argv.indexOf('--after') + 1]!

test('the events are read page after page by their cursor, and the last action is the newest of all pages', async ($, on) => {
  trace('FR-028-AC-12')
  const pages: Record<string, string> = {
    '0-0': page([[LEAD, 'QSL-1240', 'coder', 'running', 30]], 'c1', true),
    c1: page([[LEAD, 'QSL-1240', 'reviewer', 'running', 2]], 'c2', false),
  }
  const w = await setup($, on, rich(), argv => out(pages[afterOf(argv)] ?? page([], afterOf(argv), false)))
  expect(eventCalls(w).map(l => l.split(' --after ')[1])).toEqual(['0-0', 'c1'])
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/reviewer 2m$/)
  await d.unmount()
})

test('the next read asks only for what came after the last cursor and keeps the earlier last actions', async ($, on) => {
  trace('FR-028-AC-12')
  const pages: Record<string, string> = {
    '0-0': page([[LEAD, 'QSL-1240', 'coder', 'running', 3], [LEAD, 'QSL-1251', 'spec-author', 'running', 3]], 'c1', false),
    c1: page([[LEAD, 'QSL-1240', 'reviewer', 'waiting', 0]], 'c2', false),
  }
  const w = await setup($, on, rich(), argv => out(pages[afterOf(argv)] ?? page([], afterOf(argv), false)))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  expect(eventCalls(w).map(l => l.split(' --after ')[1]).slice(0, 2)).toEqual(['0-0', 'c1'])
  const rows = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(rows.find(l => l.trim().startsWith('QSL-1240'))).toMatch(/reviewer \d+m$/)
  expect(rows.find(l => l.trim().startsWith('QSL-1251'))).toMatch(/spec-author \d+m$/)
  await ui.unmount()
})

test('five full pages with more behind are a warning, and the next read carries on from where this one stopped', async ($, on) => {
  trace('FR-028-AC-12')
  const w = await setup($, on, rich(), argv => out(page([[LEAD, 'QSL-1240', 'coder', 'running', 1]], `c${Number(afterOf(argv).replace('c', '').replace('0-0', '0')) + 1}`, true)))
  expect(eventCalls(w).map(l => l.split(' --after ')[1])).toEqual(['0-0', 'c1', 'c2', 'c3', 'c4'])
  const d = await draw($)
  expect(d.buttons.find(b => b.key === 'warnings-toggle')?.label).toBe('1')
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/events behind, catching up/)
  await d.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  expect(eventCalls(w).slice(5, 6).map(l => l.split(' --after ')[1])).toEqual(['c5'])
  await ui.unmount()
})
