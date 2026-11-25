import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { compose, focusKey, recordsOf, selectorArgs, selectorsOfScope } from '../hooks/board'
import type { Outcome, Refresh, Selector } from '../hooks/board'
import { resetSources, sourceFailed } from '../hooks/sources'
import type { Records } from '../hooks/progress'
import { PRUNE_MS, STALE_MS, mergeRecords, parseRecords, prune, readRecords, saveRecords } from '../hooks/progress'
import { showText } from '../hooks/router'
import { getSelection } from '../hooks/selection'
import type { World } from './world'
import { BAD_MILESTONE, CLASSIC, FP, NEVER, bandCells, defRow, drawBand, fake$, hangs, listJson, out, report, showJson, startSession, statusJson, world } from './world'
import { LEAD, MIN, PANE, PROGRESS, T0, board, choose, hides, lead, named, pageOf, paneLines, record, refresh, saved, seed, shows, started, statusCalls } from './focus-kit'

// Tests for the focus progress requirements: isolated selectors and partial progress, the last good
// progress, and source errors that are visible and not fatal. The banner and the names are in
// focus-names.test.tsx.


// ---------------------------------------------------------------- FR-016 isolated selectors

test('a combined call that fails makes one call for each selector and shows the progress of each that succeeds', async ($, on) => {
  trace("FR-016-AC-1")
  const w = world(on, true)
  lead(w, { initiatives: ['A', 'B'], projects: ['C', 'D'] })
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: args => pageOf(`Progress of ${args[1]}`, 3, 4),
  })
  await started($, w)
  const calls = statusCalls(w)
  expect(calls).toEqual(['--initiative A --initiative B --project C --project D', '--initiative A', '--initiative B', '--project C', '--project D'])
  const lines = await paneLines($)
  for (const name of ['A', 'B', 'C', 'D']) shows(lines, new RegExp(`^Progress of ${name}$`))
})

test('with the real milestone error and only project D failing alone the pane shows A, B and C and names D with its error', async ($, on) => {
  trace("FR-016-AC-2")
  const w = world(on, true)
  lead(w, { initiatives: ['A', 'B'], projects: ['C', 'D'] })
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: args => (args[1] === 'D' ? out('', 1, 'project D is not available') : pageOf(`Progress of ${args[1]}`, 3, 4)),
  })
  await started($, w)
  const lines = await paneLines($)
  for (const name of ['A', 'B', 'C']) shows(lines, new RegExp(`^Progress of ${name}$`))
  shows(lines, /^project D: project D is not available$/)
  shows(lines, /^9\/12 done · 0 in progress · 0 ready · 3 fresh, 0 old, 1 failed$/)
  expect(lines.filter(l => l === '3/4')).toHaveLength(3)
  shows(lines, /^partial$/)
  hides(lines, /summed from parts/)
})

test('two fresh selectors, one old record and one failure sum to 20 and read 2 fresh, 1 old, 1 failed, marked partial', async ($, on) => {
  trace("FR-016-AC-3")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B', 'C', 'D'] })
  seed(w, { 'project:C': record({ done: 10, total: 10, inProgress: 0, ready: 0 }) })
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: args => (args[1] === 'A' ? pageOf('Pa', 4, 8) : args[1] === 'B' ? pageOf('Pb', 6, 12) : out('', 1, `${args[1]} failed`)),
  })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^20\/30 done · 0 in progress · 0 ready · 2 fresh, 1 old, 1 failed$/)
  shows(lines, /^partial$/)
  // Neither complete nor done: never 100%.
  hides(lines, /^100%$/)
  shows(lines, /^67%$/)
})

test('a partial aggregate that reaches its total is still drawn as not done', async ($, on) => {
  trace("FR-016-AC-3")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => (args[1] === 'A' ? pageOf('Pa', 8, 8) : out('', 1, 'B failed')) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^99%$/)
  hides(lines, /^100%$/)
})

test('a combined call that succeeds makes no single call, shows no partial mark and prints F fresh, 0 old, 0 failed', async ($, on) => {
  trace("FR-016-AC-4")
  const w = world(on, true)
  lead(w, { initiatives: ['A'], projects: ['C'], tickets: ['T-1'] })
  board(w, { combined: () => out(statusJson([{ name: 'Payments ledger', done: 34, total: 39, inProgress: 4 }, { name: 'Payments export', done: 65, total: 67, inProgress: 2 }], 3)) })
  await started($, w)
  expect(statusCalls(w)).toEqual(['--initiative A --project C --issue T-1'])
  const lines = await paneLines($)
  shows(lines, /^99\/106 done · 6 in progress · 3 ready · 3 fresh, 0 old, 0 failed$/)
  hides(lines, /^partial$/)
  hides(lines, /^summed from parts/)
})

test('every selector failing with no record shows each with its error, no aggregate, and the lead summary', async ($, on) => {
  trace("FR-016-AC-5")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] }, 'Release train summary')
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => out('', 1, `${args[1]} is broken`) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^project A: A is broken$/)
  shows(lines, /^project B: B is broken$/)
  shows(lines, /^Release train summary$/)
  hides(lines, /done · /)
  hides(lines, /^\d+%$/)
  shows(lines, /0 fresh, 0 old, 2 failed/)
})

test('a single call that does not answer in 5 seconds fails with a timeout and the other selectors are drawn', async ($, on) => {
  trace("FR-016-AC-6")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: (args, init) => (args[1] === 'B' ? hangs(w, init) : pageOf('Pa', 1, 2)),
  })
  const timeouts: (number | undefined)[] = []
  const inner = w.stub.value!
  w.stub.value = (argv, init) => (argv[0] === 'ix-board' && argv[2] === 'focus' && argv.length === 6 ? (timeouts.push(init?.timeoutMs), inner(argv, init)) : inner(argv, init))
  await startSession($)
  await w.clock!.advance(6000)
  const lines = await paneLines($)
  expect(timeouts).toEqual([5000, 5000])
  shows(lines, /^Pa$/)
  shows(lines, /^project B: .+/)
})

test('a combined call that fails and every single call succeeding sum the singles, unmarked, with the note', async ($, on) => {
  trace("FR-016-AC-7")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => (args[1] === 'A' ? pageOf('Pa', 4, 8, 1) : pageOf('Pb', 6, 12, 2)) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^10\/20 done · 3 in progress · 0 ready · 2 fresh, 0 old, 0 failed$/)
  hides(lines, /^partial$/)
  shows(lines, /^summed from parts; overlapping selectors may count twice$/)
})

/** One lead with two projects whose combined call fails in the given way; no single call may follow. */
async function sourceFailure($: Parameters<TestBody>[0], w: World, mode: 'missing' | 'timeout' | 'auth'): Promise<void> {
  lead(w, { projects: ['A', 'B'] })
  const timeouts: (number | undefined)[] = []
  board(w, {
    combined: (_args, init) => {
      timeouts.push(init?.timeoutMs)
      if (mode === 'missing') return Promise.reject(new Error('spawn ix-board ENOENT'))
      if (mode === 'timeout') return hangs(w, init)
      return out('', 1, 'ix-board: authentication failed')
    },
  })
  await startSession($)
  await w.clock!.advance(mode === 'timeout' ? 16_000 : 1000)
  expect(statusCalls(w)).toHaveLength(1)
  expect(timeouts).toEqual([15_000])
  const lines = await paneLines($)
  const shown = ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string).split('\n')
  const reported = shown.find(l => /^ {2}ix-board: /.test(l))?.replace(/^ {2}ix-board: /, '')
  expect(reported).toBeDefined()
  // The error the source reported is drawn once, on the card.
  expect(lines.filter(l => l === reported)).toHaveLength(1)
  if (mode === 'auth') expect(reported).toBe('ix-board: authentication failed')
}

test('ix-board missing shows one ix-board error and makes no single call', async ($, on) => {
  trace("FR-016-AC-8")
  await sourceFailure($, world(on, true), 'missing')
})

test('a combined call that times out at 15 seconds shows one ix-board error and makes no single call', async ($, on) => {
  trace("FR-016-AC-8", "NFR-004-M-3")
  await sourceFailure($, world(on, true), 'timeout')
})

test('an authentication failure shows one ix-board error and makes no single call', async ($, on) => {
  trace("FR-016-AC-8")
  await sourceFailure($, world(on, true), 'auth')
})

const TEN = Array.from({ length: 10 }, (_, i) => `P${i}`)

test('ten selectors and a failing combined call make 11 calls, four at once, in waves of five seconds', async ($, on) => {
  trace("FR-016-AC-9")
  const w = world(on, true)
  lead(w, { projects: TEN })
  const slow = board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => w.clock!.sleep(4000).then(() => pageOf(`Pn ${args[1]}`, 1, 2)) })
  await startSession($)
  await w.clock!.advance(13_000)
  expect(statusCalls(w)).toHaveLength(11)
  expect(slow.max).toBe(4)
  expect((await paneLines($)).filter(l => /^Pn P\d$/.test(l))).toHaveLength(10)
})

test('a refresh ends at 30 seconds and each selector unanswered then is failed with timed out', async ($, on) => {
  trace("FR-016-AC-9", "NFR-004-M-4")
  const w = world(on, true)
  lead(w, { projects: TEN })
  const stuck = board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => NEVER() })
  await startSession($)
  await w.clock!.advance(29_000)
  expect((await paneLines($)).filter(l => /timed out/.test(l))).toHaveLength(0)
  await w.clock!.advance(2000)
  expect(statusCalls(w).length).toBeLessThanOrEqual(11)
  expect(stuck.max).toBeLessThanOrEqual(4)
  expect((await paneLines($)).filter(l => /^project P\d: timed out$/.test(l))).toHaveLength(10)
})

test('a tick during a refresh is run once after it, and a result older than the stored record is ignored', async ($, on) => {
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

  // The older result: a record another process wrote after the answer wins.
  const selectors: Selector[] = [{ kind: 'project', ref: 'A' }, { kind: 'project', ref: 'B' }]
  const outcome: Outcome = { ok: true, at: T0, name: 'x', done: 1, total: 2, inProgress: 0, ready: 0 }
  const refreshed: Refresh = { at: T0, combined: null, combinedError: 'bad', outcomes: { 'project:A': outcome, 'project:B': { ...outcome, done: 2 } } }
  const newer = { 'project:A': record({ at_ms: T0 + 1000, done: 9, total: 9 }) }
  const shown = compose(selectors, refreshed, null, newer)
  expect(shown.projects.map(p => p.done)).toEqual([9, 2])
  expect(mergeRecords({ 'project:A': record({ at_ms: T0 + 1000, done: 9 }) }, recordsOf(selectors, refreshed, {}, T0))['project:A']!.done).toBe(9)
})

test('a milestone is asked alone by its ref and an initiative, project and ticket by their own arguments', async ($, on) => {
  trace("FR-016-AC-11")
  expect(selectorArgs({ kind: 'milestone', ref: 'm1', project: 'p1' })).toEqual(['--milestone', 'm1'])
  expect(selectorArgs({ kind: 'initiative', ref: 'i' })).toEqual(['--initiative', 'i'])
  expect(selectorArgs({ kind: 'project', ref: 'p' })).toEqual(['--project', 'p'])
  expect(selectorArgs({ kind: 'ticket', ref: 't' })).toEqual(['--issue', 't'])
  // A named focus with a milestone member asks for it alone, never with its project.
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4'))
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({ focus: 'Beta' }))
  w.stub.value = argv => {
    const line = argv.join(' ')
    if (line === 'agent-msg focuses list --json') return out(listJson(defRow('foc-beta', 'Beta', 'QSL')))
    if (line === 'agent-msg focuses show foc-beta --json') return out(showJson('Beta', 'QSL', { initiatives: ['i1'], projects: ['p1'], milestones: [['m1', 'p1']], tickets: ['t1'] }))
    return undefined
  }
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => pageOf('x', 1, 2) })
  await startSession($)
  await w.clock!.advance(1000)
  expect(statusCalls(w)).toEqual(['--initiative i1 --project p1 --milestone m1 --issue t1', '--initiative i1', '--project p1', '--milestone m1', '--issue t1'])
})

test('the selectors of a lead focus are its initiatives, projects and tickets, and with none the pane says no selectors and ix-board is not called', async ($, on) => {
  trace("FR-016-AC-12")
  expect(selectorsOfScope({ initiatives: ['i'], projects: ['p'], tickets: ['t'] }).map(s => `${s.kind}:${s.ref}`)).toEqual(['initiative:i', 'project:p', 'ticket:t'])
  const w = world(on, true)
  lead(w, null, 'Only a summary')
  board(w, { combined: () => pageOf('x', 1, 2) })
  await started($, w)
  expect(statusCalls(w)).toEqual([])
  const lines = await paneLines($)
  shows(lines, /^no selectors$/)
  shows(lines, /^Only a summary$/)
})

// ---------------------------------------------------------------- FR-017 last good progress

test('a successful call for project C writes project:C to progress.json, and a new session reads it', async ($, on) => {
  trace("FR-017-AC-1")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  board(w, { combined: () => pageOf('Project C', 7, 9, 1) })
  await started($, w)
  const rec = saved(w)['project:C']!
  expect(Object.keys(rec).sort()).toEqual(['at_ms', 'done', 'inProgress', 'ready', 'seen_ms', 'total'])
  expect(rec).toMatchObject({ done: 7, total: 9, inProgress: 1, ready: 0 })
  expect(typeof rec.at_ms).toBe('number')
  expect(rec.seen_ms).toBe(rec.at_ms)
  // A new session starts with nothing in memory and reads the file.
  expect((await readRecords(fake$(w) as never))['project:C']).toEqual(rec)
})

test('a failing refresh of C shows its record from 5 minutes ago marked old with the age and the error', async ($, on) => {
  trace("FR-017-AC-2", "FR-006-AC-10")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  seed(w, { 'project:C': record() })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => out('', 1, 'project C: bad data') })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^project C · old 5m$/)
  shows(lines, /^10\/20$/)
  shows(lines, /^project C: project C: bad data$/)
  shows(lines, /0 fresh, 1 old, 0 failed/)
  shows(lines, /^partial$/)
})

test('after a failure a successful refresh of C shows the new progress, no old mark and a record with the new time', async ($, on) => {
  trace("FR-017-AC-3")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  seed(w, { 'project:C': record() })
  let healthy = false
  // With one selector the combined call is the selector's own call, so one answer serves both.
  board(w, { combined: () => (healthy ? pageOf('Project C', 15, 20) : out('', 1, 'bad data')) })
  await started($, w)
  shows(await paneLines($), /old 5m/)
  healthy = true
  await refresh(w)
  const lines = await paneLines($)
  hides(lines, /· (old|stale)/)
  shows(lines, /^15\/20 done/)
  expect(saved(w)['project:C']).toMatchObject({ done: 15, total: 20 })
  expect(saved(w)['project:C']!.at_ms).toBeGreaterThan(T0)
})

test('a record 30 minutes old is old and not stale, and 30 minutes 1 second old is labelled stale and shown', async ($, on) => {
  trace("FR-017-AC-4")
  expect(STALE_MS).toBe(30 * MIN)
  const w = world(on, true)
  lead(w, { projects: ['C', 'D'] })
  seed(w, { 'project:C': record({ at_ms: T0 - 30 * MIN }), 'project:D': record({ at_ms: T0 - 30 * MIN - 1000 }) })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => out('', 1, 'bad data') })
  // The refresh moves the clock on by one second as it reads, so the boundaries are held a second back.
  w.clock!.set(T0 + 1)
  await startSession($)
  await w.clock!.advance(0)
  const lines = await paneLines($)
  shows(lines, /^project C · old 30m$/)
  shows(lines, /^project D · stale 30m$/)
  shows(lines, /^10\/20$/)
})

test('a failing refresh of D with no record shows D’s error and no progress for D', async ($, on) => {
  trace("FR-017-AC-5")
  const w = world(on, true)
  lead(w, { projects: ['C', 'D'] })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => (args[1] === 'D' ? out('', 1, 'D is broken') : pageOf('Pc', 1, 2)) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^project D: D is broken$/)
  expect(lines.filter(l => /^\d+\/\d+$/.test(l))).toEqual(['1/2'])
  expect(saved(w)['project:D']).toBeUndefined()
})

test('a malformed progress.json is drawn without a file error and the next success writes a valid file', async ($, on) => {
  trace("FR-017-AC-6")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  w.files.set(PROGRESS, '{ not json')
  board(w, { combined: () => pageOf('Project C', 3, 4) })
  await started($, w)
  const lines = await paneLines($)
  hides(lines, /progress\.json/)
  shows(lines, /^3\/4 done/)
  expect(saved(w)['project:C']).toMatchObject({ done: 3, total: 4 })
  // Whatever else the file holds is no records either.
  for (const bad of ['[1,2]', '"x"', '', 'null', '7']) expect(parseRecords(bad)).toEqual({})
})

test('one malformed entry is ignored alone and the valid ones are used', async () => {
  trace("FR-017-AC-7")
  const good = record()
  const parsed = parseRecords(JSON.stringify({ 'project:C': good, 'project:D': { at_ms: 'x' }, 'ticket:T': null, 'project:E': { ...good, total: -1 }, 'project:F': { ...good, done: 1 } }))
  expect(Object.keys(parsed).sort()).toEqual(['project:C', 'project:F'])
  expect(parsed['project:C']).toEqual(good)
})

test('a record whose time is 10 minutes in the future has an age of zero', async ($, on) => {
  trace("FR-017-AC-8")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  seed(w, { 'project:C': record({ at_ms: T0 + 10 * MIN }) })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => out('', 1, 'bad data') })
  await started($, w)
  shows(await paneLines($), /^project C · old 0s$/)
})

test('a record another process wrote in between is kept by the merge, and an interrupted write leaves the previous file intact', async ($, on) => {
  trace("FR-017-AC-9")
  const w = world(on, true)
  const e = record({ at_ms: T0 - 2 * MIN, done: 5 })
  seed(w, { 'project:E': e })
  const mine: Records = { 'project:C': record({ at_ms: T0, seen_ms: T0, done: 3 }) }
  const merged = await saveRecords(fake$(w) as never, T0, mine)
  expect(Object.keys(merged).sort()).toEqual(['project:C', 'project:E'])
  expect(Object.keys(saved(w)).sort()).toEqual(['project:C', 'project:E'])
  // Written by a temporary file and a rename.
  expect(w.writes.some(p => p.startsWith(`${PROGRESS}.`) && p.endsWith('.tmp'))).toBe(true)
  expect(w.ran).toContain(`mv -f ${w.writes.at(-1)} ${PROGRESS}`)
  // The newer at_ms and the newer seen_ms are kept independently.
  const both = mergeRecords({ 'project:C': record({ at_ms: 100, seen_ms: 900, done: 1 }) }, { 'project:C': record({ at_ms: 500, seen_ms: 400, done: 2 }) })
  expect(both['project:C']).toMatchObject({ at_ms: 500, seen_ms: 900, done: 2 })
  // An interrupted write: the rename fails and the previous file is as it was.
  const before = w.files.get(PROGRESS)
  w.mvFails.value = true
  await saveRecords(fake$(w) as never, T0, { 'project:Z': record({ at_ms: T0, seen_ms: T0 }) })
  expect(w.files.get(PROGRESS)).toBe(before)
  expect(w.files.has(`${w.writes.at(-1)}`)).toBe(false)
})

test('a record unseen for 24 hours 1 minute is removed at the next write, 23 hours stays, and an old at_ms with a current seen_ms stays', async ($, on) => {
  trace("FR-017-AC-10")
  const w = world(on, true)
  const day = PRUNE_MS
  seed(w, {
    'project:gone': record({ seen_ms: T0 - day - MIN }),
    'project:kept': record({ seen_ms: T0 - 23 * 60 * MIN }),
    'project:old-but-seen': record({ at_ms: T0 - 40 * 60 * MIN, seen_ms: T0 }),
  })
  await saveRecords(fake$(w) as never, T0, {})
  expect(Object.keys(saved(w)).sort()).toEqual(['project:kept', 'project:old-but-seen'])
  expect(Object.keys(prune({ a: record({ seen_ms: T0 - day }) }, T0))).toEqual(['a'])
})

test('/factory show gives the age of ix-board selectors from progress.json and of the other sources from memory', async ($, on) => {
  trace("FR-017-AC-11", "FR-018-AC-4")
  const w = world(on, true)
  lead(w, { projects: ['C'] })
  seed(w, { 'project:C': record() })
  w.fetch.value = () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => out('', 1, 'bad data') })
  await started($, w)
  // Prometheus answered once, then fails: the age of its last success is kept in memory.
  await w.clock!.advance(15_000)
  w.fetch.value = () => ({ value: { status: 503, ok: false, headers: {}, text: '' } })
  await w.clock!.advance(15_000)
  const text = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
  expect(text).toMatch(/Source errors:/)
  expect(text).toMatch(/ix-board project C: bad data \(last success \dm ago\)/)
  expect(text).toMatch(/prometheus: Prometheus 503 \(last success \d+s ago\)/)
  // A new session shows no age for the sources held in memory until they answer.
  resetSources()
  sourceFailed('prometheus', 'Prometheus 503')
  sourceFailed('agent-msg work', 'no live agent')
  const none = await showText(fake$(w) as never, getSelection())
  expect(none).toMatch(/^ {2}prometheus: Prometheus 503$/m)
  expect(none).toMatch(/^ {2}agent-msg work: no live agent$/m)
})

// ---------------------------------------------------------------- FR-018 errors visible and not fatal

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

test('ix-board failing is shown on the Focus card and the summary is drawn while the metrics answer', async ($, on) => {
  trace("FR-018-AC-1")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] }, 'Release train summary')
  board(w, { combined: () => out('', 1, 'ix-board: authentication failed') })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^ix-board: authentication failed$/)
  shows(lines, /^Release train summary$/)
  hides(await factoryLines($), /^Metrics unavailable/)
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
  shows(lines, /^5\/10 done/)
  shows(lines, /^agent-msg work: draco:QSL:code: no report$/)
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
  // The call is given up on after five seconds and the view says the metrics are unavailable, with the reason.
  const note = (await factoryLines($)).find(l => /^Metrics unavailable: /.test(l))
  expect(note).toMatch(/^Metrics unavailable: .+/)
})

test('ix-board failing for one selector and Prometheus failing are both listed by /factory show', async ($, on) => {
  trace("FR-018-AC-4")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  w.fetch.value = () => ({ value: { status: 503, ok: false, headers: {}, text: '' } })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => (args[1] === 'B' ? out('', 1, 'B is broken') : pageOf('Pa', 1, 2)) })
  await started($, w)
  const text = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
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
  // The sources answer after 100 ms; ix-board never does. The summary is drawn within a second of that, with no progress yet.
  await w.clock!.advance(100)
  await w.clock!.advance(900)
  const early = await paneLines($)
  shows(early, /^Release train summary$/)
  hides(early, /done · /)
  await w.clock!.advance(1000)
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
  shows(lines, /^ix-board: authentication failed$/)
  shows(lines, /^agent-msg work: draco:QSL:plan: no report$/)
  shows(await factoryLines($), /^Metrics unavailable: .*503/)
})

test('agent-msg focuses list failing is listed under agent-msg focuses and the Focus pane still draws', async ($, on) => {
  trace("FR-018-AC-7")
  const w = world(on, true)
  lead(w, null, 'Beta')
  choose(w, 'Beta')
  named(w, () => out('', 1, 'agent-msg: relay store unavailable'))
  await started($, w)
  const text = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
  expect(text).toMatch(/^ {2}agent-msg focuses: list: agent-msg: relay store unavailable$/m)
  const lines = await paneLines($)
  shows(lines, /^your choice: Beta$/)
  shows(lines, /^Beta$/)
})

// ---------------------------------------------------------------- what is kept, and what is not

test('a Linear rate limit is one ix-board error, makes no single call, and holds further calls', async ($, on) => {
  trace("FR-016-AC-13")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, { combined: () => out('', 1, 'Linear rate limited; retry in 3600.005s') })
  await started($, w)
  expect(statusCalls(w)).toHaveLength(1)
  await w.clock!.advance(10 * MIN)
  expect(statusCalls(w)).toHaveLength(1)
  shows(await paneLines($), /^Linear rate limit · paused /)
})

test('a refresh with a failed selector is held for 5 minutes and marked, then asked again, and a manual refresh asks at once', async ($, on) => {
  trace("FR-016-AC-14")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  let healthy = false
  board(w, { combined: () => (healthy ? out(statusJson([{ name: 'Pa', done: 1, total: 2 }])) : out('', 1, BAD_MILESTONE)), single: args => (args[1] === 'B' ? out('', 1, 'B is broken') : pageOf('Pa', 1, 2)) })
  await started($, w)
  expect(statusCalls(w)).toHaveLength(3)
  // The polls of the next 4 minutes make no call and the pane says it shows an earlier outcome.
  await w.clock!.advance(4 * MIN)
  expect(statusCalls(w)).toHaveLength(3)
  shows(await paneLines($), /^earlier outcome from \dm ago: ix-board is asked again after 5 minutes, r asks now$/)
  // The first poll after 5 minutes asks again.
  await w.clock!.advance(2 * MIN)
  expect(statusCalls(w)).toHaveLength(6)
  // The refresh key asks at once, with the held outcome two seconds old.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await ui.press({ key: 'refresh' })
  await ui.unmount()
  await w.clock!.advance(1000)
  expect(statusCalls(w)).toHaveLength(9)
  healthy = true
  await w.clock!.advance(6 * MIN)
  expect(statusCalls(w)).toHaveLength(10)
  // Answered by the combined call: kept, so the polls of the next ten minutes call nothing.
  await w.clock!.advance(10 * MIN)
  expect(statusCalls(w)).toHaveLength(10)
})

test('no more than 4 single-selector processes run at once across two focuses', async ($, on) => {
  trace("FR-016-AC-15")
  const w = world(on, true)
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'One', ['running'], { projects: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'] }))
  w.leads.set('draco:QSL:plan', report('draco:QSL:plan', 'Two', ['running'], { projects: ['B0', 'B1', 'B2', 'B3', 'B4', 'B5'] }))
  const live = { now: 0, max: 0 }
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: args => {
      live.max = Math.max(live.max, ++live.now)
      return w.clock!.sleep(1000).then(() => (live.now--, pageOf(`P ${args[1]}`, 1, 2)))
    },
  })
  await startSession($)
  await w.clock!.advance(10_000)
  expect(live.max).toBe(4)
  expect(statusCalls(w)).toHaveLength(14)
  expect((await paneLines($)).filter(l => /^P [AB]\d$/.test(l))).toHaveLength(12)
})

test('a successful combined call writes the focus-level record with the aggregate', async ($, on) => {
  trace("FR-017-AC-12")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, { combined: () => out(statusJson([{ name: 'Pa', done: 4, total: 8, inProgress: 1 }, { name: 'Pb', done: 6, total: 12, inProgress: 2 }], 2)) })
  await started($, w)
  expect(saved(w)[focusKey(LEAD, [{ kind: 'project', ref: 'A' }, { kind: 'project', ref: 'B' }])]).toMatchObject({ done: 10, total: 20, inProgress: 3, ready: 2 })
})

test('when everything fails and no selector has a record the focus-level record is shown old, not an empty card', async ($, on) => {
  trace("FR-017-AC-13")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  seed(w, { [focusKey(LEAD, [{ kind: 'project', ref: 'A' }, { kind: 'project', ref: 'B' }])]: record() })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => out('', 1, `${args[1]} is broken`) })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, new RegExp(`^${LEAD} · old 5m$`))
  shows(lines, /^10\/20$/)
  shows(lines, /^project A: A is broken$/)
  shows(lines, /^project B: B is broken$/)
  shows(lines, /^partial$/)
})

test('a stand-in is used only for the selectors it was recorded for, and its seen_ms is not bumped otherwise', async ($, on) => {
  trace("FR-017-AC-14")
  const w = world(on, true)
  lead(w, { projects: ['A', 'C'] })
  const stale = focusKey(LEAD, [{ kind: 'project', ref: 'A' }, { kind: 'project', ref: 'B' }])
  seed(w, { [stale]: record() })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: args => out('', 1, `${args[1]} is broken`) })
  await started($, w)
  const lines = await paneLines($)
  hides(lines, /· old/)
  shows(lines, /^project A: A is broken$/)
  expect(saved(w)[stale]!.seen_ms).toBe(record().seen_ms)
  // Long scopes are keyed by a short stable hash, in the order the selectors are listed.
  const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'project' as const, ref: `project-number-${i}` }))
  expect(focusKey(LEAD, many).length).toBeLessThan(60)
  expect(focusKey(LEAD, many)).toBe(focusKey(LEAD, [...many].reverse()))
  expect(focusKey(LEAD, [{ kind: 'project', ref: 'B' }, { kind: 'project', ref: 'A' }])).toBe(`focus:${LEAD}:project:A+project:B`)
})

test('a result older than the record another process wrote meanwhile is ignored by a real refresh', async ($, on) => {
  trace("FR-016-AC-10")
  const w = world(on, true)
  lead(w, { projects: ['A', 'B'] })
  board(w, {
    combined: () => out('', 1, BAD_MILESTONE),
    single: args => w.clock!.sleep(3000).then(() => {
      // While the answer is awaited, another session writes a newer record of A.
      seed(w, { 'project:A': record({ at_ms: T0 + 60_000, seen_ms: T0 + 60_000, done: 9, total: 9, inProgress: 0, ready: 0 }) })
      return pageOf(`P${args[1]}`, 1, 2)
    }),
  })
  await startSession($)
  await w.clock!.advance(8000)
  const lines = await paneLines($)
  shows(lines, /^10\/11 done/)
  hides(lines, /^PA$/)
  shows(lines, /^PB$/)
  expect(saved(w)['project:A']!.done).toBe(9)
})

test('the source state of agent-msg focuses and ix-board is cleared when nothing asks them any more', async ($, on) => {
  trace("FR-018-AC-7")
  const w = world(on, true)
  lead(w, { projects: ['A'] }, 'Beta')
  choose(w, 'Beta')
  named(w, () => out('', 1, 'agent-msg: relay store unavailable'))
  board(w, { combined: () => out('', 1, 'ix-board: authentication failed') })
  await started($, w)
  const before = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
  expect(before).toMatch(/agent-msg focuses: list/)
  // The choice stops being a name, and the lead no longer scopes anything.
  w.leads.set(LEAD, report(LEAD, 'Beta', ['running'], null))
  await $.command.run({ command: 'factory', args: 'focus own' } as never)
  await w.clock!.advance(2 * MIN + 1000)
  const after = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
  expect(after).not.toMatch(/agent-msg focuses/)
  expect(after).not.toMatch(/ix-board/)
})

test('a selector is named by its label, else by its kind and the first 8 characters of a UUID', async ($, on) => {
  trace("FR-016-AC-2")
  const w = world(on, true)
  lead(w, { projects: ['11111111-2222-4333-8444-555555555555', 'QSL-77'] })
  board(w, { combined: () => out('', 1, BAD_MILESTONE), single: () => out('', 1, 'boom') })
  await started($, w)
  const lines = await paneLines($)
  shows(lines, /^project 11111111: boom$/)
  shows(lines, /^project QSL-77: boom$/)
})
