import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { runFactory, helpText } from '../hooks/router'
import { askRole, isRoleUnknown, roleOf, startRole } from '../hooks/role'
import { defaultView } from '../hooks/views'
import { PRESETS, modulesFor, parseModules } from '../hooks/band/roles'
import { cellForDigit, digitFor } from '../hooks/band/modules'
import type { Cell } from '../hooks/band/modules'
import type { Options } from '../hooks/shared'

// Tests for the factory-panel spec (spec/). A trace call naming the criterion id inside a test binds
// it to that acceptance criterion (see ./trace.ts); the test must fail if the criterion is broken.

type On = Parameters<TestBody>[1]
const FULLSCREEN = { columns: 200, rows: 50, isFullscreen: true }
const CLASSIC = { columns: 200, rows: 50, isFullscreen: false }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bandColumns: 180, bodyColumns: 180, scroll: { offset: 0, bodyRows: 4 }, view: {} } as never
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

const options = (over: Partial<Options> = {}): Options => ({
  prometheusUrl: 'http://prom.test',
  grafanaUrl: 'http://graf.test',
  teams: [],
  refreshSeconds: 15,
  role: 'auto',
  bandModules: '',
  bandFocus: '',
  inlineView: 'band',
  ...over,
})

type World = {
  opens: { id: string; focus?: boolean; closeOnEscape?: boolean; rows?: number }[]
  closes: string[]
  asks: string[]
  statuses: (string | undefined)[]
  store: Map<string, unknown>
  /** What `agent-msg whoami` answers; undefined means it fails like an unplaced session. */
  whoami: { value: string | undefined }
  /** The answer the question gets; 'dismiss' rejects like Esc. */
  answer: { value: string }
  /** Panes the host lists as open (id → placed). */
  listed: { value: { id: string; title: string; isPlaced: boolean }[] | undefined }
  relayFails: { value: boolean }
  registered: string[]
}

function world(on: On): World {
  const w: World = { opens: [], closes: [], asks: [], statuses: [], store: new Map(), whoami: { value: undefined }, answer: { value: 'Code lead' }, listed: { value: undefined }, relayFails: { value: false }, registered: [] }
  on('command.register', (_, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('ui.open', (_, e) => {
    w.opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape, rows: e.rows })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: (w.listed.value ?? []) as never }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 24, 12, 0) }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } }))
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    if (line === 'printenv HOME') return ok('/home/test\n')
    if (line === 'hostname -s') return ok('draco\n')
    if (line === 'agent-msg whoami') return w.whoami.value === undefined ? fail('agent-msg: this session has no verified Herdr placement') : ok(w.whoami.value)
    if (line === 'agent-msg doctor --json') return w.relayFails.value ? fail('redis down') : ok('[]')
    return fail(`not stubbed: ${line}`)
  })
  return w
}

/** A stand-in for the mod's `$` for the code that only opens views, asks and stores. */
function fake$(w: World) {
  const run = async (argv: string[]) => {
    const line = argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    if (line === 'agent-msg whoami') return w.whoami.value === undefined ? out('', 1) : out(w.whoami.value)
    return out('', 1)
  }
  return {
    process: { run },
    store: { get: async (k: string) => w.store.get(k), set: async (k: string, v: unknown) => void w.store.set(k, v) },
    ui: {
      open: async (spec: { id: string; focus?: true; closeOnEscape?: true; rows?: number }) => {
        w.opens.push({ id: spec.id, focus: spec.focus, closeOnEscape: spec.closeOnEscape, rows: spec.rows })
        return { isPlaced: true as const }
      },
      close: async (spec: { id: string }) => void w.closes.push(spec.id),
      ask: async (question: string) => {
        w.asks.push(question)
        if (w.answer.value === 'dismiss') throw new Error('dismissed')
        return w.answer.value
      },
      log: () => undefined,
    },
  }
}

const startSession = ($: Parameters<TestBody>[0], isInteractive = true, cwd = '/proj') => $.session.start({ cwd, surface: 'terminal', isInteractive })

async function drawBand($: Parameters<TestBody>[0], viewport?: typeof CLASSIC) {
  return $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport })
}
const settle = () => new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => resolve(), 200))

// ---------------------------------------------------------------- FR-005 role resolution

test('a relay address names the role; one that cannot be read or names no known role leaves it undetected', async ($, on) => {
  trace("FR-005-AC-1", "FR-005-AC-2", "FR-005-AC-3")
  const w = world(on)
  const o = options()
  w.whoami.value = 'draco:QSL:code'
  await startRole(fake$(w) as never, o, '/proj')
  expect(roleOf(o)).toBe('code-lead')
  for (const [address, role] of [['hub:ENG:plan', 'planner'], ['hub:ENG:arch', 'coordinator']] as const) {
    w.whoami.value = address
    await startRole(fake$(w) as never, o, '/proj')
    expect(roleOf(o)).toBe(role)
  }
  w.whoami.value = 'draco:QSL:wizard'
  await startRole(fake$(w) as never, o, '/proj')
  expect(roleOf(o)).toBeUndefined()
  w.whoami.value = undefined
  await startRole(fake$(w) as never, o, '/proj')
  expect(roleOf(o)).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('with no role known the first /factory asks once, remembers the answer for the directory, and asks again elsewhere', async ($, on) => {
  trace("FR-005-AC-4", "FR-005-AC-5")
  const w = world(on)
  const o = options()
  await startRole(fake$(w) as never, o, '/proj')
  expect(isRoleUnknown(o)).toBe(true)
  const text = await runFactory(fake$(w) as never, o, '', false)
  expect(w.asks).toEqual(['What do you do in this session?'])
  expect(roleOf(o)).toBe('code-lead')
  expect(text).toMatch(/Focus is open/)
  expect(w.store.get('role./proj')).toBe('code-lead')

  // A later session in the same directory reads the stored answer and does not ask.
  await startRole(fake$(w) as never, o, '/proj')
  expect(roleOf(o)).toBe('code-lead')
  await runFactory(fake$(w) as never, o, '', false)
  expect(w.asks).toHaveLength(1)

  // Another directory has no answer, so it asks again.
  await startRole(fake$(w) as never, o, '/other')
  expect(isRoleUnknown(o)).toBe(true)
  w.answer.value = 'Program coordinator'
  await runFactory(fake$(w) as never, o, '', false)
  expect(w.asks).toHaveLength(2)
  expect(roleOf(o)).toBe('coordinator')
})

test('a dismissed question leaves the role unanswered and the next /factory asks again; "Other" is the worker role', async ($, on) => {
  trace("FR-005-AC-6", "FR-002-AC-5")
  const w = world(on)
  const o = options()
  await startRole(fake$(w) as never, o, '/proj')
  w.answer.value = 'dismiss'
  await runFactory(fake$(w) as never, o, '', false)
  expect(roleOf(o)).toBeUndefined()
  expect(w.store.size).toBe(0)
  await runFactory(fake$(w) as never, o, '', false)
  expect(w.asks).toHaveLength(2)
  w.answer.value = 'Other'
  await askRole(fake$(w) as never, o)
  expect(roleOf(o)).toBe('worker')
  expect(modulesFor(roleOf(o), '')).toEqual(['local'])
})

test('starting a session never asks a question or takes the keyboard', async ($, on) => {
  trace("FR-005-AC-7", "NFR-002-M-1")
  const w = world(on)
  await startSession($)
  await settle()
  expect(w.asks).toEqual([])
  expect(w.opens.filter(o => o.focus === true)).toEqual([])
})

test('the role setting wins over a relay address and a stored answer, and nothing is asked', async ($, on) => {
  trace("FR-005-AC-8")
  const w = world(on)
  const o = options({ role: 'planner' })
  w.whoami.value = 'draco:QSL:code'
  w.store.set('role./proj', 'coordinator')
  await startRole(fake$(w) as never, o, '/proj')
  expect(roleOf(o)).toBe('planner')
  expect(isRoleUnknown(o)).toBe(false)
  await runFactory(fake$(w) as never, o, '', false)
  expect(w.asks).toEqual([])
})

// ---------------------------------------------------------------- FR-003 one command

test('/factory opens the view the role looks at first, with the keyboard and close-on-Esc', async ($, on) => {
  trace("FR-003-AC-1", "FR-003-AC-2", "FR-004-AC-1")
  const w = world(on)
  for (const [role, id] of [['code-lead', 'focus'], ['coordinator', 'factory'], ['planner', 'focus'], ['worker', 'factory']] as const) {
    w.opens.length = 0
    const o = options({ role })
    await startRole(fake$(w) as never, o, '/proj')
    await runFactory(fake$(w) as never, o, '', false)
    expect(w.opens.at(-1)).toEqual({ id, focus: true, closeOnEscape: true, rows: 14 })
    expect(defaultView(role)).toBe(id)
  }
})

test('/factory <view> opens exactly that view', async ($, on) => {
  trace("FR-003-AC-3")
  const w = world(on)
  const o = options({ role: 'coordinator' })
  for (const view of ['factory', 'focus', 'escalations', 'relay', 'team']) {
    w.opens.length = 0
    await runFactory(fake$(w) as never, o, view, false)
    expect(w.opens.map(x => x.id)).toEqual([view])
  }
})

test('an unknown /factory argument says so and prints the help', async ($, on) => {
  trace("FR-003-AC-4")
  const w = world(on)
  const text = await runFactory(fake$(w) as never, options({ role: 'coordinator' }), 'focus2', false)
  expect(text).toMatch(/"focus2" is not a \/factory command/)
  expect(text).toContain(helpText(false))
  expect(w.opens).toEqual([])
})

test('the old per-view commands are aliases, and /band does not exist', async ($, on) => {
  trace("FR-003-AC-5", "FR-003-AC-6")
  const w = world(on)
  await startSession($)
  expect(w.registered).toEqual(expect.arrayContaining(['factory', 'focuses', 'escalations', 'relay', 'team']))
  expect(w.registered).not.toContain('band')
  for (const [command, id] of [['focuses', 'focus'], ['escalations', 'escalations'], ['relay', 'relay'], ['team', 'team']] as const) {
    w.opens.length = 0
    await $.command.run({ command, args: '' })
    await settle()
    expect(w.opens.map(x => x.id)).toContain(id)
  }
})

// ---------------------------------------------------------------- FR-004 detail view

test('with a view open, opening another replaces it in the classic layout and keeps the dock in fullscreen', async ($, on) => {
  trace("FR-004-AC-2", "FR-009-AC-6")
  const w = world(on)
  const o = options({ role: 'coordinator' })
  await runFactory(fake$(w) as never, o, 'focus', false)
  expect(w.closes).toEqual(expect.arrayContaining(['factory', 'escalations', 'relay', 'team']))
  expect(w.closes).not.toContain('focus')
  w.closes.length = 0
  w.opens.length = 0
  await runFactory(fake$(w) as never, o, 'team', true)
  expect(w.closes).toEqual([])
  expect(w.opens).toEqual([{ id: 'team', focus: true, closeOnEscape: true, rows: undefined }])
})

test('the help and the open view say which keys to use, in the words of the layout', async ($, on) => {
  trace("FR-004-AC-3", "FR-008-AC-2")
  const w = world(on)
  const o = options({ role: 'coordinator' })
  const classic = await runFactory(fake$(w) as never, o, 'focus', false)
  expect(classic).toMatch(/number to switch/)
  expect(classic).toMatch(/r refreshes, Esc closes/)
  expect(helpText(false)).toMatch(/line above the prompt/)
  expect(helpText(false)).toMatch(/number at an empty prompt/)
  expect(helpText(true)).toMatch(/panel at the right/)
  expect(helpText(true)).toMatch(/click a tab/)
  expect(helpText(true)).not.toMatch(/number at an empty prompt/)
})

// ---------------------------------------------------------------- FR-008 help

test('the help answers see, open more, switch and role, each with the key or command to use', () => {
  trace("FR-008-AC-1")
  for (const full of [false, true]) {
    const text = helpText(full)
    expect(text).toMatch(/See it:/)
    expect(text).toMatch(/Open more:\s+\/factory/)
    expect(text).toMatch(/Switch:/)
    expect(text).toMatch(/Your role:\s+\/factory role/)
  }
})

// ---------------------------------------------------------------- FR-002 presets

test('each role gets its own modules; hosts only for the coordinator; no role means a code lead', () => {
  trace("FR-002-AC-1", "FR-002-AC-2", "FR-002-AC-3", "FR-002-AC-4", "FR-002-AC-6")
  expect(PRESETS.coordinator).toEqual(['health', 'focus', 'attention', 'relay', 'team'])
  expect(PRESETS['code-lead']).toEqual(['local', 'focus', 'lead', 'lanes'])
  expect(PRESETS['code-lead']).not.toContain('health')
  expect(PRESETS.planner).toEqual(['focus', 'queue', 'lead'])
  expect(PRESETS.worker).toEqual(['local'])
  for (const role of ['code-lead', 'planner', 'worker'] as const) expect(PRESETS[role]).not.toContain('health')
  expect(modulesFor(undefined, '')).toEqual(PRESETS['code-lead'])
})

// ---------------------------------------------------------------- FR-001 ambient view

test('in the classic layout the band is drawn at the first redraw with no key pressed; a code lead sees this machine, not the host list', { options: { role: 'code-lead' } }, async ($, on) => {
  trace("FR-001-AC-1", "FR-002-AC-2", "FR-002-AC-3")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'local' })).toBeDefined()
  expect(await ui.find({ key: 'health' })).toBeUndefined()
  await ui.unmount()
})

test('a coordinator sees the host list in the band', { options: { role: 'coordinator' } }, async ($, on) => {
  trace("FR-002-AC-1")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'health' })).toBeDefined()
  await ui.unmount()
})

test('in the classic layout no pane opens at session start, at a redraw or at a surface attach', async ($, on) => {
  trace("FR-001-AC-2")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  await drawBand($, CLASSIC)
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: CLASSIC })
  await settle()
  expect(w.opens).toEqual([])
  await ui.unmount()
})

test('while the layout has not been reported the band is drawn and no pane is opened', async ($, on) => {
  trace("FR-001-AC-3")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, undefined)
  expect(await ui.find({ key: 'local' })).toBeDefined()
  await settle()
  expect(w.opens).toEqual([])
  await ui.unmount()
})

test('when the layout is first reported as fullscreen the five panes open once and no band is drawn', async ($, on) => {
  trace("FR-001-AC-4")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, FULLSCREEN)
  await drawBand($, FULLSCREEN)
  await settle()
  expect(w.opens.map(o => o.id)).toEqual(['factory', 'focus', 'escalations', 'relay', 'team'])
  expect(await ui.find({ key: 'local' })).toBeUndefined()
  await ui.unmount()
})

test('a pane the person closed is not reopened by a later attach', async ($, on) => {
  trace("FR-001-AC-6")
  const w = world(on)
  await startSession($)
  await drawBand($, FULLSCREEN)
  await settle()
  const before = w.opens.length
  w.listed.value = ['factory', 'focus', 'escalations', 'relay'].map(id => ({ id, title: id, isPlaced: true }))
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  await settle()
  expect(w.opens.length).toBe(before)
})

test('a non-interactive session opens no pane at start or at an attach', async ($, on) => {
  trace("FR-001-AC-7")
  const w = world(on)
  await startSession($, false)
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  await settle()
  expect(w.opens).toEqual([])
})

test('while a source fails the band adds one line naming the problem under its row of cells', { options: { role: 'coordinator' } }, async ($, on) => {
  trace("FR-001-AC-8", "FR-006-AC-6")
  const w = world(on)
  w.relayFails.value = true
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'relay' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^relay: / }))?.text).toMatch(/relay: /)
  await ui.unmount()
  w.relayFails.value = false
})

// ---------------------------------------------------------------- FR-009 band cells

test('each cell drawn shows its digit, so a person can read which key opens it', { options: { role: 'code-lead' } }, async ($, on) => {
  trace("FR-009-AC-1")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  const local = await ui.find({ key: 'local' })
  expect((local?.props as { hotkey?: string }).hotkey).toBe('1')
  await ui.unmount()
})

test('the digits follow the cells drawn: a module left out moves the others up', { options: { role: 'code-lead', bandModules: 'attention,local' } }, async ($, on) => {
  trace("FR-009-AC-2")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'attention' })).toBeUndefined()
  expect(((await ui.find({ key: 'local' }))?.props as { hotkey?: string }).hotkey).toBe('1')
  await ui.unmount()
})

const cell = (id: string): Cell => ({ id: id as Cell['id'], pane: 'factory', parts: [{ text: id }] })

test('digits 1 to 9 go to the first nine cells; a tenth has none; a digit nobody carries opens nothing', () => {
  trace("FR-009-AC-3", "FR-009-AC-5")
  const cells = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(cell)
  expect(cells.map((_, i) => digitFor(i))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined])
  expect(cellForDigit(cells, '9')?.id).toBe('i')
  expect(cellForDigit(cells, '0')).toBeUndefined()
  expect(cellForDigit(cells.slice(0, 2), '5')).toBeUndefined()
})

test('bandModules keeps the order written, drops unknown names and repeats', () => {
  trace("FR-009-AC-4", "FR-002-AC-5")
  expect(parseModules('focus,nope,focus,local')).toEqual(['focus', 'local'])
  expect(modulesFor('coordinator', 'local,nope,focus')).toEqual(['local', 'focus'])
})
