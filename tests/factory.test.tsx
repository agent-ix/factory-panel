import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { shortError } from '../hooks/shared'
import { trace } from './trace'

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
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1795237300000 }))
  on('clock.every', () => ({ value: undefined }))
  const files = new Map<string, string>()
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
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
    if (bin === 'printenv') return run('/home/test\n')
    if (bin === 'hostname') return run('node-a\n')
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
    // the chips show state only: no counts and no error text until one is pressed.
    for (const hidden of [/1 working · 0 idle · 1 done/, /2 waiting · 4 dead letters/, /1\/1 working/, /did not finish/]) {
      expect(await ui.find({ type: 'Text', text: hidden })).toBeUndefined()
    }
    for (const chip of ['herdr', 'ix-relay', 'ix-board']) {
      expect(Boolean(await ui.find({ type: 'Button', text: chip }))).toBe(true)
    }

    // herdr: its detail opens with the agents summed by status.
    await ui.press({ key: 'herdr' })
    expect((await ui.find({ type: 'Text', text: /1 working · 0 idle · 1 done/ }))?.text).toMatch(/1 working/)
    // relay: dead letters and waiting counts are summed from the doctor's messages.
    await ui.press({ key: 'relay' })
    expect((await ui.find({ type: 'Text', text: /2 waiting · 4 dead letters/ }))?.text).toMatch(/dead/)
    expect(await ui.find({ type: 'Text', text: /1 working · 0 idle · 1 done/ })).toBeUndefined()
    // board: the working count, and the partial-collection note from exit 4 (not a failure).
    await ui.press({ key: 'board' })
    expect((await ui.find({ type: 'Text', text: /1\/1 working/ }))?.text).toMatch(/1\/1 working/)
    expect((await ui.find({ type: 'Text', text: /did not finish/ }))?.text).toMatch(/node-a/)

    // the terminal has no Svg: it draws the summary tiles and bar glyphs instead of rings.
    const tile = await ui.find({ type: 'Text', text: /spend 24h/ })
    expect(Boolean(tile)).toBe(surface === 'terminal')

    // close the open detail so the next surface starts collapsed.
    await ui.press({ key: 'board' })
    expect(await ui.find({ type: 'Text', text: /1\/1 working/ })).toBeUndefined()

    await ui.unmount()
  }

  // The classic-layout band reads the same state: a coordinator sees each host with its mark.
  const band = await $.ui.mount({
    plugin: 'factory-panel',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 180, scroll: { offset: 0, bodyRows: 4 }, view: {} } as never,
    viewport: { columns: 200, rows: 50, isFullscreen: false },
  })
  const hosts = (await band.find({ key: 'health' }))?.text ?? ''
  expect(hosts).toMatch(/● node-a/)
  expect(hosts).toMatch(/○ node-b|▲ node-b|node-b/)
  expect((await band.find({ type: 'Text', text: /not reporting/ }))?.text).toMatch(/node-b not reporting/)
  await band.unmount()
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

const marks = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^[●▲○◌]$/ })).map(n => n.text)

test('the herdr and relay chips show ◌ before the first read', async ($, on) => {
  engine(on)
  // No session.start: nothing has been read yet.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await marks(ui)).slice(0, 2)).toEqual(['◌', '◌'])
    await ui.unmount()
  }
})

test('a failed herdr read and a relay that is not ok show ▲, with the error in the detail', async ($, on) => {
  engine(on)
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    return { value: { status: 200, ok: true, headers: {}, text: prometheusAnswer(body) } }
  })
  on('process.run', (_, e) => {
    const [bin] = e.argv
    if (bin === 'printenv') return run('/home/test\n')
    if (bin === 'herdr') return run('', 1)
    if (bin === 'agent-msg') return run(doctor.replace('"ok":true', '"ok":false'))
    return run('{}', 4)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await marks(ui)).slice(0, 2)).toEqual(['▲', '▲'])
    const shown = (await ui.findAll({ type: 'Text', text: /herdr exited 1/ })).length
    await ui.press({ key: 'herdr' })
    expect((await ui.findAll({ type: 'Text', text: /herdr exited 1/ })).length).toBe(shown + 1)
    await ui.press({ key: 'herdr' })
    await ui.unmount()
  }
})

// Factory gauges are whole-cell blocks: node-a's CPU is 43%, which rounds to 3 of 6 cells.
test('the terminal gauge draws whole-cell blocks', async ($, on) => {
  engine(on)
  on('http.fetch', (_, e) => {
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    return { value: { status: 200, ok: true, headers: {}, text: prometheusAnswer(body) } }
  })
  on('process.run', (_, e) => (e.argv[0] === 'herdr' ? run(herdrSnapshot) : run(doctor)))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^███░░░$/ }))?.text).toBe('███░░░')
  await ui.unmount()
})

test('a Prometheus timeout shows one short footer line, with the full text in the open detail', async ($, on) => {
  engine(on)
  const long = 'Prometheus query failed: no complete answer within 30000ms'
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'error', error: long }) } }))
  on('process.run', (_, e) => {
    const [bin] = e.argv
    if (bin === 'printenv') return run('/home/test\n')
    if (bin === 'herdr') return run(herdrSnapshot)
    if (bin === 'agent-msg') return run(doctor)
    return run('{}', 4)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const footer = (await ui.find({ type: 'Text', text: /^prometheus: timed out$/ }))?.text
    expect(footer).toBe('prometheus: timed out')
    // The raw error would not fit 40 columns; the footer does, and the text is clipped rather than wrapped.
    expect(long.length).toBeGreaterThan(40)
    expect(footer?.length).toBeLessThanOrEqual(40)
    expect((await ui.find({ type: 'Text', text: /^prometheus: timed out$/ }))?.props.wrap).toBe('truncate-end')
    expect(await ui.find({ type: 'Text', text: /30000ms/ })).toBeUndefined()
    // Opening a chip shows the full error for diagnosis.
    await ui.press({ key: 'herdr' })
    expect((await ui.find({ type: 'Text', text: /30000ms/ }))?.text).toContain(long)
    await ui.press({ key: 'herdr' })
    await ui.unmount()
  }
})

test('only a real timeout is shortened; other errors, and a bad_data error naming a timeout parameter, stay whole', () => {
  expect(shortError('prometheus', 'no complete answer within 30000ms')).toBe('prometheus: timed out')
  expect(shortError('prometheus', 'request timed out')).toBe('prometheus: timed out')
  expect(shortError('prometheus', 'Prometheus 503')).toBe('Prometheus 503')
  expect(shortError('prometheus', 'connection refused')).toBe('connection refused')
  const badData = 'invalid parameter "timeout": cannot parse "x" to a valid duration'
  expect(shortError('prometheus', badData)).toBe(badData)
})

const factoryWorld = (on: Parameters<TestBody>[1], prometheus: { up: boolean }) => {
  engine(on)
  on('http.fetch', (_, e) => {
    if (!prometheus.up) return { value: { status: 503, ok: false, headers: {}, text: 'down' } }
    const body = typeof e.init?.body === 'string' ? decodeURIComponent(e.init.body) : ''
    return { value: { status: 200, ok: true, headers: {}, text: prometheusAnswer(body) } }
  })
  on('process.run', (_, e) => {
    const [bin] = e.argv
    if (bin === 'printenv') return run('/home/test\n')
    if (bin === 'herdr') return run(herdrSnapshot)
    if (bin === 'agent-msg') return run(doctor)
    return run('{}', 4)
  })
}

test('with no answer from the metrics service the Factory view says so with the reason', async ($, on) => {
  trace("FR-006-AC-9")
  factoryWorld(on, { up: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const note = (await ui.find({ type: 'Text', text: /^Metrics unavailable: / }))?.text ?? ''
  expect(note).toMatch(/^Metrics unavailable: .*503/)
  // Nothing was ever read, so there is no earlier value to mark as old.
  expect(note).not.toMatch(/values from/)
  await ui.unmount()
})

test('when the metrics service stops answering the earlier values stay, marked as old', async ($, on) => {
  trace("FR-006-AC-9")
  const prometheus = { up: true }
  factoryWorld(on, prometheus)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /● node-a/ }))?.text).toMatch(/node-a/)
  expect(await ui.find({ type: 'Text', text: /^Metrics unavailable/ })).toBeUndefined()
  prometheus.up = false
  await ui.press({ key: 'refresh' })
  const note = (await ui.find({ type: 'Text', text: /^Metrics unavailable: / }))?.text ?? ''
  expect(note).toMatch(/503/)
  expect(note).toMatch(/values from /)
  expect((await ui.find({ type: 'Text', text: /● node-a/ }))?.text).toMatch(/node-a/)
  await ui.unmount()
})
