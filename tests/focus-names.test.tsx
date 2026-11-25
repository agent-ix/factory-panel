import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { focusBanner } from '../hooks/band/modules'
import { matchLeads } from '../hooks/namedfocus'
import { LEAD, MIN, board, choose, focusCalls, hides, lead, named, onScreen, pageLines, pageOf, paneButtons, paneLines, shows, started, statusCalls } from './focus-kit'
import { defRow, listJson, out, report, showJson, startSession, stubRow, world } from './world'
import type { World } from './world'

// Tests for the banner that says why these focuses are shown and the resolution of the name of
// `/factory focus <name>`: the keywords, the named focus definitions ix-relay stores, a lead address
// and a lead summary, as a read-only lookup.

const BETA = 'foc-0123456789abcdef0123456789abcdef'
const ENG = 'foc-fedcba9876543210fedcba9876543210'

/** The line `/factory show` prints for the banner, found by what it says. */
const shown = async ($: Parameters<TestBody>[0]): Promise<string> => (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string

/** A definition named Beta of team QSL over one project, and ix-board answering for it. */
function beta(w: World, over: { team?: string; name?: string; show?: () => ReturnType<typeof out> } = {}): void {
  named(w, () => out(listJson(defRow(BETA, over.name ?? 'Beta', over.team ?? 'QSL'))), { [BETA]: over.show ?? (() => out(showJson(over.name ?? 'Beta', over.team ?? 'QSL', { projects: ['p1'] }))) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
}

// ---------------------------------------------------------------- FR-019 the banner

test('a name that matches a lead summary is the first line of the pane and of /factory show', async ($, on) => {
  trace("FR-019-AC-1")
  const w = world(on, true)
  lead(w, null, 'Release Train')
  choose(w, 'Release Train')
  named(w, () => out(listJson()))
  await started($, w)
  const lines = await pageLines($)
  expect((await shown($)).split('\n')).toContain('your choice: Release Train')
  expect((await shown($)).split('\n')).toContain('your choice: Release Train')
})

test('the default scope with a focus entry of the session says own focus', async ($, on) => {
  trace("FR-019-AC-2")
  const w = world(on, true)
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('own focus')
  expect((await shown($)).split('\n')).toContain('own focus')
})

test('focus team says team focuses', async ($, on) => {
  trace("FR-019-AC-3")
  const w = world(on, true)
  lead(w, null)
  choose(w, 'team')
  await started($, w)
  expect((await shown($)).split('\n')).toContain('team focuses')
})

test('an identified session whose team has no focus entry says no focus reported, showing the whole team', async ($, on) => {
  trace("FR-019-AC-4")
  const w = world(on, true)
  w.leads.set('draco:ENG:code', report('draco:ENG:code', 'Payments v2'))
  await started($, w)
  expect((await shown($)).split('\n')).toContain('no focus reported, showing the whole team')
})

test('whoami failing with focus own says it could not tell who the session is', async ($, on) => {
  trace("FR-019-AC-5")
  const w = world(on, true)
  w.whoami.value = undefined
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('could not tell who this session is, showing every focus')
})

test('a name that matches a named focus definition says your choice', async ($, on) => {
  trace("FR-019-AC-6")
  const w = world(on, true)
  choose(w, 'Beta')
  beta(w)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('your choice: Beta')
})

test('a name that matches nothing says your choice and adds a separate warning line', async ($, on) => {
  trace("FR-019-AC-7")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, 'Nothing like it')
  named(w, () => out(listJson()))
  await started($, w)
  const lines = await pageLines($)
  expect((await shown($)).split('\n')).toContain('your choice: Nothing like it')
  shows(lines, /^no focus matches "Nothing like it"$/)
  expect(lines[1]).not.toBe('no focus matches "Nothing like it"')
})

test('whoami failing with a name says your choice', async ($, on) => {
  trace("FR-019-AC-8")
  const w = world(on, true)
  w.whoami.value = undefined
  choose(w, 'Beta', 'default')
  beta(w)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('your choice: Beta')
})

test('whoami failing with focus team says it could not tell who the session is', async ($, on) => {
  trace("FR-019-AC-9")
  const w = world(on, true)
  w.whoami.value = undefined
  choose(w, 'team', 'default')
  lead(w, null)
  await started($, w)
  expect((await shown($)).split('\n')).toContain('could not tell who this session is, showing every focus')
  // The order is the spec's: the name first, then the identity, then own, team and the rest.
  const detected = { hosts: 'local', teams: [], ownTeam: 'QSL', teamsSelected: false } as const
  expect(focusBanner({ ...detected, focus: 'Beta', identity: 'unknown' }, [])).toBe('your choice: Beta')
  expect(focusBanner({ ...detected, focus: 'own', identity: 'unknown' }, [])).toBe('could not tell who this session is, showing every focus')
  expect(focusBanner({ ...detected, focus: 'own', identity: 'detected' }, [])).toBe('no focus reported, showing the whole team')
})

// ---------------------------------------------------------------- FR-020 named focus resolution

test('the keywords own and team win over a definition named Own and the definition is not used', async ($, on) => {
  trace("FR-020-AC-1")
  const w = world(on, true)
  lead(w, null)
  choose(w, 'own')
  named(w, () => out(listJson(defRow(BETA, 'Own', 'QSL'))), { [BETA]: () => out(showJson('Own', 'QSL', { projects: ['p1'] })) })
  await started($, w)
  expect(focusCalls(w)).toEqual([])
  const lines = await pageLines($)
  expect((await shown($)).split('\n')).toContain('own focus')
  expect(lines).not.toContain('Own')
})

test('a definition is matched by its name or its focus_id, ignoring case, and shows progress over its members', async ($, on) => {
  trace("FR-020-AC-2")
  const w = world(on, true)
  choose(w, 'BETA')
  beta(w)
  await started($, w)
  shows(await pageLines($), /^5\/10$/)
  expect(statusCalls(w)).toEqual(['--project p1'])
  expect(focusCalls(w)).toEqual(['list --json', `show ${BETA} --json`])
  // The focus_id in upper case, on the next refresh.
  await $.command.run({ command: 'factory', args: `focus ${BETA.toUpperCase()}` } as never)
  await w.clock!.advance(1000)
  const lines = await pageLines($)
  shows(lines, /^your choice: FOC-0123456789ABCDEF0123456789ABCDEF$/)
  shows(lines, /^5\/10$/)
  expect(focusCalls(w).filter(c => c === `show ${BETA} --json`)).toHaveLength(2)
})

test('with definitions named Beta for two teams the session team’s one is used', async ($, on) => {
  trace("FR-020-AC-3")
  const w = world(on, true)
  choose(w, 'Beta')
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'), defRow(ENG, 'Beta', 'ENG'))), {
    [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['qsl-project'] })),
    [ENG]: () => out(showJson('Beta', 'ENG', { projects: ['eng-project'] })),
  })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  expect(focusCalls(w)).toEqual(['list --json', `show ${BETA} --json`])
  expect(statusCalls(w)).toEqual(['--project qsl-project'])
})

test('with whoami failing both definitions are shown and two matched is said', async ($, on) => {
  trace("FR-020-AC-3")
  const w = world(on, true)
  w.whoami.value = undefined
  choose(w, 'Beta', 'default')
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'), defRow(ENG, 'Beta', 'ENG'))), {
    [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['qsl-project'] })),
    [ENG]: () => out(showJson('Beta', 'ENG', { projects: ['eng-project'] })),
  })
  board(w, { combined: args => pageOf(`Pn ${args[1]}`, 1, 2) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^2 focuses matched "Beta"$/)
  shows(lines, /^label qsl-project$/)
  shows(lines, /^label eng-project$/)
})

test('with no definition the lead summary equal to the name is shown', async ($, on) => {
  trace("FR-020-AC-4")
  const w = world(on, true)
  lead(w, null, 'Release Train')
  choose(w, 'release train')
  named(w, () => out(listJson()))
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^Release Train$/)
  hides(lines, /^no focus matches/)
  // And a name contained in a summary matches it when none is equal.
  w.leads.set(LEAD, report(LEAD, 'The Release Train, all of it'))
  await w.clock!.advance(2 * MIN + 1000)
  shows(await pageLines($), /^The Release Train, all of it$/)
})

test('a list that exits non-zero or prints text that is not JSON shows a source error and the lead address resolves', async ($, on) => {
  trace("FR-020-AC-5")
  const w = world(on, true)
  w.leads.set('host1:QSL:code', report('host1:QSL:code', 'Host one focus'))
  choose(w, 'host1:QSL:code')
  let mode: 'exit' | 'text' = 'exit'
  named(w, () => (mode === 'exit' ? out('', 1, 'agent-msg: relay store unavailable') : out('not json at all')))
  await started($, w)
  let lines = await pageLines($)
  shows(lines, /^agent-msg focuses: list: agent-msg: relay store unavailable$/)
  shows(lines, /^Host one focus$/)
  mode = 'text'
  // A source that failed is read after twice its interval (FR-027).
  await w.clock!.advance(4 * MIN + 1000)
  lines = await pageLines($)
  shows(lines, /^agent-msg focuses: list: agent-msg focuses list --json printed text that is not JSON$/)
  shows(lines, /^Host one focus$/)
})

test('a definition whose selection is empty shows its name and says it selects nothing, and ix-board is not called', async ($, on) => {
  trace("FR-020-AC-6")
  const w = world(on, true)
  choose(w, 'Beta')
  beta(w, { show: () => out(showJson('Beta', 'QSL', {}, {}, { empty: true })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /Beta/)
  shows(lines, /^this focus selects nothing$/)
  expect(statusCalls(w)).toEqual([])
})

test('a definition whose selection cannot be decoded shows its name and says the selection is unavailable', async ($, on) => {
  trace("FR-020-AC-7")
  const w = world(on, true)
  choose(w, 'Beta')
  beta(w, { show: () => out(showJson('Beta', 'QSL', {}, {}, { definition: null })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /Beta/)
  shows(lines, /^the selection of this focus is unavailable$/)
  expect(statusCalls(w)).toEqual([])
})

test('a definition with an exclusion says the exclusions are not applied to progress', async ($, on) => {
  trace("FR-020-AC-8")
  const w = world(on, true)
  choose(w, 'Beta')
  beta(w, { show: () => out(showJson('Beta', 'QSL', { projects: ['p1'] }, { tickets: ['QSL-9'] })) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^exclusions are not applied to progress$/)
  shows(lines, /^5\/10$/)
})

test('an archived definition returned by list is not used', async ($, on) => {
  trace("FR-020-AC-9")
  const w = world(on, true)
  choose(w, 'Beta')
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL', 'archived'))), { [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['p1'] })) })
  board(w, { combined: () => pageOf('Payments ledger', 5, 10) })
  await started($, w)
  expect(focusCalls(w)).toEqual(['list --json'])
  shows(await pageLines($), /^no focus matches "Beta"$/)
})

test('with nothing matching the pane shows no focus and says nothing matched', async ($, on) => {
  trace("FR-020-AC-10")
  const w = world(on, true)
  lead(w, null, 'Release train')
  choose(w, 'zzz')
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'))))
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^0 focuses$/)
  shows(lines, /^no focus matches "zzz"$/)
  hides(lines, /^Release train$/)
})

test('an unavailable row is matched by its focus_id alone and shows the id and the reason with no progress', async ($, on) => {
  trace("FR-020-AC-12")
  const w = world(on, true)
  choose(w, BETA.toUpperCase())
  named(w, () => out(listJson(stubRow(BETA, 'the stored selection is not readable'))))
  board(w, { combined: () => pageOf('x', 1, 2) })
  await started($, w)
  let lines = await pageLines($)
  expect(await paneButtons($)).toContain(`▾ ${BETA}`)
  shows(lines, /^the stored selection is not readable$/)
  expect(statusCalls(w)).toEqual([])
  expect(focusCalls(w)).toEqual(['list --json'])
  hides(lines, /done/)
  // A name equal to no field of the row never matches it: not its code, not its reason.
  for (const name of ['unavailable_definition', 'the stored selection is not readable', 'false']) {
    await $.command.run({ command: 'factory', args: `focus ${name}` } as never)
    await w.clock!.advance(1000)
    lines = await pageLines($)
    shows(lines, new RegExp(`^no focus matches "${name}"$`))
  }
})

test('a show that fails or prints text that is not JSON shows a source error and the lead steps follow', async ($, on) => {
  trace("FR-020-AC-13")
  const w = world(on, true)
  lead(w, null, 'Beta')
  choose(w, 'Beta')
  let mode: 'exit' | 'text' = 'exit'
  beta(w, { show: () => (mode === 'exit' ? out('', 1, 'agent-msg: definition unreadable') : out('{ nope')) })
  await started($, w)
  let lines = await pageLines($)
  shows(lines, new RegExp(`^agent-msg focuses: show ${BETA}: agent-msg: definition unreadable$`))
  shows(lines, /^Beta$/)
  mode = 'text'
  // A source that failed is read after twice its interval (FR-027).
  await w.clock!.advance(4 * MIN + 1000)
  lines = await pageLines($)
  shows(lines, /printed text that is not JSON/)
  shows(lines, /^Beta$/)
})

test('a list or show that never returns is given up on after 5 seconds and the lead steps follow', async ($, on) => {
  trace("FR-020-AC-14", "NFR-004-M-2")
  const w = world(on, true)
  lead(w, null, 'Beta')
  choose(w, 'Beta')
  const timeouts: (number | undefined)[] = []
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv[1] === 'focuses' ? (timeouts.push(init?.timeoutMs), w.clock!.sleep(init?.timeoutMs ?? 5000).then(() => Promise.reject(new Error('timed out')))) : prior?.(argv, init))
  await startSession($)
  await onScreen($)
  // A view is read once its drawing has stood for 150 ms.
  await w.clock!.advance(150 + 4900)
  hides(await paneLines($), /^Beta$/)
  await w.clock!.advance(200)
  const lines = await pageLines($)
  expect(timeouts).toEqual([5000])
  shows(lines, /^Beta$/)
  shows(lines, /^agent-msg focuses: list: .+/)
})

test('a name given as team:segment shows every lead on several hosts and says how many matched', async ($, on) => {
  trace("FR-020-AC-15")
  const w = world(on, true)
  w.leads.set('host1:QSL:code', report('host1:QSL:code', 'Host one focus'))
  w.leads.set('host2:QSL:code', report('host2:QSL:code', 'Host two focus'))
  w.leads.set('host2:ENG:code', report('host2:ENG:code', 'Other team'))
  choose(w, 'QSL:CODE')
  named(w, () => out(listJson()))
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^2 focuses matched "QSL:CODE"$/)
  shows(lines, /^Host one focus$/)
  shows(lines, /^Host two focus$/)
  hides(lines, /^Other team$/)
  expect(matchLeads('QSL:CODE', ['host1:QSL:code', 'host2:ENG:code'])).toEqual(['host1:QSL:code'])
  expect(matchLeads('HOST1:qsl:code', ['host1:QSL:code', 'host2:QSL:code'])).toEqual(['host1:QSL:code'])
  expect(matchLeads('code', ['host1:QSL:code'])).toEqual([])
})

test('when the members of the named definition change between refreshes the second computes progress over the new members', async ($, on) => {
  trace("FR-020-AC-16")
  const w = world(on, true)
  choose(w, 'Beta')
  let members = ['p1']
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'))), { [BETA]: () => out(showJson('Beta', 'QSL', { projects: members })) })
  board(w, { combined: args => pageOf(args[1]!, 5, 10) })
  await started($, w)
  expect(statusCalls(w)).toEqual(['--project p1'])
  members = ['p1', 'p2']
  await w.clock!.advance(2 * MIN + 1000)
  expect(statusCalls(w).slice(-1)).toEqual(['--project p1 --project p2'])
})

test('two active definitions with the same name of one team are both shown and the pane says how many matched', async ($, on) => {
  const w = world(on, true)
  choose(w, 'Beta')
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'), defRow(ENG, 'Beta', 'QSL'))), {
    [BETA]: () => out(showJson('Beta', 'QSL', { projects: ['p1'] })),
    [ENG]: () => out(showJson('Beta', 'QSL', { projects: ['p2'] })),
  })
  board(w, { combined: args => pageOf(`Pn ${args[1]}`, 1, 2) })
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^2 focuses matched "Beta"$/)
  shows(lines, /^label p1$/)
  shows(lines, /^label p2$/)
})

test('a show that never returns is given up on after 5 seconds, the error is shown and the lead steps follow', async ($, on) => {
  trace("FR-020-AC-14", "NFR-004-M-2")
  const w = world(on, true)
  lead(w, null, 'Beta')
  choose(w, 'Beta')
  const timeouts: (number | undefined)[] = []
  named(w, () => out(listJson(defRow(BETA, 'Beta', 'QSL'))), { [BETA]: () => out('') })
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv[2] === 'show' ? (timeouts.push(init?.timeoutMs), w.clock!.sleep(init?.timeoutMs ?? 5000).then(() => Promise.reject(new Error('timed out')))) : prior?.(argv, init))
  await startSession($)
  await onScreen($)
  // A view is read once its drawing has stood for 150 ms.
  await w.clock!.advance(150 + 4900)
  hides(await paneLines($), /^Beta$/)
  await w.clock!.advance(200)
  const lines = await pageLines($)
  expect(timeouts).toEqual([5000])
  shows(lines, /^Beta$/)
  shows(lines, new RegExp(`^agent-msg focuses: show ${BETA}: .+`))
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

test('a name that is the address of a lead whose work show fails shows that error and not only nothing matched', async ($, on) => {
  trace("FR-018-AC-2")
  const w = world(on, true)
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'Fine'))
  w.leads.set('draco:QSL:plan', undefined)
  choose(w, 'draco:QSL:plan')
  named(w, () => out(listJson()))
  await started($, w)
  const lines = await pageLines($)
  shows(lines, /^agent-msg work: draco:QSL:plan: no report$/)
  shows(lines, /^no focus matches "draco:QSL:plan"$/)
})

test('the banner calls the focus own only when the session’s own address has an entry', async () => {
  trace("FR-019-AC-2", "FR-019-AC-4")
  const entry = (address: string) => ({ address, via: null }) as never
  const scope = { hosts: 'local', teams: ['QSL'], ownTeam: 'QSL', ownAddress: 'draco:QSL:code', teamsSelected: false, focus: 'own', identity: 'detected' } as const
  expect(focusBanner(scope, [entry('draco:ENG:code')])).toBe('no focus reported, showing the whole team')
  expect(focusBanner(scope, [entry('draco:QSL:arch')])).toBe('no focus reported, showing the whole team')
  expect(focusBanner(scope, [entry('draco:ENG:code'), entry('DRACO:qsl:code')])).toBe('own focus')
})
