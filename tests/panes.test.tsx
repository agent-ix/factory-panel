import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { bulkStep, makeGate } from '../hooks/escalations'
import { ACCENT, DOING, TRACK } from '../hooks/ui/glyphs'

// Fixtures are trimmed copies of what agent-msg, ix-board and Prometheus answered on
// 2026-11-21, so the parsers are tested against the real formats.

const WHO = `-  hub  codex  seen 11-20 21:56  pane w1F:pR  -  location unverified
hub:ENG:arch  hub  claude  seen 11-21 09:40  pane w1F:p13  -  Herdr w1F:w1F:t0
hub:ENG:code  hub  codex  seen 11-21 09:40  pane w1F:pR  -  Herdr w1F:w1F:tG
`

const WORK = JSON.stringify({
  binding: { machine: 'hub', pane: 'w1F:p13', kind: 'claude', session: 'sess-1', process_id: 4242, address: 'hub:ENG:arch' },
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

const ESCALATIONS = `e32  waiting  ENG-102  session/cc33/dd44  11-20 17:00
e31  waiting  ENG-103  session/cc33/dd44  11-20 16:45
e28  resolved  OPS-7  session/cc33/dd44  11-18 07:13
e30  waiting  ENG-101  session/687562/736573732d31  11-20 16:29
`

const SHOW_E30 = `id:             e30
ticket:         ENG-101
lead:           session/687562/736573732d31
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

const SHOW_E31 = `id:             e31
ticket:         ENG-103
machine:        node-b
kind:           claude
status:         waiting
filed:          11-20 16:45
context:
  Two designs fit; the lane needs an owner call.
options:
  - Take design A
  - Take design B
`

const SHOW_E32 = `id:             e32
ticket:         ENG-102
machine:        node-b
kind:           claude
status:         waiting
filed:          11-20 17:00
context:
  The migration can run now or after the freeze.
options:
  - Take the first option
recommendation:
  Take the first option
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

const HERDR_AGENTS = JSON.stringify({
  result: { agents: [{ agent: 'claude', pane_id: 'w1F:p13', agent_session: { value: 'sess-1' } }] },
})
const FIND_PANE = JSON.stringify({ address: 'hub:ENG:arch', machine: 'hub', pane_id: 'w1F:p13' }) + '\nsend to: hub:ENG:arch\n'

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
function engine(
  on: Parameters<TestBody>[1],
  ran: string[][],
  options: { files?: Map<string, string>; teamMetrics: boolean; rateLimited?: boolean; failResolve?: string; store?: Map<string, unknown>; escalations?: () => string; failLog?: boolean; failStoreSet?: boolean; open?: (id: string) => { isPlaced: true } | { isPlaced: false; reason: string }; status?: (text: string | undefined) => void; panes?: () => { id: string; title: string; isPlaced: boolean }[] },
): void {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  const opened = new Map<string, boolean>()
  on('ui.open', (_, e) => {
    const result = options.open?.(e.id) ?? { isPlaced: true }
    opened.set(e.id, result.isPlaced)
    return { value: result }
  })
  on('ui.panes', () => ({ value: options.panes?.() ?? [...opened].map(([id, isPlaced]) => ({ id, title: id, isPlaced })) }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    options.status?.(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 21, 10, 0) }))
  on('clock.every', () => ({ value: undefined }))
  const files = options.files ?? new Map<string, string>()
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  const store = options.store ?? new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    if (options.failStoreSet) throw new Error('disk full')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    const isTeam = e.url.endsWith('/query_range') && body.includes('ix_team_verified_path_closed_24h')
    return { value: { status: 200, ok: true, headers: {}, text: options.teamMetrics && isTeam ? TEAM_RANGE : EMPTY } }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const line = argv.join(' ')
    if (line === 'printenv HOME') return ok('/home/test\n')
    if (line === 'agent-msg who') return ok(WHO)
    if (line === 'agent-msg work --lead hub:ENG:arch show') return ok(WORK)
    if (line.startsWith('agent-msg work --lead')) return fail('agent-msg: work target is unavailable')
    if (line.startsWith('ix-board --json focus status --initiative 00000000'))
      return options.rateLimited ? fail('Linear rate limited; retry in 3600.005s') : ok(FOCUS_STATUS)
    if (line === 'agent-msg escalations') return ok(options.escalations?.() ?? ESCALATIONS)
    if (line === 'agent-msg escalation show e30') return ok(SHOW_E30)
    if (line === 'agent-msg escalation show e28') return ok(SHOW_E28)
    if (line === 'agent-msg escalation show e31') return ok(SHOW_E31)
    if (line === 'agent-msg escalation show e32') return ok(SHOW_E32)
    if (line.startsWith('agent-msg log')) return options.failLog ? fail('relay unreachable') : ok(LOG)
    if (line === 'herdr --machine hub agent list') return ok(HERDR_AGENTS)
    if (line === 'agent-msg find --json w1F:p13') return ok(FIND_PANE)
    if (line.startsWith('agent-msg resolve'))
      return argv[2] === options.failResolve ? fail('relay down') : ok(`resolved ${argv[2]}; told the lead; posted to ENG-101`)
    if (line.startsWith('agent-msg send')) return ok('')
    return fail(`not stubbed: ${line}`)
  })
}

const FULLSCREEN = { columns: 200, rows: 50, isFullscreen: true }
const MAIN_SCREEN = { columns: 200, rows: 50, isFullscreen: false }

/** Draws the prompt band, the first render that tells the mod which layout it is in. */
async function drawBand($: Parameters<TestBody>[0], viewport?: typeof FULLSCREEN): Promise<void> {
  const band = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 180, scroll: { offset: 0, bodyRows: 4 }, view: {} } as never, viewport })
  await new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => resolve(), 150)) // the open the band's hook starts is not awaited
  await band.unmount()
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
    // The terminal caption is one line; desktop keeps separate pieces.
    expect((await ui.find({ type: 'Text', text: /117.{1,3}124 done/ }))?.text).toBe(surface === 'terminal' ? '117/124 done · 6 in progress · 0 ready · 1 fresh, 0 old, 0 failed' : '117 / 124 done')
    expect((await ui.find({ type: 'Text', text: /6 in progress/ }))?.text).toMatch(/6 in progress/)
    // The real work binding carries no model, so the card shows the harness kind.
    expect((await ui.find({ type: 'Text', text: 'claude' }))?.text).toBe('claude')
    // Open projects show, most work left first; the finished one hides behind a toggle.
    const names = (await ui.findAll({ type: 'Text', text: /^Payments [a-z ]+$/ })).map(t => t.text)
    expect(names).toEqual(['Payments ledger', 'Payments export'])
    expect((await ui.find({ key: 'done-hub:ENG:arch' }))).toBeDefined()
    if (surface === 'terminal') {
      // One row per open project: a bar and one done/total count each, no percentage text.
      expect((await ui.findAll({ type: 'Text', text: /^\d+\/\d+$/ })).map(t => t.text)).toEqual(['34/39', '65/67'])
      expect((await ui.findAll({ type: 'Text', text: /^\d+%$/ })).map(t => t.text)).toEqual(['94%'])
      // Each bar is runs of [colour, text]: whole █ cells per section, no background and no partial blocks.
      const runsOf = async (key: string) =>
        ((await ui.find({ key }))?.children as { props: { color?: string; backgroundColor?: string }; children: string[] }[]).map(c => {
          expect(c.props.backgroundColor).toBeUndefined()
          return [c.props.color, c.children[0]]
        })
      const rowBar = (name: string) => runsOf(`p-hub:ENG:arch-${name}-bar`)
      // At 90 columns a row is a 15-cell name, the bar, and a 10-cell count with two gaps inside the card padding of 1 and one spare column:
      // 90 - 3 - 12 - 15 = 60 bar cells, and the overall bar is the same width so they line up.
      const colours = (runs: unknown[][]) => runs.map(r => r[0])
      const cells = (runs: unknown[][]) => runs.reduce((n: number, r) => n + (r[1] as string).length, 0)
      const ledger = await rowBar('Payments ledger')
      const exportBar = await rowBar('Payments export')
      const overall = await runsOf('all-hub:ENG:arch')
      expect([cells(ledger), cells(exportBar), cells(overall)]).toEqual([60, 60, 60])
      // done, then in progress, then (open items left) the track.
      expect(colours(ledger)).toEqual([ACCENT, DOING, TRACK])
      expect(colours(exportBar)).toEqual([ACCENT, DOING])
      expect(colours(overall)).toEqual([ACCENT, DOING, TRACK])
      expect(await ui.find({ type: 'Progress' })).toBeUndefined()
    }
    await ui.press({ key: 'done-hub:ENG:arch' })
    expect((await ui.find({ type: 'Text', text: 'Payments spec batch' }))?.text).toBe('Payments spec batch')
    await ui.press({ key: 'done-hub:ENG:arch' })
    await ui.unmount()
  }

  // Only the verified addresses were asked for a work report (each poll asks again).
  const asked = [...new Set(ran.filter(a => a[1] === 'work').map(a => a[3]))].sort()
  expect(asked).toEqual(['hub:ENG:arch', 'hub:ENG:code'])
})

test('the Escalations pane lists open escalations on both surfaces, and Relay no longer shows them', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface })
    expect((await ui.find({ key: 'filter-open' }))?.text).toBe('open 3')
    expect((await ui.find({ key: 'filter-resolved' }))?.text).toBe('resolved 1')
    expect((await ui.find({ key: 'filter-hidden' }))?.text).toBe('hidden 0')
    for (const [id, ticket] of [['e32', 'ENG-102'], ['e31', 'ENG-103'], ['e30', 'ENG-101']]) expect((await ui.find({ key: `sel-${id}` }))?.text).toBe(ticket)
    expect(await ui.find({ key: 'sel-e28' })).toBeUndefined()
    // Only a row with a recommendation offers a one-press resolve; every open row can hide.
    for (const [id, quick] of [['e32', true], ['e31', false], ['e30', true]] as const) {
      expect(await ui.find({ key: `quick-${id}` })).toEqual(quick ? expect.anything() : undefined)
      expect(await ui.find({ key: `hide-${id}` })).toBeDefined()
    }
    expect(await ui.find({ key: 'hide-all' })).toBeDefined()
    expect(await ui.find({ key: 'resolve-all' })).toBeDefined()
    await ui.unmount()

    const relay = await $.ui.mount({ ...pane('relay', 'Relay'), surface })
    expect(await relay.find({ key: 'sel-e30' })).toBeUndefined()
    expect(await relay.find({ key: 'filter-open' })).toBeUndefined()
    expect(await relay.find({ key: 'filter-waiting' })).toBeUndefined()
    expect(await relay.find({ type: 'Text', text: /escalation/i })).toBeUndefined()
    expect(await relay.find({ key: 'send' })).toBeDefined()
    await relay.unmount()
  }
})

test('a row resolves in one press with its recommendation, and a typed decision still takes a confirm', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'quick-e30' })
  expect(ran.filter(a => a[1] === 'resolve')).toEqual([
    ['agent-msg', 'resolve', 'e30', 'Allow the command on node-b; the lane can then finish and merge on its own.'],
  ])
  expect((await ui.find({ type: 'Text', text: /posted to ENG-101/ }))?.text).toMatch(/resolved e30/)

  // Opening a row shows its context; picking the recommendation and resolving arms first.
  await ui.press({ key: 'sel-e30' })
  expect((await ui.find({ type: 'Text', text: /integration test command is denied/ }))?.text).toMatch(/PR #42/)
  await ui.press({ key: 'rec-e30' })
  await ui.press({ key: 'resolve-e30' })
  expect((await ui.find({ key: 'resolve-e30' }))?.text).toBe('Confirm resolve')
  expect(ran.filter(a => a[1] === 'resolve').length).toBe(1)
  await ui.press({ key: 'resolve-e30' })
  expect(ran.filter(a => a[1] === 'resolve').length).toBe(2)

  // The resolved view shows the recorded decision.
  await ui.press({ key: 'filter-resolved' })
  await ui.press({ key: 'sel-e28' })
  expect((await ui.find({ type: 'Text', text: /Allowed the temporary/ }))?.text).toMatch(/exception/)
  await ui.unmount()
})

test('the Escalations pane replies to an escalation’s lead without resolving it', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'sel-e30' })
  await ui.input({ key: 'decision-e30', text: 'Hold until the release is cut', kind: 'change' })
  await ui.press({ key: 'reply-e30' })
  expect((await ui.find({ key: 'reply-e30' }))?.text).toBe('Confirm reply')
  expect((await ui.find({ type: 'Text', text: /Sends to hub:ENG:arch/ }))?.text).toMatch(/stays open/)
  await ui.press({ key: 'reply-e30' })

  expect(ran.find(a => a[1] === 'send')).toEqual([
    'agent-msg',
    'send',
    'hub:ENG:arch',
    'Operator, on escalation e30 (ENG-101): Hold until the release is cut',
  ])
  expect(ran.some(a => a[1] === 'resolve')).toBe(false)
  await ui.unmount()
})

test('Hide hides one row locally and Restore brings it back; nothing is sent', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'hide-e30' })
  expect(await ui.find({ key: 'sel-e30' })).toBeUndefined()
  expect((await ui.find({ key: 'filter-open' }))?.text).toBe('open 2')
  expect((await ui.find({ key: 'filter-hidden' }))?.text).toBe('hidden 1')

  await ui.press({ key: 'filter-hidden' })
  await ui.press({ key: 'restore-e30' })
  await ui.press({ key: 'filter-open' })
  expect((await ui.find({ key: 'sel-e30' }))?.text).toBe('ENG-101')
  expect(ran.some(a => a[1] === 'resolve' || a[1] === 'send')).toBe(false)
  await ui.unmount()
})

test('Hide all hides every open row locally, persists, and stays hidden until a row changes', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface })
    if (surface === 'desktop') {
      // The terminal pass hid everything already (the store lives for the test); restore to start again.
      await ui.press({ key: 'filter-hidden' })
      for (const id of ['e30', 'e31', 'e32']) await ui.press({ key: `restore-${id}` })
      await ui.press({ key: 'filter-open' })
    }
    expect((await ui.find({ key: 'hide-all' }))?.text).toBe('Hide all 3')
    await ui.press({ key: 'hide-all' })
    for (const id of ['e30', 'e31', 'e32']) expect(await ui.find({ key: `sel-${id}` })).toBeUndefined()
    expect((await ui.find({ key: 'filter-open' }))?.text).toBe('open 0')
    expect((await ui.find({ key: 'filter-hidden' }))?.text).toBe('hidden 3')
    await ui.unmount()
  }
  // Local only: no decision was sent.
  expect(ran.some(a => a[1] === 'resolve' || a[1] === 'send')).toBe(false)

  // A persisted hide survives a new session; a row whose status moved comes back.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const again = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })
  expect((await again.find({ key: 'filter-open' }))?.text).toBe('open 0')
  await again.unmount()
})

test('Resolve all confirms with the count, uses each recommendation, skips rows without one and reports failures', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false, failResolve: 'e32' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface })
    await ui.press({ key: 'resolve-all' })
    // The first press only arms: it names the count, the decision and the skipped rows.
    expect((await ui.find({ key: 'resolve-all' }))?.text).toBe('Confirm resolve 2')
    expect((await ui.find({ type: 'Text', text: /Resolve 2 escalations/ }))?.text).toBe(
      'Resolve 2 escalations with each one’s recommendation; 1 with none will be skipped. Press again to send.',
    )
    expect(ran.some(a => a[1] === 'resolve')).toBe(false)

    await ui.press({ key: 'resolve-all' })
    // Newest first; e31 has no recommendation and is never sent; e32 fails and e30 still goes.
    expect(ran.filter(a => a[1] === 'resolve').map(a => a[2])).toEqual(['e32', 'e30'])
    expect(ran.find(a => a[2] === 'e32')?.[3]).toBe('Take the first option')
    expect((await ui.find({ type: 'Text', text: /^Resolved 1 of 2/ }))?.text).toBe('Resolved 1 of 2; skipped 1 with no recommendation.')
    expect((await ui.find({ type: 'Text', text: /^e32 failed/ }))?.text).toBe('e32 failed: relay down')
    await ui.unmount()
  }
})

test('Resolve all says so when no open escalation has a recommendation', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })
  for (const id of ['e30', 'e32']) await ui.press({ key: `hide-${id}` })
  await ui.press({ key: 'resolve-all' })
  expect((await ui.find({ type: 'Text', text: /^Nothing to resolve/ }))?.text).toBe('Nothing to resolve: none of the 1 open has a recommendation.')
  expect(ran.some(a => a[1] === 'resolve')).toBe(false)
  await ui.unmount()
})

test('a hidden row comes back when its status changes, and the stale hide is dropped', async ($, on) => {
  const ran: string[][] = []
  const store = new Map<string, unknown>()
  let list = ESCALATIONS
  engine(on, ran, { teamMetrics: false, store, escalations: () => list })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'hide-e30' })
  expect(store.get('hiddenEscalations')).toEqual(['e30|waiting'])
  expect(await ui.find({ key: 'sel-e30' })).toBeUndefined()

  // The lead's session picks it up: same id, new status.
  list = list.replace('e30  waiting', 'e30  investigating')
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ key: 'sel-e30' }))?.text).toBe('ENG-101')
  expect((await ui.find({ key: 'filter-hidden' }))?.text).toBe('hidden 0')
  expect(store.get('hiddenEscalations')).toEqual([])
  await ui.unmount()
})

test('the hidden list is pruned to the rows still listed', async ($, on) => {
  const ran: string[][] = []
  const store = new Map<string, unknown>([['hiddenEscalations', ['e1|waiting', 'e30|waiting']]])
  engine(on, ran, { teamMetrics: false, store })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })
  expect((await ui.find({ key: 'filter-hidden' }))?.text).toBe('hidden 1')
  expect(store.get('hiddenEscalations')).toEqual(['e30|waiting'])
  await ui.unmount()
})

test('Relay’s old clearedEscalations list migrates once, and a restored row stays restored after a restart', async ($, on) => {
  const ran: string[][] = []
  const store = new Map<string, unknown>([['clearedEscalations', ['e30']]])
  engine(on, ran, { teamMetrics: false, store })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  // Migrated: hidden, now keyed to its status, and the old key emptied.
  expect(await ui.find({ key: 'sel-e30' })).toBeUndefined()
  expect(store.get('hiddenEscalations')).toEqual(['e30|waiting'])
  expect(store.get('clearedEscalations')).toEqual([])

  await ui.press({ key: 'filter-hidden' })
  await ui.press({ key: 'restore-e30' })
  expect(store.get('hiddenEscalations')).toEqual([])
  await ui.unmount()

  // A restart reads the store again: the row is still shown.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const again = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })
  await again.press({ key: 'filter-open' })
  expect((await again.find({ key: 'sel-e30' }))?.text).toBe('ENG-101')
  await again.unmount()
})

test('the send gate refuses a second send for a held id, and everything while Resolve all is held', () => {
  const gate = makeGate()
  // A send for e30 is held: pressing e30 again is refused, another id is not.
  expect(gate.enter('e30')).toBe(true)
  expect(gate.enter('e30')).toBe(false)
  expect(gate.enter('e31')).toBe(true)
  // Resolve all cannot start while any send runs.
  expect(gate.enter('all')).toBe(false)
  gate.leave('e30')
  gate.leave('e31')
  expect(gate.busy()).toBe(false)
  // Held, Resolve all refuses itself and every row.
  expect(gate.enter('all')).toBe(true)
  expect(gate.enter('all')).toBe(false)
  expect(gate.enter('e30')).toBe(false)
  expect(gate.keys()).toEqual(['all'])
  gate.leave('all')
  expect(gate.enter('e30')).toBe(true)
})

test('a one-press Resolve marks the row resolved at once, and it stays resolved after the poll', async ($, on) => {
  const ran: string[][] = []
  const sent = () => ran.filter(a => a[1] === 'resolve').map(a => a[2])
  // The relay lists e30 as resolved once the resolve has gone through.
  engine(on, ran, {
    teamMetrics: false,
    escalations: () => (sent().includes('e30') ? ESCALATIONS.replace('e30  waiting', 'e30  resolved') : ESCALATIONS),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'quick-e30' })
  expect(sent()).toEqual(['e30'])
  // Resolved at once: no quick button to press again, one fewer open.
  expect(await ui.find({ key: 'quick-e30' })).toBeUndefined()
  expect((await ui.find({ key: 'filter-open' }))?.text).toBe('open 2')
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'quick-e30' })).toBeUndefined()
  expect(sent()).toEqual(['e30'])
  await ui.unmount()
})

// The harness runs one event at a time and loads the plugin as its own module, so a send in flight cannot be held from a test: the decision is tested directly.
test('a Resolve all press waits while a send is in flight and keeps the armed confirm', () => {
  const key = 'resolve-all:e30,e32'
  expect(bulkStep(false, '', key)).toBe('arm')
  expect(bulkStep(false, 'resolve-all:e30', key)).toBe('arm')
  expect(bulkStep(false, key, key)).toBe('send')
  // Busy: wait, whatever the confirm is, so the armed confirm is neither spent nor changed.
  expect(bulkStep(true, key, key)).toBe('wait')
  expect(bulkStep(true, '', key)).toBe('wait')
})

test('a very long list draws at most 50 rows and says how many are not shown', async ($, on) => {
  const ran: string[][] = []
  const rows = Array.from({ length: 55 }, (_, i) => `e${100 + i}  waiting  T-${i}  session/cc33/dd44  11-20 16:29`).join('\n')
  engine(on, ran, { teamMetrics: false, escalations: () => rows })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface })
    expect((await ui.find({ key: 'filter-open' }))?.text).toBe('open 55')
    expect(await ui.find({ key: 'sel-e154' })).toBeDefined()
    expect(await ui.find({ key: 'sel-e105' })).toBeDefined()
    expect(await ui.find({ key: 'sel-e104' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /more not shown/ }))?.text).toBe('+5 more not shown; Hide all and Resolve all include them')
    expect((await ui.find({ key: 'hide-all' }))?.text).toBe('Hide all 55')
    await ui.unmount()
  }
})

test('a failed save of the hidden list keeps its notice instead of Hid eN', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false, failStoreSet: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })
  await ui.press({ key: 'hide-e30' })
  expect((await ui.find({ type: 'Text', text: /^Could not save the hidden list/ }))?.text).toMatch(/Could not save the hidden list/)
  expect(await ui.find({ type: 'Text', text: 'Hid e30.' })).toBeUndefined()
  await ui.unmount()
})

test('Resolve all sends only the confirmed set: a changed list needs a new confirm', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('escalations', 'Escalations'), surface: 'desktop' })

  await ui.press({ key: 'resolve-all' })
  expect((await ui.find({ key: 'resolve-all' }))?.text).toBe('Confirm resolve 2')
  // A row leaves the open set under the confirm: it is dropped, not honoured.
  await ui.press({ key: 'hide-e30' })
  expect((await ui.find({ key: 'resolve-all' }))?.text).toBe('Resolve all')
  await ui.press({ key: 'resolve-all' })
  expect(ran.some(a => a[1] === 'resolve')).toBe(false)
  expect((await ui.find({ key: 'resolve-all' }))?.text).toBe('Confirm resolve 1')
  await ui.press({ key: 'resolve-all' })
  expect(ran.filter(a => a[1] === 'resolve').map(a => a[2])).toEqual(['e32'])
  await ui.unmount()
})

test('a failed log or who read shows in the Relay footer and widget instead of silence', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false, failLog: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('relay', 'Relay'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^log: relay unreachable/ }))?.text).toBe('log: relay unreachable')
  await ui.unmount()
  const widget = await $.ui.mount({ ...pane('relay', 'Relay'), props: { ...pane('relay', 'Relay').props, placement: 'widget' }, surface: 'desktop' })
  expect((await widget.find({ type: 'Text', text: 'relay read failed' }))?.text).toBe('relay read failed')
  await widget.unmount()
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

test('the Focus pane reads ix-board once per interval and shares the result', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'desktop' })
  const boardReads = () => ran.filter(a => a[0] === 'ix-board').length
  expect(boardReads()).toBe(1)

  // A refresh within the interval answers from the shared result: progress still draws.
  await ui.press({ key: 'refresh' })
  expect(boardReads()).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^94%$/ }))?.text).toBe('94%')
  await ui.unmount()
})

test('a rate-limited read pauses every later ix-board call until Linear’s retry time', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false, rateLimited: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'desktop' })
  const boardReads = () => ran.filter(a => a[0] === 'ix-board').length
  expect(boardReads()).toBe(1)
  expect((await ui.find({ type: 'Text', text: /Linear rate limit/ }))?.text).toBe('Linear rate limit · paused 1h')

  await ui.press({ key: 'refresh' })
  expect(boardReads()).toBe(1)
  await ui.unmount()
})

test('a pane the host leaves undrawn is reported with its reason, and opened again when a surface attaches', async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  const statuses: (string | undefined)[] = []
  let placed = false
  engine(on, ran, {
    teamMetrics: false,
    status: text => statuses.push(text),
    open: id => {
      opens.push(id)
      return placed ? { isPlaced: true } : { isPlaced: false, reason: 'below 144 columns (now 100)' }
    },
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opens).toEqual([]) // session.start does not know the layout, so it opens nothing
  await drawBand($, FULLSCREEN)
  expect(opens).toEqual(['factory', 'focus', 'escalations', 'relay', 'team'])
  expect(statuses.at(-1)).toMatch(/Factory, Focus, Escalations, Relay, Team waiting \(below 144 columns \(now 100\)\)/)

  placed = true
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  expect(opens).toHaveLength(10)
  expect(statuses.at(-1)).toBeUndefined()

  // Let the polls started at session start settle before the file ends.
  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('a throwing open is reported and never breaks startup', async ($, on) => {
  const ran: string[][] = []
  const statuses: (string | undefined)[] = []
  engine(on, ran, {
    teamMetrics: false,
    status: text => statuses.push(text),
    open: () => {
      throw new Error('no surface')
    },
    // The host lists the panes that were asked for and never drawn, so the settle timer keeps them waiting.
    panes: () => ['factory', 'focus', 'escalations', 'relay', 'team'].map(id => ({ id, title: id, isPlaced: false })),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await drawBand($, FULLSCREEN)
  expect(statuses.at(-1)).toMatch(/Factory, Focus, Escalations, Relay, Team waiting \(.+\)/)

  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('on the main screen with the band off no pane is opened over the chat; the status line says how to open them', { options: { inlineView: 'off' } }, async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  const statuses: (string | undefined)[] = []
  engine(on, ran, { teamMetrics: false, status: text => statuses.push(text), open: id => (opens.push(id), { isPlaced: true }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await drawBand($, MAIN_SCREEN)
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: MAIN_SCREEN })
  expect(opens).toEqual([])
  expect(statuses.at(-1)).toMatch(/Type \/factory to open/)

  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('the panes open once, when the first band draw reports the fullscreen layout', async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  engine(on, ran, { teamMetrics: false, open: id => (opens.push(id), { isPlaced: true }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await drawBand($) // layout not measured yet: nothing opens
  expect(opens).toEqual([])
  await drawBand($, FULLSCREEN)
  await drawBand($, FULLSCREEN)
  expect(opens).toEqual(['factory', 'focus', 'escalations', 'relay', 'team'])

  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('a non-interactive run opens no panes and shows no status', async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  const statuses: (string | undefined)[] = []
  engine(on, ran, {
    teamMetrics: false,
    status: text => statuses.push(text),
    open: id => {
      opens.push(id)
      return { isPlaced: false, reason: 'no-surface' }
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  expect(opens).toEqual([])
  expect(statuses).toEqual([])

  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('a closed pane is not reopened on attach, and the status names only panes still waiting', async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  const statuses: (string | undefined)[] = []
  type Listed = { id: string; title: string; isPlaced: boolean }
  const entry = (id: string, isPlaced: boolean): Listed => ({ id, title: id, isPlaced })
  let listed: Listed[] = ['factory', 'focus', 'escalations', 'relay', 'team'].map(id => entry(id, false))
  engine(on, ran, {
    teamMetrics: false,
    status: text => statuses.push(text),
    open: id => {
      opens.push(id)
      return { isPlaced: false, reason: 'below 144 columns (now 100)' }
    },
    panes: () => listed,
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await drawBand($, FULLSCREEN)
  expect(opens).toEqual(['factory', 'focus', 'escalations', 'relay', 'team'])
  expect(statuses.at(-1)).toMatch(/Factory, Focus, Escalations, Relay, Team waiting/)

  // Factory got placed, the person closed Relay (it is no longer listed), Focus and Team wait.
  listed = [entry('factory', true), entry('focus', false), entry('escalations', true), entry('team', false)]
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  expect(opens.slice(5)).toEqual(['focus', 'team'])
  expect(statuses.at(-1)).toMatch(/Focus, Team waiting/)
  expect(statuses.at(-1)).not.toMatch(/Factory|Relay/)

  // Focus is placed and Team was closed: nothing waits, nothing is reopened, the status clears.
  listed = [entry('factory', true), entry('focus', true), entry('escalations', true)]
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:second', viewport: FULLSCREEN })
  expect(opens).toHaveLength(7)
  expect(statuses.at(-1)).toBeUndefined()

  const ui = await $.ui.mount({ ...pane('focus', 'Focus'), surface: 'terminal' })
  await ui.unmount()
})

test('the Team pane draws each tile’s six-hour series as braille dots on the terminal, and Svg on desktop', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const term = await $.ui.mount({ ...pane('team', 'Team'), surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^[⠀-⣿]+$/ }))?.text).toMatch(/^[⠀-⣿]+$/)
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})

test('a failing gate file or home lookup never leaves the board busy and keeps the fetched agents', { options: { teams: 'ENG' } }, async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 21, 10, 0) }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.read', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  on('fs.write', () => {
    throw new Error('read-only file system')
  })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: EMPTY } }))
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    if (line === 'printenv HOME') return { value: { exitCode: 0, stdout: '/home/test\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (line.startsWith('ix-board --json agents')) {
      const out = JSON.stringify({ agents: [{ agent: 'claude', herdr_status: 'working', machine: 'local', pane_id: 'w1:p1', team: 'ENG', title: 'plan' }] })
      return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'not stubbed', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('factory', 'Factory'), surface: 'terminal' })
  // The fetched agent is shown although the gate file cannot be saved, and the chip is not stuck on ◌.
  await ui.press({ key: 'board' })
  expect((await ui.find({ type: 'Text', text: /1\/1 working/ }))?.text).toMatch(/1\/1 working/)
  const marks = (await ui.findAll({ type: 'Text', text: /^[●▲○◌]$/ })).map(t => t.text)
  expect(marks.slice(0, 3)[2]).toBe('●')
  await ui.unmount()
})

test('the Focus bars fill the row at the sidebar width, and the overall bar matches the rows', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, { teamMetrics: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const base = pane('focus', 'Focus')
  for (const [columns, bar] of [[60, 30], [90, 60], [40, 10]] as const) {
    // a row is 15 name cells + bar + 10 count cells + 2 gaps inside 2 padding cells: columns - 3 - 12 - 15 cells of bar,
    // (the name column shrinks only when the bar would drop under 8 cells).
    const ui = await $.ui.mount({ ...base, props: { ...base.props, bodyColumns: columns }, surface: 'terminal' })
    const count = async (key: string) =>
      ((await ui.find({ key }))?.children as { children: string[] }[]).reduce((n, c) => n + c.children[0]!.length, 0)
    expect(await count('p-hub:ENG:arch-Payments ledger-bar')).toBe(bar)
    expect(await count('p-hub:ENG:arch-Payments export-bar')).toBe(bar)
    expect(await count('all-hub:ENG:arch')).toBe(bar)
    await ui.unmount()
  }
})

const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 180,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as never

test('the classic-layout band draws the selected modules as buttons, and a press opens that module’s pane', async ($, on) => {
  const ran: string[][] = []
  const opens: string[] = []
  const files = new Map([['/home/test/.ix/factory-panel/features/default.json', JSON.stringify({ modules: ['health'] })]])
  engine(on, ran, { files, teamMetrics: false, open: id => (opens.push(id), { isPlaced: true }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: MAIN_SCREEN })
  expect((await ui.find({ key: 'health' }))?.text).toBe('hosts —')
  expect(await ui.find({ key: 'local' })).toBeUndefined()
  await ui.press({ key: 'health' })
  expect(opens).toEqual(['factory'])
  await ui.unmount()

  // Fullscreen docks the panes, so no band is drawn there.
  const docked = await $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: FULLSCREEN })
  expect(await docked.find({ key: 'health' })).toBeUndefined()
  await docked.unmount()
})
