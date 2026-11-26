import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { focusBanner } from '../hooks/band/modules'
import { LEAD, MIN, board, choose, focusCalls, hides, lead, named, onScreen, pageLines, pageOf, paneButtons, paneLines, shows, started, statusCalls } from './focus-kit'
import { FP, defRow, focId, listJson, out, relayFocuses, report, showJson, startSession, stubRow, world } from './world'
import type { World } from './world'

// Tests for the banner that says why these focuses are shown and for the focus choice: one named focus definition
// ix-relay stores, resolved by `agent-msg focuses show` and read, never written.

const BETA = 'foc-0123456789abcdef0123456789abcdef'
const ENG = 'foc-fedcba9876543210fedcba9876543210'
const CREATE = /create one: agent-msg focuses create --file <file\.json>/

/** The line `/factory show` prints for the banner, found by what it says. */
const shown = async ($: Parameters<TestBody>[0]): Promise<string> => (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string

/** A definition named Beta of team QSL over one project, and ix-board answering for it. */
function beta(w: World, over: { show?: () => ReturnType<typeof out> } = {}): void {
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'))), { [BETA]: over.show ?? (() => out(showJson('Beta', 'QSL', { projects: ['p1'] }))) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
}

const run = async ($: Parameters<TestBody>[0], args: string): Promise<string> => ((await $.command.run({ command: 'factory', args } as never)) as { text: string }).text
const stored = (w: World, key = 'draco_QSL_code') => JSON.parse(w.files.get(`${FP}/choices/${key}.json`) ?? 'null') as { focus?: string } | null

/** Every text line of the Work view. */
async function workLines($: Parameters<TestBody>[0]): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'Pane', requestId: 'work', props: { title: 'Work', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  await ui.unmount()
  return [...lines, ...buttons]
}

// ---------------------------------------------------------------- FR-019 the banner

test('the name of the chosen definition is the line of the pane and of /factory show', async ($, on) => {
  trace("FR-019-AC-1", "FR-019-AC-6")
  const w = world(on, true)
  choose(w, BETA)
  beta(w)
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^your choice: Beta$/)
  hides(lines, /^your choice: foc-/)
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

test('a stored ID relay has no definition of gives the banner of the teams and a line that says so', async ($, on) => {
  trace("FR-019-AC-7", "FR-020-AC-10")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, ENG)
  relayFocuses(w, { id: BETA, name: 'Beta' })
  await started($, w)
  const lines = await pageLines($)
  expect((await shown($)).split('\n')).toContain('focuses of QSL')
  shows(lines, new RegExp(`^focus ${ENG} is not a relay focus definition: showing all$`))
  // Everything of the selected teams is still drawn.
  shows(lines, /^Release train$/)
  const work = await workLines($)
  shows(work, /is not a relay focus definition: showing all/)
  shows(work, /^Focus: all ▾$/)
})

test('whoami failing with a chosen definition says your choice', async ($, on) => {
  trace("FR-019-AC-8")
  const w = world(on, true)
  w.whoami.value = undefined
  choose(w, BETA, 'default')
  beta(w)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('your choice: Beta')
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
  expect(focusBanner({ ...detected, focus: BETA, identity: 'unknown' }, [{ via: 'definition', address: BETA, title: 'Beta' } as never])).toBe('your choice: Beta')
  expect(focusBanner({ ...detected, focus: 'all', identity: 'unknown' }, [])).toBe('could not tell who this session is, showing every focus')
  expect(focusBanner({ ...detected, focus: 'all', identity: 'detected' }, [])).toBe('focuses of every team')
})

// ---------------------------------------------------------------- FR-020 the focus definitions of relay

test('a stored own means all and a definition named Own is not used', async ($, on) => {
  trace("FR-020-AC-1")
  const w = world(on, true)
  lead(w, null)
  choose(w, 'own')
  relayFocuses(w, { id: BETA, name: 'Own' })
  await started($, w)
  expect(focusCalls(w)).toEqual(['list --json'])
  const lines = await pageLines($)
  hides(lines, /label p1/)
  shows(lines, /^focuses of QSL$/)
})

test('/factory focus with the exact name or the ID of a definition stores its ID and shows it by name', async ($, on) => {
  trace("FR-020-AC-2", "FR-014-AC-3")
  const w = world(on, true)
  relayFocuses(w, { id: BETA, name: 'Release Train' }, { id: ENG, name: 'Payments', team: 'ENG' })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  for (const reference of ['Release Train', BETA]) {
    await run($, 'focus all')
    const said = await run($, `focus ${reference}`)
    expect(said).toMatch(/^Focus: Release Train\.$/m)
    expect(said).toMatch(new RegExp(`focus +Release Train \\(${BETA}\\) +\\[user\\]`))
    expect(stored(w)).toEqual({ focus: BETA })
  }
  await w.clock!.advance(1000)
  shows(await pageLines($), /^your choice: Release Train$/)
  shows(await workLines($), /^Focus: Release Train ▾$/)
})

test('a name that definitions of two teams have is refused with the definitions listed, and the choice is unchanged', async ($, on) => {
  trace("FR-020-AC-3")
  const w = world(on, true)
  relayFocuses(w, { id: BETA, name: 'Beta' }, { id: ENG, name: 'Beta', team: 'ENG' })
  choose(w, ENG)
  await started($, w)
  const said = await run($, 'focus Beta')
  expect(said).toMatch(/belongs to definitions of several teams; use the focus ID\. The focus is unchanged\./)
  expect(said).toContain(`  Beta (QSL)  ${BETA}`)
  expect(said).toContain(`  Beta (ENG)  ${ENG}`)
  expect(stored(w)).toEqual({ focus: ENG })
})

test('a name that is not a definition’s is refused, whatever a lead address or summary it matches', async ($, on) => {
  trace("FR-020-AC-4")
  const w = world(on, true)
  lead(w, null, 'FSL alpha')
  relayFocuses(w, { id: BETA, name: 'FSL alpha two' })
  await started($, w)
  for (const name of ['FSL alpha', 'fsl alpha two', 'FSL', LEAD, 'QSL:code']) {
    const said = await run($, `focus ${name}`)
    expect(said).toContain(`no definition "${name}". The focus is unchanged.`)
    expect(said).toContain(`  FSL alpha two (QSL)  ${BETA}`)
  }
  expect(stored(w)).toBeNull()
  shows(await pageLines($), /^FSL alpha$/)
})

test('a list that fails or prints text that is not JSON shows a source error and the chosen definition is still read', async ($, on) => {
  trace("FR-020-AC-5")
  const w = world(on, true)
  choose(w, BETA)
  let mode: 'exit' | 'text' = 'exit'
  named(w, () => (mode === 'exit' ? out('', 1, 'agent-msg: relay store unavailable') : out('not json at all')), { [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['p1'] })) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  let lines = await pageLines($)
  shows(lines, /^agent-msg focuses: list: agent-msg: relay store unavailable$/)
  shows(lines, /^5\/10$/)
  mode = 'text'
  // A source that failed is read after twice its interval (FR-027).
  await w.clock!.advance(4 * MIN + 1000)
  lines = await pageLines($)
  shows(lines, /^agent-msg focuses: list: agent-msg focuses list printed text that is not JSON$/)
})

test('a definition whose selection is empty shows its name and says it selects nothing, and ix-board is not called', async ($, on) => {
  trace("FR-020-AC-6")
  const w = world(on, true)
  choose(w, BETA)
  beta(w, { show: () => out(showJson('Beta', 'QSL', {}, {}, { empty: true })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /Beta/)
  shows(lines, /^this focus selects nothing$/)
  expect(statusCalls(w)).toEqual([])
})

test('a definition whose selection cannot be decoded is said to be unavailable and everything is shown', async ($, on) => {
  trace("FR-020-AC-7")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, BETA)
  beta(w, { show: () => out(showJson('Beta', 'QSL', {}, {}, { definition: null })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^focus Beta is unavailable \(the selection of this focus is unavailable\): showing all$/)
  shows(lines, /^Release train$/)
  expect(statusCalls(w)).toEqual([])
})

test('a definition with an exclusion says the exclusions are not applied to progress', async ($, on) => {
  trace("FR-020-AC-8")
  const w = world(on, true)
  choose(w, BETA)
  beta(w, { show: () => out(showJson('Beta', 'QSL', { projects: ['p1'] }, { tickets: ['QSL-9'] })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^exclusions are not applied to progress$/)
  shows(lines, /^5\/10$/)
})

test('a chosen definition that is archived stays chosen and says so, and an archived one is not chosen anew', async ($, on) => {
  trace("FR-020-AC-9")
  const w = world(on, true)
  choose(w, BETA)
  named(w, () => out(listJson()), { [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['p1'] }, {}, { state: 'archived' })) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^focus Beta is archived$/)
  shows(lines, /named focus · archived/)
  shows(await workLines($), /^Focus: Beta ▾$/)
  expect(await run($, `focus ${BETA}`)).toMatch(/^Beta is archived\. The focus is unchanged\./)
})

test('a stored value that is not a definition ID is all, said, and blanks nothing', async ($, on) => {
  trace("FR-020-AC-10", "FR-013-AC-6")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, 'FSL alpha')
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /focus "FSL alpha" is not a focus definition ID, showing all/)
  shows(lines, /^Release train$/)
  shows(lines, /^focuses of QSL$/)
  shows(await workLines($), /focus "FSL alpha" is not a focus definition ID, showing all/)
  expect(focusCalls(w)).toEqual(['list --json'])
})

test('a definition relay cannot use is said with its reason and everything is shown', async ($, on) => {
  trace("FR-020-AC-12")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, BETA)
  const refusal = JSON.stringify({ code: 'unavailable_definition', message: 'cannot be used', reason: 'unsupported_schema' })
  named(w, () => out(listJson(stubRow(BETA, 'unsupported_schema'))), { [BETA]: () => out('', 1, refusal) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, new RegExp(`^focus ${BETA} is unavailable \\(unsupported_schema\\): showing all$`))
  shows(lines, /^Release train$/)
  expect(statusCalls(w)).toEqual([])
})

test('a show that fails shows a source error: all is shown at first, and later the definition as last read', async ($, on) => {
  trace("FR-020-AC-13")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, BETA)
  let mode: 'fail' | 'ok' | 'text' = 'fail'
  beta(w, { show: () => (mode === 'fail' ? out('', 1, 'agent-msg: definition unreadable') : mode === 'text' ? out('{ nope') : out(showJson('Beta', 'QSL', { projects: ['p1'] }))) })
  await started($, w)
  let lines = await pageLines($)
  shows(lines, new RegExp(`^agent-msg focuses: show ${BETA}: agent-msg: definition unreadable$`))
  shows(lines, /could not be read \(agent-msg: definition unreadable\): showing all$/)
  shows(lines, /^Release train$/)
  mode = 'ok'
  await w.clock!.advance(4 * MIN + 1000)
  shows(await pageLines($), /^your choice: Beta$/)
  mode = 'text'
  await w.clock!.advance(2 * MIN + 1000)
  lines = await pageLines($)
  shows(lines, /^focus Beta could not be read again \(agent-msg focuses show printed text that is not JSON\): shown as last read$/)
  shows(lines, /^your choice: Beta$/)
})

for (const sub of ['list', 'show'] as const) {
  test(`a ${sub} that never returns is given up on after 5 seconds and shows a source error`, async ($, on) => {
    trace("FR-020-AC-14", "NFR-004-M-5")
    const w = world(on, true)
    lead(w, null, 'Release train')
    choose(w, BETA)
    beta(w)
    const timeouts: (number | undefined)[] = []
    const prior = w.stub.value
    w.stub.value = (argv, init) => (argv[1] === 'focuses' && argv[2] === sub ? (timeouts.push(init?.timeoutMs), w.clock!.sleep(init?.timeoutMs ?? 5000).then(() => Promise.reject(new Error('timed out')))) : prior?.(argv, init))
    await startSession($)
    await onScreen($)
    // A view is read once its drawing has stood for 150 ms.
    await w.clock!.advance(150 + 4900)
    hides(await paneLines($), /^agent-msg focuses/)
    await w.clock!.advance(200)
    const lines = await pageLines($)
    expect(timeouts).toEqual([5000])
    shows(lines, new RegExp(`^agent-msg focuses: ${sub}`))
  })
}

test('with no definition the Work header says so, shows how one is made, and shows everything of the teams', async ($, on) => {
  trace("FR-020-AC-15")
  const w = world(on, true)
  lead(w, null, 'Release train')
  await started($, w)
  const work = await workLines($)
  shows(work, /^relay has no focus definitions$/)
  shows(work, CREATE)
  shows(work, /^Focus: all ▾$/)
  expect(await run($, 'focus Beta')).toContain('relay has no focus definitions; create one with agent-msg focuses create --file <file.json>')
  shows(await pageLines($), /^Release train$/)
  expect(focusCalls(w).every(c => c.startsWith('list ') || c.startsWith('show '))).toBe(true)
})

test('when the members of the chosen definition change between refreshes the second computes progress over the new members', async ($, on) => {
  trace("FR-020-AC-16")
  const w = world(on, true)
  choose(w, BETA)
  let members = ['p1']
  beta(w, { show: () => out(showJson('Beta', 'QSL', { projects: members })) })
  board(w, { combined: args => pageOf(args[1]!, 5, 10) })
  await started($, w)
  expect(statusCalls(w)).toEqual(['--project p1'])
  members = ['p1', 'p2']
  await w.clock!.advance(2 * MIN + 1000)
  expect(statusCalls(w).slice(-1)).toEqual(['--project p1 --project p2'])
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
