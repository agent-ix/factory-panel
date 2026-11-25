import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { MODULE_IDS, buildCells, scopeFocuses, scopeNotes, statusOf } from '../hooks/band/modules'
import type { Scope } from '../hooks/band/modules'
import { helpText, runFactory, showText } from '../hooks/router'
import { FALLBACK_MODULES, decide, getSelection, keyOf, modulesToDraw, parseFile, parseIdentity, refreshSelection } from '../hooks/selection'
import type { FocusView } from '../types'
import { CLASSIC, FULLSCREEN, FP, HOME, bandCells, bandLine, drawBand, fake$, options, report, settle, startSession, whoamiLine, world } from './world'
import type { World } from './world'

// Tests for the feature selection requirements: relay identity (FR-005), the fallback and the
// features (FR-002, FR-010), the declaration (FR-011), precedence (FR-012), scoping (FR-013), the
// user's choice (FR-014), the files (FR-015) and that none of it blocks (NFR-004).

const KEY = 'draco_QSL_code'
const feature = (w: World, picked: unknown, key = KEY) => void w.files.set(`${FP}/features/${key}.json`, typeof picked === 'string' ? picked : JSON.stringify(picked))
const choice = (w: World, picked: unknown, key = KEY) => void w.files.set(`${FP}/choices/${key}.json`, typeof picked === 'string' ? picked : JSON.stringify(picked))
/** Reads the files as one refresh would, through the stand-in for `$`. */
const refresh = (w: World) => refreshSelection(fake$(w) as never)
const run = (w: World, args: string, full = false) => runFactory(fake$(w) as never, options(), args, full)
const written = (w: World, kind: 'features' | 'choices', key = KEY): unknown => JSON.parse(w.files.get(`${FP}/${kind}/${key}.json`) ?? 'null')
const hasNoMark = (text: string) => !/\[(user|declaration|default)\]/.test(text)

const focusView = (address: string, summary: string, over: Partial<FocusView> = {}): FocusView => ({
  address,
  machine: address.split(':')[0]!,
  kind: 'claude',
  summary,
  status: 'working',
  scope: { initiatives: 0, projects: 1, tickets: 0 },
  focusReportedAt: null,
  fetchedAt: null,
  projects: [{ name: 'ledger', done: 5, total: 10, inProgress: 2, ready: 0, at: null, old: false, error: null }],
  ready: 4,
  error: null,
  title: null,
  via: null,
  failures: [],
  counts: null,
  partial: false,
  notes: [],
  ...over,
})
const machine = (name: string) => ({ name, lastSeenSecs: 5, leads: 1, panesWorking: 1, panesIdle: 0, panesDone: 0, cpuPct: 10, memPct: 10, tempC: null, spend24hUsd: 3 })
const scope = (over: Partial<Scope> = {}): Scope => ({ hosts: 'local', focus: 'own', teams: ['QSL'], ownTeam: 'QSL', teamsSelected: false, identity: 'detected', ...over })

/** A world whose own lead (draco:QSL:code) has a focus and a lane, so every fallback cell has something to say. */
function fullWorld(w: World): void {
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'QSL layer 4'))
  w.boardAgents.push({ team: 'QSL', agent: 'draco:QSL:code', herdr_status: 'working', machine: 'draco' })
}

/** Starts a session, lets what it reads settle, and draws the classic band. */
async function band($: Parameters<TestBody>[0], view = CLASSIC) {
  await startSession($)
  await settle()
  return drawBand($, view)
}

// ---------------------------------------------------------------- FR-005 relay identity

test('the relay address host1:QSL:code scopes to team QSL and asks nothing', async () => {
  trace("FR-005-AC-1")
  const w = world(() => undefined as never)
  // The real output has the location source and the models after the address.
  w.whoami.value = whoamiLine('host1:QSL:code')
  const sel = await refresh(w)
  expect(sel.identity).toEqual({ status: 'detected', address: 'host1:QSL:code', host: 'host1', team: 'QSL', segment: 'code' })
  expect(sel.teams).toEqual({ value: ['QSL'], source: 'default' })
  expect(w.asks).toEqual([])
})

test('the third segment of the address is not interpreted: plan, code and zzz give the same band', async ($, on) => {
  trace("FR-005-AC-2")
  const w = world(on)
  fullWorld(w)
  const seen: string[][] = []
  for (const segment of ['plan', 'code', 'zzz']) {
    w.whoami.value = `draco:QSL:${segment}`
    w.leads.clear()
    w.leads.set(`draco:QSL:${segment}`, report(`draco:QSL:${segment}`, 'QSL layer 4'))
    const ui = await band($)
    seen.push(await bandCells(ui))
    await ui.unmount()
  }
  expect(seen[0]).toEqual(['local', 'focus', 'lead', 'lanes'])
  expect(seen[1]).toEqual(seen[0])
  expect(seen[2]).toEqual(seen[0])
})

test('an unreadable whoami output and the text no placement each leave the identity not detected', async () => {
  trace("FR-005-AC-3")
  expect(parseIdentity('agent-msg: this session has no verified Herdr placement')).toEqual({ status: 'unknown' })
  expect(parseIdentity('no placement')).toEqual({ status: 'unknown' })
  expect(parseIdentity('')).toEqual({ status: 'unknown' })
  expect(parseIdentity('a:b')).toEqual({ status: 'unknown' })
  const w = world(() => undefined as never)
  w.whoami.value = undefined
  expect((await refresh(w)).identity).toEqual({ status: 'unknown' })
  expect(await showText(fake$(w) as never, getSelection())).toMatch(/could not tell who this session is/)
})

test('a stored 0.4.0 role answer and a role setting change nothing', { options: { role: 'coordinator' } }, async ($, on) => {
  trace("FR-005-AC-4")
  const w = world(on)
  fullWorld(w)
  w.store.set('role./proj', 'coordinator')
  const ui = await band($)
  expect(await bandCells(ui)).toEqual(['local', 'focus', 'lead', 'lanes'])
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-002 and FR-010 fallback and features

test('with nothing selected the band shows local, focus, lead and lanes and no host list', async ($, on) => {
  trace("FR-002-AC-1", "FR-002-AC-2")
  const w = world(on)
  fullWorld(w)
  const ui = await band($)
  expect(await bandCells(ui)).toEqual(['local', 'focus', 'lead', 'lanes'])
  expect(await ui.find({ key: 'health' })).toBeUndefined()
  await ui.unmount()
  expect(FALLBACK_MODULES).toEqual(['local', 'focus', 'lead', 'lanes'])
})

test('with hosts all selected the band names each machine and with hosts local only this one', () => {
  trace("FR-002-AC-3", "FR-013-AC-3")
  const s = { ...snapshotOf(), machines: [machine('draco'), machine('luna'), machine('titan')] }
  const all = decide(parseIdentity('draco:QSL:code'), {}, { hosts: 'all' }, [], false)
  expect(modulesToDraw(all)[0]).toBe('health')
  const named = (hosts: 'all' | 'local') => buildCells(['health'], { ...s, scope: scope({ hosts }) })[0]!.parts.map(p => p.text).join('')
  expect(named('all')).toMatch(/draco.*luna.*titan/)
  expect(named('local')).toMatch(/draco/)
  expect(named('local')).not.toMatch(/luna|titan/)
  expect(modulesToDraw(decide(parseIdentity('draco:QSL:code'), {}, {}, [], false))).not.toContain('health')
})

test('each module of the module-to-view table, selected in turn, draws its cell', () => {
  trace("FR-010-AC-1")
  const esc = { id: 'a', status: 'waiting' as const, ticket: '', lead: '', filed: '', machine: '', kind: '', context: '', options: [], recommendation: '', decision: '', hasDetail: false }
  const s = {
    ...snapshotOf(),
    escalations: [esc],
    relay: { ok: true, redis: 'ok', watchers: [], warnings: 0, deadLetters: 1, inboxWaiting: 2, checks: [] },
    teamViews: [{ team: 'QSL', metrics: [{ key: 'k', label: 'Closures', unit: 'count', better: 'up', value: 3, history: [] }] }] as never,
  }
  for (const id of MODULE_IDS) expect(buildCells([id], s).map(c => c.id)).toEqual([id])
})

test('with the address host1:ENG:arch and nothing selected the band shows the fallback modules and no other', () => {
  trace("FR-010-AC-2")
  const sel = decide(parseIdentity('host1:ENG:arch'), {}, {}, [], false)
  expect(sel.modules).toEqual({ value: [...FALLBACK_MODULES], source: 'default' })
  expect(modulesToDraw(sel)).toEqual([...FALLBACK_MODULES])
})

test('with nothing selected and whoami failing the band shows the fallback modules', async ($, on) => {
  trace("FR-010-AC-3")
  const w = world(on)
  w.whoami.value = undefined
  const sel = decide({ status: 'unknown' }, {}, {}, [], false)
  expect(sel.modules.value).toEqual([...FALLBACK_MODULES])
  expect(modulesToDraw(sel)).toEqual(['health', ...FALLBACK_MODULES])
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'QSL layer 4'))
  const ui = await band($)
  expect(await bandCells(ui)).toEqual(['health', 'local', 'focus', 'lead'])
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-009 order and unknown names

test('with the selection focus,nope,focus,local the band shows focus then local, with digits 1 and 2', async ($, on) => {
  trace("FR-009-AC-4")
  const w = world(on)
  fullWorld(w)
  feature(w, { modules: ['focus', 'nope', 'focus', 'local'] })
  const ui = await band($)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.key)).toEqual(['focus', 'local'])
  expect(buttons.map(b => (b.props as { hotkey?: string }).hotkey)).toEqual(['1', '2'])
  await ui.unmount()
  expect(buildCells(['focus', 'nope', 'focus', 'local'], snapshotOf()).map(c => c.id)).toEqual(['focus', 'local'])
})

// ---------------------------------------------------------------- FR-011 declaration

test('a declaration of queue and lanes makes the band show queue and lanes only', async ($, on) => {
  trace("FR-011-AC-1")
  const w = world(on)
  fullWorld(w)
  feature(w, { modules: ['queue', 'lanes'] })
  const ui = await band($)
  expect(await bandCells(ui)).toEqual(['queue', 'lanes'])
  await ui.unmount()
})

test('a replaced declaration no longer applies what the earlier one said', async () => {
  trace("FR-011-AC-2")
  const w = world(() => undefined as never)
  feature(w, { modules: ['queue'], hosts: 'all' })
  const first = await refresh(w)
  expect(first.hosts).toEqual({ value: 'all', source: 'declaration' })
  feature(w, { modules: ['queue'] })
  const second = await refresh(w)
  expect(second.hosts).toEqual({ value: 'local', source: 'default' })
  expect(second.modules).toEqual({ value: ['queue'], source: 'declaration' })
})

test('the same declaration twice gives the same band and a rewrite changes it at the next refresh', async ($, on) => {
  trace("FR-011-AC-3")
  const w = world(on, true)
  fullWorld(w)
  feature(w, { modules: ['queue', 'lanes'] })
  await startSession($)
  await w.clock!.advance(1000)
  const cells = async () => {
    const ui = await drawBand($, CLASSIC)
    const ids = await bandCells(ui)
    await ui.unmount()
    return ids
  }
  const first = await cells()
  feature(w, { modules: ['queue', 'lanes'] })
  await w.clock!.advance(15_000)
  expect(await cells()).toEqual(first)
  feature(w, { modules: ['lanes', 'queue'] })
  expect(await cells()).toEqual(first)
  await w.clock!.advance(15_000)
  expect(await cells()).toEqual(['lanes', 'queue'])
})

test('a declaration with an unknown key applies its known keys and nothing fails', async () => {
  trace("FR-011-AC-4")
  const w = world(() => undefined as never)
  feature(w, { modules: ['queue'], colour: 'blue', hosts: 'all' })
  const sel = await refresh(w)
  expect(sel.modules.value).toEqual(['queue'])
  expect(sel.hosts.value).toBe('all')
})

test('a modules list that is empty, has only unknown names, or is not a list shows the fallback and /factory show says why', async () => {
  trace("FR-011-AC-5")
  for (const modules of [[], ['nope', 'zilch'], 'queue', 7]) {
    const w = world(() => undefined as never)
    feature(w, { modules })
    const text = await run(w, 'show')
    expect(getSelection().modules).toEqual({ value: [...FALLBACK_MODULES], source: 'default' })
    expect(text).toMatch(new RegExp(`Note: .*features/${KEY}.json: modules ignored`))
  }
})

test('a declaration that is not valid JSON or not an object is ignored with one note naming the file and the reason', async () => {
  trace("FR-011-AC-6")
  for (const [text, reason] of [['{ not json', /not valid JSON/], ['["queue"]', /not a JSON object/], ['"queue"', /not a JSON object/]] as const) {
    const w = world(() => undefined as never)
    feature(w, text)
    const shown = await run(w, 'show')
    expect(getSelection().modules).toEqual({ value: [...FALLBACK_MODULES], source: 'default' })
    const notes = getSelection().notes
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain(`~/.ix/factory-panel/features/${KEY}.json`)
    expect(notes[0]).toMatch(reason)
    expect(shown).toContain(notes[0]!)
  }
  expect(parseFile('{}', 'f').notes).toEqual([])
})

test('the same malformed declaration over three refreshes is in the band once and in /factory show every time', async ($, on) => {
  trace("FR-011-AC-7")
  const w = world(on, true)
  fullWorld(w)
  feature(w, '{ not json')
  await startSession($)
  await w.clock!.advance(1000)
  const lineNow = async () => {
    const ui = await drawBand($, CLASSIC)
    const line = await bandLine(ui)
    await ui.unmount()
    return line
  }
  const showNow = async () => (await $.command.run({ command: 'factory', args: 'show' })).text
  expect(await lineNow()).toMatch(/features\/draco_QSL_code\.json: ignored, not valid JSON/)
  expect(await showNow()).toMatch(/Note: .*not valid JSON/)
  await w.clock!.advance(15_000)
  expect(await lineNow()).toBeUndefined()
  expect(await showNow()).toMatch(/Note: .*not valid JSON/)
  await w.clock!.advance(15_000)
  expect(await lineNow()).toBeUndefined()
  expect(await showNow()).toMatch(/Note: .*not valid JSON/)
})

test('with no ~/.ix/factory-panel directory the band shows the fallback, no note, and nothing is created', async ($, on) => {
  trace("FR-011-AC-8")
  const w = world(on)
  w.whoami.value = undefined // no team, so no board read: the Linear cache is the one other writer under this directory
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'QSL layer 4'))
  const ui = await band($)
  expect(await bandCells(ui)).toContain('local')
  expect(await bandLine(ui)).toMatch(/could not tell who this session is/)
  expect(getSelection().notes).toEqual([])
  expect(w.writes).toEqual([])
  await ui.unmount()
})

test('each session follows the declaration of its own key', async ($, on) => {
  trace("FR-011-AC-9")
  const w = world(on)
  w.leads.set('host1:QSL:code', report('host1:QSL:code', 'QSL layer 4'))
  feature(w, { modules: ['focus'] }, 'host1_QSL_code')
  feature(w, { modules: ['local'] }, 'host2_ENG_plan')
  const seen: string[][] = []
  for (const address of ['host1:QSL:code', 'host2:ENG:plan']) {
    w.whoami.value = address
    const ui = await band($)
    seen.push(await bandCells(ui))
    await ui.unmount()
  }
  expect(seen).toEqual([['focus'], ['local']])
})

test('the key file wins over default.json and removing it falls back to default.json', async () => {
  trace("FR-011-AC-10")
  const w = world(() => undefined as never)
  feature(w, { modules: ['queue'] })
  feature(w, { modules: ['lanes'] }, 'default')
  expect((await refresh(w)).modules.value).toEqual(['queue'])
  w.files.delete(`${FP}/features/${KEY}.json`)
  expect((await refresh(w)).modules.value).toEqual(['lanes'])
})

test('the snippet in the help parses as a declaration the mod accepts and names the path for the session key', async () => {
  trace("FR-011-AC-11", "FR-008-AC-6")
  const w = world(() => undefined as never)
  w.whoami.value = 'host1:QSL:code'
  await refresh(w)
  for (const full of [false, true]) {
    const text = helpText(full)
    expect(text).toContain('~/.ix/factory-panel/features/host1_QSL_code.json')
    const line = text.split('\n').find(l => /^\s*\{.*\}\s*$/.test(l))!
    const parsed = parseFile(line, 'snippet')
    expect(parsed.notes).toEqual([])
    expect(Object.keys(parsed.picked).sort()).toEqual(['focus', 'hosts', 'modules', 'teams'])
    for (const command of ['use', 'focus', 'teams', 'hosts', 'show', 'reset']) expect(text).toContain(`/factory ${command}`)
  }
  w.whoami.value = undefined
  world(() => undefined as never)
  await refresh(w)
  expect(helpText(false)).toContain('features/default.json')
})

test('an address that tries to leave the directory gives a key of safe characters and a file directly inside features', async () => {
  trace("FR-011-AC-12")
  const w = world(() => undefined as never)
  w.whoami.value = 'host1:QSL:../../x'
  const sel = await refresh(w)
  expect(sel.key).toMatch(/^[A-Za-z0-9_.-]+$/)
  expect(keyOf(parseIdentity('host1:QSL:../../x'))).toBe(sel.key)
  const features = w.reads.filter(p => p.startsWith(`${FP}/features/`))
  expect(features.length).toBeGreaterThan(0)
  for (const p of features) expect(p.slice(`${FP}/features/`.length)).not.toContain('/')
  expect(features).toContain(`${FP}/features/${sel.key}.json`)
})

// ---------------------------------------------------------------- FR-012 precedence

test('a user choice of modules beats a declaration of other modules', async () => {
  trace("FR-012-AC-1")
  const w = world(() => undefined as never)
  feature(w, { modules: ['relay', 'team'] })
  choice(w, { modules: ['queue'] })
  expect((await refresh(w)).modules).toEqual({ value: ['queue'], source: 'user' })
})

test('a user choice of modules and a declared focus scope show the user modules at the declared scope', async () => {
  trace("FR-012-AC-2")
  const w = world(() => undefined as never)
  feature(w, { modules: ['relay'], focus: 'team' })
  choice(w, { modules: ['queue'] })
  const sel = await refresh(w)
  expect(sel.modules).toEqual({ value: ['queue'], source: 'user' })
  expect(sel.focus).toEqual({ value: 'team', source: 'declaration' })
})

test('a declaration naming teams ENG shows lanes for ENG although the session is QSL', async ($, on) => {
  trace("FR-012-AC-3")
  const w = world(on)
  w.boardAgents.push({ team: 'ENG', agent: 'a:ENG:code', herdr_status: 'working', machine: 'draco' }, { team: 'QSL', agent: 'b:QSL:code', herdr_status: 'idle', machine: 'draco' }, { team: 'QSL', agent: 'c:QSL:plan', herdr_status: 'idle', machine: 'draco' })
  feature(w, { modules: ['lanes'], teams: ['ENG'] })
  const ui = await band($)
  expect((await ui.find({ key: 'lanes' }))?.text).toBe('1 working · 0 idle')
  await ui.unmount()
})

test('with nothing selected the focus and lead cells show the status of the relay report', async ($, on) => {
  trace("FR-012-AC-4")
  const w = world(on)
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'QSL layer 4', ['waiting']))
  const ui = await band($)
  expect((await ui.find({ key: 'focus' }))?.text).toMatch(/^QSL layer 4/)
  expect((await ui.find({ key: 'lead' }))?.text).toBe('lead draco:QSL:code ◌')
  await ui.unmount()
})

test('a lead\'s status is derived from the agents of its work report', () => {
  trace("FR-012-AC-7")
  const of = (...s: string[]) => statusOf(s.map(status => ({ status })))
  expect(of('done', 'failed')).toBe('failed')
  expect(of('running', 'waiting')).toBe('running')
  expect(of('waiting', 'done')).toBe('waiting')
  expect(of('done')).toBe('done')
  expect(of('canceled')).toBe('unknown')
  expect(statusOf(undefined)).toBe('unknown')
})

test('a plain /factory with nothing selected asks no question', async () => {
  trace("FR-012-AC-5")
  const w = world(() => undefined as never)
  const text = await run(w, '')
  expect(text).toMatch(/Focus is open/)
  expect(w.asks).toEqual([])
})

test('a user choice of teams or hosts beats a declaration naming other values', async () => {
  trace("FR-012-AC-6")
  const w = world(() => undefined as never)
  feature(w, { teams: ['ENG'], hosts: 'all' })
  choice(w, { teams: ['OPS'], hosts: 'local' })
  const sel = await refresh(w)
  expect(sel.teams).toEqual({ value: ['OPS'], source: 'user' })
  expect(sel.hosts).toEqual({ value: 'local', source: 'user' })
})

// ---------------------------------------------------------------- FR-013 scoping

const leads = [focusView('host1:QSL:code', 'QSL layer 4'), focusView('host2:ENG:code', 'Payments v2'), focusView('host3:SWM:code', 'Release train two')]

test('focus own shows only the entry of the session team', () => {
  trace("FR-013-AC-1")
  const own = scopeFocuses(leads, scope())
  expect(own.shown.map(f => f.address)).toEqual(['host1:QSL:code'])
})

test('focus team groups the lead entries under each listed team', async ($, on) => {
  trace("FR-013-AC-2")
  expect(scopeFocuses(leads, scope({ focus: 'team', teams: ['QSL', 'ENG'] })).shown.map(f => f.address)).toEqual(['host1:QSL:code', 'host2:ENG:code'])
  const w = world(on)
  for (const f of leads) w.leads.set(f.address, report(f.address, f.summary))
  feature(w, { focus: 'team', teams: ['QSL', 'ENG'] })
  await startSession($)
  await settle()
  const ui = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'Pane', requestId: 'focus', props: { title: 'Focus', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never })
  const heads = (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t === 'QSL' || t === 'ENG')
  expect(heads).toEqual(['QSL', 'ENG'])
  expect((await ui.findAll({ type: 'Text', text: /SWM|Release train/ }))).toEqual([])
  await ui.unmount()
})

test('a focus name equal to one summary ignoring case shows exactly that focus', () => {
  trace("FR-013-AC-4")
  const r = scopeFocuses([...leads, focusView('host4:OPS:code', 'Payments v2 follow-up')], scope({ focus: 'PAYMENTS V2' }))
  expect(r.shown.map(f => f.address)).toEqual(['host2:ENG:code'])
  expect(r.note).toBeNull()
})

test('a focus name contained in two summaries and equal to neither shows both and says two matched', () => {
  trace("FR-013-AC-5")
  const r = scopeFocuses(leads, scope({ focus: 'two' }))
  expect(r.shown).toHaveLength(1)
  const two = scopeFocuses([...leads, focusView('host4:OPS:code', 'Layer two')], scope({ focus: 'two' }))
  expect(two.shown.map(f => f.address)).toEqual(['host3:SWM:code', 'host4:OPS:code'])
  expect(two.note).toBe('2 focuses matched "two"')
  expect(scopeNotes({ ...snapshotOf(), focuses: [...leads, focusView('host4:OPS:code', 'Layer two')], scope: scope({ focus: 'two' }) })).toContain('2 focuses matched "two"')
})

test('a focus name that matches no summary shows no focus and says nothing matched', () => {
  trace("FR-013-AC-6")
  const r = scopeFocuses(leads, scope({ focus: 'zzz' }))
  expect(r.shown).toEqual([])
  expect(r.note).toBe('no focus matches "zzz"')
  expect(buildCells(['focus'], { ...snapshotOf(), focuses: leads, scope: scope({ focus: 'zzz' }) })).toEqual([])
  expect(scopeNotes({ ...snapshotOf(), focuses: leads, scope: scope({ focus: 'zzz' }) })).toContain('no focus matches "zzz"')
})

test('the focus value team wins over a focus summary that contains team', () => {
  trace("FR-013-AC-7")
  const withTeam = [...leads, focusView('host4:OPS:code', 'The team report')]
  const r = scopeFocuses(withTeam, scope({ focus: 'Team', teams: ['QSL'] }))
  expect(r.shown.map(f => f.address)).toEqual(['host1:QSL:code'])
  expect(r.note).toBeNull()
})

test('when whoami fails with no teams selection everything shows and the band says it could not tell who the session is', async ($, on) => {
  trace("FR-013-AC-8")
  const unknown = decide({ status: 'unknown' }, {}, {}, [], false)
  const s = scope({ ...{ hosts: unknown.hosts.value, focus: unknown.focus.value, teams: unknown.teams.value }, ownTeam: null, identity: 'unknown' })
  expect(s.hosts).toBe('all')
  expect(scopeFocuses(leads, s).shown).toHaveLength(3)
  const snap = { ...snapshotOf(), focuses: leads, scope: s }
  expect(scopeNotes(snap)).toContain('could not tell who this session is')
  const w = world(on)
  w.whoami.value = undefined
  const ui = await band($)
  expect(await bandLine(ui)).toMatch(/could not tell who this session is/)
  await ui.unmount()
})

test('when whoami fails and teams of ENG are selected focuses and lanes show only ENG', () => {
  trace("FR-013-AC-9")
  const s = scope({ ownTeam: null, identity: 'unknown', teams: ['ENG'], teamsSelected: true })
  expect(scopeFocuses(leads, s).shown.map(f => f.address)).toEqual(['host2:ENG:code'])
  const agents = [{ team: 'ENG', agent: 'a', status: 'working', machine: '', paneId: '', title: '', lastTurnAgeSecs: 1 }, { team: 'QSL', agent: 'b', status: 'idle', machine: '', paneId: '', title: '', lastTurnAgeSecs: 1 }]
  const cells = buildCells(['lanes'], { ...snapshotOf(), board: { teams: [], agents, error: null }, scope: s })
  expect(cells[0]!.parts.map(p => p.text).join('')).toBe('1 working · 0 idle')
})

test('lanes show the session team by default and the selected team when teams is set', () => {
  trace("FR-013-AC-10")
  const agents = [{ team: 'ENG', agent: 'a', status: 'working', machine: '', paneId: '', title: '', lastTurnAgeSecs: 1 }, { team: 'QSL', agent: 'b', status: 'idle', machine: '', paneId: '', title: '', lastTurnAgeSecs: 1 }, { team: 'QSL', agent: 'c', status: 'idle', machine: '', paneId: '', title: '', lastTurnAgeSecs: 1 }]
  const lanes = (teams: string[]) => buildCells(['lanes'], { ...snapshotOf(), board: { teams: [], agents, error: null }, scope: scope({ teams }) })[0]!.parts.map(p => p.text).join('')
  expect(lanes(decide(parseIdentity('host1:QSL:code'), {}, {}, [], false).teams.value)).toBe('0 working · 2 idle')
  expect(lanes(decide(parseIdentity('host1:QSL:code'), {}, { teams: ['ENG'] }, [], false).teams.value)).toBe('1 working · 0 idle')
})

// ---------------------------------------------------------------- FR-014 user choice

test('/factory use replaces the modules, a later use replaces them again, and a later session with the same key shows the last', async () => {
  trace("FR-014-AC-1")
  const w = world(() => undefined as never)
  await run(w, 'use queue,lanes')
  expect(getSelection().modules).toEqual({ value: ['queue', 'lanes'], source: 'user' })
  await run(w, 'use focus')
  expect(written(w, 'choices')).toEqual({ modules: ['focus'] })
  world(() => undefined as never) // a new session: nothing remembered but the files
  w.whoami.value = 'draco:QSL:code'
  expect((await refresh(w)).modules).toEqual({ value: ['focus'], source: 'user' })
})

test('focus, teams and hosts each change the named scope and no other', async () => {
  trace("FR-014-AC-2")
  const w = world(() => undefined as never)
  await run(w, 'focus team')
  expect(written(w, 'choices')).toEqual({ focus: 'team' })
  await run(w, 'teams QSL')
  expect(written(w, 'choices')).toEqual({ focus: 'team', teams: ['QSL'] })
  await run(w, 'hosts all')
  expect(written(w, 'choices')).toEqual({ focus: 'team', teams: ['QSL'], hosts: 'all' })
})

test('/factory focus with a name that has spaces sets the whole name', async () => {
  trace("FR-014-AC-3")
  const w = world(() => undefined as never)
  await run(w, 'focus Release Train')
  expect(written(w, 'choices')).toEqual({ focus: 'Release Train' })
  expect(getSelection().focus).toEqual({ value: 'Release Train', source: 'user' })
})

test('/factory hosts with a bad value names all and local and leaves the scope unchanged', async () => {
  trace("FR-014-AC-4")
  const w = world(() => undefined as never)
  choice(w, { hosts: 'all' })
  const text = await run(w, 'hosts bogus')
  expect(text).toMatch(/all, local/)
  expect(w.writes).toEqual([])
  expect(written(w, 'choices')).toEqual({ hosts: 'all' })
})

test('/factory use with an unknown module or no argument names the valid modules and changes nothing', async () => {
  trace("FR-014-AC-5")
  const w = world(() => undefined as never)
  for (const args of ['use bogus', 'use queue,bogus', 'use']) {
    const text = await run(w, args)
    for (const id of MODULE_IDS) expect(text).toContain(id)
  }
  expect(w.writes).toEqual([])
})

test('/factory teams NOPE keeps NOPE and the band says team NOPE matched nothing', async ($, on) => {
  trace("FR-014-AC-6")
  const w = world(on)
  fullWorld(w)
  await startSession($)
  await settle()
  await $.command.run({ command: 'factory', args: 'teams NOPE' })
  await settle()
  expect(written(w, 'choices')).toEqual({ teams: ['NOPE'] })
  const ui = await drawBand($, CLASSIC)
  expect(await bandLine(ui)).toMatch(/team NOPE matched nothing/)
  await ui.unmount()
})

test('/factory show prints each feature with its value and where it came from', async () => {
  trace("FR-014-AC-7")
  const w = world(() => undefined as never)
  feature(w, { hosts: 'all', teams: ['ENG'] })
  choice(w, { modules: ['queue'], teams: ['OPS'] })
  const text = await run(w, 'show')
  expect(text).toMatch(/modules +queue +\[user\]/)
  expect(text).toMatch(/hosts +all +\[declaration\]/)
  expect(text).toMatch(/focus +own +\[default\]/)
  expect(text).toMatch(/teams +OPS +\[user\]/)
})

test('/factory show prints the session key and the third segment of the address', async () => {
  trace("FR-014-AC-8")
  const w = world(() => undefined as never)
  w.whoami.value = 'host1:QSL:code'
  const text = await run(w, 'show')
  expect(text).toContain('host1_QSL_code')
  expect(text).toMatch(/third segment: code\)/)
})

test('/factory reset returns each feature to its declaration or default and show says so', async () => {
  trace("FR-014-AC-9")
  const w = world(() => undefined as never)
  feature(w, { hosts: 'all' })
  choice(w, { modules: ['queue'], hosts: 'local', focus: 'team' })
  expect(await run(w, 'show')).toMatch(/hosts +local +\[user\]/)
  const reset = await run(w, 'reset')
  expect(reset).toMatch(/hosts +all +\[declaration\]/)
  expect(reset).toMatch(/modules +local, focus, lead, lanes +\[default\]/)
  expect(reset).toMatch(/Your choices: none/)
  expect(hasNoMark(reset)).toBe(false)
  expect(await run(w, 'show')).toMatch(/Your choices: none/)
})

test('choices made for one session do not change the band of another', async ($, on) => {
  trace("FR-014-AC-10")
  const w = world(on)
  w.leads.set('host2:ENG:plan', report('host2:ENG:plan', 'Payments v2'))
  w.whoami.value = 'host1:QSL:code'
  await startSession($)
  await settle()
  await $.command.run({ command: 'factory', args: 'use queue' })
  await settle()
  expect(written(w, 'choices', 'host1_QSL_code')).toEqual({ modules: ['queue'] })
  expect(w.files.has(`${FP}/choices/host2_ENG_plan.json`)).toBe(false)
  w.whoami.value = 'host2:ENG:plan'
  const ui = await band($)
  expect(await bandCells(ui)).toContain('local')
  expect(await bandCells(ui)).not.toContain('queue')
  await ui.unmount()
})

test('the help lists use, focus, teams, hosts, show and reset, each with an example', () => {
  trace("FR-014-AC-11")
  const text = helpText(false)
  for (const example of ['/factory use queue,lanes', '/factory focus team', '/factory focus Release Train', '/factory teams QSL,ENG', '/factory hosts all', '/factory show', '/factory reset']) expect(text).toContain(example)
})

test('the plugin registers /factory and the four aliases and no other command', async ($, on) => {
  trace("FR-014-AC-12")
  const w = world(on)
  await startSession($)
  await settle()
  expect([...w.registered].sort()).toEqual(['escalations', 'factory', 'focuses', 'relay', 'team'])
})

test('two sessions with the same key leave the last choice in effect for both', async () => {
  trace("FR-014-AC-13")
  const w = world(() => undefined as never)
  await run(w, 'use queue') // the first session
  await run(w, 'use lanes') // the second, same key
  world(() => undefined as never)
  w.whoami.value = 'draco:QSL:code'
  expect((await refresh(w)).modules.value).toEqual(['lanes'])
  expect(written(w, 'choices')).toEqual({ modules: ['lanes'] })
})

// ---------------------------------------------------------------- FR-015 files

test('after a Linear gate refresh the cache is at ~/.ix/factory-panel/linear-gate.json', async ($, on) => {
  trace("FR-015-AC-1", "FR-015-AC-3")
  const w = world(on)
  fullWorld(w)
  await startSession($)
  await settle()
  expect(w.files.has(`${FP}/linear-gate.json`)).toBe(true)
  expect(w.writes.filter(p => p.includes('/.cache/') || p.includes('/.config/'))).toEqual([])
  expect(w.writes.every(p => p.startsWith(`${FP}/`))).toBe(true)
})

test('only an old cache is read once as the initial cache, later writes go to the new path and the old file is unchanged', async ($, on) => {
  trace("FR-015-AC-2")
  const w = world(on, true)
  fullWorld(w)
  const old = JSON.stringify({ backoffUntil: null, entries: { 'agents:QSL': { at: Date.UTC(2026, 10, 24, 11, 50), claimAt: null, data: { agents: [{ team: 'QSL', agent: 'draco:QSL:code', status: 'idle', machine: 'draco', paneId: '', title: '', lastTurnAgeSecs: 1 }], notes: [] } } } })
  w.files.set(`${HOME_CACHE}/linear-gate.json`, old)
  await startSession($)
  await settle()
  // The old content answered: ix-board was not asked, and the cached agent shows (1 idle).
  expect(w.ran.filter(l => l.startsWith('ix-board'))).toEqual([])
  expect(w.files.has(`${FP}/linear-gate.json`)).toBe(false)
  const ui = await drawBand($, CLASSIC)
  expect((await ui.find({ key: 'lanes' }))?.text).toBe('0 working · 1 idle')
  await ui.unmount()
  // Once the cached read is old enough the next read goes to the new path.
  await w.clock!.advance(6 * 60_000)
  await settle()
  expect(w.ran.filter(l => l.startsWith('ix-board')).length).toBeGreaterThan(0)
  expect(w.files.has(`${FP}/linear-gate.json`)).toBe(true)
  expect(w.files.get(`${HOME_CACHE}/linear-gate.json`)).toBe(old)
  expect(w.writes).not.toContain(`${HOME_CACHE}/linear-gate.json`)
})

const HOME_CACHE = `${HOME}/.cache/factory-panel`

// ---------------------------------------------------------------- NFR-004 selection never blocks

test('a whoami that never returns leaves the band painted from the fallback, is given up on after five seconds, and then says the identity is unknown', async ($, on) => {
  trace("NFR-004-M-1")
  const w = world(on, true)
  w.whoamiMode.value = 'hang'
  fullWorld(w)
  const started = startSession($)
  const ui = await drawBand($, CLASSIC)
  expect(await bandCells(ui)).toContain('local')
  expect(await bandLine(ui)).toBeUndefined()
  await ui.unmount()
  expect(w.whoamiTimeout.value).toBe(5000)
  await w.clock!.advance(5000)
  await started
  await w.clock!.advance(1000)
  const after = await drawBand($, CLASSIC)
  expect(await bandCells(after)).toContain('local')
  expect(await bandLine(after)).toMatch(/could not tell who this session is/)
  await after.unmount()
})

test('a missing and a malformed declaration and a malformed choice file each still draw the band', async ($, on) => {
  trace("NFR-004-M-5")
  const w = world(on)
  fullWorld(w)
  for (const [declaration, chosen] of [[undefined, undefined], ['{ nope', undefined], [undefined, '[1,2'], ['{ nope', '"x"']] as const) {
    w.files.delete(`${FP}/features/${KEY}.json`)
    w.files.delete(`${FP}/choices/${KEY}.json`)
    if (declaration !== undefined) feature(w, declaration)
    if (chosen !== undefined) choice(w, chosen)
    const ui = await band($)
    expect(await bandCells(ui)).toEqual(['local', 'focus', 'lead', 'lanes'])
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- helpers

function snapshotOf() {
  return {
    machines: [machine('draco')],
    relay: { ok: true, redis: 'ok', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] },
    board: { teams: ['QSL'], agents: [{ team: 'QSL', agent: 'draco:QSL:code', status: 'working', machine: 'draco', paneId: 'p1', title: '', lastTurnAgeSecs: 3 }], error: null },
    focuses: [focusView('draco:QSL:code', 'QSL layer 4')],
    escalations: [],
    hiddenEscalations: [],
    localMachine: 'draco',
    scope: scope(),
    teamViews: [],
    focusesLoaded: true,
    prometheusError: null,
    relayAt: 1,
    relayError: null,
    boardError: null,
  } as Parameters<typeof buildCells>[1]
}

// ---------------------------------------------------------------- review follow-ups

test('a declaration that changes the focus scope re-reads the leads at the next refresh', async ($, on) => {
  const w = world(on, true)
  w.leads.set('draco:QSL:code', report('draco:QSL:code', 'QSL layer 4'))
  w.leads.set('draco:ENG:code', report('draco:ENG:code', 'Payments v2'))
  await startSession($)
  await w.clock!.advance(1000)
  const focusText = async () => {
    const ui = await drawBand($, CLASSIC)
    const text = (await ui.find({ key: 'focus' }))?.text
    await ui.unmount()
    return text
  }
  expect(await focusText()).not.toMatch(/\+1$/)
  feature(w, { focus: 'team', teams: ['QSL', 'ENG'] })
  await w.clock!.advance(15_000)
  await w.clock!.advance(1000)
  expect(await focusText()).toMatch(/\+1$/)
})

test('a malformed declaration is noted on every draw of the first band until the next refresh, and not consumed by a layout without a band or by a command', async ($, on) => {
  trace("FR-011-AC-7")
  const w = world(on, true)
  feature(w, '{ not json')
  await startSession($)
  await w.clock!.advance(1000)
  const full = await drawBand($, FULLSCREEN)
  await full.unmount()
  await $.command.run({ command: 'factory', args: 'show' })
  const ui = await drawBand($, CLASSIC)
  expect(await bandLine(ui)).toMatch(/not valid JSON/)
  await ui.unmount()
  // It stays on every draw until the next refresh, and that refresh counts it as shown.
  const again = await drawBand($, CLASSIC)
  expect(await bandLine(again)).toMatch(/not valid JSON/)
  await again.unmount()
  await w.clock!.advance(15_000)
  const later = await drawBand($, CLASSIC)
  expect(await bandLine(later)).toBeUndefined()
  await later.unmount()
})

test('a malformed key declaration or choice file is treated as if it did not exist, so default.json is read', async () => {
  trace("FR-011-AC-6", "FR-014-AC-14")
  const w = world(() => undefined as never)
  feature(w, '{ not json')
  feature(w, { modules: ['lanes'] }, 'default')
  choice(w, '[1,2')
  choice(w, { modules: ['queue'], teams: ['OPS'] }, 'default')
  const shown = await run(w, 'show')
  expect(getSelection().modules).toEqual({ value: ['queue'], source: 'user' })
  expect(getSelection().teams).toEqual({ value: ['OPS'], source: 'user' })
  expect(shown).toMatch(/features\/draco_QSL_code\.json: ignored, not valid JSON/)
  expect(shown).toMatch(/choices\/draco_QSL_code\.json: ignored, not valid JSON/)
  feature(w, '{ not json')
  w.files.delete(`${FP}/choices/${KEY}.json`)
  choice(w, '[1,2')
  const before = w.files.get(`${FP}/choices/default.json`)
  const reset = await run(w, 'reset')
  expect(written(w, 'choices')).toEqual({})
  expect(w.files.get(`${FP}/choices/default.json`)).toBe(before)
  expect(w.writes).toEqual([`${FP}/choices/${KEY}.json`])
  expect(reset).toMatch(/Your choices: none/)
  expect(getSelection().modules).toEqual({ value: ['lanes'], source: 'declaration' })
})
