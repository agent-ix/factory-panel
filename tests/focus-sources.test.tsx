import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { resetSources, sourceFailed } from '../hooks/sources'
import { showText } from '../hooks/router'
import { getSelection } from '../hooks/selection'
import { BAD_MILESTONE, CLASSIC, NEVER, bandCells, defRow, drawBand, fake$, listJson, out, report, roadmapJson, showJson, startSession, statusJson, world } from './world'
import { LEAD, MIN, PANE, board, choose, hides, lead, named, pageOf, paneLines, seed, shows, started, statusCalls } from './focus-kit'
import { record } from './focus-kit'

// Tests of the flow around the progress of a focus: one refresh at a time, and the sources that fail
// without blocking each other. How the rows and the warning are drawn is in focus-ui.test.tsx, and
// the data in board.test.tsx.

const BAND = async ($: Parameters<TestBody>[0]): Promise<string[]> => {
  const ui = await drawBand($, CLASSIC)
  const cells = await bandCells(ui)
  await ui.unmount()
  return cells
}

const factoryLines = async ($: Parameters<TestBody>[0]): Promise<string[]> => {
  const ui = await $.ui.mount({ ...PANE, requestId: 'factory', props: { ...PANE.props, title: 'Factory' }, surface: 'terminal' } as never)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await ui.unmount()
  return lines
}

const shownText = async ($: Parameters<TestBody>[0]): Promise<string> => ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string)

test('a tick during a refresh is run once after it', async ($, on) => {
  trace("FR-016-AC-10")
  const w = world(on, true)
  lead(w, { projects: ['A'] })
  const slow = board(w, { combined: () => w.clock!.sleep(3000).then(() => pageOf('Pa', 1, 2)) })
  await startSession($)
  await w.clock!.advance(1000)
  const reads = () => w.ran.filter(l => l === 'agent-msg who').length
  const before = reads()
  // Two ticks arrive while the session's refresh waits on ix-board: one more refresh runs, not two.
  await $.command.run({ command: 'focuses', args: '' } as never)
  await $.command.run({ command: 'focuses', args: '' } as never)
  await w.clock!.advance(20_000)
  expect(reads() - before).toBe(1)
  expect(slow.max).toBe(1)
})

test('a lead whose work report has no scope says no selectors and ix-board is not called', async ($, on) => {
  trace("FR-016-AC-12")
  const w = world(on, true)
  lead(w, null, 'Only a summary')
  board(w, { combined: () => pageOf('x', 1, 2) })
  await started($, w)
  expect(statusCalls(w)).toEqual([])
  const lines = await paneLines($)
  shows(lines, /^Only a summary$/)
  // The card draws no prose: the note is in /factory show.
  expect(await shownText($)).toMatch(/^ {2}no selectors$/m)
})

test('ix-board failing is shown and the summary is drawn while the metrics answer', async ($, on) => {
  trace("FR-018-AC-1")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] }, 'Release train summary')
  board(w, { combined: () => out('', 1, 'ix-board: authentication failed') })
  await started($, w)
  shows(await paneLines($), /^Release train summary$/)
  hides(await factoryLines($), /^Metrics unavailable/)
  expect(await shownText($)).toMatch(/^ {2}ix-board: ix-board: authentication failed$/m)
})

test('agent-msg work failing is shown while the progress of a named focus is drawn', async ($, on) => {
  trace("FR-018-AC-2")
  const w = world(on, true)
  w.leads.set(LEAD, undefined) // listed by `agent-msg who`, with a work report that cannot be read
  choose(w, 'Beta')
  named(w, () => out(listJson(defRow('foc-beta', 'Beta', 'QSL'))), { 'foc-beta': () => out(showJson('Beta', 'QSL', { projects: ['p1'] })) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^5\/10$/)
  expect(await shownText($)).toMatch(/^ {2}agent-msg work: draco:QSL:code: no report$/m)
})

test('Prometheus that does not answer leaves the Focus pane and the lanes drawn and the Factory view says why', async ($, on) => {
  trace("FR-018-AC-3", "NFR-004-M-2")
  const w = world(on, true)
  lead(w, null, 'Release train summary')
  w.boardAgents.push({ team: 'QSL', agent: LEAD, herdr_status: 'working', machine: 'draco' })
  w.fetch.value = () => w.clock!.sleep(60_000).then(() => { throw new Error('too late') })
  await started($, w)
  await w.clock!.advance(5000)
  shows(await paneLines($), /^Release train summary$/)
  expect(await BAND($)).toEqual(expect.arrayContaining(['focus', 'lanes']))
  const note = (await factoryLines($)).find(l => /^Metrics unavailable: /.test(l))
  expect(note).toMatch(/^Metrics unavailable: .+/)
})

test('ix-board failing for one project and Prometheus failing are both listed by /factory show with their error text', async ($, on) => {
  trace("FR-018-AC-4")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  w.fetch.value = () => ({ value: { status: 503, ok: false, headers: {}, text: '' } })
  board(w, { combined: args => (args[1] === 'B' ? out('', 1, 'B is broken') : pageOf('Pa', 1, 2)) })
  await started($, w)
  const text = await shownText($)
  expect(text).toMatch(/^Source errors:$/m)
  expect(text).toMatch(/^ {2}ix-board project B: B is broken$/m)
  expect(text).toMatch(/^ {2}prometheus: Prometheus 503$/m)
})

test('a source that never returns does not hold back the others, and the first view is painted before any answers', async ($, on) => {
  trace("FR-018-AC-5")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] }, 'Release train summary')
  board(w, { combined: () => NEVER() })
  const started$ = startSession($)
  // The first view is painted at once, from the fallback, before anything has answered.
  expect(await BAND($)).toContain('local')
  // The sources answer after 100 ms; ix-board never does. The summary is drawn within a second of that.
  await w.clock!.advance(100)
  await w.clock!.advance(900)
  shows(await paneLines($), /^Release train summary$/)
  // Let the refresh end at its budget inside the test.
  await w.clock!.advance(61_000)
  await started$
})

test('every source failing raises nothing and each module shows its source’s error', async ($, on) => {
  trace("FR-018-AC-6")
  const w = world(on, true)
  lead(w, { projects: ['A'] }, 'Release train summary')
  w.leads.set('draco:QSL:plan', undefined)
  w.fetch.value = () => ({ value: { status: 503, ok: false, headers: {}, text: '' } })
  board(w, { combined: () => out('', 1, 'ix-board: authentication failed') })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^Release train summary$/)
  shows(await factoryLines($), /^Metrics unavailable: .*503/)
  expect(await shownText($)).toMatch(/^ {2}agent-msg work: draco:QSL:plan: no report$/m)
  expect(await shownText($)).toMatch(/^ {2}ix-board: ix-board: authentication failed$/m)
})

test('agent-msg focuses list failing is listed under agent-msg focuses and the Focus pane still draws', async ($, on) => {
  trace("FR-018-AC-7")
  const w = world(on, true)
  lead(w, null, 'Beta')
  choose(w, 'Beta')
  named(w, () => out('', 1, 'agent-msg: relay store unavailable'))
  await started($, w)
  expect(await shownText($)).toMatch(/^ {2}agent-msg focuses: list: agent-msg: relay store unavailable$/m)
  expect(await shownText($)).toMatch(/^your choice: Beta$/m)
  shows(await paneLines($), /^Beta$/)
})

test('the source state of agent-msg focuses and ix-board is cleared when nothing asks them any more', async ($, on) => {
  trace("FR-018-AC-7")
  const w = world(on, true)
  lead(w, { projects: ['A'] }, 'Beta')
  choose(w, 'Beta')
  named(w, () => out('', 1, 'agent-msg: relay store unavailable'))
  board(w, { combined: () => out('', 1, 'ix-board: authentication failed') })
  await started($, w)
  expect(await shownText($)).toMatch(/agent-msg focuses: list/)
  // The choice stops being a name, and the lead no longer scopes anything.
  w.leads.set(LEAD, report(LEAD, 'Beta', ['running'], null))
  await $.command.run({ command: 'factory', args: 'focus own' } as never)
  await w.clock!.advance(2 * MIN + 1000)
  const after = await shownText($)
  expect(after).not.toMatch(/agent-msg focuses/)
  expect(after).not.toMatch(/ix-board/)
})

test('/factory show gives the age of ix-board projects from progress.json and of the other sources from memory', async ($, on) => {
  trace("FR-017-AC-11")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  const id = '11111111-2222-4333-8444-555555555555'
  seed(w, { [`project:${id}`]: record({ id, name: 'C' }) })
  lead(w, { projects: [id] })
  w.fetch.value = () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } })
  board(w, { combined: () => out('', 1, BAD_MILESTONE) })
  await started($, w)
  // Prometheus answered once, then fails: the age of its last success is kept in memory.
  await w.clock!.advance(15_000)
  w.fetch.value = () => ({ value: { status: 503, ok: false, headers: {}, text: '' } })
  await w.clock!.advance(15_000)
  const text = await shownText($)
  expect(text).toMatch(/Source errors:/)
  expect(text).toMatch(/ix-board C: .*unavailable milestone.* \(last success \dm ago\)/)
  expect(text).toMatch(/prometheus: Prometheus 503 \(last success \d+s ago\)/)
  // A new session shows no age for the sources held in memory until they answer.
  resetSources()
  sourceFailed('prometheus', 'Prometheus 503')
  sourceFailed('agent-msg work', 'no live agent')
  const none = await showText(fake$(w) as never, getSelection())
  expect(none).toMatch(/^ {2}prometheus: Prometheus 503$/m)
  expect(none).toMatch(/^ {2}agent-msg work: no live agent$/m)
})

async function showScenario($: Parameters<TestBody>[0], on: Parameters<typeof world>[0]): Promise<string> {
  const w = world(on, true)
  lead(w, { initiatives: ['A', '674ffba8-fe0d-47e3-82b1-c0aa40787357'], projects: ['Loose'] })
  const calls = new Map<string, ReturnType<typeof out>>([
    ['--project P1', out(statusJson([{ name: 'P1', done: 10, total: 25, ready: 3, layers: { open: 3, completed: 1 } }]))],
    ['--project P2', out('', 1, BAD_MILESTONE)],
    ['--project P3', out(statusJson([{ name: 'P3', done: 1, total: 4, ready: null, layers: null }]))],
    ['--project Loose', out(statusJson([{ name: 'Loose', done: 2, total: 4 }]))],
  ])
  board(w, { combined: args => calls.get(args.join(' ')) ?? out('', 1, 'not stubbed') })
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv.join(' ') === 'ix-board --json roadmap') return out(roadmapJson([{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }] }]))
    if (argv.join(' ').startsWith('ix-board --json focus status --initiative')) return out('', 4, BAD_MILESTONE)
    return prior?.(argv, init)
  }
  await started($, w)
  return shownText($)
}

test('/factory show prints each project with remaining and ready, a dash where the answer lacks the key, and no blocked count for a project asked with others', async ($, on) => {
  trace("FR-023-AC-2", "FR-023-AC-3")
  const text = await showScenario($, on)
  expect(text).toMatch(/^ {4}P1: 10\/25 · remaining 15 · ready 3 · blocked -$/m)
  expect(text).toMatch(/^ {4}P3: 1\/4 · remaining 3 · ready - · blocked -$/m)
  expect(text).toMatch(/^ {4}P2: failed, no counts$/m)
})

test('/factory show prints the blocked count of a project asked alone', async ($, on) => {
  trace("FR-023-AC-2")
  const w = world(on, true)
  lead(w, { projects: ['P1'] })
  board(w, { combined: () => out(statusJson([{ name: 'P1', done: 10, total: 25, ready: 3, layers: { open: 3, completed: 1 } }])) })
  await started($, w)
  const text = await shownText($)
  expect(text).toMatch(/^ {4}P1: 10\/25 · remaining 15 · ready 3 · blocked 3$/m)
  expect(text).not.toMatch(/does not say which project/)
})

test('/factory show gives the open blockers of several projects once for the focus and says why no project has its own', async ($, on) => {
  trace("FR-023-AC-9")
  const w = world(on, true)
  lead(w, { projects: ['P1', 'P2'] })
  // The two answers name their blockers alike: two of the five entries are the same tickets.
  board(w, { combined: args => out(statusJson([{ name: args[1]!, done: 1, total: 9, ready: 1, layers: { open: args[1] === 'P1' ? 3 : 2, completed: 0 } }])) })
  await started($, w)
  const text = await shownText($)
  expect(text).toMatch(/^ {2}total: 2\/18 done .* ready 2 · blocked 3 · 2 of 2 projects$/m)
  expect(text).toMatch(/^ {2}blocked is counted once over the focus: a combined ix-board answer does not say which project a blocker belongs to$/m)
  expect(text).toMatch(/^ {4}P1: 1\/9 · remaining 8 · ready 1 · blocked -$/m)
})

test('/factory show prints the X of Y projects, partial and not expanded wording of the initiatives and the header', async ($, on) => {
  trace("FR-022-AC-1", "FR-022-AC-11")
  const text = await showScenario($, on)
  expect(text).toMatch(/^ {2}total: .*3 of 4 projects.*partial.*1 initiative not expanded$/m)
  expect(text).toMatch(/^ {2}initiative A: 2 of 3 projects · 11\/29 done · remaining 18 · ready 3 · blocked - · partial$/m)
  expect(text).toMatch(/^ {2}initiative initiative 674ffba8: projects unknown$/m)
})

test('/factory show lists a project in no selected initiative apart', async ($, on) => {
  trace("FR-022-AC-5")
  const text = await showScenario($, on)
  expect(text).toMatch(/^ {2}not in a selected initiative:$/m)
  expect(text).toMatch(/^ {4}Loose: 2\/4 · remaining 2/m)
})
