import { expect } from 'claude-code/testing'
import { test } from './loud'
import { trace } from './trace'

import { compose, limited, selectorArgs, selectorsOfScope } from '../hooks/board'
import type { Refresh, Selector } from '../hooks/board'
import { PRUNE_MS, STALE_MS, ageOf, mergeInitiatives, mergeRecords, parseFile, parseRecords, prune, readFile, saveFile, saveRecords } from '../hooks/progress'
import { FP, BAD_MILESTONE, fake$, out, pid, roadmapJson, statusJson, world } from './world'
import { gatedBoard } from '../hooks/linear'
import { MIN, PROGRESS, T0, initiative, ix, names, proj, progress, project, record, saved, seed } from './board-kit'

// Tests of the progress data the Focus pane reads: initiative expansion, per-project calls, the roll-up,
// the records of last good progress and the membership cache. They call the function the pane calls
// (loadProgress) with a stand-in for ix-board whose answers have the keys of the real ones.

const FSL = 'efb47f87-949b-4da2-9a2a-1c3a1859f05f'
const HARD = '674ffba8-fe0d-47e3-82b1-c0aa40787357'
const BAD = 'a31003a8-790b-482e-b28d-78f1d26a1cbf'
const many = (n: number, over: Partial<ReturnType<typeof project>> = {}) => Array.from({ length: n }, (_, i) => project(`Proj ${i + 1}`, i + 1, 20, over))
const byName = (specs: ReturnType<typeof project>[]) => Object.fromEntries(specs.map(p => [p.name, p]))
const byId = (specs: ReturnType<typeof project>[]) => Object.fromEntries(specs.map(p => [pid(p.name), p]))
const ids = (specs: ReturnType<typeof project>[]) => specs.map(p => ({ name: p.name, id: pid(p.name) }))

// ---------------------------------------------------------------- FR-021 initiative expansion

test('an initiative selected by name whose roadmap lists 18 projects makes one roadmap call and one call naming them all, and no initiative call', async ($, on) => {
  trace("FR-021-AC-1")
  const w = world(on, true)
  const specs = many(18)
  const b = ix(w, { roadmap: [{ name: 'FSL Hardening', projects: specs.map(p => ({ name: p.name })) }], projects: byName(specs) })
  const shown = await progress(w, [initiative('FSL Hardening')])
  expect(b.calls.filter(c => c === 'roadmap')).toHaveLength(1)
  expect(b.calls).toEqual(['roadmap', together(specs.map(p => p.name))])
  expect(shown.progress!.initiatives[0]!.enumerated).toBe(18)
  expect(shown.progress!.initiatives[0]!.counted).toBe(18)
})

test('a roadmap whose initiatives and projects carry ids matches an initiative selected by UUID and calls its projects by id', async ($, on) => {
  trace("FR-021-AC-2")
  const w = world(on, true)
  const specs = many(3)
  const b = ix(w, { roadmap: [{ name: 'FSL Hardening', id: FSL, projects: ids(specs) }], projects: byId(specs) })
  const shown = await progress(w, [initiative(FSL)])
  expect(b.calls.filter(c => c.startsWith('focus status'))).toEqual([together(specs.map(p => pid(p.name)))])
  expect(shown.progress!.initiatives[0]!.name).toBe('FSL Hardening')
  expect(shown.progress!.initiatives[0]!.counted).toBe(3)
})

test('an initiative selected by UUID with no roadmap match makes one initiative call, expands from its projects and calls none of them', async ($, on) => {
  trace("FR-021-AC-3")
  const w = world(on, true)
  const specs = [project('FSL architecture and design holding', 0, 6), project('FSL single analysis route', 3, 26), project('FSL held features', 0, 5)]
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [FSL]: specs } })
  const shown = await progress(w, [initiative(FSL)])
  expect(b.calls).toEqual(['roadmap', `focus status --initiative ${FSL}`])
  const i = shown.progress!.initiatives[0]!
  expect(names(shown)).toEqual(specs.map(p => p.name))
  expect(i).toMatchObject({ counted: 3, enumerated: 3, done: 3, total: 37, failed: null })
})

test('an initiative selected by identifier that the roadmap does not list is resolved with the initiative call', async ($, on) => {
  trace("FR-021-AC-4")
  const w = world(on, true)
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { 'I-10': [project('Alpha', 1, 2)] } })
  const shown = await progress(w, [initiative('I-10')])
  expect(b.calls).toEqual(['roadmap', 'focus status --initiative I-10'])
  expect(names(shown)).toEqual(['Alpha'])
})

test('a failing initiative call with a cached membership expands from the cache, asks the projects by id and draws a failing one from its old record', async ($, on) => {
  trace("FR-021-AC-5")
  const w = world(on, true)
  const specs = many(2)
  const [a, b2] = [pid('Proj 1'), pid('Proj 2')]
  seed(w, {
    initiatives: { [HARD]: { at_ms: T0 - 7 * 60 * MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }, { id: b2, name: 'Proj 2' }] } },
    [`project:${b2}`]: record({ id: b2, name: 'Proj 2', done: 4, total: 8 }),
  })
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { [a]: specs[0]!, [b2]: 'Proj 2 is broken' } })
  const shown = await progress(w, [initiative(HARD)])
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(1)
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([together([a, b2]), together([a]), together([b2])])
  const i = shown.progress!.initiatives[0]!
  expect(i.projects.map(p => [p.name, p.old])).toEqual([['Proj 1', false], ['Proj 2', true]])
  expect(i).toMatchObject({ counted: 2, enumerated: 2, partial: false })
  expect(i.oldestAt).not.toBeNull()
})

test('a failing initiative call with no cached membership is one failed initiative row, projects unknown, counted once in the warnings', async ($, on) => {
  trace("FR-021-AC-6")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE } })
  const shown = await progress(w, [initiative(HARD)])
  const p = shown.progress!
  expect(p.initiatives).toHaveLength(1)
  expect(p.initiatives[0]).toMatchObject({ failed: 'projects unknown', projects: [] })
  expect(p.warnings).toHaveLength(1)
  expect(p.warnings[0]!.text).toContain(BAD_MILESTONE)
  expect(p.warnings[0]!.text).not.toContain('initiative not found')
  expect(p.header).toBeNull()
})

test('an initiative the roadmap lacks and the initiative call reports as not found, with no cache, reads initiative not found', async ($, on) => {
  trace("FR-021-AC-7")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: `initiative ${HARD} not found` } })
  const shown = await progress(w, [initiative(HARD)])
  expect(shown.progress!.initiatives[0]!.failed).toBe('initiative not found')
})

test('a failing roadmap draws each initiative from its cache or as projects unknown and makes no initiative call, and a source error makes no project call', async ($, on) => {
  trace("FR-021-AC-8")
  const w = world(on, true)
  const a = pid('Proj 1')
  seed(w, { initiatives: { [HARD]: { at_ms: T0 - 7 * 60 * MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }] } } })
  const b = ix(w, { roadmap: out('', 1, 'roadmap read failed'), projects: { [a]: project('Proj 1', 1, 2) } })
  const shown = await progress(w, [initiative(HARD), initiative(FSL)])
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(0)
  expect(shown.progress!.initiatives.map(i => i.failed)).toEqual([null, 'projects unknown'])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([`focus status --project ${a}`])
  // A source error of the roadmap call stops everything.
  const w2 = world(on, true)
  seed(w2, { initiatives: { [HARD]: { at_ms: T0 - 7 * 60 * MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }] } } })
  const b2 = ix(w2, { roadmap: out('', 1, 'ix-board: authentication failed'), projects: { [a]: project('Proj 1', 1, 2) } })
  const shown2 = await progress(w2, [initiative(HARD)])
  expect(b2.calls).toEqual(['roadmap'])
  expect(shown2.progress!.warnings.map(x => x.kind)).toEqual(['source'])
})

test('an initiative failed as projects unknown and two projects listed directly ask both projects and draw them with their counts', async ($, on) => {
  trace("FR-021-AC-9")
  const w = world(on, true)
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { One: project('One', 1, 2), Two: project('Two', 2, 4) } })
  const shown = await progress(w, [initiative(HARD), proj('One'), proj('Two')])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([together(['One', 'Two'])])
  expect(shown.progress!.loose.map(p => [p.name, p.done, p.total])).toEqual([['One', 1, 2], ['Two', 2, 4]])
  expect(shown.progress!.header).toMatchObject({ done: 3, total: 6, notExpanded: 1 })
})

// ---------------------------------------------------------------- FR-022 roll-up

test('an initiative of 18 projects with 17 counted is 17 of 18, partial, and sums the 17', async ($, on) => {
  trace("FR-022-AC-1")
  const w = world(on, true)
  const specs = many(18)
  ix(w, { roadmap: [{ name: 'FSL Hardening', projects: specs.map(p => ({ name: p.name })) }], projects: { ...byName(specs), 'Proj 18': BAD_MILESTONE } })
  const shown = await progress(w, [initiative('FSL Hardening')])
  const i = shown.progress!.initiatives[0]!
  expect(i).toMatchObject({ counted: 17, enumerated: 18, partial: true, done: (17 * 18) / 2, total: 17 * 20 })
  expect(i.projects.filter(p => p.failed).map(p => p.name)).toEqual(['Proj 18'])
})

test('all 18 projects answering fresh is 18 of 18 with no partial mark and no old data', async ($, on) => {
  trace("FR-022-AC-2")
  const w = world(on, true)
  const specs = many(18)
  ix(w, { roadmap: [{ name: 'FSL Hardening', projects: specs.map(p => ({ name: p.name })) }], projects: byName(specs) })
  const i = (await progress(w, [initiative('FSL Hardening')])).progress!.initiatives[0]!
  expect(i).toMatchObject({ counted: 18, enumerated: 18, partial: false, oldestAt: null })
})

test('with 17 of 18 projects counted and done equal to total the header is not complete and is partial', async ($, on) => {
  trace("FR-022-AC-3")
  const w = world(on, true)
  const specs = many(18).map(p => ({ ...p, done: p.total }))
  ix(w, { roadmap: [{ name: 'FSL Hardening', projects: specs.map(p => ({ name: p.name })) }], projects: { ...byName(specs), 'Proj 18': BAD_MILESTONE } })
  const h = (await progress(w, [initiative('FSL Hardening')])).progress!.header!
  expect(h).toMatchObject({ done: 340, total: 340, counted: 17, enumerated: 18, partial: true, complete: false })
})

test('a project the roadmap lists under initiatives A and B is in both and counts once in the header', async ($, on) => {
  trace("FR-022-AC-4")
  const w = world(on, true)
  const shared = project('Shared', 5, 10)
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'Shared', also_in: ['B'] }, { name: 'OnlyA' }] }, { name: 'B', projects: [{ name: 'OnlyB' }] }], projects: { Shared: shared, OnlyA: project('OnlyA', 1, 2), OnlyB: project('OnlyB', 1, 2) } })
  const shown = await progress(w, [initiative('A'), initiative('B')])
  expect(names(shown, 0)).toEqual(['Shared', 'OnlyA'])
  expect(names(shown, 1)).toEqual(['OnlyB', 'Shared'])
  expect(shown.progress!.header).toMatchObject({ done: 7, total: 14, counted: 3, enumerated: 3 })
})

test('a selected project in no selected initiative is a loose project', async ($, on) => {
  trace("FR-022-AC-5")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'InA' }] }], projects: { InA: project('InA', 1, 2), Loose: project('Loose', 3, 4) } })
  const shown = await progress(w, [initiative('A'), proj('Loose')])
  expect(shown.progress!.loose.map(p => p.name)).toEqual(['Loose'])
  expect(names(shown)).toEqual(['InA'])
})

test('every project failing with no record draws no total, shows each failed row and keeps the notes the pane draws', async ($, on) => {
  trace("FR-022-AC-6")
  const w = world(on, true)
  const specs = many(3)
  ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name, id: pid(p.name) })) }], projects: Object.fromEntries(specs.map(p => [pid(p.name), dangling(pid(p.name))])), other: chunks })
  const p = (await progress(w, [initiative('A')])).progress!
  expect(p.header).toBeNull()
  expect(p.initiatives[0]!.projects.every(x => x.failed)).toBe(true)
  expect(p.initiatives[0]).toMatchObject({ counted: 0, enumerated: 3 })
  expect(p.warnings).toHaveLength(3)
})

test('17 projects fresh and one drawn from a record 5 minutes old read 18 of 18, not partial, with the oldest age', async ($, on) => {
  trace("FR-022-AC-7")
  const w = world(on, true)
  const specs = many(18)
  seed(w, { [`project:${pid('Proj 18')}`]: record({ id: pid('Proj 18'), name: 'Proj 18', at_ms: T0 - 5 * MIN }) })
  ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: { ...byName(specs), 'Proj 18': 'Proj 18 is broken' } })
  const shown = await progress(w, [initiative('A')])
  const i = shown.progress!.initiatives[0]!
  expect(i).toMatchObject({ counted: 18, enumerated: 18, partial: false })
  expect(i.oldestAt).toBe(T0 - 5 * MIN)
  expect(shown.progress!.header).toMatchObject({ oldestAt: T0 - 5 * MIN, partial: false })
})

test('17 distinct projects sum to the header done and total and read 17 of 17', async ($, on) => {
  trace("FR-022-AC-8")
  const w = world(on, true)
  const specs = many(17)
  ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: byName(specs) })
  const h = (await progress(w, [initiative('A')])).progress!.header!
  expect(h).toMatchObject({ done: (17 * 18) / 2, total: 17 * 20, counted: 17, enumerated: 17, partial: false })
  expect(h.stages).toEqual([['In Progress', 17 * 20 - (17 * 18) / 2]])
})

test('initiative A whose 4 projects all fail reads 0 of 4 with no total, B is drawn, and the header sums B only and is partial', async ($, on) => {
  trace("FR-022-AC-9")
  const w = world(on, true)
  const a = many(4)
  ix(w, { roadmap: [{ name: 'A', projects: a.map(p => ({ name: `a-${p.name}` })) }, { name: 'B', projects: [{ name: 'b1' }] }], projects: { ...Object.fromEntries(a.map(p => [`a-${p.name}`, BAD_MILESTONE])), b1: project('b1', 2, 4) } })
  const p = (await progress(w, [initiative('A'), initiative('B')])).progress!
  expect(p.initiatives[0]).toMatchObject({ counted: 0, enumerated: 4, total: 0 })
  expect(p.initiatives[1]).toMatchObject({ counted: 1, enumerated: 1, done: 2, total: 4 })
  expect(p.header).toMatchObject({ done: 2, total: 4, partial: true })
  expect(p.warnings).toHaveLength(4)
  expect(p.warnings.every(x => x.kind === 'project')).toBe(true)
})

test('a record whose success is 24 hours 1 minute old does not draw a failing project, which is failed and not counted', async ($, on) => {
  trace("FR-022-AC-10")
  const w = world(on, true)
  seed(w, { [`project:${pid('P')}`]: record({ id: pid('P'), name: 'P', at_ms: T0 - 24 * 60 * MIN - MIN, seen_ms: T0 }) })
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'P' }] }], projects: { P: 'P is broken' } })
  const i = (await progress(w, [initiative('A')])).progress!.initiatives[0]!
  expect(i.projects[0]).toMatchObject({ failed: true })
  expect(i.counted).toBe(0)
})

test('initiatives that cannot be enumerated are failed with projects unknown and counted in the header', async ($, on) => {
  trace("FR-022-AC-11")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE, [FSL]: BAD_MILESTONE }, projects: { P: project('P', 1, 2) } })
  const one = (await progress(w, [initiative(HARD), proj('P')])).progress!
  expect(one.initiatives[0]!.failed).toBe('projects unknown')
  expect(one.header).toMatchObject({ notExpanded: 1, partial: true })
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE, [FSL]: BAD_MILESTONE }, projects: { P: project('P', 1, 2) } })
  const two = (await progress(w2, [initiative(HARD), initiative(FSL), proj('P')])).progress!
  expect(two.header).toMatchObject({ notExpanded: 2, partial: true })
})

// ---------------------------------------------------------------- FR-023 numbers of a project row

test('a project with 10 of 25 done, 3 ready entries and 4 blocker entries of which 1 is completed has remaining 15, ready 3 and blocked 3', async ($, on) => {
  trace("FR-023-AC-2")
  const w = world(on, true)
  ix(w, { projects: { P: project('P', 10, 25, { ready: 3, layers: { open: 3, completed: 1 } }) } })
  const p = (await progress(w, [proj('P')])).progress!
  expect(p.loose[0]).toMatchObject({ done: 10, total: 25, ready: 3, blocked: 3 })
  expect(p.header).toMatchObject({ remaining: 15, ready: 3, blocked: 3 })
})

test('an answer with an empty ready queue has ready 0 and one without the key has null, drawn as a dash', async ($, on) => {
  trace("FR-023-AC-3")
  const w = world(on, true)
  ix(w, { projects: { E: project('E', 1, 2, { ready: 0, layers: { open: 0, completed: 0 } }) } })
  expect((await progress(w, [proj('E')])).progress!.loose.map(x => [x.ready, x.blocked])).toEqual([[0, 0]])
  const w2 = world(on, true)
  ix(w2, { projects: { N: project('N', 1, 2, { ready: null, layers: null }) } })
  expect((await progress(w2, [proj('N')])).progress!.loose.map(x => [x.ready, x.blocked])).toEqual([[null, null]])
})

// ---------------------------------------------------------------- FR-025 last good per project

test('a successful call for project P writes project:<id> with the aliases and a new session reads it', async ($, on) => {
  trace("FR-025-AC-1", "FR-017-AC-1")
  const w = world(on, true)
  ix(w, { projects: { P: project('P', 7, 9, { inProgress: 1 }) } })
  await progress(w, [proj('P')])
  const rec = saved(w)[`project:${pid('P')}`]
  expect(rec).toMatchObject({ done: 7, total: 9, inProgress: 1, ready: 0, id: pid('P'), identifier: pid('P'), name: 'P' })
  for (const k of ['at_ms', 'seen_ms', 'done', 'total', 'inProgress', 'ready']) expect(rec).toHaveProperty(k)
  expect(rec.seen_ms).toBe(rec.at_ms)
  expect((await readFile(fake$(w) as never)).records[`project:${pid('P')}`]).toMatchObject({ done: 7 })
})

test('a failing call for P with a record from 5 minutes ago draws P from it marked old and counts it in its initiative', async ($, on) => {
  trace("FR-025-AC-2", "FR-017-AC-2", "FR-006-AC-10")
  const w = world(on, true)
  seed(w, { [`project:${pid('P')}`]: record({ id: pid('P'), name: 'P', at_ms: T0 - 5 * MIN }) })
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'P' }, { name: 'Q' }] }], projects: { P: 'P is broken', Q: project('Q', 1, 2) } })
  const shown = await progress(w, [initiative('A')])
  const i = shown.progress!.initiatives[0]!
  expect(i.projects[0]).toMatchObject({ old: true, failed: false, at: T0 - 5 * MIN, done: 10, total: 20 })
  expect(i).toMatchObject({ counted: 2, enumerated: 2 })
  expect(shown.progress!.warnings.map(x => x.name)).toEqual(['P'])
  expect(shown.failed.size).toBe(1)
})

test('a failing call for Q with no record draws Q failed and not counted', async ($, on) => {
  trace("FR-025-AC-3", "FR-017-AC-5")
  const w = world(on, true)
  ix(w, { projects: { Q: 'Q is broken', R: project('R', 1, 2) } })
  const p = (await progress(w, [proj('Q'), proj('R')])).progress!
  expect(p.loose.map(x => [x.failed, x.done])).toEqual([[true, 0], [false, 1]])
  expect(p.header).toMatchObject({ counted: 1, enumerated: 2 })
  expect(saved(w)['project:Q']).toBeUndefined()
})

test('a refresh with a failed project is kept for 30 minutes like any other, and a manual refresh asks after 60 seconds', async ($, on) => {
  trace("FR-025-AC-10")
  const w = world(on, true)
  const b = ix(w, { projects: { P: 'P is broken', Q: project('Q', 1, 2) } })
  const sels = [proj('P'), proj('Q')]
  await progress(w, sels)
  const first = b.calls.length
  await w.clock!.advance(29 * MIN)
  const kept = await progress(w, sels)
  expect(b.calls).toHaveLength(first)
  expect(kept.progress!.warnings.map(x => x.text)).toEqual(['P is broken'])
  expect(kept.progress!.notes).toEqual([])
  await w.clock!.advance(2 * MIN)
  await progress(w, sels)
  expect(b.calls.length).toBeGreaterThan(first)
  const second = b.calls.length
  await w.clock!.advance(MIN / 2)
  await progress(w, sels, { manual: true })
  expect(b.calls).toHaveLength(second)
  await w.clock!.advance(MIN)
  await progress(w, sels, { manual: true })
  expect(b.calls.length).toBeGreaterThan(second)
})

test('a refresh a source error cut short is held for 5 minutes and said to be earlier, then asked again, and a manual refresh asks at once', async ($, on) => {
  trace("FR-025-AC-11")
  const w = world(on, true)
  let healthy = false
  const b = ix(w, { projects: { P: () => (healthy ? out(statusJson([project('P', 1, 2)])) : out('', 1, 'ix-board: authentication failed')) } })
  await progress(w, [proj('P')])
  await w.clock!.advance(4 * MIN)
  const held = await progress(w, [proj('P')])
  expect(b.calls).toHaveLength(1)
  expect(held.progress!.notes.join(' ')).toMatch(/earlier outcome from 4m ago/)
  await w.clock!.advance(2 * MIN)
  await progress(w, [proj('P')])
  expect(b.calls).toHaveLength(2)
  healthy = true
  const ok = await progress(w, [proj('P')], { manual: true })
  expect(b.calls).toHaveLength(3)
  expect(ok.progress!.warnings).toEqual([])
})

test('a gated read that fails outright is held 5 minutes with its error, and sessions share one read in 30 minutes', async ($, on) => {
  trace("FR-025-AC-12", "FR-025-AC-13")
  const w = world(on, true)
  let reads = 0
  let fails = true
  const read = (manual = false) => gatedBoard(fake$(w) as never, 'agents:QSL', async () => {
    reads++
    if (fails) throw new Error('ix-board: authentication failed')
    return reads
  }, { manual })
  expect((await read()).error).toBe('ix-board: authentication failed')
  await w.clock!.advance(4 * MIN)
  expect((await read()).error).toBe('ix-board: authentication failed')
  expect(reads).toBe(1)
  fails = false
  await w.clock!.advance(2 * MIN)
  expect(await read()).toMatchObject({ data: 2, error: null })
  // Whoever asks next, from the same file, is answered from it for 30 minutes.
  await w.clock!.advance(29 * MIN)
  expect(await read()).toMatchObject({ data: 2, error: null })
  expect(reads).toBe(2)
  await w.clock!.advance(2 * MIN)
  await read()
  expect(reads).toBe(3)
})

test('records of 0.6.0 under project:<uuid> are used, records keyed by name, focus: and initiative: are ignored but kept valid and pruned at 24 hours', async ($, on) => {
  trace("FR-025-AC-5")
  const w = world(on, true)
  const id = pid('P')
  seed(w, {
    [`project:${id}`]: record(),
    'project:Payments': record({ done: 99, total: 99 }),
    'focus:draco:QSL:code:project:A': record(),
    'initiative:X': record(),
    'project:old': record({ seen_ms: T0 - PRUNE_MS - MIN }),
  })
  ix(w, { projects: { [id]: 'P is broken', Payments: 'Payments is broken' } })
  const p = (await progress(w, [proj(id), proj('Payments')])).progress!
  expect(p.loose.map(x => [x.name, x.old, x.done])).toEqual([[`project ${id.slice(0, 8)}`, true, 10], ['project Payments', false, 0]])
  expect(p.loose[1]!.failed).toBe(true)
  const file = saved(w)
  expect(Object.keys(file).sort()).toEqual([`project:${id}`, 'focus:draco:QSL:code:project:A', 'initiative:X', 'project:Payments'].sort())
  expect(parseRecords(w.files.get(PROGRESS)!)).toBeDefined()
})

test('after a successful refresh over an initiative the file holds no progress record of the initiative', async ($, on) => {
  trace("FR-025-AC-6")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'P' }] }], projects: { P: project('P', 1, 2) } })
  await progress(w, [initiative('A')])
  const keys = Object.keys(saved(w))
  expect(keys.filter(k => k.startsWith('initiative:') || k === 'A' || k.startsWith('focus:'))).toEqual([])
  expect(keys.sort()).toEqual(['initiatives', `project:${pid('P')}`].sort())
})

test('an initiative that is resolved stores its project ids and names with at_ms and seen_ms, and a new session reads them', async ($, on) => {
  trace("FR-025-AC-7", "FR-017-AC-15")
  const w = world(on, true)
  const specs = [project('P1', 1, 2), project('P2', 1, 2)]
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [FSL]: specs } })
  await progress(w, [initiative(FSL)])
  const entry = saved(w).initiatives[FSL]
  expect(entry.projects).toEqual(ids(specs))
  expect(typeof entry.at_ms).toBe('number')
  expect(typeof entry.seen_ms).toBe('number')
  expect((await readFile(fake$(w) as never)).initiatives[FSL]!.projects).toHaveLength(2)
  // Initiatives selected by name are keyed by name, and the projects answered by id are stored with their ids.
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'A', projects: [{ name: 'P' }] }], projects: { P: project('P', 1, 2) } })
  await progress(w2, [initiative('A')])
  expect(saved(w2).initiatives.A.projects).toEqual([{ id: pid('P'), name: 'P' }])
})

test('with a failing initiative call and a cached membership the initiative is drawn from the cache, with project rows from records and old data', async ($, on) => {
  trace("FR-025-AC-8")
  const w = world(on, true)
  const id = pid('P')
  seed(w, {
    initiatives: { [HARD]: { at_ms: T0 - 7 * 60 * MIN, seen_ms: T0 - MIN, projects: [{ id, name: 'P' }] } },
    [`project:${id}`]: record({ id, name: 'P', at_ms: T0 - 7 * MIN }),
  })
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { [id]: BAD_MILESTONE } })
  const i = (await progress(w, [initiative(HARD)])).progress!.initiatives[0]!
  expect(i).toMatchObject({ failed: null, counted: 1, enumerated: 1, oldestAt: T0 - 7 * MIN })
  expect(i.projects[0]!.old).toBe(true)
})

test('an initiatives entry unseen for 24 hours 1 minute is removed at the next write, and a malformed entry is ignored alone', async ($, on) => {
  trace("FR-025-AC-9", "FR-017-AC-15")
  const w = world(on, true)
  const ok = { at_ms: T0, seen_ms: T0, projects: [{ id: 'x', name: 'X' }] }
  seed(w, { initiatives: { gone: { ...ok, seen_ms: T0 - PRUNE_MS - MIN }, kept: ok, bad: { at_ms: 'x' }, worse: { ...ok, projects: [{ id: 1 }] } }, [`project:${pid('Z')}`]: record() })
  const file = await readFile(fake$(w) as never)
  expect(Object.keys(file.initiatives).sort()).toEqual(['gone', 'kept'])
  expect(Object.keys(file.records)).toEqual([`project:${pid('Z')}`])
  await saveFile(fake$(w) as never, T0, {}, {})
  expect(Object.keys(saved(w).initiatives)).toEqual(['kept'])
  // Another process's newer seen_ms for an entry is kept by the merge.
  const merged = mergeInitiatives({ a: { ...ok, seen_ms: 900 } }, { a: { ...ok, at_ms: T0 + 1, seen_ms: 400 } })
  expect(merged.a).toMatchObject({ at_ms: T0 + 1, seen_ms: 900 })
})

// ---------------------------------------------------------------- FR-026 the combined progress call

/** The one `focus status` call these project refs make together, as ix-board is given it. */
const together = (refs: readonly string[]) => `focus status ${refs.map(r => `--project ${r}`).join(' ')}`
const status = (b: { calls: string[] }) => b.calls.filter(c => c.startsWith('focus status'))
const dangling = (id: string) => `issue QSL-3236 references unavailable milestone m1 in project ${id}`
const KNOWN_BAD = `${FP}/known-bad.json`
const knownBad = (w: ReturnType<typeof world>): Record<string, any> => JSON.parse(w.files.get(KNOWN_BAD) ?? '{}') as Record<string, any>
const chunks = (args: string[]) => (args[0] === 'project-chunk' ? out(JSON.stringify({ identifier: args[1], name: 'Chunked' })) : out('', 1, 'not stubbed'))
const hang = (w: ReturnType<typeof world>) => (init: { timeoutMs?: number } | undefined) => w.clock!.sleep(init?.timeoutMs ?? 20_000).then(() => Promise.reject(new Error(`timed out after ${init?.timeoutMs}ms`)))

test('one call names every project of the scope verbatim and once, a milestone is asked by --milestone alone and a ticket by --issue', async ($, on) => {
  trace("FR-026-AC-15", "FR-016-AC-12")
  expect(selectorArgs({ kind: 'project', ref: pid('P') })).toEqual(['--project', pid('P')])
  expect(selectorArgs({ kind: 'milestone', ref: 'm1', project: 'p1' })).toEqual(['--milestone', 'm1'])
  expect(selectorArgs({ kind: 'ticket', ref: 't' })).toEqual(['--issue', 't'])
  expect(selectorsOfScope({ initiatives: ['i'], projects: ['p'], tickets: ['t'] }).map(s => `${s.kind}:${s.ref}`)).toEqual(['initiative:i', 'project:p', 'ticket:t'])
  const w = world(on, true)
  const b = ix(w, { projects: { [pid('P')]: project('By id', 1, 2), 'QSL-7': project('By identifier', 1, 2, { id: 'QSL-7' }), 'By name': project('By name', 1, 2) }, other: () => out(statusJson([project('Touched', 1, 4)])) })
  const sels: Selector[] = [proj(pid('P')), proj('QSL-7'), proj('By name'), proj(pid('P')), { kind: 'milestone', ref: 'm1', project: 'p1' }, { kind: 'ticket', ref: 'QSL-9' }]
  const shown = await progress(w, sels)
  expect([...b.calls].sort()).toEqual([together([pid('P'), 'QSL-7', 'By name']), 'focus status --milestone m1', 'focus status --issue QSL-9'].sort())
  expect(shown.progress!.warnings).toEqual([])
  expect(shown.progress!.header).toMatchObject({ counted: 3, enumerated: 3 })
})

test('nineteen projects under two selectors make one call and no roadmap call, and each row has its own done, total and ready', async ($, on) => {
  trace("FR-026-AC-16", "FR-023-AC-9")
  const w = world(on, true)
  const specs = many(19).map((p, i) => ({ ...p, ready: i % 3 }))
  const b = ix(w, { projects: byId(specs) })
  const p = (await progress(w, [...specs.map(x => proj(pid(x.name))), proj(pid('Proj 1'))])).progress!
  expect(b.calls).toEqual([together(specs.map(x => pid(x.name)))])
  expect(p.loose.slice(0, 19).map(x => [x.name, x.done, x.total, x.ready])).toEqual(specs.map(x => [x.name, x.done, x.total, x.ready]))
  expect(p.header).toMatchObject({ counted: 19, enumerated: 19, done: 190, total: 380 })
})

test('of a combined answer no row has a blocked count, the header counts each open blocker once, and rows sharing a name have no ready count', async ($, on) => {
  trace("FR-026-AC-17", "FR-023-AC-9")
  const w = world(on, true)
  // The two answers name the blockers QSL-200.. alike: two of them are the same tickets.
  ix(w, { projects: { P: project('P', 1, 9, { ready: 3, layers: { open: 3, completed: 1 } }), Q: project('Q', 1, 9, { ready: 1, layers: { open: 2, completed: 0 } }) } })
  const p = (await progress(w, [proj('P'), proj('Q')])).progress!
  expect(p.loose.map(x => [x.ready, x.blocked])).toEqual([[3, null], [1, null]])
  expect(p.header).toMatchObject({ ready: 4, blocked: 3 })
  const w2 = world(on, true)
  const [a, b2] = [pid('twin-a'), pid('twin-b')]
  ix(w2, { projects: { [a]: project('Twin', 1, 4, { id: a, ready: 1 }), [b2]: project('Twin', 2, 6, { id: b2, ready: 1 }) } })
  expect((await progress(w2, [proj(a), proj(b2)])).progress!.loose.map(x => x.ready)).toEqual([null, null])
})

test('a project the error names by id is found with one further call, the other seventeen are drawn and it is remembered', async ($, on) => {
  trace("FR-026-AC-18", "FR-016-AC-18")
  const w = world(on, true)
  const specs = many(18)
  const refs = specs.map(p => pid(p.name))
  const bad = pid('Proj 5')
  const b = ix(w, { projects: { ...byId(specs), [bad]: dangling(bad) }, other: chunks })
  const shown = await progress(w, refs.map(proj))
  expect(status(b)).toEqual([together(refs), together(refs.filter(r => r !== bad))])
  expect(shown.progress!.loose.filter(r => !r.failed)).toHaveLength(17)
  expect(shown.progress!.warnings).toEqual([{ kind: 'project', name: 'Chunked', text: dangling(bad), id: bad }])
  expect(knownBad(w)[`project:${bad}`]).toMatchObject({ error: dangling(bad), id: bad, name: 'Chunked', at_ms: T0 })
})

test('a project named only by its name is matched through the id the error gives', async ($, on) => {
  trace("FR-026-AC-18")
  const w = world(on, true)
  const b = ix(w, { projects: { Alpha: project('Alpha', 1, 2), Stability: dangling(BAD), Gamma: project('Gamma', 1, 2) }, other: args => (args[0] === 'project-chunk' ? out(JSON.stringify({ identifier: args[1] === BAD ? BAD : args[1], name: 'Stability' })) : out('', 1, 'not stubbed')) })
  await progress(w, ['Alpha', 'Stability', 'Gamma'].map(proj))
  expect(b.calls).toEqual([together(['Alpha', 'Stability', 'Gamma']), `project-chunk ${BAD}`, together(['Alpha', 'Gamma'])])
  expect(knownBad(w)['project:Stability']).toMatchObject({ id: BAD, name: 'Stability' })
})

test('an error that names no project is found by halves within twelve further calls', async ($, on) => {
  trace("FR-026-AC-19", "FR-016-AC-18")
  const w = world(on, true)
  const specs = many(19)
  const b = ix(w, { projects: { ...byName(specs), 'Proj 13': 'bad data in Proj 13' }, other: chunks })
  const shown = await progress(w, specs.map(p => proj(p.name)))
  expect(status(b).length).toBeLessThanOrEqual(1 + 12)
  expect(shown.progress!.loose.filter(r => r.failed).map(r => r.name)).toEqual(['Chunked'])
  expect(shown.progress!.warnings.map(x => x.text)).toEqual(['bad data in Proj 13'])
  expect(Object.keys(knownBad(w))).toEqual(['project:Proj 13'])
})

test('with more failing projects than the allowance finds, the rest are not isolated and only those found alone are remembered', async ($, on) => {
  trace("FR-026-AC-20")
  const w = world(on, true)
  const specs = many(32)
  const failing = [1, 3, 5, 7, 9, 11, 13, 15].map(i => `Proj ${i}`)
  const b = ix(w, { projects: { ...byName(specs), ...Object.fromEntries(failing.map(n => [n, `bad data in ${n}`])) }, other: chunks })
  const shown = await progress(w, specs.map(p => proj(p.name)))
  expect(status(b).length).toBeLessThanOrEqual(1 + 12)
  const texts = shown.progress!.warnings.map(x => x.text)
  expect(texts.some(t => t.startsWith('not isolated: bad data in '))).toBe(true)
  for (const key of Object.keys(knownBad(w))) expect(failing).toContain(key.slice('project:'.length))
  expect(shown.progress!.warnings.every(x => x.kind === 'project')).toBe(true)
})

test('a known-bad project is left out of the combined call, asked alone after an hour or on a refresh by hand, and rejoins when it answers', async ($, on) => {
  trace("FR-026-AC-21", "FR-025-AC-10")
  const w = world(on, true)
  const specs = many(3)
  const refs = specs.map(p => pid(p.name))
  const [a, bad, c] = refs as [string, string, string]
  let healthy = false
  const b = ix(w, { projects: { ...byId(specs), [bad]: () => (healthy ? out(statusJson([specs[1]!])) : out('', 4, dangling(bad))) }, other: chunks })
  const sels = refs.map(proj)
  const since = async (by: number, manual = false) => {
    await w.clock!.advance(by)
    const from = b.calls.length
    const shown = await progress(w, sels, { manual })
    return { shown, calls: b.calls.slice(from).sort() }
  }
  await progress(w, sels)
  const second = await since(31 * MIN)
  expect(second.calls).toEqual([together([a, c])])
  expect(second.shown.progress!.warnings.map(x => x.text)).toEqual([dangling(bad)])
  expect(second.shown.progress!.loose[1]).toMatchObject({ failed: true })
  const third = await since(31 * MIN)
  expect(third.calls).toEqual([together([a, c]), together([bad])].sort())
  expect(knownBad(w)[`project:${bad}`].at_ms).toBe(T0 + 62 * MIN)
  healthy = true
  const manual = await since(2 * MIN, true)
  expect(manual.calls).toEqual([together([a, c]), together([bad])].sort())
  expect(manual.shown.progress!.warnings).toEqual([])
  expect(knownBad(w)[`project:${bad}`]).toBeUndefined()
  const fifth = await since(31 * MIN)
  expect(fifth.calls).toEqual([together(refs)])
})

test('another session reads the known-bad memory and does not ask the project again', async ($, on) => {
  trace("FR-026-AC-22")
  const w = world(on, true)
  const specs = many(3)
  const refs = specs.map(p => pid(p.name))
  const bad = refs[1]!
  ix(w, { projects: { ...byId(specs), [bad]: dangling(bad) }, other: chunks })
  await progress(w, refs.map(proj))
  const w2 = world(on, true)
  w2.files.set(KNOWN_BAD, w.files.get(KNOWN_BAD)!)
  const b = ix(w2, { projects: byId(specs) })
  const p = (await progress(w2, refs.map(proj))).progress!
  expect(b.calls).toEqual([together([refs[0]!, refs[2]!])])
  expect(p.warnings.map(x => x.text)).toEqual([dangling(bad)])
})

test('a source error is never laid on a project: nothing is remembered and nothing is searched', async ($, on) => {
  trace("FR-026-AC-23")
  const refs = ['A', 'B', 'C', 'D']
  for (const text of ['ix-board: authentication failed', 'Linear rate limited; retry in 60s']) {
    const w = world(on, true)
    const b = ix(w, { projects: Object.fromEntries(refs.map(r => [r, text])) })
    const p = (await progress(w, refs.map(proj))).progress!
    expect(b.calls).toHaveLength(1)
    expect(p.warnings.map(x => x.kind)).toEqual(['source'])
    expect(w.files.has(KNOWN_BAD)).toBe(false)
  }
  // No status call answers, and the halves and then the quarters are refused with the same words, which name nothing.
  const eight = many(8).map(p => p.name)
  const w = world(on, true)
  const b = ix(w, { projects: Object.fromEntries(eight.map(r => [r, 'ix-board: cannot reach Linear'])) })
  const p = (await progress(w, eight.map(proj))).progress!
  expect(b.calls).toHaveLength(1 + 2 + 4)
  expect(p.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'ix-board: cannot reach Linear', id: null }])
  expect(w.files.has(KNOWN_BAD)).toBe(false)
  // A call for several projects that times out is nobody's failure, also after another call answered.
  const w2 = world(on, true)
  const b2 = ix(w2, { roadmap: [{ name: 'I', projects: [{ name: 'A' }, { name: 'B' }] }], projects: { A: hang(w2), B: hang(w2) } })
  const late = await progress(w2, [initiative('I')], { advance: 21_000 })
  expect(b2.calls).toHaveLength(2)
  expect(late.progress!.warnings.map(x => x.kind)).toEqual(['source'])
  expect(w2.files.has(KNOWN_BAD)).toBe(false)
})

test('a try of a known-bad project that a source error cuts off stays due', async ($, on) => {
  trace("FR-026-AC-23")
  const w = world(on, true)
  const entry = { at_ms: T0 - 61 * MIN, seen_ms: T0 - MIN, error: 'old trouble' }
  w.files.set(KNOWN_BAD, JSON.stringify({ 'project:A': entry }))
  ix(w, { projects: { A: 'ix-board: authentication failed' } })
  await progress(w, [proj('A')])
  expect(knownBad(w)['project:A']).toMatchObject({ at_ms: entry.at_ms, error: 'old trouble' })
})

test('ten projects and no initiative are one call', async ($, on) => {
  trace("FR-026-AC-16")
  const w = world(on, true)
  const specs = many(10)
  const b = ix(w, { projects: byName(specs) })
  await progress(w, specs.map(p => proj(p.name)))
  expect(b.calls).toEqual([together(specs.map(p => p.name))])
})

test('initiatives cost the roadmap, one call each that the roadmap cannot place, and one call for the projects it lists', async ($, on) => {
  trace("FR-026-AC-24")
  const w = world(on, true)
  const b = ix(w, {
    roadmap: [{ name: 'Named', projects: [{ name: 'N1' }, { name: 'N2' }] }],
    initiatives: { [FSL]: [project('F1', 1, 2), project('F2', 1, 2)], [HARD]: [project('H1', 1, 2)] },
    projects: byName(['N1', 'N2', 'D1', 'D2', 'D3'].map(n => project(n, 1, 2))),
  })
  await progress(w, [initiative('Named'), initiative(FSL), initiative(HARD), proj('D1'), proj('D2'), proj('D3')])
  expect(b.calls.filter(c => c === 'roadmap')).toHaveLength(1)
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(2)
  expect(status(b).filter(c => c.includes('--project'))).toEqual([together(['D1', 'D2', 'D3', 'N1', 'N2'])])
  expect(b.calls).toHaveLength(4)
})

test('no more than 4 ix-board processes run at once across two focuses', async ($, on) => {
  trace("FR-026-AC-9", "NFR-004-M-6")
  const w = world(on, true)
  const tickets = (from: string): Selector[] => Array.from({ length: 6 }, (_, i) => ({ kind: 'ticket', ref: `${from}-${i}` }))
  const b = ix(w, { other: () => out(statusJson([project('Touched', 1, 4)])), delay: 1000 })
  const first = progress(w, tickets('QSL'))
  const second = progress(w, tickets('ENG'))
  await w.clock!.advance(10_000)
  await Promise.all([first, second])
  expect(b.live.max).toBe(4)
  expect(b.calls).toHaveLength(12)
})

test('a read of single tickets waits for one of the 4 ix-board places a refresh holds', async ($, on) => {
  trace("NFR-004-M-6")
  const w = world(on, true)
  const b = ix(w, { other: () => out(statusJson([project('Touched', 1, 4)])), delay: 1000 })
  const refresh = progress(w, Array.from({ length: 6 }, (_, i): Selector => ({ kind: 'ticket', ref: `QSL-${i}` })))
  await w.clock!.advance(500)
  expect(b.live.now).toBe(4)
  let isStarted = false
  const single = limited(async () => void (isStarted = true))
  await w.clock!.advance(100)
  expect(isStarted).toBe(false)
  await w.clock!.advance(10_000)
  await Promise.all([refresh, single])
  expect(isStarted).toBe(true)
})

test('a unit unanswered at the call timeout or at the budget fails alone and is not remembered', async ($, on) => {
  trace("FR-026-AC-25", "NFR-004-M-7")
  const w = world(on, true)
  ix(w, { projects: { A: project('A', 1, 2) }, other: (_, init) => hang(w)(init) })
  const shown = await progress(w, [proj('A'), { kind: 'ticket', ref: 'QSL-9' }], { advance: 21_000 })
  expect(shown.progress!.loose.map(p => [p.name, p.failed])).toEqual([['A', false], ['ticket QSL-9', true]])
  expect(shown.progress!.warnings).toEqual([{ kind: 'project', name: 'ticket QSL-9', text: 'timed out', id: null }])
  expect(w.files.has(KNOWN_BAD)).toBe(false)
  // A call that never returns at all: the refresh ends at its 60 seconds with the unit failed.
  const w2 = world(on, true)
  ix(w2, { projects: { A: project('A', 1, 2) }, other: () => new Promise<never>(() => undefined) })
  const stuck = await progress(w2, [proj('A'), { kind: 'ticket', ref: 'QSL-9' }], { advance: 61_000 })
  expect(stuck.progress!.warnings.map(x => x.text)).toEqual(['timed out'])
  expect(stuck.progress!.loose[0]).toMatchObject({ name: 'A', failed: false })
})

test('a lone project that fails with nothing to show it is at fault is a source error, held five minutes and not remembered', async ($, on) => {
  trace("FR-026-AC-26")
  const w = world(on, true)
  const b = ix(w, { projects: { P: 'bad data' }, other: chunks })
  const shown = await progress(w, [proj('P')])
  expect(shown.progress!.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'bad data', id: null }])
  expect(w.files.has(KNOWN_BAD)).toBe(false)
  await w.clock!.advance(4 * MIN)
  await progress(w, [proj('P')])
  expect(b.calls).toHaveLength(1)
  await w.clock!.advance(2 * MIN)
  await progress(w, [proj('P')])
  expect(b.calls).toEqual([together(['P']), together(['P'])])
})

for (const [layout, failing] of [
  ['in one half', [1, 3]],
  ['one in each half', [1, 5]],
] as const)
  test(`two bad projects ${layout} refused in the same words are both found, the others drawn and the two remembered`, async ($, on) => {
    trace("FR-026-AC-27")
    const w = world(on, true)
    const specs = many(8)
    const bad = failing.map(i => `Proj ${i}`)
    const named = (args: string[]) => out(JSON.stringify({ identifier: args[1], name: args[1] }))
    const b = ix(w, { projects: { ...byName(specs), ...Object.fromEntries(bad.map(n => [n, 'bad data'])) }, other: named })
    const shown = await progress(w, specs.map(p => proj(p.name)))
    expect(status(b).length).toBeLessThanOrEqual(1 + 12)
    expect(shown.progress!.loose.filter(r => !r.failed)).toHaveLength(6)
    expect(shown.progress!.warnings.map(x => x.kind)).toEqual(['project', 'project'])
    expect(Object.keys(knownBad(w)).sort()).toEqual(bad.map(n => `project:${n}`).sort())
    // The refresh is kept for the whole interval, and the next one is one call for the healthy ones.
    await w.clock!.advance(31 * MIN)
    const from = b.calls.length
    await progress(w, specs.map(p => proj(p.name)))
    expect(b.calls.slice(from)).toEqual([together(specs.map(p => p.name).filter(n => !bad.includes(n)))])
  })

test('a search in which no status call answers, in words that differ, is a source error: nothing is remembered and it is asked again after five minutes', async ($, on) => {
  trace("FR-026-AC-28")
  const w = world(on, true)
  const refs = many(4).map(p => p.name)
  const b = ix(w, { projects: Object.fromEntries(refs.map(r => [r, `broke ${r.slice(-1)}`])), other: chunks })
  const shown = await progress(w, refs.map(proj))
  expect(shown.progress!.warnings.map(x => x.kind)).toEqual(['source'])
  expect(w.files.has(KNOWN_BAD)).toBe(false)
  expect(b.calls.filter(c => c.startsWith('project-chunk'))).toEqual([])
  const first = b.calls.length
  await w.clock!.advance(4 * MIN)
  await progress(w, refs.map(proj))
  expect(b.calls).toHaveLength(first)
  await w.clock!.advance(2 * MIN)
  await progress(w, refs.map(proj))
  expect(b.calls.length).toBeGreaterThan(first)
})

test('one project whose ready count is unknown leaves the initiative and header Ready unknown, and no record says 0', async ($, on) => {
  trace("FR-023-AC-10")
  const w = world(on, true)
  const twin = [pid('Twin one'), pid('Twin two')] as const
  const solo = pid('Solo')
  ix(w, {
    roadmap: [{ name: 'A', projects: [{ name: 'Twin', id: twin[0] }, { name: 'Twin', id: twin[1] }, { name: 'Solo', id: solo }] }],
    projects: { [twin[0]]: project('Twin', 1, 4, { id: twin[0], ready: 2 }), [twin[1]]: project('Twin', 1, 4, { id: twin[1], ready: 1 }), [solo]: project('Solo', 1, 2, { id: solo, ready: 1 }) },
  })
  const p = (await progress(w, [initiative('A')])).progress!
  expect(p.initiatives[0]!.projects.map(x => x.ready)).toEqual([null, null, 1])
  expect(p.initiatives[0]!.ready).toBeNull()
  expect(p.header!.ready).toBeNull()
  expect(saved(w)[`project:${twin[0]}`]).toBeDefined()
  expect('ready' in saved(w)[`project:${twin[0]}`]).toBe(false)
  expect(saved(w)[`project:${solo}`]).toMatchObject({ ready: 1 })
  // The record without a ready count is read back and drawn as unknown, not as 0.
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'Twin', id: twin[0] }] }], projects: { [twin[0]]: 'ix-board: authentication failed' } })
  const old = (await progress(w, [proj(twin[0])], { manual: true, advance: 0 })).progress!
  expect(old.loose[0]).toMatchObject({ old: true, ready: null })
  expect(old.header!.ready).toBeNull()
})

test('a write of the gate file drops what was not read for a day and old 0.7.0 keys not written for an hour, and replaces the file whole', async ($, on) => {
  trace("FR-015-AC-5", "FR-015-AC-6")
  const w = world(on, true)
  const GATE = `${FP}/linear-gate.json`
  const entry = (ago: number) => ({ at: T0 - ago, claimAt: null, data: null })
  w.files.set(GATE, JSON.stringify({ backoffUntil: null, entries: {
    'agents:OLD': entry(25 * 60 * MIN),
    'agents:LATE': entry(23 * 60 * MIN),
    'progress:never': { at: null, claimAt: null, data: null },
    'focus:--project dead': entry(61 * MIN),
    'focus:--project live': entry(10 * MIN),
  } }))
  ix(w, { projects: { A: project('A', 1, 2) } })
  await progress(w, [proj('A')])
  expect(Object.keys(JSON.parse(w.files.get(GATE)!).entries).sort()).toEqual(['agents:LATE', 'focus:--project live', 'progress:project:A'])
  expect(w.writes).not.toContain(GATE)
  expect(w.ran.filter(l => l.startsWith('mv -f ') && l.endsWith(` ${GATE}`)).length).toBeGreaterThan(0)
  expect([...w.files.keys()].filter(k => k.endsWith('.tmp'))).toEqual([])
  // A rename that fails leaves the file as it was.
  const before = w.files.get(GATE)
  w.mvFails.value = true
  await w.clock!.advance(31 * MIN)
  await progress(w, [proj('A')])
  expect(w.files.get(GATE)).toBe(before)
  expect([...w.files.keys()].filter(k => k.endsWith('.tmp'))).toEqual([])
})

test('ix-board missing is one ix-board error and no further call in that refresh', async ($, on) => {
  trace("FR-026-AC-3")
  const w = world(on, true)
  const b = ix(w, { projects: { A: () => Promise.reject(new Error('spawn ix-board ENOENT')), B: project('B', 1, 2) } })
  const shown = await progress(w, ['A', 'B'].map(proj))
  expect(shown.progress!.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'spawn ix-board ENOENT', id: null }])
  expect(b.calls).toHaveLength(1)
})

test('a call that times out before anything answered is one ix-board error and no further call', async ($, on) => {
  trace("FR-026-AC-4", "NFR-004-M-4")
  const w = world(on, true)
  const timeouts: (number | undefined)[] = []
  const stuck = (init: { timeoutMs?: number } | undefined) => (timeouts.push(init?.timeoutMs), hang(w)(init))
  const refs = ['A', 'B', 'C']
  const b = ix(w, { projects: Object.fromEntries(refs.map(r => [r, stuck])) })
  const shown = await progress(w, refs.map(proj), { advance: 21_000 })
  expect(timeouts.every(t => t === 20_000)).toBe(true)
  expect(shown.progress!.warnings).toHaveLength(1)
  expect(shown.progress!.warnings[0]).toMatchObject({ kind: 'source', name: 'ix-board' })
  expect(shown.progress!.warnings[0]!.text).toMatch(/timed out/)
  expect(b.calls).toHaveLength(1)
})

test('an authentication failure is one ix-board error and no further call', async ($, on) => {
  trace("FR-026-AC-5")
  const w = world(on, true)
  const b = ix(w, { projects: Object.fromEntries(['A', 'B'].map(r => [r, 'ix-board: authentication failed'])) })
  const shown = await progress(w, ['A', 'B'].map(proj))
  expect(shown.progress!.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'ix-board: authentication failed', id: null }])
  expect(b.calls).toHaveLength(1)
})

test('a Linear rate limit is one ix-board error, makes no further call, and no call is made for its 60 seconds', async ($, on) => {
  trace("FR-026-AC-6")
  const w = world(on, true)
  const b = ix(w, { projects: Object.fromEntries(['A', 'B'].map(r => [r, 'Linear rate limited; retry in 60s'])) })
  const sels = ['A', 'B'].map(proj)
  const shown = await progress(w, sels)
  expect(shown.progress!.warnings).toHaveLength(1)
  expect(shown.progress!.warnings[0]!.kind).toBe('source')
  expect(b.calls).toHaveLength(1)
  await w.clock!.advance(30_000)
  const paused = await progress(w, sels, { manual: true })
  expect(b.calls).toHaveLength(1)
  expect(paused.progress!.warnings[0]!.text).toMatch(/paused/)
  await w.clock!.advance(31_000)
  await progress(w, sels, { manual: true })
  expect(b.calls.length).toBeGreaterThan(1)
})

test('a project renamed since its record was written is matched by the id of the answer, the record is replaced and the row shows the new name', async ($, on) => {
  trace("FR-026-AC-11")
  const w = world(on, true)
  const id = pid('P')
  seed(w, { [`project:${id}`]: record({ id, name: 'Old name', at_ms: T0 - 20 * MIN }) })
  ix(w, { projects: { [id]: project('New name', 3, 4, { id }) } })
  const shown = await progress(w, [proj(id)])
  expect(shown.progress!.loose[0]).toMatchObject({ name: 'New name', old: false, done: 3 })
  expect(saved(w)[`project:${id}`]).toMatchObject({ name: 'New name', done: 3 })
  expect(Object.keys(saved(w)).filter(k => k.startsWith('project:'))).toHaveLength(1)
})

test('two projects with the same name and ids from the roadmap are called by id and counted separately, and without ids the ambiguous name fails its row', async ($, on) => {
  trace("FR-026-AC-12")
  const w = world(on, true)
  const [a, b2] = [pid('twin-a'), pid('twin-b')]
  ix(w, { roadmap: [{ name: 'A', id: FSL, projects: [{ name: 'Twin', id: a }, { name: 'Twin', id: b2 }] }], projects: { [a]: project('Twin', 1, 4, { id: a }), [b2]: project('Twin', 2, 6, { id: b2 }) } })
  const shown = await progress(w, [initiative(FSL)])
  expect(shown.progress!.initiatives[0]).toMatchObject({ counted: 2, enumerated: 2, done: 3, total: 10 })
  const w2 = world(on, true)
  const text = 'project name Twin is ambiguous: matches 2 projects'
  ix(w2, { roadmap: [{ name: 'A', projects: [{ name: 'Twin' }, { name: 'Twin' }, { name: 'Solo' }] }], projects: { Twin: text, Solo: project('Solo', 1, 2) } })
  const amb = await progress(w2, [initiative('A')])
  expect(amb.progress!.warnings.map(x => x.text)).toEqual([text])
  expect(amb.progress!.initiatives[0]!.counted).toBe(1)
})

// ---------------------------------------------------------------- FR-021 membership that costs no calls

test('a remembered membership is used with no roadmap or initiative call for six hours, and asked again after them or by hand', async ($, on) => {
  trace("FR-021-AC-12")
  const w = world(on, true)
  const specs = many(2)
  const b = ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: { ...byName(specs), ...byId(specs) } })
  await progress(w, [initiative('A')])
  expect(b.calls).toEqual(['roadmap', together(['Proj 1', 'Proj 2'])])
  await w.clock!.advance(31 * MIN)
  await progress(w, [initiative('A')])
  expect(b.calls.slice(2)).toEqual([together(ids(specs).map(p => p.id))])
  await w.clock!.advance(6 * 60 * MIN)
  await progress(w, [initiative('A')])
  expect(b.calls.slice(3)).toEqual(['roadmap', together(['Proj 1', 'Proj 2'])])
  await w.clock!.advance(2 * MIN)
  await progress(w, [initiative('A')], { manual: true })
  expect(b.calls.slice(5)).toEqual(['roadmap', together(['Proj 1', 'Proj 2'])])
})

test('two focuses that need the roadmap within 30 minutes read it once', async ($, on) => {
  trace("FR-021-AC-14")
  const w = world(on, true)
  const b = ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'P' }] }, { name: 'B', projects: [{ name: 'Q' }] }], projects: byName([project('P', 1, 2), project('Q', 1, 2)]) })
  await progress(w, [initiative('A')])
  await w.clock!.advance(5 * MIN)
  const second = await progress(w, [initiative('B')])
  expect(b.calls.filter(c => c === 'roadmap')).toHaveLength(1)
  expect(second.progress!.initiatives[0]).toMatchObject({ counted: 1 })
})

// ---------------------------------------------------------------- the file (FR-017)

test('one malformed entry is ignored alone and the valid ones are used', async () => {
  trace("FR-017-AC-7")
  const good = record()
  const parsed = parseRecords(JSON.stringify({ 'project:C': good, 'project:D': { at_ms: 'x' }, 'ticket:T': null, 'project:E': { ...good, total: -1 }, 'project:F': { ...good, done: 1 } }))
  expect(Object.keys(parsed).sort()).toEqual(['project:C', 'project:F'])
  for (const bad of ['[1,2]', '"x"', '', 'null', '7', '{ not json']) expect(parseFile(bad)).toEqual({ records: {}, initiatives: {} })
})

test('a record whose time is in the future has an age of zero, and 60 minutes is not stale while 60 minutes 1 second is', async () => {
  trace("FR-017-AC-8", "FR-017-AC-4")
  expect(ageOf({ at_ms: T0 + 10 * MIN }, T0)).toBe(0)
  expect(STALE_MS).toBe(60 * MIN)
  expect(ageOf({ at_ms: T0 - 60 * MIN }, T0) > STALE_MS).toBe(false)
  expect(ageOf({ at_ms: T0 - 60 * MIN - 1000 }, T0) > STALE_MS).toBe(true)
})

test('a record another process wrote in between is kept by the merge, and an interrupted write leaves the previous file intact', async ($, on) => {
  trace("FR-017-AC-9")
  const w = world(on, true)
  seed(w, { 'project:E': record({ at_ms: T0 - 2 * MIN, done: 5 }) })
  const merged = await saveRecords(fake$(w) as never, T0, { 'project:C': record({ at_ms: T0, seen_ms: T0, done: 3 }) })
  expect(Object.keys(merged).sort()).toEqual(['project:C', 'project:E'])
  expect(w.writes.some(p => p.startsWith(`${PROGRESS}.`) && p.endsWith('.tmp'))).toBe(true)
  expect(w.ran).toContain(`mv -f ${w.writes.at(-1)} ${PROGRESS}`)
  const both = mergeRecords({ 'project:C': record({ at_ms: 100, seen_ms: 900, done: 1 }) }, { 'project:C': record({ at_ms: 500, seen_ms: 400, done: 2 }) })
  expect(both['project:C']).toMatchObject({ at_ms: 500, seen_ms: 900, done: 2 })
  const before = w.files.get(PROGRESS)
  w.mvFails.value = true
  await saveRecords(fake$(w) as never, T0, { 'project:Z': record({ at_ms: T0, seen_ms: T0 }) })
  expect(w.files.get(PROGRESS)).toBe(before)
})

test('a record unseen for 24 hours 1 minute is removed at the next write, 23 hours stays, and an old at_ms with a current seen_ms stays', async ($, on) => {
  trace("FR-017-AC-10")
  const w = world(on, true)
  seed(w, { 'project:gone': record({ seen_ms: T0 - PRUNE_MS - MIN }), 'project:kept': record({ seen_ms: T0 - 23 * 60 * MIN }), 'project:old-but-seen': record({ at_ms: T0 - 40 * 60 * MIN, seen_ms: T0 }) })
  await saveRecords(fake$(w) as never, T0, {})
  expect(Object.keys(saved(w)).sort()).toEqual(['project:kept', 'project:old-but-seen'])
  expect(Object.keys(prune({ a: record({ seen_ms: T0 - PRUNE_MS }) }, T0))).toEqual(['a'])
})

test('a malformed progress.json draws without a file error and the next success writes a valid file', async ($, on) => {
  trace("FR-017-AC-6")
  const w = world(on, true)
  w.files.set(PROGRESS, '{ not json')
  ix(w, { projects: { P: project('P', 3, 4) } })
  const shown = await progress(w, [proj('P')])
  expect(shown.progress!.warnings).toEqual([])
  expect(saved(w)[`project:${pid('P')}`]).toMatchObject({ done: 3, total: 4 })
})

test('after a failure a successful refresh shows the new progress with no old mark and a record with the new time', async ($, on) => {
  trace("FR-017-AC-3")
  const w = world(on, true)
  const id = pid('C')
  seed(w, { [`project:${id}`]: record({ id, name: 'C' }) })
  let healthy = false
  ix(w, { projects: { C: () => (healthy ? out(statusJson([project('C', 15, 20)])) : out('', 4, 'bad data')) } })
  const bad = await progress(w, [proj('C')])
  expect(bad.progress!.loose[0]!.old).toBe(true)
  healthy = true
  await w.clock!.advance(31 * MIN)
  const good = await progress(w, [proj('C')])
  expect(good.progress!.loose[0]).toMatchObject({ old: false, done: 15 })
  expect(saved(w)[`project:${id}`]).toMatchObject({ done: 15, total: 20 })
  expect(saved(w)[`project:${id}`].at_ms).toBeGreaterThan(T0)
})

test('a result older than the record another process wrote meanwhile is ignored', async ($, on) => {
  trace("FR-016-AC-10")
  const w = world(on, true)
  const id = pid('A')
  const newer = record({ id, name: 'A', at_ms: T0 + 60_000, seen_ms: T0 + 60_000, done: 9, total: 9, inProgress: 0, ready: 0 })
  ix(w, { projects: { A: () => w.clock!.sleep(3000).then(() => { seed(w, { [`project:${id}`]: newer }); return out(statusJson([project('A', 1, 2)])) }) } })
  const shown = await progress(w, [proj('A')], { advance: 4000 })
  expect(shown.progress!.loose[0]).toMatchObject({ done: 9, total: 9, old: false })
  expect(saved(w)[`project:${id}`].done).toBe(9)
})

test('the compose of a source failure draws every project from its record and counts the source error once', () => {
  trace("FR-018-AC-1")
  const sels: Selector[] = [proj(pid('A')), proj(pid('B'))]
  const refresh: Refresh | null = null
  const composed = compose(sels, refresh, 'ix-board: authentication failed', { records: { [`project:${pid('A')}`]: { ...record({ id: pid('A'), name: 'A', at_ms: T0 - MIN }) } as never }, initiatives: {} }, T0)
  expect(composed.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'ix-board: authentication failed', id: null }])
  expect(composed.loose.map(p => [p.old, p.failed])).toEqual([[true, false], [false, true]])
})

// ---------------------------------------------------------------- the lead's real scope

const REAL_SCOPE = { initiatives: [HARD, FSL], projects: ['bf1b90a0-e8b2-4ec8-8c29-933eaa936545', 'ccc8bf91-cba4-4ddc-b436-6afa1c4ca9b6'] }
const alpha = project('FSL alpha release', 37, 43, { id: REAL_SCOPE.projects[0]!, ready: 1, layers: { open: 1, completed: 5 } })
const hardening = project('QSL Production Hardening', 20, 28, { id: REAL_SCOPE.projects[1]!, ready: 2, layers: { open: 2, completed: 3 } })
const fslProjects = [project('FSL architecture and design holding', 0, 6), project('FSL single analysis route', 3, 26), project('FSL held features', 0, 5)]
const realWorld = (w: ReturnType<typeof world>) =>
  ix(w, {
    roadmap: [{ name: 'FSL Hardening', projects: [{ name: 'X' }] }],
    initiatives: { [FSL]: fslProjects, [HARD]: BAD_MILESTONE },
    projects: { [REAL_SCOPE.projects[0]!]: alpha, [REAL_SCOPE.projects[1]!]: hardening },
  })

test('the lead scope of two initiatives and two projects counts every project in the header, names the direct ones, and labels the failed initiative by its short id', async ($, on) => {
  trace("FR-022-AC-8", "FR-022-AC-11", "FR-025-AC-1")
  const w = world(on, true)
  const b = realWorld(w)
  // The records an older build wrote carry no name.
  seed(w, { [`project:${REAL_SCOPE.projects[0]}`]: record({ at_ms: T0 - 13 * MIN }), [`project:${REAL_SCOPE.projects[1]}`]: record({ at_ms: T0 - 13 * MIN }) })
  const shown = await progress(w, selectorsOfScope(REAL_SCOPE))
  const p = shown.progress!
  // One call, `ix-board --json focus status --project <uuid> --project <uuid>`, for the direct projects.
  expect(w.ran).toContain(`ix-board --json ${together(REAL_SCOPE.projects)}`)
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toHaveLength(1)
  expect(p.initiatives.map(i => [i.name, i.failed])).toEqual([['initiative 674ffba8', 'projects unknown'], ['initiative efb47f87', null]])
  expect(p.loose.map(x => [x.name, x.done, x.total, x.old])).toEqual([['FSL alpha release', 37, 43, false], ['QSL Production Hardening', 20, 28, false]])
  expect(p.header).toMatchObject({ done: 37 + 20 + 3, total: 43 + 28 + 37, counted: 5, enumerated: 5, notExpanded: 1, partial: true })
  expect(p.warnings.map(x => x.kind)).toEqual(['initiative'])
  // The names are kept in the records, so a later failure still shows them.
  expect(saved(w)[`project:${REAL_SCOPE.projects[0]}`].name).toBe('FSL alpha release')
})

test('a project whose live call fails later is drawn by the name its record keeps, marked old', async ($, on) => {
  trace("FR-025-AC-2")
  const w = world(on, true)
  realWorld(w)
  await progress(w, selectorsOfScope(REAL_SCOPE))
  const w2 = world(on, true)
  w2.files.set(PROGRESS, w.files.get(PROGRESS)!)
  ix(w2, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'X' }] }], initiatives: { [FSL]: BAD_MILESTONE, [HARD]: BAD_MILESTONE }, projects: { [REAL_SCOPE.projects[0]!]: 'timed out', [REAL_SCOPE.projects[1]!]: 'timed out' } })
  const p = (await progress(w2, selectorsOfScope(REAL_SCOPE))).progress!
  expect(p.loose.map(x => [x.name, x.old, x.done])).toEqual([['FSL alpha release', true, 37], ['QSL Production Hardening', true, 20]])
  // The failed initiatives have a name only where one is known: the cached membership has none for them here.
  expect(p.initiatives.map(i => i.failed)).toEqual(['projects unknown', null])
  expect(p.initiatives[1]!.projects.map(x => x.name)).toEqual(fslProjects.map(x => x.name))
})

test('an initiative name learned from the roadmap is kept in the cache and shown when the initiative call later fails', async ($, on) => {
  trace("FR-025-AC-7")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'FSL Completion', projects: fslProjects.map(p => ({ name: p.name })) }], initiatives: { [FSL]: fslProjects } })
  await progress(w, [initiative(FSL)])
  expect(saved(w).initiatives[FSL].name).toBe('FSL Completion')
  const w2 = world(on, true)
  w2.files.set(PROGRESS, w.files.get(PROGRESS)!)
  ix(w2, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'X' }] }], initiatives: { [FSL]: BAD_MILESTONE }, projects: Object.fromEntries(fslProjects.map(p => [pid(p.name), BAD_MILESTONE])) })
  const p = (await progress(w2, [initiative(FSL)])).progress!
  expect(p.initiatives[0]).toMatchObject({ name: 'FSL Completion', failed: null })
})

test('a direct project whose status call fails is named by project-chunk, shown failed with its name and no counts, and the name is kept for later failures', async ($, on) => {
  trace("FR-026-AC-18", "FR-025-AC-3")
  const w = world(on, true)
  const [a, b2] = REAL_SCOPE.projects as [string, string]
  const chunk = (name: string, id: string) => out(JSON.stringify({ blocker_layers: [[]], goal: 'a goal', identifier: id, milestones: [], name, open_tickets: [] }))
  const b = ix(w, {
    projects: { [a]: dangling(a), [b2]: dangling(b2) },
    other: args => (args[0] === 'project-chunk' ? (args[1] === a ? chunk('FSL alpha release', a) : chunk('QSL Production Hardening', b2)) : out('', 1, 'not stubbed')),
  })
  const shown = await progress(w, [proj(a), proj(b2)])
  expect([...b.calls].sort()).toEqual([together([a, b2]), together([b2]), `project-chunk ${a}`, `project-chunk ${b2}`].sort())
  expect(shown.progress!.loose.map(p => [p.name, p.failed, p.id])).toEqual([['FSL alpha release', true, a], ['QSL Production Hardening', true, b2]])
  expect(shown.progress!.warnings.map(x => x.name)).toEqual(['FSL alpha release', 'QSL Production Hardening'])
  expect(saved(w)[`project:${a}`]).toMatchObject({ name: 'FSL alpha release', unknown: true, total: 0 })
  // A later failure knows the name already: no project-chunk call, and the name-only record draws no counts.
  await w.clock!.advance(31 * MIN)
  const again = await progress(w, [proj(a), proj(b2)], { manual: true })
  expect(b.calls.filter(c => c.startsWith('project-chunk'))).toHaveLength(2)
  expect(again.progress!.loose.map(p => [p.name, p.failed, p.old])).toEqual([['FSL alpha release', true, false], ['QSL Production Hardening', true, false]])
  expect(again.progress!.header).toBeNull()
})

test('a success after a name-only record replaces it with counts, and a name-only record never replaces counts', async ($, on) => {
  trace("FR-025-AC-1")
  const w = world(on, true)
  const [a] = REAL_SCOPE.projects as [string, string]
  seed(w, { [`project:${a}`]: record({ unknown: true, id: a, name: 'FSL alpha release', done: 0, total: 0, at_ms: T0 - MIN }) })
  ix(w, { projects: { [a]: alpha } })
  await progress(w, [proj(a)])
  expect(saved(w)[`project:${a}`]).toMatchObject({ done: 37, total: 43 })
  expect(saved(w)[`project:${a}`].unknown).toBeUndefined()
  const w2 = world(on, true)
  seed(w2, { [`project:${a}`]: record({ id: a, name: 'FSL alpha release', at_ms: T0 - 30 * MIN }) })
  ix(w2, { projects: { [a]: 'timed out' }, other: () => out(JSON.stringify({ name: 'FSL alpha release', identifier: a })) })
  const p = (await progress(w2, [proj(a)])).progress!
  expect(p.loose[0]).toMatchObject({ old: true, done: 10, name: 'FSL alpha release' })
  expect(saved(w2)[`project:${a}`].unknown).toBeUndefined()
})

// ---------------------------------------------------------------- rule 4c: the initiative named by the failing project

const STABILITY = 'FSL stability: red main and blowups'
const HARDENING_PROJECTS = ['FSL engine cross-checks', 'FSL example findings', 'FSL fuzz and mutation targets (later)', 'FSL L3: CLI contract tests', 'FSL L4: user journey tests', 'FSL L5: agent journey evals', 'FSL probability engine completion', 'FSL proof gate', 'FSL property tests', 'FSL protocol forms and partial-order reduction', 'FSL refinement, hyperproperties and composition', 'FSL residual language, checker and replay defects', 'FSL source-level program corpus', STABILITY, 'FSL standard conformance against the compiler', 'FSL test and gate trustworthiness', 'FSL timed, clock and hybrid forms', 'FSL untested requirements and catalogues']
const chunkOf = (name: string) => out(JSON.stringify({ blocker_layers: [[]], goal: 'a goal', identifier: BAD, milestones: [], name, open_tickets: [] }))

test('a failing initiative call that names a project, with no cache, takes the one roadmap initiative that lists that project, expands to its 18 projects by name, fails the named one alone and keeps the guess for an hour', async ($, on) => {
  trace("FR-021-AC-10", "FR-021-AC-13")
  const w = world(on, true)
  const specs = HARDENING_PROJECTS.map((n, i) => project(n, i + 1, 40))
  const b = ix(w, {
    roadmap: [{ name: 'FSL Hardening', projects: HARDENING_PROJECTS.map(name => ({ name })) }, { name: 'FSL Completion', projects: [{ name: 'Other' }] }],
    initiatives: { [HARD]: BAD_MILESTONE },
    projects: { ...byName(specs), [STABILITY]: BAD_MILESTONE },
    other: args => (args[0] === 'project-chunk' && args[1] === BAD ? chunkOf(STABILITY) : out('', 1, 'not stubbed')),
  })
  const shown = await progress(w, [initiative(HARD)])
  const i = shown.progress!.initiatives[0]!
  expect(i).toMatchObject({ name: 'FSL Hardening', failed: null, enumerated: 18, counted: 17, partial: true })
  expect(i.projects.find(p => p.failed)!.name).toBe(STABILITY)
  const rest = HARDENING_PROJECTS.filter(n => n !== STABILITY)
  expect(b.calls).toEqual(['roadmap', `focus status --initiative ${HARD}`, `project-chunk ${BAD}`, together(HARDENING_PROJECTS), together(rest)])
  expect(shown.progress!.warnings.map(x => x.name)).toEqual([STABILITY])
  // The identity is a guess: it is not stored as membership. It is kept with the known-bad initiative for an hour.
  expect(saved(w).initiatives?.[HARD]).toBeUndefined()
  await w.clock!.advance(31 * MIN)
  const again = await progress(w, [initiative(HARD)])
  expect(b.calls.slice(5)).toEqual([together(rest)])
  expect(again.progress!.initiatives[0]).toMatchObject({ name: 'FSL Hardening', enumerated: 18, counted: 17 })
  expect(again.progress!.warnings.map(x => x.name)).toEqual([STABILITY])
  expect(saved(w).initiatives?.[HARD]).toBeUndefined()
  await w.clock!.advance(31 * MIN)
  await progress(w, [initiative(HARD)])
  expect(b.calls.slice(6)).toContain(`focus status --initiative ${HARD}`)
  expect(b.calls.slice(6)).toContain(together([STABILITY]))
})

test('with two roadmap initiatives that list the project, or none, the failing initiative is projects unknown', async ($, on) => {
  trace("FR-021-AC-11")
  const w = world(on, true)
  ix(w, {
    roadmap: [{ name: 'FSL Hardening', projects: [{ name: STABILITY }] }, { name: 'Another', projects: [{ name: STABILITY }] }],
    initiatives: { [HARD]: BAD_MILESTONE },
    other: args => (args[0] === 'project-chunk' ? chunkOf(STABILITY) : out('', 1, 'not stubbed')),
  })
  expect((await progress(w, [initiative(HARD)])).progress!.initiatives[0]).toMatchObject({ failed: 'projects unknown' })
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, other: args => (args[0] === 'project-chunk' ? chunkOf(STABILITY) : out('', 1, 'not stubbed')) })
  expect((await progress(w2, [initiative(HARD)])).progress!.initiatives[0]).toMatchObject({ failed: 'projects unknown' })
})

// ---------------------------------------------------------------- review rulings

test('a ticket identifier such as QSL-403 in an error is no source error, and a call with no stderr text fails alone', async ($, on) => {
  trace("FR-016-AC-17")
  const w = world(on, true)
  const text = 'issue QSL-403 references unavailable milestone m1 in project p1'
  const b = ix(w, { projects: { A: text, B: project('B', 1, 2), C: () => out('stdout says why', 1, ''), D: () => out('', 3, ''), E: project('E', 1, 2) } })
  const shown = await progress(w, ['A', 'B', 'C', 'D', 'E'].map(proj))
  const p = shown.progress!
  expect(p.warnings.every(x => x.kind === 'project')).toBe(true)
  expect(p.warnings.map(x => x.text).sort()).toEqual([text, 'stdout says why', 'ix-board exited 3'].sort())
  expect(b.calls.filter(c => c.startsWith('focus status')).length).toBeLessThanOrEqual(1 + 12)
  expect(p.loose.filter(x => !x.failed).map(x => x.name)).toEqual(['B', 'E'])
})

test('the first call timing out is one source error, and a call for one thing timing out after another answered is only that thing', async ($, on) => {
  trace("FR-016-AC-16")
  const w = world(on, true)
  ix(w, { projects: { A: hang(w), B: hang(w) } })
  const first = await progress(w, [proj('A'), proj('B')], { advance: 21_000 })
  expect(first.progress!.warnings.map(x => x.kind)).toEqual(['source'])
  const w2 = world(on, true)
  ix(w2, { projects: { A: project('A', 1, 2) }, other: (_, init) => hang(w2)(init) })
  const second = await progress(w2, [proj('A'), { kind: 'ticket', ref: 'QSL-9' }], { advance: 21_000 })
  expect(second.progress!.warnings.map(x => [x.kind, x.text])).toEqual([['project', 'timed out']])
})

test('two direct projects of the same name and different ids both show, and a direct project is hidden from the loose rows by name only when its id is unknown', async ($, on) => {
  trace("FR-026-AC-12")
  const w = world(on, true)
  const [a, b2] = [pid('twin-a'), pid('twin-b')]
  ix(w, { projects: { [a]: project('Twin', 1, 4, { id: a }), [b2]: project('Twin', 2, 6, { id: b2 }) } })
  const p = (await progress(w, [proj(a), proj(b2)])).progress!
  expect(p.loose.map(x => x.id)).toEqual([a, b2])
  expect(p.header).toMatchObject({ counted: 2, enumerated: 2, done: 3, total: 10 })
  // Another project of the same name in an initiative does not hide a direct project whose id is known.
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'A', projects: [{ name: 'Twin' }] }], projects: { Twin: project('Twin', 1, 4, { id: a }), [b2]: project('Twin', 2, 6, { id: b2 }) } })
  const q = (await progress(w2, [initiative('A'), proj(b2)])).progress!
  expect(q.loose.map(x => x.id)).toEqual([b2])
})

test('a rule 4c guess is not made when two initiatives hold the project, when the holder is itself selected, or when also_in adds a holder', async ($, on) => {
  trace("FR-021-AC-11")
  const chunk = (args: string[]) => (args[0] === 'project-chunk' ? chunkOf(STABILITY) : out('', 1, 'not stubbed'))
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'FSL Hardening', projects: [{ name: STABILITY }] }, { name: 'Other', projects: [{ name: 'X' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { [STABILITY]: project(STABILITY, 1, 2) }, other: chunk })
  // The holder is itself selected by name.
  expect((await progress(w, [initiative(HARD), initiative('FSL Hardening')])).progress!.initiatives[0]).toMatchObject({ failed: 'projects unknown' })
  // A second holder through also_in.
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'FSL Hardening', projects: [{ name: STABILITY, also_in: ['Another'] }] }, { name: 'Another', projects: [{ name: 'Y' }] }], initiatives: { [HARD]: BAD_MILESTONE }, other: chunk })
  expect((await progress(w2, [initiative(HARD)])).progress!.initiatives[0]).toMatchObject({ failed: 'projects unknown' })
})

test('an initiative from an initiative call is named only when exactly one roadmap initiative has the very projects of the answer', async ($, on) => {
  trace("FR-021-AC-3")
  const specs = [project('P1', 1, 2), project('P2', 1, 2)]
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'One', projects: [{ name: 'P1' }, { name: 'P2' }] }], initiatives: { [FSL]: specs } })
  expect((await progress(w, [initiative(FSL)])).progress!.initiatives[0]!.name).toBe('One')
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'One', projects: [{ name: 'P1' }, { name: 'P2' }] }, { name: 'Two', projects: [{ name: 'P2' }, { name: 'P1' }] }], initiatives: { [FSL]: specs } })
  expect((await progress(w2, [initiative(FSL)])).progress!.initiatives[0]!.name).toBe('initiative efb47f87')
})

test('only an error about the initiative itself is initiative not found, and an initiative expanded from its memory adds no warning of its own', async ($, on) => {
  trace("FR-021-AC-7")
  const w = world(on, true)
  ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: 'project p9 not found' } })
  expect((await progress(w, [initiative(HARD)])).progress!.initiatives[0]!.failed).toBe('projects unknown')
  const w2 = world(on, true)
  const id = pid('P')
  seed(w2, { initiatives: { [HARD]: { at_ms: T0 - 7 * 60 * MIN, seen_ms: T0 - MIN, projects: [{ id, name: 'P' }] } } })
  ix(w2, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { [id]: project('P', 1, 2, { id }) } })
  const p = (await progress(w2, [initiative(HARD)])).progress!
  expect(p.initiatives[0]).toMatchObject({ failed: null, counted: 1 })
  expect(p.warnings).toEqual([])
})

test('the header counts projects only: a loose milestone or ticket row is drawn but not summed', async ($, on) => {
  trace("FR-022-AC-8")
  const w = world(on, true)
  ix(w, { projects: { P: project('P', 3, 6) }, other: () => out(statusJson([project('Touched', 1, 4)])) })
  const p = (await progress(w, [proj('P'), { kind: 'ticket', ref: 'QSL-9' }])).progress!
  expect(p.loose).toHaveLength(2)
  expect(p.header).toMatchObject({ done: 3, total: 6, counted: 1, enumerated: 1 })
})

test('a Linear rate limit keeps the projects answered before it, records them, and still holds every call', async ($, on) => {
  trace("FR-026-AC-6")
  const w = world(on, true)
  const slow = () => w.clock!.sleep(1000).then(() => out('', 4, 'Linear rate limited; retry in 60s'))
  ix(w, { projects: { A: project('A', 1, 2) }, other: slow })
  const shown = await progress(w, [proj('A'), { kind: 'ticket', ref: 'QSL-9' }], { advance: 2000 })
  expect(shown.progress!.loose.map(p => [p.name, p.failed])).toEqual([['A', false], ['ticket QSL-9', true]])
  expect(saved(w)[`project:${pid('A')}`]).toMatchObject({ done: 1, total: 2 })
  expect(shown.progress!.warnings.map(x => x.kind)).toEqual(['source'])
})

test('a project named by project-chunk through its name keeps a name-only record under the id, so it is not asked again', async ($, on) => {
  trace("FR-025-AC-3")
  const w = world(on, true)
  const id = pid('Named')
  const b = ix(w, { projects: { Named: 'bad data', Other: project('Other', 1, 2) }, other: args => (args[0] === 'project-chunk' ? out(JSON.stringify({ identifier: id, name: 'Named', goal: '', milestones: [], open_tickets: [], blocker_layers: [] })) : out('', 1, 'not stubbed')) })
  await progress(w, [proj('Named'), proj('Other')])
  expect(saved(w)[`project:${id}`]).toMatchObject({ name: 'Named', unknown: true })
  await w.clock!.advance(31 * MIN)
  await progress(w, [proj('Named'), proj('Other')], { manual: true })
  expect(b.calls.filter(c => c.startsWith('project-chunk'))).toHaveLength(1)
})

test('answers of a search level are drawn and recorded when another call of the level is rate limited', async ($, on) => {
  trace("FR-026-AC-6")
  const w = world(on, true)
  let asked = 0
  // C fails the combined call as a bad project would, and its half then meets the rate limit.
  const b = ix(w, { projects: { A: project('A', 1, 2), B: project('B', 2, 4), C: () => out('', 4, asked++ === 0 ? 'bad data' : 'Linear rate limited; retry in 60s'), D: project('D', 1, 4) } })
  const shown = await progress(w, ['A', 'B', 'C', 'D'].map(proj))
  expect(b.calls).toHaveLength(3)
  expect(shown.progress!.loose.map(p => [p.name, p.failed])).toEqual([['A', false], ['B', false], ['project C', true], ['project D', true]])
  expect(saved(w)[`project:${pid('A')}`]).toMatchObject({ done: 1, total: 2 })
  expect(saved(w)[`project:${pid('B')}`]).toMatchObject({ done: 2, total: 4 })
  expect(shown.progress!.warnings.map(x => x.kind)).toEqual(['source'])
})

test('an inferred source error that repeats is held twice as long each time to 30 minutes, r asks after 60 seconds, and an answer starts again', async ($, on) => {
  trace("FR-025-AC-14")
  const w = world(on, true)
  let healthy = false
  // Words that name no project, from the only call: nothing shows whose fault it is.
  const b = ix(w, { projects: { P: () => (healthy ? out(statusJson([project('P', 1, 2)])) : out('', 4, 'something went wrong')) } })
  const poll = (manual = false) => progress(w, [proj('P')], { manual })
  const after = async (ms: number, manual = false) => (await w.clock!.advance(ms), (await poll(manual), b.calls.length))
  await poll()
  expect(b.calls).toHaveLength(1)
  let calls = 1
  for (const hold of [5, 10, 20, 30, 30]) {
    expect(await after((hold - 1) * MIN)).toBe(calls)
    expect(await after(2 * MIN)).toBe(++calls)
  }
  const held = await poll()
  expect(held.progress!.notes.join(' ')).toMatch(/after 30 minutes, r asks after 60 seconds/)
  expect(await after(30_000, true)).toBe(calls)
  expect(await after(31_000, true)).toBe(++calls)
  healthy = true
  expect(await after(61_000, true)).toBe(++calls)
  // The answer is kept the usual 30 minutes; the next failure is held 5.
  healthy = false
  expect(await after(31 * MIN)).toBe(++calls)
  expect(await after(4 * MIN)).toBe(calls)
  expect(await after(2 * MIN)).toBe(++calls)
})
