import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { BAND_PROPS, CLASSIC, FP, FULLSCREEN, SHOWN, out, report, startSession, whoamiLine, world } from './world'
import type { World } from './world'

// A source is read only while a view that draws it is on screen (FR-027). A test puts a view on
// screen by mounting it, takes it away by unmounting it, and counts the reads that follow.

const SEC = 1000
const MIN = 60 * SEC
const LEAD = 'draco:QSL:code'

/** Every read the mod makes, by the source behind it. */
type Reads = { prometheus: number; herdr: number; doctor: number; board: number; focus: number; escalations: number; announcements: number; team: number; events: number; retro: number; capacity: number; whoami: number; tickets: number }

const VIEWS = ['factory', 'focus', 'work', 'escalations', 'relay', 'team'] as const
type View = (typeof VIEWS)[number]

/** A world with a clock, a lead to read and every fetch recorded by what asked for it. */
function watched(on: Parameters<TestBody>[1]) {
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4'))
  const fetched: string[] = []
  const fleet: string[] = []
  w.fetch.value = (url, body) => ((body.includes('ix_fleet_') ? fleet : fetched).push(url), undefined)
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'herdr api snapshot') return out(JSON.stringify({ result: { snapshot: { version: '1', agents: [], workspaces: [] } } }))
    if (line === 'agent-msg escalations') return out('')
    if (line.startsWith('agent-msg log')) return out('')
    return prior?.(argv, init)
  }
  const count = (test: (line: string) => boolean) => w.ran.filter(test).length
  const reads = (): Reads => ({
    prometheus: fetched.filter(u => u.endsWith('/api/v1/query')).length,
    herdr: count(l => l === 'herdr api snapshot'),
    doctor: count(l => l === 'agent-msg doctor --json'),
    board: count(l => l.startsWith('ix-board --json agents')),
    focus: count(l => l.startsWith('agent-msg work --lead')),
    escalations: count(l => l === 'agent-msg escalations'),
    announcements: count(l => l.startsWith('agent-msg log')),
    team: fetched.filter(u => u.endsWith('/api/v1/query_range')).length,
    events: count(l => l.startsWith('agent-msg work events')),
    retro: count(l => l.startsWith('ix-board --json retro delta')),
    // The capacity's ledger query and its series.
    capacity: count(l => l.startsWith('ix-board --json fleet')) + fleet.length,
    tickets: count(l => l.startsWith('ix-board --json issues')),
    whoami: count(l => l === 'agent-msg whoami'),
  })
  return { w, reads }
}

/** The sources that have been read since `before`. */
const since = (before: Reads, now: Reads): string[] => (Object.keys(now) as (keyof Reads)[]).filter(k => k !== 'whoami' && now[k] > before[k])

const paneOf = (view: View, placement: 'dock' | 'widget' = 'dock') =>
  ({ plugin: 'factory-panel', surface: 'terminal', component: 'Pane', requestId: view, props: { title: view, isFocused: false, bodyColumns: 90, placement, scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const

const openPane = ($: Parameters<TestBody>[0], view: View, placement: 'dock' | 'widget' = 'dock') => $.ui.mount(paneOf(view, placement) as never)

const openBand = ($: Parameters<TestBody>[0], props: Record<string, unknown> = {}, viewport = CLASSIC) =>
  $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: { ...(BAND_PROPS as object), ...props }, viewport } as never)

const declare = (w: World, modules: string[]) => void w.files.set(`${FP}/features/default.json`, JSON.stringify({ modules }))

/** Moves the clock on; every wait on the way comes due in order. */
const pass = (w: World, ms: number): Promise<void> => w.clock!.advance(ms)

test('with nothing on screen no source is read, however long the session runs', async ($, on) => {
  trace("FR-027-AC-1")
  const { w, reads } = watched(on)
  await startSession($)
  await pass(w, 20 * MIN)
  expect(since({ ...reads(), prometheus: 0, herdr: 0, doctor: 0, board: 0, focus: 0, escalations: 0, announcements: 0, team: 0, events: 0, retro: 0, capacity: 0 }, reads())).toEqual([])
  expect(w.ran.filter(l => l.startsWith('agent-msg who') && l !== 'agent-msg whoami')).toEqual([])
  expect(w.ran.filter(l => l.startsWith('ix-board'))).toEqual([])
})

test('a session with nobody at it reads nothing and does not ask who it is', async ($, on) => {
  trace("FR-027-AC-2")
  const { w, reads } = watched(on)
  await startSession($, false)
  await pass(w, 10 * MIN)
  expect(Object.values(reads()).reduce((a, b) => a + b, 0)).toBe(0)
})

const DRAWS: Record<View, string[]> = {
  factory: ['prometheus', 'herdr', 'doctor', 'board'],
  focus: ['focus'],
  // Closed, the Work pane reads the leads' reports and events, their lanes' states (a fleet series, counted as
  // capacity) and the one read of the reported tickets.
  work: ['focus', 'events', 'capacity', 'tickets'],
  escalations: ['escalations'],
  relay: ['announcements'],
  team: ['team', 'retro', 'capacity'],
}

for (const view of VIEWS) {
  test(`the ${view} pane on screen reads its own sources and no other`, { options: { teams: 'QSL' } }, async ($, on) => {
    trace("FR-027-AC-3")
    const { w, reads } = watched(on)
    await startSession($)
    await pass(w, SEC)
    const before = reads()
    const ui = await openPane($, view)
    await pass(w, 70 * SEC)
    expect(since(before, reads())).toEqual(DRAWS[view])
    await ui.unmount()
  })
}

test('the Factory widget reads the machines, herdr and the relay, and no agents', { options: { teams: 'QSL' } }, async ($, on) => {
  trace("FR-027-AC-3")
  const { w, reads } = watched(on)
  await startSession($)
  await pass(w, SEC)
  const before = reads()
  const ui = await openPane($, 'factory', 'widget')
  await pass(w, 3 * MIN)
  expect(since(before, reads())).toEqual(['prometheus', 'herdr', 'doctor'])
  await ui.unmount()
})

test('the Team widget reads its series and the retro delta, and no capacity', { options: { teams: 'QSL' } }, async ($, on) => {
  trace("FR-027-AC-3")
  const { w, reads } = watched(on)
  await startSession($)
  await pass(w, SEC)
  const before = reads()
  const ui = await openPane($, 'team', 'widget')
  await pass(w, 3 * MIN)
  expect(since(before, reads())).toEqual(['team', 'retro'])
  await ui.unmount()
})

const BANDS: [string[], string[]][] = [
  [['local'], ['prometheus']],
  [['health', 'agents', 'spend'], ['prometheus']],
  [['focus', 'queue'], ['focus']],
  [['lanes'], ['board']],
  [['lead'], ['board', 'focus']],
  [['attention'], ['escalations']],
  [['relay'], ['doctor']],
  [['team'], ['team']],
  // The leads' work reports, which the Focus view reads with the same command; the events are the Work pane's alone.
  [['work'], ['focus', 'tickets']],
]

for (const [modules, expected] of BANDS) {
  test(`a band of ${modules.join(' and ')} reads only what those cells draw, drawn or still empty`, async ($, on) => {
    trace("FR-027-AC-4")
    const { w, reads } = watched(on)
    declare(w, modules)
    await startSession($)
    await pass(w, SEC)
    const before = reads()
    const ui = await openBand($)
    await pass(w, 70 * SEC)
    expect(since(before, reads()).sort()).toEqual([...expected].sort())
    await ui.unmount()
  })
}

for (const [state, listed] of [
  ['behind another tab', SHOWN.map(p => ({ ...p, isShown: p.id === 'focus' }))],
  ['waiting for a wider terminal', SHOWN.map(p => ({ ...p, isPlaced: false }))],
  ['closed', []],
] as const) {
  test(`a pane drawn for a moment and then ${state} is not read`, async ($, on) => {
    trace("FR-027-AC-5")
    const { w, reads } = watched(on)
    await startSession($)
    await pass(w, SEC)
    const before = reads()
    w.listed.value = [...listed]
    const ui = await openPane($, 'escalations')
    await pass(w, 3 * MIN)
    expect(since(before, reads())).toEqual([])
    await ui.unmount()
  })
}

test('once a view is off screen its sources are not read again', { options: { teams: 'QSL' } }, async ($, on) => {
  trace("FR-027-AC-6")
  const { w, reads } = watched(on)
  await startSession($)
  for (const view of VIEWS) {
    const ui = await openPane($, view)
    await pass(w, 20 * SEC)
    await ui.unmount()
  }
  const band = await openBand($)
  await pass(w, 20 * SEC)
  await band.unmount()
  await pass(w, SEC)
  const before = reads()
  await pass(w, 12 * MIN)
  expect(since(before, reads())).toEqual([])
})

test('a view that comes back reads at once when its data is older than its interval, and not when it is newer', async ($, on) => {
  trace("FR-027-AC-7")
  const { w, reads } = watched(on)
  await startSession($)
  const first = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(reads().escalations).toBe(1)
  await first.unmount()

  // Twenty seconds on, the data is younger than the minute it is read at.
  await pass(w, 20 * SEC)
  const soon = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(reads().escalations).toBe(1)
  await soon.unmount()

  await pass(w, 10 * MIN)
  expect(reads().escalations).toBe(1)
  const later = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(reads().escalations).toBe(2)
  await later.unmount()
})

for (const [state, props, viewport] of [
  ['collapsed', { isCollapsed: true }, CLASSIC],
  ['held by a survey', { hasSurvey: true }, CLASSIC],
  ['not drawn in the fullscreen layout', {}, FULLSCREEN],
] as const) {
  test(`a band ${state} reads nothing`, async ($, on) => {
    trace("FR-027-AC-8")
    const { w, reads } = watched(on)
    await startSession($)
    await pass(w, SEC)
    const before = reads()
    const ui = await openBand($, props, viewport)
    await pass(w, 3 * MIN)
    expect(since(before, reads())).toEqual([])
    await ui.unmount()
  })
}

test('the status line is on screen while the band slot is collapsed, so its cells are read', { options: { inlineView: 'status' } }, async ($, on) => {
  trace("FR-027-AC-8")
  const { w, reads } = watched(on)
  await startSession($)
  await pass(w, SEC)
  const before = reads()
  const ui = await openBand($, { isCollapsed: true })
  await pass(w, 3 * MIN)
  expect(since(before, reads())).toContain('prometheus')
  await ui.unmount()
})

test('with the band off nothing is read until a pane is opened', { options: { inlineView: 'off' } }, async ($, on) => {
  trace("FR-027-AC-8")
  const { w, reads } = watched(on)
  await startSession($)
  await pass(w, SEC)
  const before = reads()
  const ui = await openBand($)
  await pass(w, 3 * MIN)
  expect(since(before, reads())).toEqual([])
  await ui.unmount()
})

test('agent-msg doctor and the herdr snapshot run once a minute at most, whatever the refresh setting', { options: { refreshSeconds: 5 } }, async ($, on) => {
  trace("FR-027-AC-9")
  const { w, reads } = watched(on)
  await startSession($)
  const ui = await openPane($, 'factory')
  await pass(w, 125 * SEC)
  const r = reads()
  expect(r.doctor).toBeGreaterThanOrEqual(2)
  expect(r.doctor).toBeLessThanOrEqual(3)
  expect(r.herdr).toBeGreaterThanOrEqual(2)
  expect(r.herdr).toBeLessThanOrEqual(3)
  // Prometheus follows the setting: seven queries every five seconds.
  expect(r.prometheus).toBeGreaterThanOrEqual(7 * 20)
  await ui.unmount()
})

/** How finely the clock is stepped while watching for reads. */
const STEP = 5 * SEC

/** The seconds, counted from the start of the watch, at which each new read was seen over `ms`. */
async function readTimes(w: World, count: () => number, ms: number): Promise<number[]> {
  const from = w.clock!.now()
  const times: number[] = []
  let seen = count()
  for (let left = ms; left > 0; left -= STEP) {
    await w.clock!.advance(STEP)
    if (count() > seen) times.push(Math.round((w.clock!.now() - from) / SEC))
    seen = count()
  }
  return times
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]!)

test('a source that fails is read half as often each time, five minutes apart at most, and returns once it answers', async ($, on) => {
  trace("FR-027-AC-10")
  const { w, reads } = watched(on)
  let failing = true
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg escalations' && failing ? out('', 1, 'redis down') : prior?.(argv, init))
  await startSession($)
  const ui = await openPane($, 'escalations')
  const slow = gaps(await readTimes(w, () => reads().escalations, 17 * MIN))
  // A heartbeat of fifteen seconds, and the step of the watch, are the most a read is seen late by.
  const within = (gap: number, wait: number) => gap >= wait - 5 && gap <= wait + 20
  expect(slow.length).toBeGreaterThanOrEqual(3)
  expect(within(slow[0]!, 120)).toBe(true)
  expect(within(slow[1]!, 240)).toBe(true)
  for (const gap of slow.slice(2)) expect(within(gap, 300)).toBe(true)

  failing = false
  await pass(w, 6 * MIN)
  const back = gaps(await readTimes(w, () => reads().escalations, 4 * MIN))
  expect(back.length).toBeGreaterThanOrEqual(2)
  for (const gap of back) expect(within(gap, 60)).toBe(true)
  await ui.unmount()
})

test('a source that answers slowly is read less often', async ($, on) => {
  trace("FR-027-AC-11")
  const { w, reads } = watched(on)
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg escalations' ? w.clock!.sleep(8 * SEC).then(() => out('')) : prior?.(argv, init))
  await startSession($)
  const ui = await openPane($, 'escalations')
  const apart = gaps(await readTimes(w, () => reads().escalations, 12 * MIN))
  expect(apart[0]).toBeGreaterThanOrEqual(120)
  expect(apart[1]).toBeGreaterThanOrEqual(240)
  await ui.unmount()
})

test('the refresh key reads at once, while a source is backed off and before its interval is up', async ($, on) => {
  trace("FR-027-AC-12")
  const { w, reads } = watched(on)
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg escalations' ? out('', 1, 'redis down') : prior?.(argv, init))
  await startSession($)
  const ui = await openPane($, 'escalations')
  await pass(w, SEC)
  const before = reads().escalations
  await ui.press({ key: 'refresh' })
  await pass(w, SEC)
  expect(reads().escalations).toBe(before + 1)
  await ui.unmount()
})

test('opening a view by command reads nothing the view already holds', async ($, on) => {
  trace("FR-027-AC-13")
  const { w, reads } = watched(on)
  await startSession($)
  const ui = await openPane($, 'escalations')
  await pass(w, SEC)
  const before = reads()
  await $.command.run({ command: 'factory', args: 'escalations' } as never)
  await $.command.run({ command: 'factory', args: 'relay' } as never)
  await pass(w, SEC)
  expect(since(before, reads())).toEqual([])
  await ui.unmount()
})

test('a relay that cannot say who the session is is asked less and less often, and a command asks at once', async ($, on) => {
  trace("FR-027-AC-14")
  const { w, reads } = watched(on)
  w.whoami.value = undefined
  await startSession($)
  const ui = await openBand($)
  await pass(w, 6 * MIN)
  // Every refresh would be twenty-four; doubling to five minutes apart leaves a handful.
  expect(reads().whoami).toBeLessThanOrEqual(6)
  w.whoami.value = whoamiLine(LEAD)
  const before = reads().whoami
  await $.command.run({ command: 'factory', args: 'show' } as never)
  expect(reads().whoami).toBe(before + 1)
  await ui.unmount()
})

test('a changed focus choice reads the leads and lanes again at the next drawing', async ($, on) => {
  trace("FR-027-AC-15")
  const { w, reads } = watched(on)
  await startSession($)
  const ui = await openBand($)
  await pass(w, 2 * SEC)
  const before = reads()
  expect(before.board).toBe(1)
  w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify({ teams: ['ENG'] }))
  // The file is read at the next refresh and the lanes with it: 37 seconds after their last read,
  // whose interval is 60.
  await pass(w, 35 * SEC)
  expect(reads().board).toBe(2)
  expect(w.ran.filter(l => l.startsWith('ix-board --json agents')).at(-1)).toBe('ix-board --json agents ENG')
  await ui.unmount()
})

test('a changed teams choice reads the work reports again at the next drawing', async ($, on) => {
  trace("FR-027-AC-15")
  const { w } = watched(on)
  const eng = report('draco:ENG:code', 'Payments')
  w.leads.set('draco:ENG:code', { ...eng, agents: eng.agents.map(a => ({ ...a, ticket: 'ENG-9' })) })
  declare(w, ['work'])
  await startSession($)
  const ui = await openBand($)
  await pass(w, 2 * SEC)
  const cell = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('')
  expect(await cell()).toMatch(/1 ticket /)
  w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify({ modules: ['work'], teams: ['QSL', 'ENG'] }))
  // The cell's own interval of 60 seconds is not up.
  await pass(w, 35 * SEC)
  expect(await cell()).toMatch(/2 tickets /)
  // The focus and the work cell ask for the new lead's report once between them.
  expect(w.ran.filter(l => l === 'agent-msg work --lead draco:ENG:code show')).toHaveLength(1)
  await ui.unmount()
})

test('the refresh key of the Factory view reads ix-board agents again once 60 seconds have passed, and not before', { options: { teams: 'QSL' } }, async ($, on) => {
  trace("FR-027-AC-18")
  const { w, reads } = watched(on)
  await startSession($)
  const ui = await openPane($, 'factory')
  await pass(w, 2 * SEC)
  expect(reads().board).toBe(1)
  await pass(w, 20 * SEC)
  await ui.press({ key: 'refresh' })
  await pass(w, SEC)
  expect(reads().board).toBe(1)
  // Left alone, the gate holds the agents for 30 minutes; only the key asks after one.
  await pass(w, 60 * SEC)
  expect(reads().board).toBe(1)
  await ui.press({ key: 'refresh' })
  await pass(w, SEC)
  expect(reads().board).toBe(2)
  await ui.unmount()
})

test('a view drawn before the metrics address is found asks nothing of it, then reads as soon as it is known', { options: { prometheusUrl: '' } }, async ($, on) => {
  trace("FR-027-AC-17")
  const { w } = watched(on)
  const asked: string[] = []
  w.fetch.value = url => (asked.push(url), undefined)
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'ix config get observability.prometheusUrl' ? w.clock!.sleep(5 * SEC).then(() => out('http://prom.test\n')) : prior?.(argv, init))
  const started = startSession($)
  const ui = await openPane($, 'factory')
  await pass(w, 2 * SEC)
  expect(asked).toEqual([])
  await pass(w, 4 * SEC)
  await started
  expect(asked.length).toBeGreaterThan(0)
  expect(asked.every(url => url.startsWith('http://prom.test/'))).toBe(true)
  await ui.unmount()
})

test('a Work view drawn before the metrics address is found asks nothing for its lanes', { options: { prometheusUrl: '' } }, async ($, on) => {
  trace("FR-027-AC-17")
  const { w } = watched(on)
  const asked: string[] = []
  w.fetch.value = url => (asked.push(url), undefined)
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === 'ix config get observability.prometheusUrl' ? w.clock!.sleep(5 * SEC).then(() => out('http://prom.test\n')) : prior?.(argv, init))
  const started = startSession($)
  const ui = await openPane($, 'work')
  await pass(w, 2 * SEC)
  await ui.press({ key: 'refresh' })
  await pass(w, SEC)
  expect(asked).toEqual([])
  await pass(w, 4 * SEC)
  await started
  await pass(w, SEC)
  expect(asked.length).toBeGreaterThan(0)
  expect(asked.every(url => url.startsWith('http://prom.test/'))).toBe(true)
  await ui.unmount()
})
