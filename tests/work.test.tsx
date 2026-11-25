import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { FEED_CAP, boardOf, composeWork, eventRole, foldFeed, lastOfEvents, mergeBoards, recentOf } from '../hooks/work'
import { runFactory } from '../hooks/router'
import { ticketLine } from '../hooks/workview'
import { VIEW_IDS } from '../hooks/views'
import { CLASSIC, FP, drawBand, fake$, options, out, report, startSession, world } from './world'
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

async function setup($: $t, on: Parameters<TestBody>[1], answer: string | (() => ReturnType<typeof out>), eventsText: string | ((argv: string[]) => ReturnType<typeof out>) = events(), agents = true, arrange: (w: World) => void = () => undefined): Promise<World> {
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
  arrange(w)
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
  // The folded finished tickets are opened, so that every ticket of a lead is on screen.
  for (const b of d.buttons.filter(b => b.key.startsWith('finished-') && b.label.startsWith('▸'))) await d.press(b.key)
  return d
}
const m = (re: RegExp) => new RegExp(re.source, 'm')
const ticketRow = (d: Drawn, id: string) => d.lines.find(l => l.trim().startsWith(id)) ?? ''

// ---------------------------------------------------------------- FR-028 leads and tickets

/** A lead's report whose focus names `tickets`, said `ago` minutes ago, with the agents given. */
const focused = (address: string, summary: string, tickets: string[], ago: number, agents: unknown[] = []) => ({ ...report(address, summary, [], { projects: ['Alpha'] }), focus: { summary, tickets, reported_at_ms: NOW - ago * MIN }, agents })

test('the tickets a lead’s focus names are listed under it once, with the focus age where nothing else speaks of them', async ($, on) => {
  trace("FR-028-AC-19")
  await setup($, on, rich(), events([LEAD, 'QSL-9', 'reviewer', 'done', 30]), true, w => {
    w.leads.set(LEAD, focused(LEAD, 'landing', ['QSL-1240', 'QSL-1251', 'QSL-9'], 780, [agent('c', 'QSL-1251', 'coder', 'running', 12)]))
  })
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/^ {3}QSL-1240 proof gate .*\[pr\] {3}13h$/)
  expect(ticketRow(d, 'QSL-1251')).toMatch(/ 12m$/)
  expect(ticketRow(d, 'QSL-9')).toMatch(/^ {3}QSL-9 +30m$/)
  expect(d.lines.filter(l => l.trim().startsWith('QSL-1251'))).toHaveLength(1)
  expect(d.lines).not.toContain('   no ticket reported')
  await d.unmount()
  // The idle lead holds three more.
  const widget = await draw($, 'terminal', 'widget')
  expect(widget.text).toContain('2 leads · 6 tickets')
  await widget.unmount()
})

test('a lead with no ticket says so and what its focus says', async ($, on) => {
  trace("FR-028-AC-20")
  await setup($, on, rich(), events(), true, w => {
    w.leads.set(LEAD, focused(LEAD, 'Landing 8 inherited PRs', [], 700))
    w.leads.set(IDLE, focused(IDLE, '', [], 700))
  })
  const d = await draw($)
  expect(d.lines.filter(l => l === '   no ticket reported')).toHaveLength(2)
  expect(d.lines.filter(l => l.startsWith('   focus:'))).toEqual(['   focus: Landing 8 inherited PRs'])
  await d.unmount()
})

test('the leads of the selected teams that report nothing are named, and one that could not be read is not among them', async ($, on) => {
  trace("FR-028-AC-21")
  await setup($, on, rich(), events(), true, w => {
    w.leads.set('luna:QSL:code', null)
    w.leads.set('terra:QSL:minder', null)
    w.leads.set('draco:SWM:code', null)
    w.leads.set('terra:QSL:gone', undefined)
  })
  const d = await draw($)
  // Only their number is on screen until it is opened.
  expect(d.buttons.find(b => b.key === 'silent')?.label).toBe('▸ 2 leads report no work')
  expect(d.text).not.toContain('luna:QSL:code')
  await d.press('silent')
  expect(d.lines).toContain('luna:QSL:code, terra:QSL:minder')
  expect(d.lines).toContain('terra:QSL:gone')
  await d.press('silent')
  expect(d.text).not.toContain('luna:QSL:code')
  await d.unmount()
})

test('one lead that reports nothing is named where no lead reported work', async ($, on) => {
  trace("FR-028-AC-21")
  await setup($, on, rich(), events(), true, w => {
    w.leads.delete(IDLE)
    w.leads.set(LEAD, null)
  })
  const d = await draw($)
  expect(d.lines).toContain('No lead has reported work.')
  expect(d.buttons.find(b => b.key === 'silent')?.label).toBe('▸ 1 lead reports no work')
  await d.press('silent')
  expect(d.lines).toContain(LEAD)
  await d.unmount()
})

test('a lead is listed with its status mark and age, and its tickets with id, title, badges and age and no role, status or state word', async ($, on) => {
  trace("FR-028-AC-1")
  await setup($, on, rich(), events([LEAD, 'QSL-1240', 'coder', 'running', 4], [LEAD, 'QSL-1240', 'reviewer', 'running', 2]))
  const d = await draw($)
  expect(d.lines).toContain(LEAD)
  expect(d.lines).toContain(IDLE)
  // The latest transition of an agent on the ticket, 2 minutes ago.
  expect(ticketRow(d, 'QSL-1240')).toMatch(/^ {3}QSL-1240 proof gate checks[^ ]*.*… {2}\[pr\]\[review×2\] {4}2m$/)
  // No event for QSL-1251: the latest agent report (12 minutes ago) stands in.
  expect(ticketRow(d, 'QSL-1251')).toMatch(/^ {3}QSL-1251 residual defects +\[spec\] {3}12m$/)
  // The ages keep one column, and no row says what an agent or Linear says of the ticket.
  const rows = d.lines.filter(l => /^ {3}QSL-/.test(l))
  expect(rows.map(l => l.length)).toEqual(rows.map(() => 60))
  expect(rows.join('\n')).not.toMatch(/coder|reviewer|spec-author|focus|running|done|waiting|Coding|Specced/)
  // The lead's age is its newest report (5 minutes) and a mark leads the row.
  expect(d.lines).toContain('◐')
  expect(d.lines).toContain('5m')
  await d.unmount()
})

test('the badges are pr for an open or draft PR only, review with the count of reviewers, spec and gate', async ($, on) => {
  trace("FR-028-AC-2")
  await setup($, on, rich(), events())
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/\[pr\]\[review×2\]/)
  expect(ticketRow(d, 'QSL-1238')).toMatch(/\[gate\]/)
  // A merged PR is no [pr] badge.
  expect(ticketRow(d, 'QSL-1238')).not.toMatch(/\[pr\]/)
  expect(ticketRow(d, 'QSL-1251')).toMatch(/\[spec\]/)
  await d.unmount()
  const board = boardOf(JSON.parse(rich()))
  const one = composeWork([{ address: LEAD, status: 'running', reportedAt: NOW, error: null, readAt: NOW, focus: null, agents: [{ name: 'a', ticket: 'QSL-9', role: 'reviewer', status: 'running', reportedAt: NOW }, { name: 'b', ticket: 'QSL-9', role: 'coder', status: 'running', reportedAt: NOW }] }], {}, [{ issues: [{ identifier: 'QSL-9', title: 't', state: 'Specify', prs: [pr('draft')] }], activity: board.activity }])
  expect(one.leads[0]!.tickets[0]!.badges).toEqual(['[pr]', '[review]', '[spec]'])
  // Finished agents keep no badge.
  const done = composeWork([{ address: LEAD, status: 'done', reportedAt: NOW, error: null, readAt: NOW, focus: null, agents: [{ name: 'a', ticket: 'QSL-9', role: 'reviewer', status: 'done', reportedAt: NOW }, { name: 'g', ticket: 'QSL-9', role: 'gate', status: 'failed', reportedAt: NOW }, { name: 's', ticket: 'QSL-9', role: 'spec-author', status: 'done', reportedAt: NOW }] }], {}, [])
  expect(done.leads[0]!.tickets[0]!.badges).toEqual([])
})

test('a ticket in progress that no lead reports is not listed under a lead', async ($, on) => {
  trace("FR-028-AC-3")
  await setup($, on, rich())
  const d = await draw($)
  expect(d.text).not.toMatch(/QSL-1300/)
  await d.unmount()
})

test('a lead collapses to its ticket count and expands again, and ticket rows fit 60 columns', async ($, on) => {
  trace("FR-028-AC-4")
  await setup($, on, rich())
  const d = await draw($)
  for (const l of d.lines.filter(l => /^ {3}QSL-/.test(l))) expect(l.length).toBeLessThanOrEqual(60)
  expect(d.buttons.filter(b => b.key.startsWith('toggle-')).map(b => b.label)).toEqual(['▾', '▾'])
  await d.press(`toggle-${LEAD}`)
  expect(d.text).toMatch(m(/^\(2 tickets\)$/))
  expect(ticketRow(d, 'QSL-1240')).toBe('')
  await d.press(`toggle-${LEAD}`)
  expect(ticketRow(d, 'QSL-1240')).not.toBe('')
  await d.unmount()
  expect(ticketLine({ id: 'QSL-1', title: 'x'.repeat(200), why: null, badges: ['[pr]', '[review×2]'], at: NOW - 4 * MIN }, NOW, 60)).toBe(`   QSL-1 ${'x'.repeat(28)}…  [pr][review×2]    4m`)
})

// ---------------------------------------------------------------- FR-028 old and finished work

test('finished tickets are folded under their lead and a report over two hours old is marked old', async ($, on) => {
  trace("FR-028-AC-22", "FR-028-AC-27")
  await setup($, on, rich(), events(), true, w => {
    w.leads.set(IDLE, { ...report(IDLE, 'idle', ['waiting']), focus: { summary: 'idle', tickets: [], reported_at_ms: NOW - 13 * 60 * MIN }, scope: null, agents: [agent('c1', 'QSL-2', 'coder', 'waiting', 13 * 60)] })
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const label = async (key: string) => ((await ui.find({ key }))?.props as { label?: string } | undefined)?.label
  expect(await label(`finished-${LEAD}`)).toBe('▸ 1 finished')
  expect((await texts()).some(l => l.trim().startsWith('QSL-1251'))).toBe(false)
  // The old lead has the hollow mark and says its report is old.
  expect(await texts()).toEqual(expect.arrayContaining(['◌', 'old 13h', '2 leads · 1 old']))
  await ui.press({ key: `finished-${LEAD}` })
  expect((await texts()).some(l => l.trim().startsWith('QSL-1251'))).toBe(true)
  await ui.unmount()
  const widget = await draw($, 'terminal', 'widget')
  // The old lead's ticket is counted apart.
  expect(widget.text).toBe('2 leads · ≥2 tickets · +1 old · 2 merged 24h · 1 old')
  await widget.unmount()
})

test('the widget says it is reading, or that the leads could not be read, and counts nothing', async ($, on) => {
  trace("FR-030-AC-10", "FR-028-AC-23")
  const w = world(on, true)
  let release: (() => void) | undefined
  const held = new Promise<void>(resolve => (release = resolve))
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg who' ? held.then(() => out('', 1, 'redis down')) : prior?.(argv, init))
  await startSession($)
  const d = await draw($, 'terminal', 'widget')
  expect(d.text).toBe('Reading the leads’ work reports…')
  await d.unmount()
  release!()
  await w.clock!.advance(1000)
  const failed = await draw($, 'terminal', 'widget')
  expect(failed.text).toBe('The leads could not be read.')
  await failed.unmount()
})

// ---------------------------------------------------------------- FR-028 the tickets no focus status names

const single = (identifier: string, state: string, prs: unknown[], complete = true) => ({ id: `id-${identifier}`, identifier, title: `single ${identifier}`, state: 'x', state_name: state, state_type: 'started', attachments_complete: complete, pull_requests: prs })

test('a ticket no focus status names gets its title and [pr] from one read of ix-board', async ($, on) => {
  trace("FR-028-AC-24")
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running'], { projects: ['Alpha'] }), agents: [agent('a', 'QSL-1240', 'coder', 'running', 9), agent('b', 'QSL-7', 'coder', 'running', 9), agent('c', 'QSL-8', 'coder', 'running', 9), agent('d', 'not a ticket', 'coder', 'running', 9)] })
  const board = ix(w, { projects: { Alpha: () => out(rich()) }, issues: () => out(JSON.stringify({ complete: true, missing: [], issues: [single('QSL-7', 'Specify', [pr('open', 77)]), single('QSL-8', 'Specced', [pr('open', 88)], false)] })) })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(60_000)
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(rows.find(l => l.trim().startsWith('QSL-7 '))).toMatch(/QSL-7 single QSL-7 +\[pr\]/)
  // Where the attachments are cut short nothing is said of its PRs.
  expect(rows.find(l => l.trim().startsWith('QSL-8 '))).toMatch(/QSL-8 single QSL-8 /)
  expect(rows.find(l => l.trim().startsWith('QSL-8 '))).not.toMatch(/\[pr\]/)
  // Asked once, of the identifiers no focus status names and no other word.
  expect(board.calls.filter(c => c.startsWith('issues'))).toEqual(['issues QSL-7 QSL-8'])
  await ui.unmount()
})

test('the tickets read is shared and made again only after five minutes where there is a new ticket, else after thirty', async ($, on) => {
  trace("FR-028-AC-25")
  const w = world(on, true)
  const lead = (...ids: string[]) => ({ ...report(LEAD, 'FSL alpha', ['running']), agents: ids.map((id, i) => agent(`a${i}`, id, 'coder', 'running', 1)) })
  w.leads.set(LEAD, lead('QSL-7'))
  const board = ix(w, {})
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const calls = () => board.calls.filter(c => c.startsWith('issues'))
  await w.clock!.advance(MIN)
  expect(calls()).toEqual(['issues QSL-7'])
  await w.clock!.advance(3 * MIN)
  expect(calls()).toHaveLength(1)
  w.leads.set(LEAD, lead('QSL-7', 'QSL-9'))
  await w.clock!.advance(4 * MIN)
  expect(calls()).toEqual(['issues QSL-7', 'issues QSL-7 QSL-9'])
  await w.clock!.advance(20 * MIN)
  expect(calls()).toHaveLength(2)
  await w.clock!.advance(15 * MIN)
  expect(calls()).toHaveLength(3)
  await ui.unmount()
})

test('an ix-board that cannot read the tickets is a warning on the Work tab, and an old answer says its age', async ($, on) => {
  trace("FR-028-AC-26")
  let fails = false
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running'], { projects: ['Alpha'] }), agents: [agent('a', 'QSL-1240', 'coder', 'running', 9)] })
  ix(w, { projects: { Alpha: () => (fails ? out('', 1, 'ix-board broke') : out(rich())) } })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await w.clock!.advance(MIN)
  expect((await texts()).some(l => /old: states, PRs and merges/.test(l))).toBe(false)
  fails = true
  await w.clock!.advance(40 * MIN)
  await ui.press({ key: 'warnings-toggle' })
  const lines = await texts()
  expect(lines.join('\n')).toMatch(/ix-board: .*ix-board broke/)
  expect(lines.some(l => /^ix-board’s answer is \d+m old: states, PRs and merges are as of then\.$/.test(l))).toBe(true)
  expect(lines).not.toContain('Nothing merged lately.')
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-028 Recent

test('Recent lists merges newest first with repository, PR, ticket and title, and a toggles every kind', async ($, on) => {
  trace("FR-028-AC-5")
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
  trace("FR-028-AC-6")
  await setup($, on, old())
  const d = await draw($)
  expect(d.text).toMatch(/needs ix-board ≥0\.9\.0/)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/QSL-1240 proof gate/)
  expect(ticketRow(d, 'QSL-1240')).not.toMatch(/\[pr\]/)
  await d.unmount()
})

test('the stale result wrapper is read as the object inside, and ix-board is asked once for the tickets no focus status names', async ($, on) => {
  trace("FR-028-AC-7")
  const wrapped = JSON.stringify({ result: JSON.parse(rich()) })
  const w = await setup($, on, wrapped)
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/\[pr\]/)
  expect(d.lines.some(l => /filament-mltl#412/.test(l))).toBe(true)
  await d.unmount()
  expect(w.ran.filter(l => l.startsWith('ix-board'))).toEqual(['ix-board --json focus status --project Alpha', 'ix-board --json issues QSL-2 QSL-3 QSL-4'])
})

test('where the events cannot be read the tickets show with the age of the latest report and the footer warns once', async ($, on) => {
  trace("FR-028-AC-8")
  await setup($, on, rich(), () => out('', 1, 'redis down'))
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/ 5m$/)
  expect(d.buttons.find(b => b.key === 'warnings-toggle')?.label).toBe('1')
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/agent-msg work events: redis down/)
  await d.unmount()
})

test('the widget says how many leads, tickets and merges of the last 24 hours', async ($, on) => {
  trace("FR-028-AC-9")
  await setup($, on, rich())
  const d = await draw($, 'terminal', 'widget')
  // Five in hand: the one whose only agent is done is not counted.
  expect(d.text).toBe('2 leads · 5 tickets · 2 merged 24h')
  await d.unmount()
})

test('Work follows Focus in the dock and /factory work opens it', async ($, on) => {
  trace("FR-028-AC-10")
  const w = world(on)
  await runFactory(fake$(w) as never, options(), 'work', true)
  expect(w.opens.at(-1)).toEqual({ id: 'work', focus: true, closeOnEscape: true, rows: undefined })
  expect(VIEW_IDS.slice(0, 3)).toEqual(['factory', 'focus', 'work'])
})

// ---------------------------------------------------------------- the model

test('the latest event of each lead and ticket wins, an answer is merged once and activity is newest first', () => {
  const last: Record<string, { role: string; status: string; at: number }> = {}
  lastOfEvents(JSON.parse(events([LEAD, 'QSL-1', 'coder', 'running', 10], [LEAD, 'QSL-1', 'reviewer', 'done', 3], [LEAD, 'QSL-1', 'coder', 'running', 8])).events, last)
  expect(last[`${LEAD}\u0000QSL-1`]).toBe(NOW - 3 * MIN)
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

test('the events are read page after page by their cursor, and a ticket’s age is that of the newest event of all pages', async ($, on) => {
  trace("FR-028-AC-12")
  const pages: Record<string, string> = {
    '0-0': page([[LEAD, 'QSL-1240', 'coder', 'running', 30]], 'c1', true),
    c1: page([[LEAD, 'QSL-1240', 'reviewer', 'running', 2]], 'c2', false),
  }
  const w = await setup($, on, rich(), argv => out(pages[afterOf(argv)] ?? page([], afterOf(argv), false)))
  expect(eventCalls(w).map(l => l.split(' --after ')[1])).toEqual(['0-0', 'c1'])
  const d = await draw($)
  expect(ticketRow(d, 'QSL-1240')).toMatch(/ 2m$/)
  await d.unmount()
})

test('the next read asks only for what came after the last cursor and keeps the earlier ages', async ($, on) => {
  trace("FR-028-AC-12")
  const pages: Record<string, string> = {
    '0-0': page([[LEAD, 'QSL-1240', 'coder', 'running', 3], [LEAD, 'QSL-1251', 'spec-author', 'running', 3]], 'c1', false),
    c1: page([[LEAD, 'QSL-1240', 'reviewer', 'waiting', 0]], 'c2', false),
  }
  const w = await setup($, on, rich(), argv => out(pages[afterOf(argv)] ?? page([], afterOf(argv), false)))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  expect(eventCalls(w).map(l => l.split(' --after ')[1]).slice(0, 2)).toEqual(['0-0', 'c1'])
  // QSL-1251, whose only agent is done, is among the finished.
  await ui.press({ key: `finished-${LEAD}` })
  const rows = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(rows.find(l => l.trim().startsWith('QSL-1240'))).toMatch(/ [12]m$/)
  expect(rows.find(l => l.trim().startsWith('QSL-1251'))).toMatch(/ [45]m$/)
  await ui.unmount()
})

test('five full pages with more behind are a warning, and the next read carries on from where this one stopped', async ($, on) => {
  trace("FR-028-AC-12")
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

// ---------------------------------------------------------------- FR-028 review, spec and gate events

const recent = (d: Drawn) => d.lines.filter(l => /^\d+[smhd] /.test(l) && l.length > 4)
const roleEvents = () =>
  events(
    [LEAD, 'QSL-1251', 'spec-author', 'running', 40],
    [LEAD, 'QSL-1251', 'spec-author', 'done', 18],
    [LEAD, 'QSL-1240', 'coder', 'running', 15],
    [LEAD, 'QSL-1240', 'reviewer', 'running', 4],
    [IDLE, 'QSL-2', 'gate', 'running', 2],
    ['hub:ENG:code', 'ENG-7', 'reviewer', 'done', 1],
  )

test('merges stay the default, and a lists review, spec and gate starts and finishes with ticket, lead and age among the other events', async ($, on) => {
  trace("FR-028-AC-13", "FR-028-AC-5")
  await setup($, on, rich(), roleEvents())
  const d = await draw($)
  expect(recent(d)).toEqual(['6m  filament-mltl#412  QSL-1238 timed clock', '22m filament-mltl#400  QSL-1111 earlier merge'])
  await d.press('kinds')
  expect(recent(d)).toEqual([
    `2m  gate start    QSL-2  ${IDLE}`,
    '3m  filament-mltl#415  QSL-1251 residual defects',
    `4m  review start  QSL-1240  ${LEAD}`,
    '6m  filament-mltl#412  QSL-1238 timed clock',
    `18m spec done     QSL-1251  ${LEAD}`,
    '20m QSL-1199 old thing',
    '22m filament-mltl#400  QSL-1111 earlier merge',
    `40m spec start    QSL-1251  ${LEAD}`,
  ])
  await d.press('kinds')
  expect(d.text).not.toMatch(/review start|spec done|gate start/)
  await d.unmount()
})

test('the role events of a lead outside the selected teams are not listed', { options: { teams: 'QSL' } }, async ($, on) => {
  trace("FR-028-AC-15")
  await setup($, on, rich(), roleEvents())
  const d = await draw($)
  await d.press('kinds')
  expect(d.text).toMatch(/gate start/)
  expect(d.text).not.toMatch(/ENG-7/)
  await d.unmount()
  const feed = foldFeed(JSON.parse(roleEvents()).events, { events: [], phase: {} })
  expect(recentOf(null, feed.events, true, null).map(r => r.event!.ticket)).toContain('ENG-7')
  expect(recentOf(null, feed.events, true, ['eng']).map(r => r.event!.ticket)).toEqual(['ENG-7'])
  expect(recentOf(null, feed.events, false, null)).toEqual([])
})

test('only a change to running or done of a review, spec or gate role is an event', () => {
  trace("FR-028-AC-14")
  const fold = (...rows: [string, string, string, string, number][]) => foldFeed(JSON.parse(events(...rows)).events.map((e: { change: { agent: { agent_id: string } } }) => ((e.change.agent.agent_id = 'one'), e)), { events: [], phase: {} })
  const steps = (...statuses: string[]) => fold(...statuses.map((s, i): [string, string, string, string, number] => [LEAD, 'QSL-1', 'reviewer', s, 50 - i])).events.map(e => e.step)
  expect(steps('running', 'running', 'waiting', 'running', 'done', 'done')).toEqual(['start', 'done'])
  // A first report of waiting is not a start; the running that follows is.
  expect(steps('waiting', 'running')).toEqual(['start'])
  // Work again after done, failed or canceled is a new start; neither failed nor canceled is listed.
  expect(steps('running', 'done', 'running', 'failed', 'running', 'canceled', 'running')).toEqual(['start', 'done', 'start', 'start', 'start'])
  // A done with no start in the stream is still a finish.
  expect(steps('done')).toEqual(['done'])
  expect(['coder', 'researcher', 'gate', 'spec-steward', 'spec author', 'code-reviewer', 'spec-reviewer'].map(eventRole)).toEqual([null, null, 'gate', 'spec', 'spec', 'review', 'review'])
  expect(fold([LEAD, 'QSL-1', 'coder', 'running', 5], [LEAD, 'QSL-1', 'researcher', 'done', 4]).events).toEqual([])
})

test('a removed agent that reports again starts again, and the feed keeps its newest events', () => {
  trace("FR-028-AC-14")
  const report = (at: number, status: string, ticket = 'QSL-1') => ({ id: `${at}-0`, at_ms: at, binding: { address: LEAD }, change: { kind: 'agent', agent: { agent_id: 'r1', name: 'r', ticket, role: 'reviewer', status } } })
  const removed = { id: '2-0', at_ms: 2, binding: { address: LEAD }, change: { kind: 'remove', agent_id: 'r1' } }
  const first = foldFeed([report(1, 'running')], { events: [], phase: {} })
  // The next page carries on from what is held.
  expect(foldFeed([report(2, 'running')], first).events).toHaveLength(1)
  expect(foldFeed([removed, report(3, 'running')], first).events.map(e => [e.at, e.step])).toEqual([[1, 'start'], [3, 'start']])
  const many = foldFeed(Array.from({ length: FEED_CAP + 5 }, (_, i) => report(i + 1, 'running', `QSL-${i}`)), { events: [], phase: {} })
  expect(many.events).toHaveLength(FEED_CAP)
  expect(many.events.at(-1)!.at).toBe(FEED_CAP + 5)
})

test('a review reported while the tab is on screen is listed within a minute', async ($, on) => {
  trace("FR-028-AC-16")
  let reported = false
  const w = await setup($, on, rich(), argv => {
    const after = afterOf(argv)
    return out(reported && after !== 'c9' ? page([[LEAD, 'QSL-9001', 'reviewer', 'running', -1]], 'c9', false) : page([], after, false))
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await ui.press({ key: 'kinds' })
  // Past the first read of the mount, then the review is reported just after a read.
  await w.clock!.advance(5000)
  const reads = eventCalls(w).length
  while (eventCalls(w).length === reads) await w.clock!.advance(1000)
  reported = true
  // Half a minute and one redraw: the rest of the minute is left for the view check and the read of a real session.
  await w.clock!.advance(46_000)
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').some(l => /review start +QSL-9001/.test(l))).toBe(true)
  await ui.unmount()
})

test('without ix-board’s activity a still lists the role events and says what is missing', async ($, on) => {
  trace("FR-028-AC-17")
  await setup($, on, old(), roleEvents())
  const d = await draw($)
  expect(d.text).toMatch(/needs ix-board ≥0\.9\.0/)
  expect(d.text).not.toMatch(/review start/)
  await d.press('kinds')
  expect(d.text).toMatch(/review start +QSL-1240/)
  expect(d.text).toMatch(/needs ix-board ≥0\.9\.0/)
  await d.unmount()
})

test('events held from an earlier read stay listed when a later read fails, with one warning', async ($, on) => {
  trace("FR-028-AC-8")
  let fails = false
  const w = await setup($, on, rich(), argv => (fails ? out('', 1, 'redis down') : out(page(afterOf(argv) === '0-0' ? [[LEAD, 'QSL-1240', 'reviewer', 'running', 2]] : [], 'c1', false))))
  fails = true
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  await ui.press({ key: 'kinds' })
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines.some(l => /review start +QSL-1240/.test(l))).toBe(true)
  expect((await ui.find({ key: 'warnings-toggle' }))?.props).toMatchObject({ label: '1' })
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-009 the work band cell

test('the widget marks the merges as a lower bound where ix-board cut its activity', async ($, on) => {
  trace("FR-028-AC-9")
  const cut = rich({ activity: Array.from({ length: 200 }, (_, i) => act('merged', `QSL-${i}`, 't', i + 1, i)) })
  await setup($, on, cut)
  const d = await draw($, 'terminal', 'widget')
  expect(d.text).toBe('2 leads · 5 tickets · ≥200 merged 24h')
  await d.unmount()
})

test('the band marks the counts as lower bounds where one lead’s report cannot be read', async ($, on) => {
  trace("FR-009-AC-13")
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha'), agents: [agent('coder-a', 'QSL-1240', 'coder', 'running', 9)] })
  w.leads.set(IDLE, report(IDLE, 'idle'))
  w.files.set(`${FP}/features/default.json`, JSON.stringify({ modules: ['work'], teams: ['QSL'] }))
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === `agent-msg work --lead ${IDLE} show` ? out('', 1, 'timed out') : prior?.(argv, init))
  await startSession($)
  const ui = await drawBand($, CLASSIC)
  await w.clock!.advance(20_000)
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).toMatch(/≥1 ticket \(1\/2 leads\) · — PRs open · — merged 24h/)
  expect(text).toMatch(/agent-msg work: 1 of 2 leads not read/)
  await ui.unmount()
})

test('a band with the work module reads the leads and the focus status, shows the counts and opens the Work view', async ($, on) => {
  trace("FR-009-AC-9", "FR-009-AC-6")
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running'], { projects: ['Alpha'] }), agents: [agent('coder-a', 'QSL-1240', 'coder', 'running', 9), agent('c2', 'QSL-1251', 'coder', 'running', 9)] })
  w.files.set(`${FP}/features/default.json`, JSON.stringify({ modules: ['work'], teams: ['QSL'] }))
  ix(w, { projects: { Alpha: () => out(rich()) } })
  await startSession($)
  const ui = await drawBand($, CLASSIC)
  await w.clock!.advance(20_000)
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toMatch(/2 tickets · 1 PR open · 2 merged 24h/)
  expect(w.ran.filter(l => l.startsWith('agent-msg work events'))).toEqual([])
  await ui.press({ key: 'work' })
  await w.clock!.advance(1000)
  expect(w.opens.at(-1)?.id).toBe('work')
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-028 the share of Recent held for role events

const busy = (count: number) => rich({ activity: Array.from({ length: count }, (_, i) => act('merged', `QSL-${3000 + i}`, 't', i + 1, 500 + i)) })
const reviews = (count: number) => events(...Array.from({ length: count }, (_, i): [string, string, string, string, number] => [LEAD, `QSL-${4000 + i}`, 'reviewer', 'running', 600 - i]))
const kinds = (d: Drawn) => ({ role: recent(d).filter(l => /review start/.test(l)).length, activity: recent(d).filter(l => /filament-mltl#/.test(l)).length })

for (const [title, activity, roles, expected] of [
  ['role events older than all the activity keep half of the rows', 40, 20, { role: 5, activity: 5 }],
  ['rows the role events do not fill go to the activity', 40, 2, { role: 2, activity: 8 }],
  ['rows the activity does not fill go to the role events', 3, 20, { role: 7, activity: 3 }],
] as const) {
  test(`under a, ${title}`, async ($, on) => {
    trace("FR-028-AC-18")
    await setup($, on, busy(activity), reviews(roles))
    const d = await draw($)
    await d.press('kinds')
    expect(kinds(d)).toEqual(expected)
    // The newest of each kind, listed together newest first.
    const ages = recent(d).map(l => l.split(' ')[0]!)
    expect(ages.slice(0, expected.activity)).toEqual(Array.from({ length: expected.activity }, (_, i) => `${i + 1}m`))
    expect(recent(d).slice(expected.activity).every(l => /review start/.test(l))).toBe(true)
    expect(recent(d).at(expected.activity)).toMatch(new RegExp(`QSL-${4000 + roles - 1} `))
    await d.unmount()
  })
}

// ---------------------------------------------------------------- a gate entry an older build wrote

const GATE = `${FP}/linear-gate.json`
const KEY = 'progress:project:Alpha'

/** The gate as a build older than 0.9.0 leaves it: a progress answer with no tickets or activity, read 5 minutes ago. */
const seedGate = (w: World, entry: Record<string, unknown> = {}) => {
  const data = { at: NOW - 5 * MIN, roadmapError: null, sourceError: null, expansions: [], outcomes: {}, blockers: 0 }
  w.files.set(GATE, JSON.stringify({ backoffUntil: null, entries: { [KEY]: { at: NOW - 5 * MIN, claimAt: null, data, ...entry } } }))
}

async function overGate($: $t, on: Parameters<TestBody>[1], seed: (w: World) => void): Promise<World> {
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running'], { projects: ['Alpha'] }), agents: [agent('coder-a', 'QSL-1240', 'coder', 'running', 9)] })
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ').startsWith('agent-msg work events') ? out(events()) : prior?.(argv, init))
  ix(w, { projects: { Alpha: () => out(rich()) } })
  seed(w)
  await startSession($)
  return w
}

const focusCalls = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json focus status'))

test('a gate entry without the tickets and activity, as an older build writes it, is read again at once', async ($, on) => {
  trace("FR-025-AC-15")
  const w = await overGate($, on, w => seedGate(w))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(1000)
  expect(focusCalls(w)).toHaveLength(1)
  const drawn = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(drawn.find(l => l.trim().startsWith('QSL-1240'))).toMatch(/\[pr\]/)
  expect(drawn.some(l => /filament-mltl#412/.test(l))).toBe(true)
  // The answer written now holds: later reads are answered from the gate.
  await w.clock!.advance(10 * MIN)
  expect(focusCalls(w)).toHaveLength(1)
  // An older session writes over it again: it is read again once.
  seedGate(w)
  await w.clock!.advance(10 * MIN)
  expect(focusCalls(w)).toHaveLength(2)
  await ui.unmount()
})

for (const [title, entry, backoff] of [
  ['held after a failure', { unkept: true, error: 'ix-board: authentication failed', at: NOW - 26 * MIN }, null],
  ['that another session is reading', { claimAt: NOW - 1000 }, null],
  ['under a Linear rate limit', {}, NOW + 60 * MIN],
] as const) {
  test(`an older entry ${title} is left to its hold`, async ($, on) => {
    trace("FR-025-AC-15")
    const w = await overGate($, on, w => {
      seedGate(w, entry)
      if (backoff !== null) w.files.set(GATE, JSON.stringify({ ...JSON.parse(w.files.get(GATE)!), backoffUntil: backoff }))
    })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await w.clock!.advance(2 * MIN)
    expect(focusCalls(w)).toEqual([])
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- FR-028 what is missing says why

test('a ticket Linear has no record of, or that ix-board could not be asked for, says so in place of a title', async ($, on) => {
  trace("FR-028-AC-28")
  let fails = true
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running']), agents: [agent('a', 'QSL-404', 'coder', 'running', 1)] })
  ix(w, { issues: ids => (fails ? out('', 1, 'ix-board broke') : out(JSON.stringify({ complete: false, missing: ids, issues: [] }))) })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const row = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').find(l => l.trim().startsWith('QSL-404'))
  await w.clock!.advance(MIN)
  expect(await row()).toMatch(/QSL-404 state not read +\d+m$/)
  fails = false
  await w.clock!.advance(40 * MIN)
  expect(await row()).toMatch(/QSL-404 not in Linear +\d+m$/)
  await ui.unmount()
})

test('where Linear has none of the asked tickets, ix-board exits 3 with its answer and each reads not in Linear', async ($, on) => {
  trace("FR-028-AC-28")
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running']), agents: [agent('a', 'QSL-404', 'coder', 'running', 1)] })
  ix(w, { issues: ids => out(JSON.stringify({ complete: false, missing: ids, issues: [] }), 3, '') })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines.find(l => l.trim().startsWith('QSL-404'))).toMatch(/QSL-404 not in Linear +\d+m$/)
  // The read did not fail: the warnings say nothing of an exit.
  await ui.press({ key: 'warnings-toggle' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')).not.toMatch(/ix-board exited|ix-board issues/)
  await ui.unmount()
})

test('exit 3 of ix-board issues with a message is a failure', async ($, on) => {
  trace("FR-028-AC-28")
  const w = world(on, true)
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running']), agents: [agent('a', 'QSL-404', 'coder', 'running', 1)] })
  ix(w, { issues: () => out('', 3, 'ix-board refused the request') })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines.find(l => l.trim().startsWith('QSL-404'))).toMatch(/QSL-404 state not read +\d+m$/)
  await ui.unmount()
})

test('of more than 100 tickets no focus names, those in hand are asked for first and one left out reads state not read', async ($, on) => {
  trace("FR-028-AC-30")
  const w = world(on, true)
  // 100 finished tickets whose ids sort before the one in hand.
  const done = Array.from({ length: 100 }, (_, i) => agent(`d${i}`, `AAA-${100 + i}`, 'coder', 'done', 1))
  w.leads.set(LEAD, { ...report(LEAD, 'FSL alpha', ['running']), agents: [...done, agent('a', 'QSL-1', 'coder', 'running', 1)] })
  const board = ix(w, { issues: ids => out(JSON.stringify({ complete: true, missing: [], issues: ids.map(id => single(id, 'Specced', [])) })) })
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  const asked = board.calls.find(c => c.startsWith('issues'))!.split(' ').slice(1)
  expect(asked).toHaveLength(100)
  expect(asked).toContain('QSL-1')
  expect(asked).not.toContain('AAA-199')
  await ui.press({ key: `finished-${LEAD}` })
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(rows.find(l => l.trim().startsWith('QSL-1 '))).toContain('QSL-1 single QSL-1')
  expect(rows.find(l => l.trim().startsWith('AAA-199 '))).toContain('AAA-199 state not read')
  expect(rows.find(l => l.trim().startsWith('AAA-198 '))).toContain('AAA-198 single AAA-198')
  await ui.unmount()
})

test('where no focus names tracker work, Recent says there is no focus status to read merges from', async ($, on) => {
  trace("FR-028-AC-29")
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'FSL alpha', ['running']))
  ix(w, {})
  await startSession($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines).toContain('No focus names a project or ticket, so there is no focus status to read merges from.')
  expect(lines.join('\n')).not.toMatch(/Waiting for ix-board|Nothing merged/)
  await ui.unmount()
})
