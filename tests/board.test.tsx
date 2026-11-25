import { expect, test } from 'claude-code/testing'
import { trace } from './trace'

import { compose, selectorArgs, selectorsOfScope } from '../hooks/board'
import type { Refresh, Selector } from '../hooks/board'
import { PRUNE_MS, STALE_MS, ageOf, mergeInitiatives, mergeRecords, parseFile, parseRecords, prune, readFile, saveFile, saveRecords } from '../hooks/progress'
import { FP, BAD_MILESTONE, fake$, out, pid, roadmapJson, statusJson, world } from './world'
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

test('an initiative selected by name whose roadmap lists 18 projects makes one roadmap call and one project call each, and no initiative call', async ($, on) => {
  trace("FR-021-AC-1")
  const w = world(on, true)
  const specs = many(18)
  const b = ix(w, { roadmap: [{ name: 'FSL Hardening', projects: specs.map(p => ({ name: p.name })) }], projects: byName(specs) })
  const shown = await progress(w, [initiative('FSL Hardening')])
  expect(b.calls.filter(c => c === 'roadmap')).toHaveLength(1)
  expect(b.calls.filter(c => c.startsWith('focus status --project '))).toHaveLength(18)
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(0)
  expect(b.calls).toContain('focus status --project Proj 7')
  expect(shown.progress!.initiatives[0]!.enumerated).toBe(18)
  expect(shown.progress!.initiatives[0]!.counted).toBe(18)
})

test('a roadmap whose initiatives and projects carry ids matches an initiative selected by UUID and calls its projects by id', async ($, on) => {
  trace("FR-021-AC-2")
  const w = world(on, true)
  const specs = many(3)
  const b = ix(w, { roadmap: [{ name: 'FSL Hardening', id: FSL, projects: ids(specs) }], projects: byId(specs) })
  const shown = await progress(w, [initiative(FSL)])
  expect(b.calls.filter(c => c.startsWith('focus status'))).toEqual(specs.map(p => `focus status --project ${pid(p.name)}`))
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

test('a failing initiative call with a cached membership expands from the cache, calls each project by id and draws a failing one from its old record', async ($, on) => {
  trace("FR-021-AC-5")
  const w = world(on, true)
  const specs = many(2)
  const [a, b2] = [pid('Proj 1'), pid('Proj 2')]
  seed(w, {
    initiatives: { [HARD]: { at_ms: T0 - 10 * MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }, { id: b2, name: 'Proj 2' }] } },
    [`project:${b2}`]: record({ id: b2, name: 'Proj 2', done: 4, total: 8 }),
  })
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { [a]: specs[0]!, [b2]: 'Proj 2 is broken' } })
  const shown = await progress(w, [initiative(HARD)])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([`focus status --project ${a}`, `focus status --project ${b2}`])
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
  seed(w, { initiatives: { [HARD]: { at_ms: T0 - MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }] } } })
  const b = ix(w, { roadmap: out('', 1, 'roadmap read failed'), projects: { [a]: project('Proj 1', 1, 2) } })
  const shown = await progress(w, [initiative(HARD), initiative(FSL)])
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(0)
  expect(shown.progress!.initiatives.map(i => i.failed)).toEqual([null, 'projects unknown'])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([`focus status --project ${a}`])
  // A source error of the roadmap call stops everything.
  const w2 = world(on, true)
  seed(w2, { initiatives: { [HARD]: { at_ms: T0 - MIN, seen_ms: T0 - MIN, projects: [{ id: a, name: 'Proj 1' }] } } })
  const b2 = ix(w2, { roadmap: out('', 1, 'ix-board: authentication failed'), projects: { [a]: project('Proj 1', 1, 2) } })
  const shown2 = await progress(w2, [initiative(HARD)])
  expect(b2.calls).toEqual(['roadmap'])
  expect(shown2.progress!.warnings.map(x => x.kind)).toEqual(['source'])
})

test('an initiative failed as projects unknown and two projects listed directly call both projects and draw them with their counts', async ($, on) => {
  trace("FR-021-AC-9")
  const w = world(on, true)
  const b = ix(w, { roadmap: [{ name: 'Elsewhere', projects: [{ name: 'Other' }] }], initiatives: { [HARD]: BAD_MILESTONE }, projects: { P1: project('One', 1, 2), P2: project('Two', 2, 4) } })
  const shown = await progress(w, [initiative(HARD), proj('P1'), proj('P2')])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual(['focus status --project P1', 'focus status --project P2'])
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
  ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: Object.fromEntries(specs.map(p => [p.name, BAD_MILESTONE])) })
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
  ix(w, { projects: { E: project('E', 1, 2, { ready: 0, layers: { open: 0, completed: 0 } }), N: project('N', 1, 2, { ready: null, layers: null }) } })
  const p = (await progress(w, [proj('E'), proj('N')])).progress!
  expect(p.loose.map(x => [x.ready, x.blocked])).toEqual([[0, 0], [null, null]])
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
  trace("FR-025-AC-2", "FR-017-AC-2")
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

test('after a refresh with a failed project the polls of the next 5 minutes make no call, the first poll after asks again, and a manual refresh asks at once', async ($, on) => {
  trace("FR-025-AC-4")
  const w = world(on, true)
  let healthy = false
  const b = ix(w, { projects: { P: () => (healthy ? out(statusJson([project('P', 1, 2)])) : out('', 4, 'P is broken')), Q: project('Q', 1, 2) } })
  const sels = [proj('P'), proj('Q')]
  await progress(w, sels)
  expect(b.calls.filter(c => c.startsWith('focus status'))).toHaveLength(2)
  await w.clock!.advance(4 * MIN)
  const held = await progress(w, sels)
  expect(b.calls.filter(c => c.startsWith('focus status'))).toHaveLength(2)
  expect(held.progress!.notes.join(' ')).toMatch(/earlier outcome from 4m ago/)
  await w.clock!.advance(2 * MIN)
  await progress(w, sels)
  expect(b.calls.filter(c => c.startsWith('focus status'))).toHaveLength(4)
  // A manual refresh asks at once, while the failed outcome is held.
  await w.clock!.advance(MIN)
  await progress(w, sels, { manual: true })
  expect(b.calls.filter(c => c.startsWith('focus status'))).toHaveLength(6)
  healthy = true
  await w.clock!.advance(6 * MIN)
  const ok = await progress(w, sels)
  expect(b.calls.filter(c => c.startsWith('focus status'))).toHaveLength(8)
  expect(ok.progress!.warnings).toHaveLength(0)
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
  expect(p.loose.map(x => [x.name, x.old, x.done])).toEqual([[`project ${id.slice(0, 8)}`.length > 0 ? p.loose[0]!.name : '', true, 10], ['project Payments', false, 0]])
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
    initiatives: { [HARD]: { at_ms: T0 - 10 * MIN, seen_ms: T0 - MIN, projects: [{ id, name: 'P' }] } },
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

// ---------------------------------------------------------------- FR-026 per-project calls

test('a project selector is passed verbatim to --project, a milestone to --milestone alone and a ticket to --issue', async ($, on) => {
  trace("FR-026-AC-1", "FR-016-AC-12")
  expect(selectorArgs({ kind: 'project', ref: pid('P') })).toEqual(['--project', pid('P')])
  expect(selectorArgs({ kind: 'milestone', ref: 'm1', project: 'p1' })).toEqual(['--milestone', 'm1'])
  expect(selectorArgs({ kind: 'ticket', ref: 't' })).toEqual(['--issue', 't'])
  expect(selectorsOfScope({ initiatives: ['i'], projects: ['p'], tickets: ['t'] }).map(s => `${s.kind}:${s.ref}`)).toEqual(['initiative:i', 'project:p', 'ticket:t'])
  const w = world(on, true)
  const b = ix(w, { projects: { [pid('P')]: project('By id', 1, 2), 'QSL-7': project('By identifier', 1, 2), 'By name': project('By name', 1, 2) }, other: () => out(statusJson([project('Touched', 1, 4)])) })
  const sels: Selector[] = [proj(pid('P')), proj('QSL-7'), proj('By name'), { kind: 'milestone', ref: 'm1', project: 'p1' }, { kind: 'ticket', ref: 'QSL-9' }]
  const shown = await progress(w, sels)
  expect(b.calls.sort()).toEqual([`focus status --project ${pid('P')}`, 'focus status --project QSL-7', 'focus status --project By name', 'focus status --milestone m1', 'focus status --issue QSL-9'].sort())
  expect(shown.progress!.loose).toHaveLength(5)
})

test('one failing project of 18 draws the other 17 with their counts and names the failed one with the error text', async ($, on) => {
  trace("FR-026-AC-2")
  const w = world(on, true)
  const specs = many(18)
  const text = 'issue QSL-3236 references unavailable milestone m1 in project p1'
  ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: { ...byName(specs), 'Proj 5': text } })
  const shown = await progress(w, [initiative('A')])
  const rows = shown.progress!.initiatives[0]!.projects
  expect(rows.filter(r => !r.failed)).toHaveLength(17)
  expect(shown.progress!.warnings).toEqual([{ kind: 'project', name: 'Proj 5', text, id: null }])
  expect([...shown.failed.values()]).toEqual([{ name: 'Proj 5', error: text }])
})

test('ix-board missing is one ix-board error and no further call in that refresh', async ($, on) => {
  trace("FR-026-AC-3")
  const w = world(on, true)
  const slow = () => w.clock!.sleep(1000).then(() => out(statusJson([project('X', 1, 2)])))
  const b = ix(w, { projects: { A: () => Promise.reject(new Error('spawn ix-board ENOENT')), B: slow, C: slow, D: slow, E: slow, F: slow } })
  const shown = await progress(w, ['A', 'B', 'C', 'D', 'E', 'F'].map(proj), { advance: 2000 })
  expect(shown.progress!.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'spawn ix-board ENOENT', id: null }])
  // Only the calls already started (four at a time) ran; the rest never did.
  expect(b.calls.length).toBeLessThanOrEqual(4)
})

test('a call that times out before anything answered is one ix-board error and no further call', async ($, on) => {
  trace("FR-026-AC-4", "NFR-004-M-3")
  const w = world(on, true)
  const timeouts: (number | undefined)[] = []
  const hang = (init: { timeoutMs?: number } | undefined) => (timeouts.push(init?.timeoutMs), w.clock!.sleep(init?.timeoutMs ?? 20_000).then(() => Promise.reject(new Error(`timed out after ${init?.timeoutMs}ms`))))
  const refs = ['A', 'B', 'C', 'D', 'E', 'F']
  const b = ix(w, { projects: Object.fromEntries(refs.map(r => [r, (init: { timeoutMs?: number } | undefined) => hang(init)])) })
  const shown = await progress(w, refs.map(proj), { advance: 21_000 })
  expect(timeouts.every(t => t === 20_000)).toBe(true)
  expect(shown.progress!.warnings).toHaveLength(1)
  expect(shown.progress!.warnings[0]).toMatchObject({ kind: 'source', name: 'ix-board' })
  expect(shown.progress!.warnings[0]!.text).toMatch(/timed out/)
  expect(b.calls.length).toBe(4)
})

test('an authentication failure is one ix-board error and no further call', async ($, on) => {
  trace("FR-026-AC-5")
  const w = world(on, true)
  const b = ix(w, { projects: Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map(r => [r, 'ix-board: authentication failed'])) })
  const shown = await progress(w, ['A', 'B', 'C', 'D', 'E', 'F'].map(proj))
  expect(shown.progress!.warnings).toEqual([{ kind: 'source', name: 'ix-board', text: 'ix-board: authentication failed', id: null }])
  expect(b.calls.length).toBeLessThanOrEqual(4)
})

test('a Linear rate limit is one ix-board error, makes no further call, and no call is made for its 60 seconds', async ($, on) => {
  trace("FR-026-AC-6", "FR-016-AC-13")
  const w = world(on, true)
  const b = ix(w, { projects: Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map(r => [r, 'Linear rate limited; retry in 60s'])) })
  const sels = ['A', 'B', 'C', 'D', 'E', 'F'].map(proj)
  const shown = await progress(w, sels)
  expect(shown.progress!.warnings).toHaveLength(1)
  expect(shown.progress!.warnings[0]!.kind).toBe('source')
  const made = b.calls.length
  expect(made).toBeLessThanOrEqual(4)
  await w.clock!.advance(30_000)
  const paused = await progress(w, sels, { manual: true })
  expect(b.calls.length).toBe(made)
  expect(paused.progress!.warnings[0]!.text).toMatch(/paused/)
  await w.clock!.advance(31_000)
  await progress(w, sels, { manual: true })
  expect(b.calls.length).toBeGreaterThan(made)
})

test('10 distinct project selectors and no initiative make at most 10 calls and no roadmap call', async ($, on) => {
  trace("FR-026-AC-7")
  const w = world(on, true)
  const specs = many(10)
  const b = ix(w, { projects: byName(specs) })
  await progress(w, specs.map(p => proj(p.name)))
  expect(b.calls).toHaveLength(10)
  expect(b.calls).not.toContain('roadmap')
})

test('one roadmap initiative, two initiatives needing initiative calls and 3 listed projects make at most 1 + 2 + 3 calls', async ($, on) => {
  trace("FR-026-AC-8")
  const w = world(on, true)
  const b = ix(w, {
    roadmap: [{ name: 'Named', projects: [{ name: 'N1' }, { name: 'N2' }] }],
    initiatives: { [FSL]: [project('F1', 1, 2), project('F2', 1, 2)], [HARD]: [project('H1', 1, 2)] },
    projects: { N1: project('N1', 1, 2), N2: project('N2', 1, 2), D1: project('D1', 1, 2), D2: project('D2', 1, 2), D3: project('D3', 1, 2) },
  })
  await progress(w, [initiative('Named'), initiative(FSL), initiative(HARD), proj('D1'), proj('D2'), proj('D3')])
  expect(b.calls.filter(c => c === 'roadmap')).toHaveLength(1)
  expect(b.calls.filter(c => c.includes('--initiative'))).toHaveLength(2)
  expect(b.calls.length).toBeLessThanOrEqual(1 + 2 + 5)
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toHaveLength(5)
})

test('no more than 4 ix-board processes run at once across two focuses', async ($, on) => {
  trace("FR-026-AC-9", "NFR-004-M-4")
  const w = world(on, true)
  const a = Array.from({ length: 6 }, (_, i) => project(`A${i}`, 1, 2))
  const b2 = Array.from({ length: 6 }, (_, i) => project(`B${i}`, 1, 2))
  const b = ix(w, { projects: { ...byName(a), ...byName(b2) }, delay: 1000 })
  const first = progress(w, a.map(p => proj(p.name)))
  const second = progress(w, b2.map(p => proj(p.name)))
  await w.clock!.advance(10_000)
  await Promise.all([first, second])
  expect(b.live.max).toBe(4)
  expect(b.calls).toHaveLength(12)
})

test('a project unanswered at the 20 second call timeout or at the 60 second budget is failed with timed out and the others are drawn', async ($, on) => {
  trace("FR-026-AC-10", "FR-016-AC-10")
  const w = world(on, true)
  const hang = (init: { timeoutMs?: number } | undefined) => w.clock!.sleep(init?.timeoutMs ?? 20_000).then(() => Promise.reject(new Error(`timed out after ${init?.timeoutMs}ms`)))
  ix(w, { projects: { A: project('A', 1, 2), B: hang, C: project('C', 1, 2) } })
  const shown = await progress(w, [proj('A'), proj('B'), proj('C')], { advance: 21_000 })
  expect(shown.progress!.loose.map(p => [p.name, p.failed])).toEqual([['A', false], ['project B', true], ['C', false]])
  expect(shown.progress!.warnings).toEqual([{ kind: 'project', name: 'project B', text: 'timed out', id: null }])
  // A call that never returns at all: the refresh ends at its 60 seconds with the project failed.
  const w2 = world(on, true)
  ix(w2, { projects: { A: project('A', 1, 2), B: () => new Promise<never>(() => undefined) } })
  const stuck = await progress(w2, [proj('A'), proj('B')], { advance: 61_000 })
  expect(stuck.progress!.warnings.map(x => x.text)).toEqual(['timed out'])
  expect(stuck.progress!.loose[0]).toMatchObject({ name: 'A', failed: false })
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

test('when ix-board tolerates the dangling milestone and every call succeeds there is no warning and the header is complete only when done equals total', async ($, on) => {
  trace("FR-026-AC-13")
  const w = world(on, true)
  const specs = many(3).map(p => ({ ...p, done: p.total }))
  const b = ix(w, { roadmap: [{ name: 'A', projects: specs.map(p => ({ name: p.name })) }], projects: byName(specs) })
  const done = (await progress(w, [initiative('A')])).progress!
  expect(b.calls).toHaveLength(4)
  expect(done.warnings).toEqual([])
  expect(done.header).toMatchObject({ complete: true, done: 60, total: 60 })
  const w2 = world(on, true)
  ix(w2, { roadmap: [{ name: 'A', projects: [{ name: 'P' }] }], projects: { P: project('P', 1, 2) } })
  expect((await progress(w2, [initiative('A')])).progress!.header!.complete).toBe(false)
})

test('a project listed under two selectors is called once', async ($, on) => {
  trace("FR-026-AC-14")
  const w = world(on, true)
  const id = pid('P')
  const b = ix(w, { roadmap: [{ name: 'A', id: FSL, projects: [{ name: 'P', id }] }, { name: 'B', id: HARD, projects: [{ name: 'P', id }] }], projects: { [id]: project('P', 1, 2, { id }) } })
  const shown = await progress(w, [initiative(FSL), initiative(HARD), proj(id)])
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toEqual([`focus status --project ${id}`])
  expect(shown.progress!.header).toMatchObject({ counted: 1, enumerated: 1 })
  expect(shown.progress!.loose).toEqual([])
})

// ---------------------------------------------------------------- the file (FR-017)

test('one malformed entry is ignored alone and the valid ones are used', async () => {
  trace("FR-017-AC-7")
  const good = record()
  const parsed = parseRecords(JSON.stringify({ 'project:C': good, 'project:D': { at_ms: 'x' }, 'ticket:T': null, 'project:E': { ...good, total: -1 }, 'project:F': { ...good, done: 1 } }))
  expect(Object.keys(parsed).sort()).toEqual(['project:C', 'project:F'])
  for (const bad of ['[1,2]', '"x"', '', 'null', '7', '{ not json']) expect(parseFile(bad)).toEqual({ records: {}, initiatives: {} })
})

test('a record whose time is in the future has an age of zero, and 30 minutes is not stale while 30 minutes 1 second is', async () => {
  trace("FR-017-AC-8", "FR-017-AC-4")
  expect(ageOf({ at_ms: T0 + 10 * MIN }, T0)).toBe(0)
  expect(STALE_MS).toBe(30 * MIN)
  expect(ageOf({ at_ms: T0 - 30 * MIN }, T0) > STALE_MS).toBe(false)
  expect(ageOf({ at_ms: T0 - 30 * MIN - 1000 }, T0) > STALE_MS).toBe(true)
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
  await w.clock!.advance(6 * MIN)
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
  // The calls are `ix-board --json focus status --project <uuid>`, one for each direct project.
  expect(w.ran).toContain(`ix-board --json focus status --project ${REAL_SCOPE.projects[0]}`)
  expect(b.calls.filter(c => c.startsWith('focus status --project'))).toHaveLength(2)
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
  trace("FR-026-AC-2", "FR-025-AC-3")
  const w = world(on, true)
  const [a, b2] = REAL_SCOPE.projects as [string, string]
  const chunk = (name: string, id: string) => out(JSON.stringify({ blocker_layers: [[]], goal: 'a goal', identifier: id, milestones: [], name, open_tickets: [] }))
  const b = ix(w, {
    projects: { [a]: 'timed out', [b2]: BAD_MILESTONE },
    other: args => (args[0] === 'project-chunk' ? (args[1] === a ? chunk('FSL alpha release', a) : chunk('QSL Production Hardening', b2)) : out('', 1, 'not stubbed')),
  })
  const shown = await progress(w, [proj(a), proj(b2)])
  expect(b.calls).toEqual([`focus status --project ${a}`, `focus status --project ${b2}`, `project-chunk ${a}`, `project-chunk ${b2}`].sort((x, y) => b.calls.indexOf(x) - b.calls.indexOf(y)))
  expect(b.calls.filter(c => c.startsWith('project-chunk'))).toHaveLength(2)
  expect(shown.progress!.loose.map(p => [p.name, p.failed, p.id])).toEqual([['FSL alpha release', true, a], ['QSL Production Hardening', true, b2]])
  expect(shown.progress!.warnings.map(x => x.name)).toEqual(['FSL alpha release', 'QSL Production Hardening'])
  expect(saved(w)[`project:${a}`]).toMatchObject({ name: 'FSL alpha release', unknown: true, total: 0 })
  // A later failure knows the name already: no project-chunk call, and the name-only record draws no counts.
  await w.clock!.advance(6 * MIN)
  const again = await progress(w, [proj(a), proj(b2)])
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
