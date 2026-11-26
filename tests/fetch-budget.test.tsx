import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { test } from './loud'
import { trace } from './trace'

import { BAND_PROPS, CLASSIC, FP, out, pid, report, roadmapJson, startSession, statusJson, world } from './world'
import type { World } from './world'

// How much the mod reads (FR-027, "Fetch budget and measurement"). Each test runs a scripted timeline on the fake clock
// in 5 second steps and reads what was read from `/factory show fetch`, the mod's own meter, checked against the
// commands the world saw run. Budgets are upper bounds (`<=`); each tuned read names the number it had before.

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const STEP = 5 * SEC
const LEAD = 'draco:QSL:code'
const SESSION = 'sess-1'

type Body = Parameters<TestBody>[0]

/** A world with a clock, a lead to read, and every Prometheus call recorded by its endpoint. */
function watched(on: Parameters<TestBody>[1]) {
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4'))
  const fetched: string[] = []
  w.fetch.value = url => (fetched.push(url), undefined)
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'herdr api snapshot') return out(JSON.stringify({ result: { snapshot: { version: '1', agents: [], workspaces: [] } } }))
    if (line === 'agent-msg escalations') return out('')
    if (line.startsWith('agent-msg log')) return out('')
    return prior?.(argv, init)
  }
  return { w, fetched }
}

const ran = (w: World, test: (line: string) => boolean): number => w.ran.filter(test).length

const pane = (view: string) => ({ plugin: 'factory-panel', surface: 'terminal', component: 'Pane', requestId: view, props: { title: view, isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as never
const openPane = ($: Body, view: string) => $.ui.mount(pane(view))
const openBand = ($: Body) => $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: CLASSIC } as never)
const declare = (w: World, modules: string[]) => void w.files.set(`${FP}/features/default.json`, JSON.stringify({ modules }))

/** Runs the clock `ms` on in 5 second steps, so that every wait on the way comes due in order. */
async function run(w: World, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= STEP) await w.clock!.advance(Math.min(STEP, left))
}

const show = async ($: Body): Promise<string> => ((await $.command.run({ command: 'factory', args: 'show fetch' } as never)) as { text: string }).text

type Row = { reads: number; spawns: number; http: number; bytes: number; fail: number; slow: number; skips: string; gate: string }

/** One row of `/factory show fetch`, by name; zeros for a source not counted yet. */
async function meterRow($: Body, name: string): Promise<Row> {
  const line = (await show($)).split('\n').find(l => l.startsWith(`${name} `))
  if (line === undefined) return { reads: 0, spawns: 0, http: 0, bytes: 0, fail: 0, slow: 0, skips: '-', gate: '-' }
  const [, reads, spawns, http, bytes, , fail, slow, skips, gate] = line.trim().split(/\s{2,}/)
  return { reads: Number(reads), spawns: Number(spawns), http: Number(http), bytes: Number(bytes), fail: Number(fail), slow: Number(slow), skips: skips ?? '-', gate: gate ?? '-' }
}

/** Stubs one command line, ahead of what the world answers already. */
function answer(w: World, match: (line: string) => boolean, reply: (line: string) => ReturnType<typeof out> | Promise<ReturnType<typeof out>>): void {
  const prior = w.stub.value
  w.stub.value = (argv, init) => (match(argv.join(' ')) ? reply(argv.join(' ')) : prior?.(argv, init))
}

// ---------------------------------------------------------------- the meter

test('/factory show fetch counts every process run and every Prometheus call, by source', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-30')
  const { w, fetched } = watched(on)
  await startSession($)
  const ui = await openPane($, 'factory')
  await ui.press({ key: 'board' })
  await run(w, 10 * MIN)
  const text = await show($)
  const total = /^total: (\d+) spawns, (\d+) http, (\d+) bytes$/m.exec(text)
  expect(total).not.toBeNull()
  expect(Number(total![1])).toBe(w.ran.length)
  expect(Number(total![2])).toBe(fetched.length)
  expect(Number(total![3])).toBeGreaterThan(0)
  expect((await meterRow($, 'relay')).spawns).toBe(ran(w, l => l === 'agent-msg doctor --json'))
  expect((await meterRow($, 'board')).spawns).toBe(ran(w, l => l.startsWith('ix-board --json agents')))
  expect((await meterRow($, 'prometheus:machines')).http).toBe(fetched.length)
  // A read of a source is counted once, whatever it runs.
  expect((await meterRow($, 'prometheus')).reads).toBeGreaterThanOrEqual(10 * 4)
  expect(text).toMatch(/gate/)
  await ui.unmount()
})

test('without FACTORY_PANEL_METER no meter file is written and ix-board is not asked for its Linear counters', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-31')
  const { w, fetched } = watched(on)
  on('session.id', () => ({ value: SESSION }))
  await startSession($)
  const ui = await openPane($, 'work')
  await run(w, 12 * MIN)
  expect(fetched.length).toBeGreaterThan(0)
  expect([...w.files.keys()].filter(k => k.includes('meter-'))).toEqual([])
  expect(ran(w, l => l.includes('cache status'))).toBe(0)
  await ui.unmount()
})

test('with FACTORY_PANEL_METER the meter file is written at most every 5 minutes and the Linear spend of gated reads is sampled', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-31')
  const { w } = watched(on)
  mock.env(on, { FACTORY_PANEL_METER: '1' })
  on('session.id', () => ({ value: SESSION }))
  let used = 0
  answer(w, l => l === 'ix-board --json cache status', () => out(JSON.stringify({ quota: { requests_used: (used += 3), complexity_used: used * 100 } })))
  await startSession($)
  const ui = await openPane($, 'work')
  await run(w, 40 * MIN)
  const path = `${FP}/meter-${SESSION}.json`
  const file = JSON.parse(w.files.get(path)!) as { rows: Record<string, { spawns: number; linearRequests: number }> }
  expect(file.rows.work).toBeDefined()
  expect(ran(w, l => l.startsWith('mv -f ') && l.endsWith(` ${path}`))).toBeLessThanOrEqual(40 / 5 + 1)
  // The first gated read sets the baseline; each later one spent 3 requests.
  const issues = ran(w, l => l.startsWith('ix-board --json issues'))
  expect(issues).toBeGreaterThanOrEqual(2)
  expect(file.rows['gate:tickets']!.linearRequests).toBeGreaterThanOrEqual(3)
  expect(file.rows['gate:tickets']!.linearRequests % 3).toBe(0)
  await ui.unmount()
})

// ---------------------------------------------------------------- T1, T2: ix-board agents

test('the Factory pane reads ix-board agents only while its chip is open, and at once when it opens', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-32')
  const { w } = watched(on)
  await startSession($)
  const ui = await openPane($, 'factory')
  await run(w, 10 * MIN)
  // Before: read at the start and kept, 1 in 10 minutes, though nothing drew the agents.
  expect((await meterRow($, 'board')).spawns).toBe(0)
  await ui.press({ key: 'board' })
  await run(w, 20 * SEC)
  expect((await meterRow($, 'board')).spawns).toBe(1)
  await ui.press({ key: 'board' })
  await run(w, 10 * MIN)
  expect((await meterRow($, 'board')).spawns).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('ix-board agents is shared for a minute, not held by the 30 minute Linear gate or a Linear rate limit', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-33')
  const { w } = watched(on)
  mock.env(on, { FACTORY_PANEL_METER: '1' })
  // Linear is rate limiting every other read for the next two hours.
  const until = w.clock!.now() + 2 * HOUR
  w.files.set(`${FP}/linear-gate.json`, JSON.stringify({ backoffUntil: until, entries: {} }))
  await startSession($)
  const ui = await openPane($, 'factory')
  await ui.press({ key: 'board' })
  await run(w, HOUR)
  const agents = await meterRow($, 'board')
  // Before: none while the rate limit held, and at most 2 an hour (30 minutes old) without one. After: once a minute.
  expect(agents.spawns).toBeGreaterThanOrEqual(50)
  expect(agents.spawns).toBeLessThanOrEqual(60 + 1)
  expect((await meterRow($, 'gate:agents')).gate).not.toMatch(/backoff/)
  // It makes no Linear call, so no Linear spend is sampled for it.
  expect(ran(w, l => l.includes('cache status'))).toBe(0)
  await ui.unmount()
})

test('a second session takes the agents another session read within the minute', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-33')
  const { w } = watched(on)
  const fresh = (at: number) => w.files.set(`${FP}/agents-gate.json`, JSON.stringify({ backoffUntil: null, entries: { 'agents:QSL': { at, claimAt: null, data: { agents: [], notes: [] } } } }))
  fresh(w.clock!.now())
  await startSession($)
  const ui = await openPane($, 'factory')
  await ui.press({ key: 'board' })
  await run(w, 30 * SEC)
  expect((await meterRow($, 'board')).spawns).toBe(0)
  expect((await meterRow($, 'gate:agents')).gate).toMatch(/hit/)
  await ui.unmount()
})

// ---------------------------------------------------------------- T6: escalation detail

/** 100 escalations, the 10 newest open, the rest resolved; each `escalation show` takes a second. */
function escalations(w: World) {
  const rows = Array.from({ length: 100 }, (_, i) => `e${i + 1}  ${i >= 90 ? 'waiting' : 'resolved'}  -  ${LEAD}  11-20 16:29`)
  const state = { inflight: 0, max: 0 }
  answer(w, l => l === 'agent-msg escalations', () => out(rows.join('\n')))
  answer(
    w,
    l => l.startsWith('agent-msg escalation show '),
    () => {
      state.inflight++
      state.max = Math.max(state.max, state.inflight)
      return w.clock!.sleep(SEC).then(() => (state.inflight--, out('machine: draco\nkind: decision\nrecommendation:\n  ship it\n')))
    },
  )
  return state
}

test('the Escalations pane reads the detail of the rows it shows, four at a time', async ($, on) => {
  trace('FR-027-AC-34')
  const { w } = watched(on)
  const state = escalations(w)
  await startSession($)
  const ui = await openPane($, 'escalations')
  await run(w, 10 * MIN)
  // Before: one `escalation show` for each of the 100 rows on the first poll, all at once.
  expect((await meterRow($, 'escalationDetail')).spawns).toBe(10)
  expect(ran(w, l => l.startsWith('agent-msg escalation show '))).toBe(10)
  expect(state.max).toBeLessThanOrEqual(4)
  // Each open row's recommendation reached the pane: Resolve all would send all 10.
  await ui.press({ key: 'resolve-all' })
  expect((await ui.find({ type: 'Text', text: /^Resolve \d+ escalations/ }))?.text).toBe('Resolve 10 escalations with each one’s recommendation. Press again to send.')
  await ui.unmount()
})

test('the band attention cell reads the escalation list and no detail', async ($, on) => {
  trace('FR-027-AC-35')
  const { w } = watched(on)
  escalations(w)
  declare(w, ['attention'])
  await startSession($)
  const ui = await openBand($)
  await run(w, 10 * MIN)
  expect((await meterRow($, 'escalations')).spawns).toBeGreaterThan(0)
  // Before: 100 `escalation show` for a cell that draws a count.
  expect(ran(w, l => l.startsWith('agent-msg escalation show '))).toBe(0)
  await ui.unmount()
})

// ---------------------------------------------------------------- T7, T8: the leads

const LEADS = Array.from({ length: 10 }, (_, i) => `draco:QSL:l${i}`)

test('a chosen focus Linear names is read without a lead report', async ($, on) => {
  trace('FR-027-AC-36')
  const { w } = watched(on)
  for (const l of LEADS) w.leads.set(l, report(l, 'QSL work'))
  const id = pid('chosen')
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({ focus: `project:${id}` }))
  answer(w, l => l === 'ix-board --json roadmap', () => out(roadmapJson([{ name: 'QSL', projects: [{ name: 'Chosen', id }] }])))
  answer(w, l => l.startsWith('ix-board --json focus status'), () => out(statusJson([{ name: 'Chosen', done: 1, total: 2, id }])))
  await startSession($)
  const ui = await openPane($, 'focus')
  await run(w, 30 * MIN)
  // Before: every lead's report on every read of the focus, 11 every 2 minutes.
  expect((await meterRow($, 'leads')).spawns).toBe(0)
  expect(ran(w, l => l.startsWith('agent-msg work --lead'))).toBe(0)
  await ui.unmount()
})

test('a lead report is read again after 10 minutes, and at once by the refresh key', async ($, on) => {
  trace('FR-027-AC-37')
  const { w } = watched(on)
  for (const l of LEADS) w.leads.set(l, report(l, 'QSL work'))
  await startSession($)
  const ui = await openPane($, 'focus')
  await run(w, HOUR)
  const shown = (await meterRow($, 'leads')).spawns
  // Before: 11 leads every 2 minutes, 330 an hour. After: each at most once in 10 minutes.
  expect(shown).toBeLessThanOrEqual(11 * 7)
  expect(shown).toBe(ran(w, l => l.startsWith('agent-msg work --lead')))
  await ui.press({ key: 'refresh' })
  await run(w, 10 * SEC)
  expect((await meterRow($, 'leads')).spawns).toBeGreaterThanOrEqual(shown + 11)
  await ui.unmount()
})

// ---------------------------------------------------------------- T9: the Message pane

test('the Message pane reads the whole log once and then only the minutes since', async ($, on) => {
  trace('FR-027-AC-38')
  const { w } = watched(on)
  await startSession($)
  const ui = await openPane($, 'relay')
  await run(w, HOUR)
  // Before: 60 reads of 14 days, at most 2000 messages each.
  expect(ran(w, l => l.startsWith('agent-msg log --since 14d'))).toBe(1)
  expect(ran(w, l => /^agent-msg log --since \d+m --max 500$/.test(l))).toBeLessThanOrEqual(60)
  expect((await meterRow($, 'announcements')).spawns).toBeLessThanOrEqual(60 + 1)
  await ui.unmount()
})

test('the Message and Focus panes share one agent-msg who a minute', async ($, on) => {
  trace('FR-027-AC-38')
  const { w } = watched(on)
  await startSession($)
  const relay = await openPane($, 'relay')
  const focus = await openPane($, 'focus')
  await run(w, HOUR)
  // Before: 60 for the Message pane and 30 for the Focus pane.
  expect((await meterRow($, 'who')).spawns).toBeLessThanOrEqual(60 + 1)
  expect(ran(w, l => l === 'agent-msg who')).toBeLessThanOrEqual(60 + 1)
  await focus.unmount()
  await relay.unmount()
})

// ---------------------------------------------------------------- T10: the Team pane

test('the Team pane reads its series every 5 minutes', async ($, on) => {
  trace('FR-027-AC-39')
  const { w } = watched(on)
  await startSession($)
  const ui = await openPane($, 'team')
  await run(w, HOUR)
  // Before: every minute, 60 reads an hour.
  expect((await meterRow($, 'team')).reads).toBeLessThanOrEqual(12 + 1)
  await ui.unmount()
})

// ---------------------------------------------------------------- T11: slow is not failed

test('a Prometheus that answers in 3 seconds is read as often as one that answers at once', async ($, on) => {
  trace('FR-027-AC-40')
  const { w } = watched(on)
  const fetched: number[] = []
  w.fetch.value = () => (fetched.push(w.clock!.now()), w.clock!.sleep(3 * SEC).then(() => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } })))
  await startSession($)
  const ui = await openPane($, 'factory')
  await run(w, 10 * MIN)
  const reads = await meterRow($, 'prometheus')
  // Before: each answer over 2.5 seconds doubled the wait, to 5 minutes: 6 reads in 10 minutes. After: about every 15 s.
  expect(reads.reads).toBeGreaterThanOrEqual(30)
  expect(reads.fail).toBe(0)
  expect(reads.slow).toBeLessThanOrEqual(1)
  await ui.unmount()
})

// ---------------------------------------------------------------- T13: the view check

const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }
const snapshot = (focused: string) =>
  JSON.stringify({ result: { snapshot: { focused_tab_id: focused, panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', agent_session: { value: SESSION } }], agents: [], workspaces: [], layouts: [{ tab_id: 'w1:t1', zoomed: false, focused_pane_id: 'w1:p1' }] } } })

test('the view check runs only when a source other than the selection is due', async ($, on) => {
  trace('FR-027-AC-41')
  const { w } = watched(on)
  mock.env(on, HERDR)
  on('session.id', () => ({ value: SESSION }))
  answer(w, l => l === 'herdr api snapshot', () => out(snapshot('w1:t1')))
  await startSession($)
  const ui = await openPane($, 'focus')
  await run(w, 20 * MIN)
  // Before: once in 15 s for the selection's own refresh, 80 in 20 minutes. After: with the focus, every 2 minutes.
  expect((await meterRow($, 'onview')).spawns).toBeLessThanOrEqual(10 + 1)
  expect((await meterRow($, 'focus')).reads).toBeGreaterThanOrEqual(9)
  await ui.unmount()
})

test('a pane behind another herdr tab makes no read but the view check, and counts what it skipped', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-42')
  const { w, fetched } = watched(on)
  mock.env(on, HERDR)
  on('session.id', () => ({ value: SESSION }))
  answer(w, l => l === 'herdr api snapshot', () => out(snapshot('w1:t2')))
  await startSession($)
  const ui = await openPane($, 'factory')
  await run(w, HOUR)
  expect((await meterRow($, 'onview')).spawns).toBeLessThanOrEqual(240 + 1)
  expect((await meterRow($, 'onview')).spawns).toBeGreaterThan(0)
  expect(fetched.length).toBe(0)
  expect(ran(w, l => l === 'agent-msg doctor --json' || l.startsWith('ix-board'))).toBe(0)
  expect((await meterRow($, 'prometheus')).skips).toMatch(/[1-9]\d* off-view/)
  await ui.unmount()
})

// ---------------------------------------------------------------- after review

test('an ix-board agents that takes 8 seconds is still read once a minute', { options: { teams: 'QSL' } }, async ($, on) => {
  trace('FR-027-AC-33')
  const { w } = watched(on)
  answer(w, l => l.startsWith('ix-board --json agents'), () => w.clock!.sleep(8 * SEC).then(() => out(JSON.stringify({ agents: [] }))))
  await startSession($)
  const ui = await openPane($, 'factory')
  await ui.press({ key: 'board' })
  await run(w, HOUR)
  // Stamped when it ended, every other ask found the last read fresh: 30 an hour, data up to 2 minutes old.
  const agents = (await meterRow($, 'board')).spawns
  expect(agents).toBeGreaterThanOrEqual(55)
  expect(agents).toBeLessThanOrEqual(60 + 1)
  // Its gate is a file of its own: the Linear gate is not written for it.
  expect(w.files.has(`${FP}/agents-gate.json`)).toBe(true)
  expect(w.files.has(`${FP}/linear-gate.json`)).toBe(false)
  await ui.unmount()
})

test('an open escalation whose detail is still being read is neither resolved nor counted as having no recommendation', async ($, on) => {
  trace('FR-027-AC-34')
  const { w } = watched(on)
  answer(w, l => l === 'agent-msg escalations', () => out(`e1  waiting  -  ${LEAD}  11-20 16:29`))
  // The detail does not answer within the test.
  answer(w, l => l.startsWith('agent-msg escalation show '), () => new Promise<never>(() => undefined))
  await startSession($)
  const ui = await openPane($, 'escalations')
  await run(w, 30 * SEC)
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text === 'reading its detail…')).toBe(true)
  await ui.press({ key: 'resolve-all' })
  expect((await ui.find({ type: 'Text', text: /still being read/ }))?.text).toBe('Wait: the detail of 1 open escalation is still being read.')
  await ui.press({ key: 'quick-e1' }).catch(() => undefined)
  expect(ran(w, l => l.startsWith('agent-msg resolve'))).toBe(0)
  await ui.unmount()
})

test('a later read of the log that reaches its limit is followed by a full read', async ($, on) => {
  trace('FR-027-AC-38')
  const { w } = watched(on)
  let busy = false
  const broadcast = (text: string) => `11-26 10:00 ${LEAD} -> all: ${text}`
  answer(
    w,
    l => l.startsWith('agent-msg log'),
    l => (l.includes('--since 14d') ? out([broadcast('the whole log')].join('\n')) : out(busy && !(busy = false) ? Array.from({ length: 500 }, (_, i) => `11-26 10:01 ${LEAD} -> draco:QSL:l1: note ${i}`).join('\n') : '')),
  )
  await startSession($)
  const ui = await openPane($, 'relay')
  await run(w, 3 * MIN)
  expect(ran(w, l => l.startsWith('agent-msg log --since 14d'))).toBe(1)
  // A busy bus: 500 messages in the minutes asked for once, so broadcasts before them may be missing.
  busy = true
  await run(w, 65 * SEC)
  expect(ran(w, l => l.startsWith('agent-msg log --since 14d'))).toBe(2)
  expect((await ui.findAll({ type: 'Text' })).some(t => /the whole log/.test(t.text ?? ''))).toBe(true)
  await ui.unmount()
})
