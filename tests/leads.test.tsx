import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { CLASSIC, FP, drawBand, out, report, startSession, world } from './world'
import type { Run, World } from './world'

// Tests for the reads of the leads' work reports (FR-030), which the Focus and the Work view share.

const NOW = Date.UTC(2026, 10, 24, 12, 0)
const SEC = 1000
const MIN = 60 * SEC
const NEAR = 'draco:QSL:arch'
const FAR = 'terra:QSL:code'
const BUSY = 'agent-msg: redis: Resource temporarily unavailable (os error 35)'
type $t = Parameters<TestBody>[0]

const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'work', props: { title: 'Work', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const

const leadReport = (address: string, ticket: string) => {
  const r = report(address, `focus of ${address}`)
  return { ...r, agents: r.agents.map(a => ({ ...a, ticket, reported_at_ms: NOW - 5 * MIN })) }
}
const addressOf = (argv: string[]): string | null => (argv[0] === 'agent-msg' && argv[1] === 'work' && argv[2] === '--lead' ? argv[3]! : null)
const noEvents = () => out(JSON.stringify({ events: [], has_more: false, next_cursor: '0-0' }))

type Answer = (address: string, init: { timeoutMs?: number } | undefined) => Run | Promise<Run> | undefined

/** A world with these leads; `answer` may answer a lead's read before the report does. */
function leadsWorld(on: Parameters<TestBody>[1], addresses: string[], answer: Answer = () => undefined): World {
  const w = world(on, true)
  addresses.forEach((a, i) => w.leads.set(a, leadReport(a, `QSL-${i + 1}`)))
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv.join(' ').startsWith('agent-msg work events')) return noEvents()
    const address = addressOf(argv)
    return (address === null ? undefined : answer(address, init)) ?? prior?.(argv, init)
  }
  return w
}

const asked = (w: World, address: string) => w.ran.filter(l => l === `agent-msg work --lead ${address} show`).length
const mount = ($: $t, requestId = 'work') => $.ui.mount({ ...PANE, requestId, surface: 'terminal' } as never)
const lines = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

test('a lead’s report is given 20 seconds, so a report that takes 10 is read', async ($, on) => {
  trace("FR-030-AC-1", "NFR-004-M-2")
  const limits: (number | undefined)[] = []
  const w = leadsWorld(on, [FAR], (address, init) => {
    limits.push(init?.timeoutMs)
    return w.clock!.sleep(10 * SEC).then(() => out(JSON.stringify(leadReport(address, 'QSL-77'))))
  })
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(12 * SEC)
  expect(limits).toEqual([20_000])
  expect((await lines(ui)).some(l => /QSL-77/.test(l))).toBe(true)
  await ui.unmount()
})

test('at most eight lead reports are read at once, and every lead is read', async ($, on) => {
  trace("FR-030-AC-2", "NFR-004-M-3")
  const addresses = Array.from({ length: 30 }, (_, i) => `terra:QSL:lead-${String(i).padStart(2, '0')}`)
  let inFlight = 0
  let most = 0
  const w = leadsWorld(on, addresses, address => {
    most = Math.max(most, ++inFlight)
    return w.clock!.sleep(6 * SEC).then(() => (inFlight--, out(JSON.stringify(leadReport(address, `QSL-${address.slice(-2)}`)))))
  })
  await startSession($)
  // Both views at once ask for the same leads.
  const work = await mount($)
  const focus = await mount($, 'focus')
  await w.clock!.advance(30 * SEC)
  expect(most).toBe(8)
  expect(addresses.map(a => asked(w, a))).toEqual(addresses.map(() => 1))
  expect((await lines(work)).filter(l => /^ {3}QSL-/.test(l))).toHaveLength(30)
  await work.unmount()
  await focus.unmount()
})

test('the Focus and the Work view share one read of each lead, and the refresh key reads anew', async ($, on) => {
  trace("FR-030-AC-3")
  const w = leadsWorld(on, [NEAR, FAR])
  await startSession($)
  const focus = await mount($, 'focus')
  await w.clock!.advance(SEC)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([1, 1])
  // Ten seconds later the Work view is answered from the same reports.
  await w.clock!.advance(10 * SEC)
  const work = await mount($)
  await w.clock!.advance(SEC)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([1, 1])
  expect((await lines(work)).filter(l => /^ {3}QSL-/.test(l))).toHaveLength(2)
  await work.press({ key: 'refresh' })
  await w.clock!.advance(SEC)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([2, 2])
  // Their own intervals read them again once the reports are no longer fresh.
  await w.clock!.advance(2 * MIN)
  expect(asked(w, NEAR)).toBeGreaterThan(2)
  await work.unmount()
  await focus.unmount()
})

for (const [name, failure] of [
  ['Redis', BUSY],
  ['herdr on another machine', 'agent-msg: herdr call timed out after 5s and was killed'],
  ['ssh to another machine', 'agent-msg: herdr exited with status 1: remote SSH connection failed: Connection closed by UNKNOWN port 65535'],
] as const) {
  test(`a read that fails because ${name} did not answer is tried once more at once`, async ($, on) => {
    trace("FR-030-AC-4")
    let failures = 1
    const w = leadsWorld(on, [FAR], () => (failures-- > 0 ? out('', 1, failure) : undefined))
    await startSession($)
    const ui = await mount($)
    await w.clock!.advance(SEC)
    expect(asked(w, FAR)).toBe(2)
    expect((await lines(ui)).some(l => /QSL-1/.test(l))).toBe(true)
    expect(await ui.find({ key: 'warnings-toggle' })).toBeUndefined()
    await ui.unmount()
  })
}

test('a read that fails twice, or for another reason, is not tried a third time', async ($, on) => {
  trace("FR-030-AC-4")
  const w = leadsWorld(on, [NEAR, FAR], address => out('', 1, address === FAR ? BUSY : 'agent-msg: work target is unavailable'))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([1, 2])
  await ui.unmount()
})

test('the events and the lead list are tried once more too', async ($, on) => {
  trace("FR-030-AC-4")
  const w = leadsWorld(on, [NEAR])
  const prior = w.stub.value!
  const failures = { who: 1, events: 1 }
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'agent-msg who' && failures.who-- > 0) return out('', 1, BUSY)
    if (line.startsWith('agent-msg work events') && failures.events-- > 0) return out('', 1, BUSY)
    return prior(argv, init)
  }
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(w.ran.filter(l => l === 'agent-msg who').length).toBeGreaterThanOrEqual(2)
  expect(await ui.find({ key: 'warnings-toggle' })).toBeUndefined()
  expect((await lines(ui)).some(l => /QSL-1/.test(l))).toBe(true)
  await ui.unmount()
})

test('a lead never read is listed as not read, beside the leads that were', async ($, on) => {
  trace("FR-030-AC-5")
  const w = leadsWorld(on, [NEAR, FAR], address => (address === FAR ? out('', 1, 'agent-msg: machine terra is unreachable') : undefined))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  const drawn = await lines(ui)
  expect(drawn).toContain(FAR)
  expect(drawn).toContain('not read')
  expect(drawn).toContain('▲')
  expect(drawn).toContain('2 leads · 1 not read')
  // Nothing is claimed about its tickets.
  expect(drawn.join('\n')).not.toMatch(/no ticket reported/)
  await ui.press({ key: 'warnings-toggle' })
  expect((await lines(ui)).join('\n')).toMatch(/terra:QSL:code: agent-msg: machine terra is unreachable/)
  await ui.unmount()
  const widget = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'widget' } } as never)
  expect((await widget.findAll({ type: 'Text' })).map(t => t.text).join('')).toBe('2 leads · ≥1 ticket · merged 24h unavailable (no focus status read) · 1 not read')
  await widget.unmount()
})

test('a lead that cannot be read now is drawn as last read, marked old, until it answers again', async ($, on) => {
  trace("FR-030-AC-6")
  let isDown = false
  const w = leadsWorld(on, [NEAR, FAR], address => (isDown && address === FAR ? out('', 1, 'agent-msg: machine terra is unreachable') : undefined))
  w.files.set(`${FP}/features/default.json`, JSON.stringify({ modules: ['work'] }))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  isDown = true
  await w.clock!.advance(3 * MIN)
  const drawn = await lines(ui)
  expect(drawn.some(l => /^ {3}QSL-2/.test(l))).toBe(true)
  expect(drawn.some(l => /^old [234]m$/.test(l))).toBe(true)
  expect(drawn).toContain('▲')
  expect(drawn).toContain('2 leads · 1 old')
  await ui.unmount()
  const band = await drawBand($, CLASSIC)
  await w.clock!.advance(20 * SEC)
  const text = (await band.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).toMatch(/2 tickets /)
  expect(text).toMatch(/agent-msg work: 1 of 2 leads not read, 1 shown from an earlier read/)
  await band.unmount()
  isDown = false
  const again = await mount($)
  await w.clock!.advance(2 * MIN)
  expect((await lines(again)).join('\n')).not.toMatch(/old \d|not read/)
  await again.unmount()
})

test('the Focus view keeps a lead it cannot read now, with a note of when its report was read', async ($, on) => {
  trace("FR-030-AC-6")
  let isDown = false
  const w = leadsWorld(on, [NEAR], () => (isDown ? out('', 1, 'agent-msg: machine terra is unreachable') : undefined))
  await startSession($)
  const ui = await mount($, 'focus')
  await w.clock!.advance(SEC)
  isDown = true
  await w.clock!.advance(2 * MIN + SEC)
  expect((await lines(ui)).join('\n')).toMatch(/focus of draco:QSL:arch/)
  const shown = await $.command.run({ command: 'factory', args: 'show' } as never)
  expect((shown as { text: string }).text).toMatch(/work report not read, as read \dm ago/)
  await ui.unmount()
})

test('where the leads cannot be listed those drawn are marked old, and a lead no longer listed is forgotten', async ($, on) => {
  trace("FR-030-AC-6", "FR-030-AC-7")
  let isListed = true
  const w = leadsWorld(on, [NEAR, FAR])
  const prior = w.stub.value!
  w.stub.value = (argv, init) => (!isListed && argv.join(' ') === 'agent-msg who' ? out('', 1, 'relay store unavailable') : prior(argv, init))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  isListed = false
  await w.clock!.advance(MIN + 20 * SEC)
  let drawn = await lines(ui)
  expect(drawn).toContain('2 leads · 2 old')
  expect(drawn.filter(l => /^ {3}QSL-/.test(l))).toHaveLength(2)
  isListed = true
  w.leads.delete(FAR)
  await w.clock!.advance(6 * MIN)
  drawn = await lines(ui)
  expect(drawn).not.toContain(FAR)
  expect(drawn).toContain('1 lead')
  await ui.unmount()
})

test('a lead that had reported nothing and stops answering is old, not never read', async ($, on) => {
  trace("FR-030-AC-6")
  let isDown = false
  const w = leadsWorld(on, [NEAR, FAR], address => (address !== FAR ? undefined : isDown ? out('', 1, 'agent-msg: work target is unavailable') : out('null')))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  // Named with those that report nothing, and no row of its own.
  expect(await lines(ui)).not.toContain(FAR)
  isDown = true
  // A lead on another machine that reported nothing is asked again after five minutes.
  await w.clock!.advance(6 * MIN)
  const drawn = (await lines(ui)).join('\n')
  expect(drawn).toContain(FAR)
  expect(drawn).toMatch(/old 6m/)
  expect(drawn).toContain('1 old')
  expect(drawn).not.toMatch(/not read/)
  await ui.unmount()
})

test('where the leads were never listed the Work view says they could not be read, not that none reported', async ($, on) => {
  trace("FR-030-AC-10")
  const w = leadsWorld(on, [NEAR])
  const prior = w.stub.value!
  w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg who' ? out('', 1, BUSY) : prior(argv, init))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  const drawn = await lines(ui)
  expect(drawn).toContain('The leads could not be read.')
  expect(drawn.join('\n')).not.toMatch(/No lead has reported|Reading the leads/)
  expect((await ui.find({ key: 'warnings-toggle' }))?.props).toMatchObject({ label: '1' })
  await ui.unmount()
})

test('the first Focus drawing does not wait for a slow lead, which is drawn when it answers', async ($, on) => {
  trace("FR-030-AC-11")
  const w = leadsWorld(on, [NEAR, FAR], address => (address === FAR ? w.clock!.sleep(15 * SEC).then(() => out(JSON.stringify(leadReport(address, 'QSL-2')))) : undefined))
  await startSession($)
  const focus = await mount($, 'focus')
  await w.clock!.advance(4 * SEC)
  expect((await lines(focus)).join('\n')).toMatch(/Reading coordinators/)
  await w.clock!.advance(2 * SEC)
  const early = (await lines(focus)).join('\n')
  expect(early).toContain(`focus of ${NEAR}`)
  expect(early).not.toContain(`focus of ${FAR}`)
  expect(await focus.find({ key: 'warnings-toggle' })).toBeUndefined()
  await w.clock!.advance(10 * SEC)
  const late = (await lines(focus)).join('\n')
  expect(late).toContain(`focus of ${NEAR}`)
  expect(late).toContain(`focus of ${FAR}`)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([1, 1])
  await focus.unmount()
})

test('a lead is drawn as soon as it answers, and review events are read while another lead is still out', async ($, on) => {
  trace("FR-030-AC-8", "FR-028-AC-16")
  let reported = false
  const w = leadsWorld(on, [NEAR, FAR], address => (address === FAR ? w.clock!.sleep(19 * SEC).then(() => out('', 1, 'agent-msg: machine terra is unreachable')) : undefined))
  const prior = w.stub.value!
  w.stub.value = (argv, init) => {
    if (!argv.join(' ').startsWith('agent-msg work events') || !reported) return prior(argv, init)
    const event = { id: '9-0', at_ms: w.clock!.now(), binding: { address: NEAR }, change: { kind: 'agent', agent: { agent_id: 'r', name: 'r', ticket: 'QSL-9001', role: 'reviewer', status: 'running' } } }
    return out(JSON.stringify({ events: argv.includes('9-0') ? [] : [event], has_more: false, next_cursor: '9-0' }))
  }
  await startSession($)
  const ui = await mount($)
  await ui.press({ key: 'kinds' })
  await w.clock!.advance(3 * SEC)
  // The near lead is drawn while the far one is still being read.
  expect((await lines(ui)).some(l => /^ {3}QSL-1/.test(l))).toBe(true)
  reported = true
  await w.clock!.advance(46 * SEC)
  expect((await lines(ui)).some(l => /review start +QSL-9001/.test(l))).toBe(true)
  await ui.unmount()
})

// ---------------------------------------------------------------- shared between the sessions of a machine

const SHARED = `${FP}/lead-reports.json`
type Entry = { report?: unknown; at: number | null; error: string | null; triedAt: number | null; claimAt: number | null }
const seed = (w: World, leads: Record<string, Entry>) => w.files.set(SHARED, JSON.stringify({ leads }))
const kept = (w: World): Record<string, Entry> => JSON.parse(w.files.get(SHARED) ?? '{"leads":{}}').leads
const readAgo = (ticket: string, ago: number, over: Partial<Entry> = {}): Entry => ({ report: leadReport(FAR, ticket), at: NOW - ago, error: null, triedAt: NOW - ago, claimAt: null, ...over })

test('a report another session read lately is used without a read, and only leads of other machines are shared', async ($, on) => {
  trace("FR-030-AC-12")
  const w = leadsWorld(on, [NEAR, FAR])
  seed(w, { [FAR]: readAgo('QSL-90', 20 * SEC) })
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect([asked(w, NEAR), asked(w, FAR)]).toEqual([1, 0])
  expect((await lines(ui)).some(l => /QSL-90/.test(l))).toBe(true)
  // Once it is no longer fresh this session reads the lead and leaves the report for the others.
  await w.clock!.advance(2 * MIN)
  expect(asked(w, FAR)).toBeGreaterThanOrEqual(1)
  expect((await lines(ui)).some(l => /QSL-2 /.test(l))).toBe(true)
  expect(Object.keys(kept(w))).toEqual([FAR])
  expect(kept(w)[FAR]).toMatchObject({ claimAt: null, error: null })
  expect(JSON.stringify(kept(w)[FAR]!.report)).toContain('QSL-2')
  await ui.unmount()
})

test('a lead another session is reading is left to it until its claim is old', async ($, on) => {
  trace("FR-030-AC-13")
  const w = leadsWorld(on, [NEAR, FAR])
  seed(w, { [FAR]: { at: null, error: null, triedAt: null, claimAt: NOW - 5 * SEC } })
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(0)
  const drawn = await lines(ui)
  expect(drawn).toContain('1 lead being read by another session')
  expect(drawn.join('\n')).not.toMatch(/not read|reports? no work/)
  await w.clock!.advance(2 * MIN)
  expect(asked(w, FAR)).toBeGreaterThanOrEqual(1)
  await ui.unmount()
})

test('no more than eight reads of other machines are claimed at once over all sessions', async ($, on) => {
  trace("FR-030-AC-14", "NFR-004-M-9")
  const w = leadsWorld(on, [FAR])
  const claims = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`luna:QSL:lead-${i}`, { at: null, error: null, triedAt: null, claimAt: NOW }]))
  seed(w, claims(8))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(0)
  await w.clock!.advance(2 * MIN)
  expect(asked(w, FAR)).toBeGreaterThanOrEqual(1)
  await ui.unmount()
})

test('with seven reads claimed the eighth is made', async ($, on) => {
  trace("FR-030-AC-14", "NFR-004-M-9")
  const w = leadsWorld(on, [FAR])
  seed(w, Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`luna:QSL:lead-${i}`, { at: null, error: null, triedAt: null, claimAt: NOW }])))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(1)
  await ui.unmount()
})

test('a lead of another machine that reported nothing is asked again only after five minutes', async ($, on) => {
  trace("FR-030-AC-15")
  const w = leadsWorld(on, [NEAR, FAR], () => out('null'))
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(4 * MIN + 30 * SEC)
  expect(asked(w, FAR)).toBe(1)
  expect(asked(w, NEAR)).toBeGreaterThanOrEqual(4)
  await w.clock!.advance(2 * MIN)
  expect(asked(w, FAR)).toBe(2)
  await ui.unmount()
})

test('the refresh key reads a fresh shared report anew', async ($, on) => {
  trace("FR-030-AC-3", "FR-030-AC-12")
  const w = leadsWorld(on, [FAR])
  seed(w, { [FAR]: readAgo('QSL-90', 5 * SEC) })
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(0)
  await ui.press({ key: 'refresh' })
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(1)
  await ui.unmount()
})

test('a read that failed in another session is drawn as old with its error, and is not repeated at once', async ($, on) => {
  trace("FR-030-AC-12", "FR-030-AC-6")
  const w = leadsWorld(on, [FAR])
  seed(w, { [FAR]: readAgo('QSL-90', 10 * MIN, { error: 'agent-msg: machine terra is unreachable', triedAt: NOW - 10 * SEC }) })
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(0)
  const drawn = await lines(ui)
  expect(drawn).toContain('1 lead · 1 old')
  expect(drawn.some(l => /QSL-90/.test(l))).toBe(true)
  await ui.unmount()
})

test('where the shared file cannot be written the lead is read all the same', async ($, on) => {
  trace("FR-030-AC-16")
  const w = leadsWorld(on, [FAR])
  w.mvFails.value = true
  await startSession($)
  const ui = await mount($)
  await w.clock!.advance(SEC)
  expect(asked(w, FAR)).toBe(1)
  expect((await lines(ui)).some(l => /QSL-1/.test(l))).toBe(true)
  await ui.unmount()
})
