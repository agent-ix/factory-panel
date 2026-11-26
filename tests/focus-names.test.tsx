import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { focusBanner } from '../hooks/band/modules'
import { LEAD, board, choose, hides, lead, pageLines, pageOf, paneLines, shows, started, statusCalls } from './focus-kit'
import { FP, out, pid, report, roadmapJson, world } from './world'
import type { World } from './world'

// Tests for the banner that says why these focuses are shown and for the focus choice: `all`, or one Linear initiative
// or project that leads report, by its Linear ID, with Linear's name from ix-board.

const P1 = pid(1)
const P2 = pid(2)
const I1 = pid(9)
const STABLE = `project:${P1}`
const ALPHA = `initiative:${I1}`
const STABLE_NAME = 'FSL stability: red main and blowups'

/** The line `/factory show` prints for the banner, found by what it says. */
const shown = async ($: Parameters<TestBody>[0]): Promise<string> => (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
const run = async ($: Parameters<TestBody>[0], args: string): Promise<string> => ((await $.command.run({ command: 'factory', args } as never)) as { text: string }).text
const stored = (w: World, key = 'draco_QSL_code') => JSON.parse(w.files.get(`${FP}/choices/${key}.json`) ?? 'null') as { focus?: string } | null

/**
 * A lead reporting the initiative FSL Alpha, whose one project is P2, and the project P1, which no initiative of the
 * roadmap holds, so that `project-chunk` names it.
 */
function linear(w: World, over: { initiative?: string; roadmapOnly?: boolean; unnamed?: boolean } = {}): void {
  if (over.roadmapOnly !== true) lead(w, { initiatives: [I1], projects: [P1] }, 'FSL alpha summary')
  board(w, { combined: args => pageOf(args[1] === P1 ? STABLE_NAME : 'Alpha work', 5, 10) })
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'ix-board --json roadmap') return out(roadmapJson([{ id: I1, name: over.initiative ?? 'FSL Alpha', projects: [{ id: P2, name: 'Alpha work' }] }]))
    if (line === `ix-board --json project-chunk ${P1}`) return over.unnamed ? out('', 1, 'no such project') : out(JSON.stringify({ name: STABLE_NAME }))
    if (over.unnamed && line.startsWith('ix-board --json focus status')) return out('', 1, 'no such project')
    return prior?.(argv, init)
  }
}

/** Every text line and button label of the Work view, with the focus choice opened where asked. */
async function workLines($: Parameters<TestBody>[0], open = false): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'Pane', requestId: 'work', props: { title: 'Work', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)
  if (open) await ui.press({ key: 'focus-choice' })
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  if (open) await ui.press({ key: 'focus-choice' })
  await ui.unmount()
  return [...lines, ...buttons]
}

// ---------------------------------------------------------------- FR-019 the banner

test('the name of the chosen focus is the line of the pane and of /factory show', async ($, on) => {
  trace("FR-019-AC-1", "FR-019-AC-6")
  const w = world(on, true)
  linear(w)
  choose(w, STABLE)
  await started($, w)
  const lines = await pageLines($)
  shows(lines, new RegExp(`^your choice: ${STABLE_NAME}$`))
  hides(lines, /^your choice: project:/)
})

test('the default scope says the focuses of the session team', async ($, on) => {
  trace("FR-019-AC-2")
  const w = world(on, true)
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('focuses of QSL')
})

test('several chosen teams are named, and all teams says every team', async ($, on) => {
  trace("FR-019-AC-3", "FR-019-AC-10")
  const w = world(on, true)
  lead(w, null)
  w.files.set(`${FP}/choices/draco_QSL_code.json`, JSON.stringify({ teams: ['QSL', 'ENG'] }))
  await started($, w)
  expect((await shown($)).split('\n')).toContain('focuses of QSL, ENG')
  await $.command.run({ command: 'factory', args: 'teams all' } as never)
  expect((await shown($)).split('\n')).toContain('focuses of every team')
})

test('an identified session whose team has no focus entry says no focus reported by that team', async ($, on) => {
  trace("FR-019-AC-4")
  const w = world(on, true)
  w.leads.set('draco:ENG:code', report('draco:ENG:code', 'Payments v2'))
  await started($, w)
  expect((await shown($)).split('\n')).toContain('no focus reported by QSL')
})

test('whoami failing with no choice says it could not tell who the session is', async ($, on) => {
  trace("FR-019-AC-5")
  const w = world(on, true)
  w.whoami.value = undefined
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('could not tell who this session is, showing every focus')
})

test('a stored ID nothing knows gives the banner of the teams and a line that says so', async ($, on) => {
  trace("FR-019-AC-7", "FR-020-AC-10")
  const w = world(on, true)
  linear(w)
  choose(w, `initiative:${pid(77)}`)
  await started($, w)
  const lines = await pageLines($)
  expect((await shown($)).split('\n')).toContain('focuses of QSL')
  shows(lines, /^focus initiative 00000000 is not known: showing all$/)
  // Everything of the selected teams is still drawn.
  shows(lines, /FSL alpha summary/)
  const work = await workLines($)
  shows(work, /is not known: showing all/)
  shows(work, /^Focus: all ▾$/)
})

test('whoami failing with a chosen focus says your choice', async ($, on) => {
  trace("FR-019-AC-8")
  const w = world(on, true)
  w.whoami.value = undefined
  linear(w)
  choose(w, ALPHA, 'default')
  await started($, w)
  expect((await shown($)).split('\n')).toContain('your choice: FSL Alpha')
})

test('whoami failing with a stored team focus says it could not tell who the session is', async ($, on) => {
  trace("FR-019-AC-9")
  const w = world(on, true)
  w.whoami.value = undefined
  choose(w, 'team', 'default')
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('could not tell who this session is, showing every focus')
  const detected = { hosts: 'local', teams: [], ownTeam: 'QSL', teamsSelected: false } as const
  expect(focusBanner({ ...detected, focus: STABLE, identity: 'unknown' }, [{ via: 'chosen', address: STABLE, title: 'Beta' } as never])).toBe('your choice: Beta')
  expect(focusBanner({ ...detected, focus: 'all', identity: 'unknown' }, [])).toBe('could not tell who this session is, showing every focus')
  expect(focusBanner({ ...detected, focus: 'all', identity: 'detected' }, [])).toBe('focuses of every team')
})

// ---------------------------------------------------------------- FR-020 the focus choice

test('a stored own means all', async ($, on) => {
  trace("FR-020-AC-1")
  const w = world(on, true)
  linear(w)
  choose(w, 'own')
  await started($, w)
  shows(await pageLines($), /^focuses of QSL$/)
  shows(await workLines($), /^Focus: all ▾$/)
})

test('/factory focus with the Linear name or ID of a reported focus stores its ID and shows its name', async ($, on) => {
  trace("FR-020-AC-2", "FR-014-AC-3")
  const w = world(on, true)
  linear(w)
  await started($, w)
  for (const reference of [STABLE_NAME, P1, STABLE.toUpperCase()]) {
    await run($, 'focus all')
    const said = await run($, `focus ${reference}`)
    expect(said).toMatch(new RegExp(`^Focus: ${STABLE_NAME}\\.$`, 'm'))
    expect(said).toContain(`${STABLE_NAME} (${STABLE})`)
    expect(stored(w)).toEqual({ focus: STABLE })
  }
  await w.clock!.advance(1000)
  shows(await pageLines($), new RegExp(`^your choice: ${STABLE_NAME}$`))
  shows(await workLines($), /^Focus: FSL stability.*▾$/)
})

test('a name that an initiative and a project share is refused with both listed, and the choice is unchanged', async ($, on) => {
  trace("FR-020-AC-3")
  const w = world(on, true)
  linear(w, { initiative: STABLE_NAME })
  await started($, w)
  const said = await run($, `focus ${STABLE_NAME}`)
  expect(said).toContain('names several focuses; use the ID. The focus is unchanged.')
  expect(said).toContain(`  ${STABLE_NAME}  ${STABLE}`)
  expect(said).toContain(`  ${STABLE_NAME}  ${ALPHA}`)
  expect(stored(w)).toBeNull()
  const picker = await workLines($, true)
  shows(picker, /\(initiative\)$/)
  shows(picker, /\(project\)$/)
})

test('a lead address, a lead summary, a part of a name and a name in another case name no focus', async ($, on) => {
  trace("FR-020-AC-4")
  const w = world(on, true)
  linear(w)
  await started($, w)
  for (const name of [LEAD, 'FSL alpha summary', 'FSL', 'fsl alpha']) {
    const said = await run($, `focus ${name}`)
    expect(said).toContain(`No lead reports a focus "${name}". The focus is unchanged.`)
    expect(said).toContain(`  FSL Alpha  ${ALPHA}`)
  }
  expect(stored(w)).toBeNull()
})

test('the choices are exactly the initiatives and projects the leads of the selected teams report, by Linear name', async ($, on) => {
  trace("FR-020-AC-5", "FR-028-AC-38")
  const w = world(on, true)
  linear(w)
  w.leads.set('draco:ENG:code', report('draco:ENG:code', 'Payments v2', ['running'], { projects: [pid(55)] }))
  // A scope entry that is no Linear ID is not offered.
  w.leads.set('draco:QSL:plan', report('draco:QSL:plan', 'Plan', ['running'], { projects: ['Some name'] }))
  await started($, w)
  const picker = await workLines($, true)
  const offered = picker.slice(picker.indexOf('✓ all'))
  expect(offered.slice(0, 3)).toEqual(['✓ all', '  FSL Alpha', `  ${STABLE_NAME}`])
  hides(picker, /Some name|FSL alpha summary|project 00000000/)
})

test('a project nothing names is listed by its kind and the start of its ID', async ($, on) => {
  trace("FR-020-AC-6")
  const w = world(on, true)
  linear(w, { unnamed: true })
  await started($, w)
  shows(await workLines($, true), /^  project 00000000$/)
})

test('a chosen project shows ix-board’s progress over that project alone', async ($, on) => {
  trace("FR-020-AC-7")
  const w = world(on, true)
  linear(w)
  choose(w, STABLE)
  await started($, w)
  expect(statusCalls(w)).toEqual([`--project ${P1}`])
  const lines = await pageLines($)
  shows(lines, /^5\/10$/)
  hides(lines, /FSL alpha summary/)
})

test('a chosen initiative is expanded to its projects by ix-board', async ($, on) => {
  trace("FR-020-AC-8", "FR-021-AC-2")
  const w = world(on, true)
  linear(w)
  choose(w, ALPHA)
  await started($, w)
  expect(statusCalls(w)).toEqual([`--project ${P2}`])
  shows(await paneLines($), /Alpha work/)
})

test('a chosen focus that no lead reports and Linear names stays applied', async ($, on) => {
  trace("FR-020-AC-9")
  const w = world(on, true)
  linear(w, { roadmapOnly: true })
  lead(w, null, 'Release train')
  choose(w, ALPHA)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('your choice: FSL Alpha')
  shows(await workLines($, true), /^✓ FSL Alpha$/)
})

test('a stored value that is no focus is all, said, and blanks nothing', async ($, on) => {
  trace("FR-020-AC-10", "FR-013-AC-6")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, 'FSL alpha')
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /focus "FSL alpha" is not a Linear initiative or project focus, showing all/)
  shows(lines, /Release train/)
  shows(lines, /^focuses of QSL$/)
  shows(await workLines($), /focus "FSL alpha" is not a Linear initiative or project focus, showing all/)
})

test('no relay focus definition is asked for', async ($, on) => {
  trace("FR-020-AC-11")
  const w = world(on, true)
  linear(w)
  await started($, w)
  await run($, 'focus FSL Alpha')
  await workLines($, true)
  expect(w.ran.filter(l => l.startsWith('agent-msg focuses'))).toEqual([])
})

// ---------------------------------------------------------------- the work reports of the leads

test('a lead with no report is silent in own mode, and a lead whose work show fails is named with its error', async ($, on) => {
  trace("FR-018-AC-2")
  const w = world(on, true)
  w.leads.set('draco:QSL:code', null) // `agent-msg work show` prints null for a lead that has reported nothing
  w.leads.set('draco:QSL:plan', undefined) // and fails for one it cannot resolve
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^agent-msg work: draco:QSL:plan: no report$/)
  hides(lines, /draco:QSL:code:/)
  hides(lines, /null/)
})

test('a lead with no report at all draws no error', async ($, on) => {
  trace("FR-018-AC-2")
  const w = world(on, true)
  w.leads.set('draco:QSL:code', null)
  await started($, w)
  hides(await pageLines($), /^agent-msg work: /)
})

test('the banner says no focus is reported only where no lead of the teams has one', async () => {
  trace("FR-019-AC-2", "FR-019-AC-4")
  const entry = (address: string) => ({ address, via: null }) as never
  const scope = { hosts: 'local', teams: ['QSL'], ownTeam: 'QSL', teamsSelected: false, focus: 'all', identity: 'detected' } as const
  expect(focusBanner(scope, [entry('draco:ENG:code')])).toBe('no focus reported by QSL')
  expect(focusBanner(scope, [entry('draco:ENG:code'), entry('DRACO:qsl:code')])).toBe('focuses of QSL')
})
