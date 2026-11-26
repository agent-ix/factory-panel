import { expect } from 'claude-code/testing'
import { test } from './loud'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { BAR_CELLS, barCells, flagOf, foldTurns, issuesOf, readsCurrent, stateOf } from '../hooks/work'
import type { TicketState } from '../hooks/work'
import type { WorkIssue, WorkLanes, WorkLead } from '../types'
import { ix } from './board-kit'
import { openWork } from './open'
import { FP, out, report, startSession, world } from './world'
import type { World } from './world'

// Tests for what the Work tab draws of each ticket's state and of leads that are stuck or going nowhere (FR-028).

const NOW = Date.UTC(2026, 10, 24, 12, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN
type $t = Parameters<TestBody>[0]

const issue = (over: Partial<WorkIssue> = {}): WorkIssue => ({ identifier: 'QSL-1', title: 't', state: 'Coding', prs: [], stateType: 'started', updatedAt: NOW - 5 * HOUR, prAt: null, project: 'p1', ...over })
const pr = (status: string) => ({ url: 'u', repo: 'r', number: 1, status, draft: status === 'draft' })

test('a ticket is done, in review, worked on or not started by what Linear, its PRs and the agents say, and never guessed', () => {
  trace("FR-028-AC-39")
  expect(stateOf(issue({ stateType: 'completed', state: 'Done', prs: [pr('open')] }), true)).toBe('done')
  expect(stateOf(issue({ state: 'In Review' }), false)).toBe('review')
  expect(stateOf(issue({ stateType: 'unstarted', state: 'Specced', prs: [pr('open')] }), false)).toBe('review')
  expect(stateOf(issue({ prs: [pr('merged')] }), false)).toBe('working')
  expect(stateOf(issue({ stateType: 'unstarted', state: 'Specced' }), true)).toBe('working')
  expect(stateOf(issue({ stateType: 'backlog', state: 'Backlog' }), false)).toBe('new')
  expect(stateOf(issue({ stateType: 'canceled', state: 'Canceled' }), false)).toBe('canceled')
  expect(stateOf(undefined, true)).toBe('unread')
  expect(stateOf(issue({ stateType: undefined }), true)).toBe('unread')
})

test('a bar is one cell a ticket up to twenty, and above that is shared with a cell for every state there is', () => {
  trace("FR-028-AC-40")
  const of = (n: Partial<Record<TicketState, number>>) => (Object.entries(n) as [TicketState, number][]).flatMap(([s, c]) => Array<TicketState>(c).fill(s))
  expect(barCells(of({ working: 2, done: 3, new: 1 }))).toEqual([{ state: 'done', cells: 3 }, { state: 'working', cells: 2 }, { state: 'new', cells: 1 }])
  expect(barCells(of({ done: 20 }))).toEqual([{ state: 'done', cells: 20 }])
  const big = barCells(of({ done: 97, review: 1, working: 1, new: 1 }))
  expect(big.reduce((n, c) => n + c.cells, 0)).toBe(BAR_CELLS)
  expect(big.map(c => c.state)).toEqual(['done', 'review', 'working', 'new'])
  expect(big.every(c => c.cells >= 1)).toBe(true)
  expect(barCells(of({ done: 30, new: 10 }))).toEqual([{ state: 'done', cells: 15 }, { state: 'new', cells: 5 }])
  // A canceled ticket is not drawn.
  expect(barCells(of({ canceled: 3 }))).toEqual([])
})

const LEAD = 'draco:QSL:code'
const lead = (...tickets: string[]): WorkLead => ({ address: LEAD, status: 'running', reportedAt: NOW, error: null, readAt: NOW, focus: null, agents: tickets.map((t, i) => ({ name: `a${i}`, ticket: t, role: 'coder', status: 'running', reportedAt: NOW })) })
const lanes = (state: string, reason: string | null = null, isStuck = false, since: number | null = null, at = NOW): WorkLanes => ({ at, lanes: { [LEAD]: { state, reason, isStuck, since } } })

test('a lead is stuck where its lane waits on a person or a tool, and churning where it works and nothing moves for two hours', () => {
  trace("FR-028-AC-41")
  const singles = new Map([['QSL-1', issue()]])
  const flag = (l: WorkLanes | null, turn: number | undefined = NOW - 3 * HOUR, held: ReadonlyMap<string, WorkIssue> = singles, who = lead('QSL-1')) => flagOf(who, l, held, turn, NOW, true)
  expect(flag(lanes('blocked', 'permission', true, NOW - 2 * HOUR))).toEqual({ kind: 'stuck', since: NOW - 2 * HOUR, why: 'blocked on a permission request' })
  expect(flag(lanes('stuck', null, true, NOW - HOUR))?.why).toBe('a tool call ran past its limit')
  expect(flag(lanes('blocked', 'usage_limit', true, NOW - HOUR))?.why).toBe('usage limit')
  // A repeated sleep or poll line is no wait on a person.
  expect(flag(lanes('blocked', 'wait_loop'))).toBeNull()
  expect(flag(lanes('working'))).toEqual({ kind: 'churning', since: NOW - 3 * HOUR, why: 'the lane is working, and no ticket, role or PR of it has changed' })
  // Any change inside two hours: a role, a ticket as Linear has it, a PR.
  expect(flag(lanes('working'), NOW - 119 * MIN)).toBeNull()
  expect(flag(lanes('working'), undefined, new Map([['QSL-1', issue({ updatedAt: NOW - HOUR })]]))).toBeNull()
  expect(flag(lanes('working'), NOW - 3 * HOUR, new Map([['QSL-1', issue({ updatedAt: NOW - HOUR })]]))).toBeNull()
  expect(flag(lanes('working'), NOW - 3 * HOUR, new Map([['QSL-1', issue({ prAt: NOW - HOUR })]]))).toBeNull()
  // Without the data nothing is said: no lanes, old lanes, no change known, a ticket or its PRs unread.
  expect(flag(null)).toBeNull()
  expect(flag(lanes('blocked', 'permission', true, null, NOW - 10 * MIN))).toBeNull()
  expect(flagOf(lead('QSL-1'), lanes('working'), singles, undefined, NOW, true)).toBeNull()
  expect(flag(lanes('working'), NOW - 3 * HOUR, new Map())).toBeNull()
  expect(flag(lanes('working'), NOW - 3 * HOUR, new Map([['QSL-1', issue({ prs: null })]]))).toBeNull()
  expect(flag(lanes('idle'))).toBeNull()
  expect(flag(lanes('working'), NOW - 3 * HOUR, new Map([['QSL-1', issue({ stateType: 'completed' })]]))).toBeNull()
})

test('a repeated report is no change of an agent, and its role, status, ticket or removal is', () => {
  trace("FR-028-AC-41")
  const event = (at: number, status: string, kind = 'agent') => ({ at_ms: at, binding: { address: LEAD }, change: kind === 'remove' ? { kind, agent_id: 'a' } : { kind, agent: { agent_id: 'a', role: 'coder', ticket: 'QSL-1', status } } })
  const first = foldTurns([event(1, 'running'), event(2, 'running')], {})
  expect(first.turns[LEAD]).toBe(1)
  expect(foldTurns([event(3, 'running')], first).turns[LEAD]).toBe(1)
  expect(foldTurns([event(4, 'waiting')], first).turns[LEAD]).toBe(4)
  expect(foldTurns([event(5, '', 'remove')], first).turns[LEAD]).toBe(5)
})

test('an ix-board issues answer gives each ticket its state category, its last update and its newest PR time', () => {
  trace("FR-028-AC-39")
  const [one] = issuesOf({ issues: [{ identifier: 'QSL-1', title: 't', state_name: 'Coding', state_type: 'started', updated_at: '2026-11-24T10:00:00Z', attachments_complete: true, pull_requests: [{ url: 'u', repo: 'r', number: 1, status: 'merged', created_at: '2026-11-24T08:00:00Z', merged_at: '2026-11-24T11:00:00Z' }] }] })
  expect(one).toMatchObject({ stateType: 'started', updatedAt: Date.UTC(2026, 10, 24, 10), prAt: Date.UTC(2026, 10, 24, 11) })
})

// ---------------------------------------------------------------- the pane

const P1 = '00000000-0000-4000-8000-000000000001'
const P2 = '00000000-0000-4000-8000-000000000002'
const A = 'draco:QSL:arch'
const B = 'draco:QSL:codex-code-b'
const C = 'luna:QSL:code'
const D = 'luna:QSL:review'
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'work', props: { title: 'Work', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const

const working = (address: string, tickets: string[], ago = 5) => ({ ...report(address, `focus of ${address}`), agents: tickets.map((t, i) => ({ agent_id: `${address}-${i}`, name: `n${i}`, ticket: t, role: 'coder', status: 'running', reported_at_ms: NOW - ago * MIN })), focus: null, scope: null })

/** What ix-board says of each ticket of the fleet below. */
const STATES: Record<string, [string, string, string | null]> = {
  'QSL-1': ['completed', 'Done', P1],
  'QSL-2': ['started', 'In Review', P1],
  'QSL-3': ['started', 'Coding', P2],
  'QSL-4': ['unstarted', 'Specced', null],
  'QSL-5': ['started', 'Coding', P1],
}

async function fleet($: $t, on: Parameters<TestBody>[1], reason = 'permission'): Promise<World & { board: { calls: string[] } }> {
  const w = world(on, true)
  w.leads.set(A, working(A, ['QSL-1', 'QSL-2', 'QSL-3']))
  // QSL-3 is held by two leads of the host, and counts once there.
  w.leads.set(B, working(B, ['QSL-3', 'QSL-4']))
  w.leads.set(C, working(C, ['QSL-5']))
  w.leads.set(D, working(D, ['QSL-1'], 3 * 60))
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({}))
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (!argv.join(' ').startsWith('agent-msg work events')) return prior?.(argv, init)
    const events = argv.includes('0-0') ? [A, B, C, D].map(address => ({ at_ms: NOW - 3 * HOUR, binding: { address }, change: { kind: 'agent', agent: { agent_id: 'x', role: 'coder', ticket: 'QSL-1', status: 'running' } } })) : []
    return out(JSON.stringify({ events, has_more: false, next_cursor: '9-0' }))
  }
  // The lanes: A waits on a permission, C works and nothing of it has moved for three hours.
  const series = (labels: Record<string, string>, value: number) => ({ metric: labels, value: [NOW / 1000, String(value)] })
  w.fetch.value = (_url, body) => {
    const q = body.replace(/^query=/, '')
    if (!q.includes('ix_fleet_lane')) return undefined
    const now = w.clock!.now() / 1000
    const lane = (address: string, state: string) => ({ host: address.split(':')[0]!, lane: address, state })
    const result = q.startsWith('timestamp(ix_fleet_lane_blocked') ? [series({ host: 'draco', lane: A, reason }, now)]
      : q.startsWith('timestamp(ix_fleet_lane_state') ? [series(lane(A, 'blocked'), now), series(lane(B, 'idle'), now), series(lane(C, 'working'), now)]
      : q.startsWith('max_over_time') ? [series(lane(A, 'working'), now - 2 * 3600)]
      : [series(lane(A, 'working'), now - 20 * 3600)]
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result } }) } }
  }
  const board = ix(w, {
    issues: ids => out(JSON.stringify({ complete: true, missing: [], issues: ids.map(id => ({ identifier: id, title: `title ${id}`, state_name: STATES[id]![1], state_type: STATES[id]![0], project_id: STATES[id]![2], updated_at: new Date(NOW - 4 * HOUR).toISOString(), attachments_complete: true, pull_requests: [] })) })),
    roadmap: () => out(JSON.stringify({ projects: [] })),
    other: args => (args[0] === 'project-chunk' ? out(JSON.stringify({ name: args[1] === P1 ? 'Ledger' : 'Payments' })) : out('', 1, 'not stubbed')),
  })
  await startSession($)
  return Object.assign(w, { board })
}

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[]; text?: string }
const walk = (n: Node, f: (n: Node) => void): void => {
  f(n)
  for (const c of n.children ?? []) if (typeof c === 'object' && c !== null) walk(c as Node, f)
}

test('closed, each host is one line with its bar, count and alerts, read without a focus status or any name', async ($, on) => {
  trace("FR-028-AC-42", "FR-028-AC-43")
  const w = await fleet($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  expect(buttons.filter(b => b.startsWith('▸'))).toEqual(['▸ draco', '▸ luna', '▸ Recent'])
  // draco: QSL-1 done, QSL-2 in review, QSL-3 (twice) and QSL-4 worked on; one lead stuck. luna: one of its two leads
  // has an old report and the other is churning, so two time warnings.
  const text = lines.join('|')
  expect(text).toContain('█|▓|▒▒|4|⚠ 1')
  expect(text).toContain('█|▒|2|⏱ 2')
  expect(text).not.toMatch(/QSL-|Ledger|old/)
  // The one read of every reported ticket, and nothing of ix-board besides.
  expect(w.board.calls).toEqual(['issues QSL-1 QSL-2 QSL-3 QSL-4 QSL-5'])
  expect(w.ran.some(l => /focus status|roadmap|project-chunk/.test(l))).toBe(false)
  await ui.unmount()
})

test('a host opens to a line a lead with the bars in one column, and a lead to its projects, rows and the reason for its alert', async ($, on) => {
  trace("FR-028-AC-42", "FR-028-AC-44", "FR-028-AC-45")
  const w = await fleet($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  await openWork(ui, () => w.clock!.advance(MIN), /^(host:|old:)/)
  const text = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const closed = await text()
  expect(closed).toEqual(expect.arrayContaining(['QSL:arch', 'QSL:codex-code-b', '⚠ 2h', '⏱ 3h']))
  // Every line is name, bar, count: the name boxes have one width, the bar boxes and the count boxes theirs.
  const widths = { name: new Set<number>(), bar: new Set<number>(), count: new Set<number>() }
  walk((await ui.findAll({ type: 'Box' }))[0] as Node, n => {
    const kids = (n.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
    if (kids.length >= 3 && kids[1]!.props?.width === BAR_CELLS) {
      widths.name.add(kids[0]!.props?.width as number)
      widths.bar.add(kids[1]!.props?.width as number)
      widths.count.add(kids[2]!.props?.width as number)
    }
  })
  expect([widths.name.size, [...widths.bar], [...widths.count]]).toEqual([1, [BAR_CELLS], [4]])
  await ui.press({ key: `lead:${A}` })
  await w.clock!.advance(MIN)
  const stuck = (await text()).join('\n')
  expect(stuck).toContain('⚠ stuck: blocked on a permission request, for 2h')
  // Project headings over rows with their state marks.
  expect(stuck).toMatch(/Payments\n▒\n QSL-3 title QSL-3.*\nLedger\n▓\n QSL-2 title QSL-2.*\n█\n QSL-1 title QSL-1/)
  await ui.press({ key: `lead:${C}` })
  await ui.press({ key: `lead:${D}` })
  await w.clock!.advance(MIN)
  const late = (await text()).join('\n')
  expect(late).toMatch(/⏱ no movement for \dh: the lane is working, and no ticket, role or PR of it has changed/)
  expect(late).toContain('⏱ old report: the lead last reported 3h ago')
  await ui.unmount()
})

const statuses = (w: { board: { calls: string[] } }) => w.board.calls.filter(c => c.startsWith('focus status'))
const named = (w: { board: { calls: string[] } }) => w.board.calls.filter(c => /^(roadmap|project-chunk)/.test(c))

test('Recent and the focus choices are read only once they are opened', async ($, on) => {
  trace("FR-028-AC-46")
  const w = await fleet($, on)
  w.leads.set(A, { ...working(A, ['QSL-1']), scope: { projects: [P2], initiatives: [], reported_at_ms: NOW - MIN } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  expect([statuses(w), named(w)]).toEqual([[], []])
  await ui.press({ key: 'focus-choice' })
  await w.clock!.advance(MIN)
  expect(named(w)).toContain(`project-chunk ${P2}`)
  expect(statuses(w)).toEqual([])
  await ui.press({ key: 'recent' })
  await w.clock!.advance(MIN)
  expect(statuses(w).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('under a chosen focus the closed view reads that focus’s status and name, and no other', async ($, on) => {
  trace("FR-028-AC-47")
  const w = await fleet($, on)
  w.leads.set(A, { ...working(A, ['QSL-1']), scope: { projects: [P2], initiatives: [], reported_at_ms: NOW - MIN } })
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({ focus: `project:${P1}` }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  expect(w.board.calls.filter(c => c.includes(P2))).toEqual([])
  expect(statuses(w).every(c => c.includes(P1))).toBe(true)
  expect(statuses(w).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('a lane blocked on its usage limit is stuck and says so when opened, and one in a wait loop is not', async ($, on) => {
  trace("FR-028-AC-41", "FR-028-AC-45")
  const w = await fleet($, on, 'usage_limit')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  await openWork(ui, () => w.clock!.advance(MIN), /^host:/)
  await ui.press({ key: `lead:${A}` })
  await w.clock!.advance(MIN)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines).toContain('    ⚠ stuck: usage limit, for 2h')
  await ui.unmount()
})

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

/** Makes the commands starting with `prefix` fail from the time `down.value` is set. */
function failing(w: World, prefix: string) {
  const down = { value: false }
  const prior = w.stub.value!
  w.stub.value = (argv, init) => (down.value && argv.join(' ').startsWith(prefix) ? out('', 1, 'broke') : prior(argv, init))
  return down
}

test('tickets and events can say nothing has changed only where both were read lately, without error and to the end', () => {
  trace("FR-028-AC-48")
  const board = { issues: [], activity: null, at: NOW - MIN, error: null, ticketsOnly: true as const }
  const feed = { at: NOW - MIN, error: null }
  expect(readsCurrent(board, feed, NOW)).toBe(true)
  expect(readsCurrent(undefined, feed, NOW)).toBe(false)
  expect(readsCurrent({ ...board, error: 'broke' }, feed, NOW)).toBe(false)
  expect(readsCurrent({ ...board, at: NOW - 11 * MIN }, feed, NOW)).toBe(false)
  expect(readsCurrent({ ...board, at: null }, feed, NOW)).toBe(false)
  expect(readsCurrent(board, { error: null }, NOW)).toBe(false)
  expect(readsCurrent(board, { at: NOW - 6 * MIN, error: null }, NOW)).toBe(false)
  // A failed read, and one still catching up, are held as an error.
  expect(readsCurrent(board, { at: NOW - MIN, error: 'more than 5000 events behind, catching up' }, NOW)).toBe(false)
  const working = lanes('working')
  expect(flagOf(lead('QSL-1'), working, new Map([['QSL-1', issue()]]), NOW - 3 * HOUR, NOW, false)).toBeNull()
  expect(flagOf({ ...lead('QSL-1'), error: 'unreachable' }, working, new Map([['QSL-1', issue()]]), NOW - 3 * HOUR, NOW, true)).toBeNull()
  // A stuck lane is still said.
  expect(flagOf(lead('QSL-1'), lanes('stuck', null, true, null), new Map(), undefined, NOW, false)?.kind).toBe('stuck')
})

for (const [what, prefix] of [['ix-board issues', 'ix-board --json issues'], ['the events', 'agent-msg work events']] as const) {
  test(`a lead is no longer said to be churning once ${what} cannot be read`, async ($, on) => {
    trace("FR-028-AC-48")
    const w = await fleet($, on)
    const down = failing(w, prefix)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await w.clock!.advance(MIN)
    await openWork(ui, () => w.clock!.advance(MIN), /^host:luna/)
    const said = async () => (await texts(ui)).filter(t => /^⏱ [0-9]+[hm]$/.test(t))
    // The churning lead's row, beside the host's count.
    expect((await said()).length).toBeGreaterThan(0)
    down.value = true
    await w.clock!.advance(7 * MIN)
    expect(await said()).toEqual([])
    await ui.unmount()
  })
}

test('a bar gives no state fewer cells than a state with fewer tickets', () => {
  trace("FR-028-AC-40")
  const of = (review: number, working: number, fresh: number, done = 0): TicketState[] => [...Array<TicketState>(done).fill('done'), ...Array<TicketState>(review).fill('review'), ...Array<TicketState>(working).fill('working'), ...Array<TicketState>(fresh).fill('new')]
  expect(barCells(of(1, 18, 2))).toEqual([{ state: 'review', cells: 1 }, { state: 'working', cells: 17 }, { state: 'new', cells: 2 }])
  for (let done = 0; done <= 6; done++)
    for (let review = 0; review <= 6; review++)
      for (let working = 0; working <= 40; working++)
        for (let fresh = 0; fresh <= 6; fresh++) {
          const states = of(review, working, fresh, done)
          const bar = barCells(states)
          const count = (s: string) => states.filter(x => x === s).length
          if (states.length > BAR_CELLS) expect(bar.reduce((n, c) => n + c.cells, 0)).toBe(BAR_CELLS)
          for (const a of bar) for (const b of bar) if (count(a.state) > count(b.state) && a.cells < b.cells) throw new Error(`${done} ${review} ${working} ${fresh}: ${JSON.stringify(bar)}`)
        }
})

test('a count that is not known is a dash and one that may be short is marked, never 0', async ($, on) => {
  trace("FR-028-AC-49")
  const w = await fleet($, on)
  const prior = w.stub.value!
  w.stub.value = (argv, init) => (argv.join(' ') === `agent-msg work --lead ${C} show` ? out('', 1, 'unreachable') : prior(argv, init))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  await openWork(ui, () => w.clock!.advance(MIN), /^(host:luna|old:)/)
  const lines = await texts(ui)
  // The lead never read, and its host, which holds the one ticket of its other lead.
  expect(lines[lines.indexOf('QSL:code') + 1]).toBe('—')
  expect(lines).toContain('≥1')
  expect(lines).not.toContain('0')
  await ui.unmount()
})

test('under a focus whose tickets cannot be placed the closed lines give no 0', async ($, on) => {
  trace("FR-028-AC-49")
  const w = await fleet($, on)
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({ focus: `project:${P1}` }))
  const down = failing(w, 'ix-board --json issues')
  down.value = true
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(2 * MIN)
  const lines = await texts(ui)
  expect(lines).not.toContain('0')
  expect(lines.some(t => t === '—' || /^≥[0-9]+$/.test(t))).toBe(true)
  await ui.unmount()
  const widget = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'widget' } } as never)
  await w.clock!.advance(MIN)
  expect((await texts(widget)).join('')).not.toMatch(/(^| )≥?0 tickets/)
  await widget.unmount()
})

test('a stuck lead counts on its host when its row shows that its report was not read', async ($, on) => {
  trace("FR-028-AC-42")
  const w = await fleet($, on)
  const down = failing(w, `agent-msg work --lead ${A} show`)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(MIN)
  down.value = true
  await w.clock!.advance(3 * MIN)
  await openWork(ui, () => w.clock!.advance(1000), /^host:draco/)
  const lines = await texts(ui)
  expect(lines.some(t => /^▲ [0-9]+m$/.test(t))).toBe(true)
  expect(lines).toContain('⚠ 1')
  await ui.unmount()
})

for (const [what, stderr, isRate] of [['a rate limit', 'Linear rate limited; retry in 3600s', true], ['another failure', 'broke', false]] as const) {
  test(`a project name call that ends in ${what} is no answer: it is said and held${isRate ? ' for every read' : ' five minutes'}`, async ($, on) => {
    trace("FR-028-AC-50")
    const w = await fleet($, on)
    const down = failing(w, 'ix-board --json project-chunk')
    const prior = w.stub.value!
    w.stub.value = (argv, init) => (down.value && argv[2] === 'project-chunk' ? out('', 1, stderr) : prior(argv, init))
    down.value = true
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await w.clock!.advance(MIN)
    await openWork(ui, () => w.clock!.advance(1000), /^host:draco/)
    await ui.press({ key: `lead:${A}` })
    await w.clock!.advance(MIN)
    const gate = JSON.parse(w.files.get(`${FP}/linear-gate.json`)!) as { backoffUntil: number | null; entries: Record<string, { unkept?: boolean; data: unknown }> }
    if (isRate) expect(gate.backoffUntil).toBeGreaterThan(w.clock!.now())
    else expect(gate.entries[`project-name:${P1}`]).toMatchObject({ unkept: true, data: null })
    await ui.press({ key: 'warnings-toggle' })
    expect((await texts(ui)).join('\n')).toMatch(isRate ? /ix-board: .*(rate limit|paused|until)/i : /ix-board: broke/)
    down.value = false
    // A failure other than a rate limit is asked again after five minutes.
    await w.clock!.advance(7 * MIN)
    if (!isRate) expect((await texts(ui)).join('\n')).toContain('Ledger')
    await ui.unmount()
  })
}

for (const [what, key] of [['the lead', `lead:${A}`], ['its host', 'host:draco']] as const) {
  test(`a project name warning leaves the footer when ${what} is closed`, async ($, on) => {
    trace("FR-028-AC-50")
    const w = await fleet($, on)
    const prior = w.stub.value!
    w.stub.value = (argv, init) => (argv[2] === 'project-chunk' ? out('', 1, 'broke') : prior(argv, init))
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await w.clock!.advance(MIN)
    await openWork(ui, () => w.clock!.advance(1000), /^host:draco/)
    await ui.press({ key: `lead:${A}` })
    await w.clock!.advance(MIN)
    expect(await ui.find({ key: 'warnings-toggle' })).toBeDefined()
    await ui.press({ key })
    await w.clock!.advance(1000)
    expect(await ui.find({ key: 'warnings-toggle' })).toBeUndefined()
    await ui.unmount()
  })
}
