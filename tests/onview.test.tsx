import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { herdrOnView, tmuxOnView } from '../hooks/onview'
import { BAND_PROPS, CLASSIC, out, startSession, world } from './world'
import type { World } from './world'

// The engine draws into a terminal nobody can see, so herdr or tmux is asked before a read (FR-027).

const SEC = 1000
const MIN = 60 * SEC
const SESSION = 'sess-1'

type Pane = { pane_id: string; tab_id: string; agent_session?: { value: string } }
const mine: Pane = { pane_id: 'w1:p1', tab_id: 'w1:t1', agent_session: { value: SESSION } }
const beside: Pane = { pane_id: 'w1:p2', tab_id: 'w1:t1' }

/** `herdr api snapshot` with this session in w1:p1 on tab w1:t1, in the shape herdr 0.9.1 prints. */
const herdr = (focused: string | undefined, over: { panes?: Pane[]; zoomed?: string } = {}): string =>
  JSON.stringify({
    result: {
      snapshot: {
        focused_tab_id: focused,
        panes: over.panes ?? [mine, beside],
        agents: [],
        workspaces: [],
        layouts: [{ tab_id: 'w1:t1', zoomed: over.zoomed !== undefined, focused_pane_id: over.zoomed ?? 'w1:p1' }],
      },
    },
  })

/** A session inside herdr or tmux, with the answer of the view check in the test's hands. */
function inside($on: Parameters<TestBody>[1], env: Record<string, string>) {
  const w = world($on, true)
  mock.env($on, env)
  $on('session.id', () => ({ value: SESSION }))
  const view = { herdr: herdr('w1:t1'), tmux: '1 0 1 [0]\n', fails: false }
  const fetched: string[] = []
  w.fetch.value = url => (fetched.push(url), undefined)
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'herdr api snapshot') return view.fails ? out('', 1, 'no server') : out(view.herdr)
    if (argv[0] === 'tmux') return view.fails ? out('', 1, 'no server') : out(view.tmux)
    if (line === 'agent-msg escalations') return out('')
    return prior?.(argv, init)
  }
  const checks = () => w.ran.filter(l => l.startsWith('tmux ') || l === 'herdr api snapshot').length
  const escalations = () => w.ran.filter(l => l === 'agent-msg escalations').length
  return { w, view, fetched, checks, escalations }
}

const openPane = ($: Parameters<TestBody>[0], view: string, surface: 'terminal' | 'desktop' = 'terminal', placement: 'dock' | 'widget' = 'dock') =>
  $.ui.mount({ plugin: 'factory-panel', surface, component: 'Pane', requestId: view, props: { title: view, isFocused: false, bodyColumns: 90, placement, scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)

const openBand = ($: Parameters<TestBody>[0]) => $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: CLASSIC } as never)

const pass = (w: World, ms: number): Promise<void> => w.clock!.advance(ms)

const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }
const TMUX = { TMUX_PANE: '%0', TMUX: '/tmp/tmux-501/default,1,0' }

test('herdr says off view only for a session whose panes are behind another tab or under a zoomed pane', () => {
  trace("FR-027-AC-20")
  expect(herdrOnView(herdr('w1:t1'), SESSION)).toBe(true)
  expect(herdrOnView(herdr('w1:t2'), SESSION)).toBe(false)
  // Every pane of the focused tab is on view, whichever has the keyboard.
  expect(herdrOnView(herdr('w1:t1', { panes: [{ ...beside, agent_session: { value: SESSION } }, { ...mine, agent_session: undefined }] }), SESSION)).toBe(true)
  expect(herdrOnView(herdr('w1:t1', { zoomed: 'w1:p2' }), SESSION)).toBe(false)
  expect(herdrOnView(herdr('w1:t1', { zoomed: 'w1:p1' }), SESSION)).toBe(true)
  // Resumed in two panes: one on view is enough.
  expect(herdrOnView(herdr('w2:t1', { panes: [mine, { ...mine, pane_id: 'w2:p1', tab_id: 'w2:t1' }] }), SESSION)).toBe(true)
})

test('an answer of herdr or tmux that does not say counts as on view', () => {
  trace("FR-027-AC-21")
  expect(herdrOnView('not json', SESSION)).toBe(true)
  expect(herdrOnView('{"error":{"code":"x"}}', SESSION)).toBe(true)
  expect(herdrOnView(herdr(undefined), SESSION)).toBe(true)
  // herdr lists no pane for this session, whatever pane the environment names.
  expect(herdrOnView(herdr('w1:t2'), 'another-session')).toBe(true)
  expect(herdrOnView(herdr('w1:t2', { panes: [beside] }), '')).toBe(true)
  expect(tmuxOnView('')).toBe(true)
  expect(tmuxOnView('  [0]')).toBe(true)
  // A control mode client shows windows its own way.
  expect(tmuxOnView('0 0 1 [1]')).toBe(true)
})

test('tmux says off view for a session nobody is attached to, a window not viewed, or a pane under a zoomed one', () => {
  trace("FR-027-AC-22")
  expect(tmuxOnView('0 0 1 []\n')).toBe(false)
  expect(tmuxOnView('0 0 1 [0]\n')).toBe(false)
  expect(tmuxOnView('1 1 0 [0]\n')).toBe(false)
  expect(tmuxOnView('1 0 0 [0]\n')).toBe(true)
  expect(tmuxOnView('1 1 1 [0]\n')).toBe(true)
  expect(tmuxOnView('2 0 1 [00]\n')).toBe(true)
  // Two clients attached, one of them on another window (tmux 3.7's own answer): one viewer is enough.
  expect(tmuxOnView('1 0 1 [00]\n')).toBe(true)
})

for (const [name, env, hide] of [
  ['herdr tab', HERDR, (v: { herdr: string; tmux: string }, off: boolean) => (v.herdr = herdr(off ? 'w1:t2' : 'w1:t1'))],
  ['tmux window', TMUX, (v: { herdr: string; tmux: string }, off: boolean) => (v.tmux = off ? '0 0 1 [0]' : '1 0 1 [0]')],
] as const) {
  test(`behind another ${name} nothing is read, and the views catch up when it comes back`, { options: { teams: 'QSL' } }, async ($, on) => {
    trace("FR-027-AC-23")
    const { w, view, fetched, checks } = inside(on, env)
    hide(view, true)
    await startSession($)
    const band = await openBand($)
    const pane = await openPane($, 'escalations')
    const asked = () => w.ran.filter(l => /^(agent-msg (escalations|work|who\b|log|doctor)|ix-board)/.test(l) && l !== 'agent-msg whoami').length
    await pass(w, 10 * MIN)
    expect(asked()).toBe(0)
    expect(fetched).toEqual([])
    // The check is the one command left, at most once in 15 seconds.
    expect(checks()).toBeGreaterThan(0)
    expect(checks()).toBeLessThanOrEqual(41)
    hide(view, false)
    await pass(w, 16 * SEC)
    expect(asked()).toBeGreaterThan(0)
    expect(fetched.length).toBeGreaterThan(0)
    await band.unmount()
    await pane.unmount()
  })
}

test('the check runs at most once in 15 seconds, and only when something would otherwise read', { options: { refreshSeconds: 5 } }, async ($, on) => {
  trace("FR-027-AC-24")
  const { w, checks } = inside(on, TMUX)
  await startSession($)
  await pass(w, 5 * MIN)
  expect(checks()).toBe(0)
  const band = await openBand($)
  await pass(w, 5 * MIN)
  expect(checks()).toBeGreaterThan(0)
  expect(checks()).toBeLessThanOrEqual(21)
  await band.unmount()
  // With only a pane read once a minute on view, the checks are as rare as the reads.
  const pane = await openPane($, 'escalations')
  await pass(w, SEC)
  const before = checks()
  await pass(w, 5 * MIN)
  expect(checks() - before).toBeLessThanOrEqual(6)
  await pane.unmount()
})

test('a check that fails leaves the reads as they were', async ($, on) => {
  trace("FR-027-AC-21")
  const { w, view, escalations } = inside(on, TMUX)
  view.fails = true
  view.tmux = '0 0 1 []'
  await startSession($)
  const pane = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(escalations()).toBe(1)
  await pane.unmount()
})

for (const [name, env] of [
  ['neither herdr nor tmux', {}],
  ['tmux inside herdr', { ...HERDR, ...TMUX }],
  ['the view check switched off', { ...TMUX, FACTORY_PANEL_VIEW_CHECK: 'off' }],
  ['a TMUX_PANE left over outside tmux', { TMUX_PANE: '%0' }],
  ['a TMUX_PANE inherited by another terminal program', { ...TMUX, TERM_PROGRAM: 'iTerm.app' }],
] as const) {
  test(`with ${name} no check runs and a drawn view reads`, async ($, on) => {
    trace("FR-027-AC-25")
    const { w, view, checks, escalations } = inside(on, env as Record<string, string>)
    view.tmux = '0 0 1 []'
    view.herdr = herdr('w1:t2')
    await startSession($)
    const pane = await openPane($, 'escalations')
    await pass(w, SEC)
    expect(escalations()).toBe(1)
    expect(checks()).toBe(0)
    await pane.unmount()
  })
}

test('with TERM_PROGRAM tmux the pane is asked after', async ($, on) => {
  trace("FR-027-AC-25")
  const { w, view, checks, escalations } = inside(on, { ...TMUX, TERM_PROGRAM: 'tmux' })
  view.tmux = '0 0 1 []'
  await startSession($)
  const pane = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(checks()).toBe(1)
  expect(escalations()).toBe(0)
  await pane.unmount()
})

test('the refresh key reads although the terminal is off view', async ($, on) => {
  trace("FR-027-AC-26")
  const { w, view, escalations } = inside(on, TMUX)
  view.tmux = '0 0 1 []'
  await startSession($)
  const pane = await openPane($, 'escalations')
  await pass(w, SEC)
  expect(escalations()).toBe(0)
  await pane.press({ key: 'refresh' })
  await pass(w, SEC)
  expect(escalations()).toBe(1)
  await pane.unmount()
})

for (const [name, surface, placement] of [
  ['a desktop pane', 'desktop', 'dock'],
  ['a desktop widget', 'desktop', 'widget'],
] as const) {
  test(`${name} reads on being drawn, whatever the pane list and tmux say of the terminal`, async ($, on) => {
    trace("FR-027-AC-27")
    const { w, view, checks, escalations } = inside(on, TMUX)
    view.tmux = '0 0 1 []'
    w.listed.value = [{ id: 'escalations', title: 'Escalations', isShown: false, isFocused: false, isPlaced: false }] as never
    await startSession($)
    const pane = await openPane($, 'escalations', surface, placement)
    await pass(w, SEC)
    expect(escalations()).toBe(1)
    expect(checks()).toBe(0)
    await pane.unmount()
  })
}
