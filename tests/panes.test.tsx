import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// Fixtures are trimmed copies of what agent-msg, ix-board and Prometheus answered on
// 2026-11-21, so the parsers are tested against the real formats.

const WHO = `-  hub  codex  seen 11-20 21:56  pane w1F:pR  -  location unverified
hub:ENG:arch  hub  claude  seen 11-21 09:40  pane w1F:p13  -  Herdr w1F:w1F:t0
hub:ENG:code  hub  codex  seen 11-21 09:40  pane w1F:pR  -  Herdr w1F:w1F:tG
`

const WORK = JSON.stringify({
  binding: { machine: 'hub', pane: 'w1F:p13', kind: 'claude', address: 'hub:ENG:arch' },
  scope: { initiatives: ['00000000-0000-4000-8000-000000000001'], projects: [], tickets: [], reported_at_ms: 1795216041262 },
  focus: { summary: 'Payments v2: finish the ledger and export work', tickets: [], reported_at_ms: 1795214759001 },
  agents: [],
})

const FOCUS_STATUS = JSON.stringify({
  fetched_at: 1795282750,
  ready_queue: [],
  blocker_layers: [],
  projects: [
    { name: 'Payments spec batch', progress: { done: 18, total: 18 }, in_progress: [] },
    { name: 'Payments ledger', progress: { done: 34, total: 39 }, in_progress: [{}, {}, {}, {}] },
    { name: 'Payments export', progress: { done: 65, total: 67 }, in_progress: [{}, {}] },
  ],
})

const ESCALATIONS = `e28  resolved  OPS-7  session/cc33/dd44  11-18 07:13
e30  waiting  ENG-101  session/aa11/bb22  11-20 16:29
`

const SHOW_E30 = `id:             e30
ticket:         ENG-101
lead:           session/aa11/bb22
machine:        hub
cwd:            -
kind:           claude
status:         waiting
filed:          11-20 16:29
context:
  node-b:ENG:code PR #42 is blocked: the coder's integration test command
  is denied by the permission classifier on node-b.
options:
  - Allow the lane's integration test command in node-b's permissions
  - Run that one test command yourself on node-b
recommendation:
  Allow the command on node-b; the lane can then finish and merge on its own.
`

const SHOW_E28 = `id:             e28
ticket:         OPS-7
machine:        node-b
kind:           codex
status:         resolved
filed:          11-18 07:13
context:
  The 2.1 release fails the dependency audit.
options:
  - Allow a temporary audit exception
recommendation:
  Allow the exception.
decision:
  Allowed the temporary exception.
`

const LOG = `11-21 09:41 node-c:OPS:code -> node-b:ENG:code: a direct message, not an announcement
11-21 09:45 operator -> all: Freeze merges on ENG until the release is cut
`

type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const ok = (stdout: string): { value: Run } => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const fail = (stderr: string): { value: Run } => ({
  value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const TEAM_RANGE = JSON.stringify({
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [{ metric: { team_id: 'ENG' }, values: [[1795280000, '3'], [1795280300, '5'], [1795280600, '8']] }],
  },
})
const EMPTY = JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } })

/** Stands in for the engine and the host: every command and fetch the mod makes is answered here. */
function engine(on: Parameters<TestBody>[1], ran: string[][], options: { teamMetrics: boolean }): void {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 21, 10, 0) }))
  on('clock.every', () => ({ value: undefined }))
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    const isTeam = e.url.endsWith('/query_range') && body.includes('ix_team_verified_path_closed_24h')
    return { value: { status: 200, ok: true, headers: {}, text: options.teamMetrics && isTeam ? TEAM_RANGE : EMPTY } }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const line = argv.join(' ')
    if (line === 'agent-msg who') return ok(WHO)
    if (line === 'agent-msg work --lead hub:ENG:arch show') return ok(WORK)
    if (line.startsWith('agent-msg work --lead')) return fail('agent-msg: work target is unavailable')
    if (line.startsWith('ix-board --json focus status --initiative 00000000')) return ok(FOCUS_STATUS)
    if (line === 'agent-msg escalations') return ok(ESCALATIONS)
    if (line === 'agent-msg escalation show e30') return ok(SHOW_E30)
    if (line === 'agent-msg escalation show e28') return ok(SHOW_E28)
    if (line.startsWith('agent-msg log')) return ok(LOG)
    if (line.startsWith('agent-msg resolve')) return ok('resolved e30; told the lead; posted to ENG-101')
    if (line.startsWith('agent-msg send')) return ok('')
    return fail(`not stubbed: ${line}`)
  })
}

const pane = (requestId: string, title: string) =>
  ({
    plugin: 'factory-panel',
    component: 'Pane',
    requestId,
    props: {
      title,
      isFocused: false,
      bodyColumns: 90,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  }) as const

test('the Focus pane draws a coordinator’s focus, its progress and its open projects', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface })

    expect((await ui.find({ type: 'Text', text: /1 focus$/ }))?.text).toBe('1 focus')
    expect((await ui.find({ type: 'Text', text: /Payments v2/ }))?.text).toMatch(/ledger and export/)
    // 117 of 124 leaves done across the three projects.
    expect((await ui.find({ type: 'Text', text: /^94%$/ }))?.text).toBe('94%')
    expect((await ui.find({ type: 'Text', text: /117\/124 done/ }))?.text).toBe('117/124 done')
    expect((await ui.find({ type: 'Text', text: /6 in progress/ }))?.text).toBe('6 in progress')
    // Open projects show, most work left first; the finished one hides behind a toggle.
    const names = (await ui.findAll({ type: 'Text', text: /^Payments [a-z ]+$/ })).map(t => t.text)
    expect(names).toEqual(['Payments ledger', 'Payments export'])
    expect((await ui.find({ key: 'done-hub:ENG:arch' }))).toBeDefined()

    await ui.press({ key: 'done-hub:ENG:arch' })
    expect((await ui.find({ type: 'Text', text: 'Payments spec batch' }))?.text).toBe('Payments spec batch')
    await ui.press({ key: 'done-hub:ENG:arch' })
    await ui.unmount()
  }

  // Only the verified addresses were asked for a work report (each poll asks again).
  const asked = [...new Set(ran.filter(a => a[1] === 'work').map(a => a[3]))].sort()
  expect(asked).toEqual(['hub:ENG:arch', 'hub:ENG:code'])
})

test('the Relay pane lists waiting escalations and resolves one only on a second press', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('relay', 'Relay'), surface: 'desktop' })

  expect((await ui.find({ key: 'filter-waiting' }))?.text).toBe('waiting 1')
  expect((await ui.find({ key: 'filter-resolved' }))?.text).toBe('resolved 1')
  expect((await ui.find({ key: 'sel-e30' }))?.text).toBe('ENG-101')
  expect(await ui.find({ key: 'sel-e28' })).toBeUndefined()

  await ui.press({ key: 'sel-e30' })
  expect((await ui.find({ type: 'Text', text: /integration test command is denied/ }))?.text).toMatch(/PR #42/)
  expect((await ui.find({ type: 'Text', text: /^Allow the lane’?'?s integration test/ }))?.text).toMatch(/permissions/)

  // Picking the recommendation fills the decision; the first press only arms.
  await ui.press({ key: 'rec-e30' })
  await ui.press({ key: 'resolve-e30' })
  expect((await ui.find({ key: 'resolve-e30' }))?.text).toBe('Confirm resolve')
  expect(ran.some(a => a[1] === 'resolve')).toBe(false)

  await ui.press({ key: 'resolve-e30' })
  const resolve = ran.find(a => a[1] === 'resolve')
  expect(resolve).toEqual([
    'agent-msg',
    'resolve',
    'e30',
    'Allow the command on node-b; the lane can then finish and merge on its own.',
  ])
  expect((await ui.find({ type: 'Text', text: /posted to ENG-101/ }))?.text).toMatch(/resolved e30/)

  // The resolved filter shows the recorded decision.
  await ui.press({ key: 'filter-resolved' })
  await ui.press({ key: 'sel-e28' })
  expect((await ui.find({ type: 'Text', text: /Allowed the temporary/ }))?.text).toMatch(/exception/)
  await ui.unmount()
})

test('the Relay pane shows broadcasts and sends an announcement after a confirm', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('relay', 'Relay'), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /Freeze merges on ENG/ }))?.text).toMatch(/release is cut/)
  expect(await ui.find({ type: 'Text', text: /a direct message/ })).toBeUndefined()

  await ui.input({ key: 'announce', text: 'Standup in 10', kind: 'change' })
  await ui.press({ key: 'send' })
  expect((await ui.find({ key: 'send' }))?.text).toBe('Confirm send to every lead')
  await ui.press({ key: 'send' })
  expect(ran.find(a => a[1] === 'send')).toEqual(['agent-msg', 'send', 'all', 'Standup in 10'])
  expect((await ui.find({ type: 'Text', text: 'Sent to every lead.' }))?.text).toBe('Sent to every lead.')
  await ui.unmount()
})

test('the Team pane draws a tile per metric with its latest value, or says the metrics are absent', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('team', 'Team'), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: 'ENG' }))?.text).toBe('ENG')
  expect((await ui.find({ type: 'Text', text: 'Verified closures · 24h' }))?.text).toBe('Verified closures · 24h')
  expect((await ui.find({ type: 'Text', text: /^8$/ }))?.text).toBe('8')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('the Team pane says so when Prometheus has no team metrics', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('team', 'Team'), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: 'No team metrics yet.' }))?.text).toBe('No team metrics yet.')
  await ui.unmount()
})
