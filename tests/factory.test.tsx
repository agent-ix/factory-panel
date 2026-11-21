import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'factory-panel',
  component: 'Pane',
  requestId: 'factory',
  props: {
    title: 'Factory',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const vector = (rows: { metric: Record<string, string>; v: number }[]) =>
  JSON.stringify({
    status: 'success',
    data: {
      resultType: 'vector',
      result: rows.map(r => ({ metric: r.metric, value: [1795237296, String(r.v)] })),
    },
  })

const prometheusAnswer = (query: string): string => {
  if (query.includes('timestamp(ix_relay_registrations)')) {
    return vector([
      { metric: { machine: 'node-a' }, v: 12 },
      { metric: { machine: 'node-b' }, v: 900 },
    ])
  }
  if (query.includes('sum by (machine) (ix_relay_registrations)')) {
    return vector([{ metric: { machine: 'node-a' }, v: 1 }, { metric: { machine: 'node-b' }, v: 24 }])
  }
  if (query.includes('herdr_pane_status_ratio')) {
    return vector([
      { metric: { machine: 'node-a', status: 'idle' }, v: 1 },
      { metric: { machine: 'node-b', status: 'working' }, v: 8 },
    ])
  }
  if (query.includes('node_cpu_seconds_total')) {
    return vector([{ metric: { instance: 'node-a.ix:9100' }, v: 42.5 }])
  }
  if (query.includes('node_hwmon_temp_celsius')) {
    return vector([{ metric: { instance: 'node-a.ix:9100' }, v: 71 }])
  }
  return vector([])
}

const herdrSnapshot = JSON.stringify({
  result: {
    snapshot: {
      version: '0.9.1',
      agents: [
        {
          agent: 'claude',
          agent_status: 'working',
          terminal_title_stripped: 'billing-migration-plan',
          pane_id: 'w1F:p13',
          workspace_id: 'w1F',
        },
        {
          agent: 'codex',
          agent_status: 'done',
          terminal_title_stripped: 'Fix flaky test',
          pane_id: 'w1E:p5',
          workspace_id: 'w1E',
        },
      ],
      workspaces: [
        { workspace_id: 'w1F', label: 'ENG' },
        { workspace_id: 'w1E', label: 'ix-relay' },
      ],
    },
  },
})

const doctor = JSON.stringify({
  ok: true,
  strict: false,
  checks: [
    { check: 'redis', status: 'ok', subject: null, message: 'redis answers in 31 ms' },
    { check: 'watcher', status: 'ok', subject: 'node-a', message: 'watcher on node-a: last tick 2s ago' },
    { check: 'watcher', status: 'ok', subject: 'node-b', message: 'watcher on node-b: last tick 0s ago' },
    { check: 'dead_letter', status: 'warn', subject: 'session/x', message: '4 dead letter(s) for session/x' },
    { check: 'inbox', status: 'warn', subject: 'session/y', message: 'session/y: 2 waiting, oldest 11m' },
  ],
})

// What sits beneath the plugin in a session, answered here in the engine's place.
const engine = (on: Parameters<TestBody>[1]) => {
  on('command.register', () => ({ value: { command: 'factory' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1795237300000 }))
  on('clock.every', () => ({ value: undefined }))
}

const run = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('the pane draws machines, herdr, relay and board from seeded answers', { options: { teams: 'ENG,ix-relay,web' } }, async ($, on) => {
  engine(on)
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    return { value: { status: 200, ok: true, headers: {}, text: prometheusAnswer(body) } }
  })
  on('process.run', (_, e) => {
    const [bin] = e.argv
    if (bin === 'herdr') return run(herdrSnapshot)
    if (bin === 'agent-msg') return run(doctor)
    if (bin === 'ix-board') {
      return run(
        JSON.stringify({
          errors: ['node-a: herdr agent list did not finish within 26s'],
          agents: [
            {
              agent: 'claude',
              herdr_status: 'working',
              machine: 'local',
              pane_id: 'w1F:p13',
              team: 'ENG',
              title: 'billing-migration-plan',
            },
          ],
        }),
        4,
      )
    }
    return run('')
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // node-b's watcher went silent 15 minutes ago: one of two machines is up.
    expect((await ui.find({ type: 'Text', text: /1\/2 up/ }))?.text).toMatch(/1\/2 up/)
    expect((await ui.find({ type: 'Text', text: /● node-a/ }))?.text).toMatch(/node-a/)
    expect((await ui.find({ type: 'Text', text: /○ node-b/ }))?.text).toMatch(/node-b/)
    // node_exporter answered for node-a: its temperature shows, mapped from the instance.
    expect((await ui.find({ type: 'Text', text: /71°/ }))?.text).toBe('71°')
    // herdr: the tile sums the agents by status.
    expect((await ui.find({ type: 'Text', text: /1 working · 0 idle · 1 done/ }))?.text).toMatch(/1 working/)
    // relay: dead letters and waiting counts are summed from the doctor's messages.
    expect((await ui.find({ type: 'Text', text: /2 waiting · 4 dead letters/ }))?.text).toMatch(/dead/)
    // board: collapsed by default, shows the working count in its status.
    expect((await ui.find({ type: 'Text', text: /1\/1 working/ }))?.text).toBe('1/1 working')
    // the partial-collection note from exit 4 is shown, not treated as a failure.
    expect((await ui.find({ type: 'Text', text: /did not finish/ }))?.text).toMatch(/node-a/)

    await ui.unmount()
  }
})

test('the widget seat draws one glance line', async ($, on) => {
  engine(on)
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    return { value: { status: 200, ok: true, headers: {}, text: prometheusAnswer(body) } }
  })
  on('process.run', (_, e) => (e.argv[0] === 'herdr' ? run(herdrSnapshot) : run(doctor)))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })

  expect((await ui.find({ type: 'Text', text: /1\/2 up/ }))?.text).toBe('1/2 up')
  expect((await ui.find({ type: 'Text', text: /1 working/ }))?.text).toMatch(/1 working/)
  expect((await ui.find({ type: 'Text', text: /71°/ }))?.text).toMatch(/71°/)
  await ui.unmount()
})
