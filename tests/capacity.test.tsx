import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'
import { paint } from './paint'

import { out, startSession, world } from './world'
import type { Run, World } from './world'

// Tests for the Hosts table of the Team tab (FR-032). The lane series follow the ix-relay watcher's FR-045 and the
// ledger rows the published shape of `ix-board --json fleet ledger query host_output_share_of_recorded_level`.

type $t = Parameters<TestBody>[0]
const SEC = 1000
const MIN = 60 * SEC
const NOW = Date.UTC(2026, 10, 24, 12, 0)
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'team', props: { title: 'Team', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const LEDGER = 'ix-board --json fleet ledger query host_output_share_of_recorded_level'
const SHARE = 'ix_fleet_host_output_share_of_recorded_level'
const DEFICIT = 'ix_fleet_ready_buffer_deficit'

/** One lane series: its host, lane, state, and the age of its last sample in seconds. */
type Lane = [host: string, lane: string, state: string, age?: number]
type Busy = { host: string; ratio: number | string; age?: number; job?: string }
type Fleet = {
  lanes?: Lane[]
  /** why a lane is blocked */
  reasons?: [host: string, lane: string, reason: string, age?: number][]
  busy?: Busy[]
  deficit?: [string, number][]
  /** the age in minutes of each host's deficit sample; by default 2 */
  deficitAge?: number
  /** the largest share of the last two hours, and the share two hours ago */
  most?: [string, number][]
  earlier?: [string, number][]
  failing?: RegExp
}

const vector = (result: unknown[]) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }) } })
const sample = (metric: Record<string, string>, value: number | string) => ({ metric, value: [NOW / 1000, String(value)] })

function answer(fleet: Fleet, query: string) {
  if (fleet.failing?.test(query)) return { value: { status: 500, ok: false, headers: {}, text: '' } }
  const busy = fleet.busy ?? []
  const labels = (b: Busy) => ({ host: b.host, job: b.job ?? 'ix-relay-watcher' })
  const at = (age: number | undefined) => NOW / 1000 - (age ?? 10)
  if (query === 'timestamp(ix_fleet_lane_state_ratio)') return vector((fleet.lanes ?? []).map(([host, lane, state, age]) => sample({ host, lane, state }, at(age))))
  if (query === 'timestamp(ix_fleet_lane_blocked_ratio)') return vector((fleet.reasons ?? []).map(([host, lane, reason, age]) => sample({ host, lane, reason }, at(age))))
  if (query === 'last_over_time(ix_fleet_host_busy_ratio[1h])') return vector(busy.map(b => sample({ __name__: 'ix_fleet_host_busy_ratio', ...labels(b) }, b.ratio)))
  if (query.includes('timestamp(ix_fleet_host_busy_ratio)')) return vector(busy.map(b => sample(labels(b), b.age ?? 10)))
  if (query === DEFICIT) return vector((fleet.deficit ?? []).map(([host, n]) => sample({ __name__: query, host }, n)))
  if (query === `${DEFICIT}_timestamp_seconds`) return vector((fleet.deficit ?? []).map(([host]) => sample({ __name__: query, host }, NOW / 1000 - (fleet.deficitAge ?? 2) * 60)))
  if (query === `max_over_time(${SHARE}[2h])`) return vector((fleet.most ?? []).map(([host, n]) => sample({ host }, n)))
  if (query === `${SHARE} offset 2h`) return vector((fleet.earlier ?? []).map(([host, n]) => sample({ host }, n)))
  return vector([])
}

/** A ledger row of the view, its sample `agoMin` minutes old. */
const row = (host: string, more: Record<string, unknown> = {}, agoMin = 2) => ({ host, output_basis: 'tickets_prs', output_per_hour: 3, recorded_output_per_hour: 6, share_percent: 50, at_ms: NOW - agoMin * MIN, unavailable_reason: null, source_basis: {}, ...more })
const rowsOf = (rows: unknown[]) => () => out(JSON.stringify({ view: 'host_output_share_of_recorded_level', since_ms: null, rows }))

const FULL: Fleet = {
  lanes: [['draco', 'hub:A:one', 'working'], ['draco', 'hub:A:two', 'working'], ['draco', 'hub:A:three', 'idle'], ['luna', 'hub:B:one', 'idle']],
  busy: [{ host: 'draco', ratio: 0.429 }, { host: 'luna', ratio: 0.999 }],
  deficit: [['draco', 3], ['luna', 0]],
}

async function setup($: $t, on: Parameters<TestBody>[1], fleet: Fleet = FULL, ledger: () => Run | Promise<Run> = rowsOf([row('draco')])): Promise<World & { queries: string[] }> {
  const queries: string[] = []
  const w = Object.assign(world(on, true), { queries })
  w.fetch.value = (url, body) => {
    if (!url.endsWith('/api/v1/query')) return undefined
    const query = body.replace(/^query=/, '')
    queries.push(query)
    return answer(fleet, query)
  }
  const prior = w.stub.value
  w.stub.value = (argv, init) => (argv.join(' ') === LEDGER ? ledger() : prior?.(argv, init))
  await startSession($)
  return w
}

type Node = { type?: string; children?: unknown[] }
/** The words of each Text under an element, in the order drawn. */
const textsIn = (node: unknown): string[] => {
  const { type, children = [] } = node as Node
  if (type === 'Text') return [children.join('')]
  return children.flatMap(c => (typeof c === 'object' && c !== null ? textsIn(c) : []))
}

async function draw($: $t, w: World, wait = SEC, placement: 'dock' | 'widget' = 'dock') {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement }, surface: 'terminal' } as never)
  await w.clock!.advance(wait)
  const lines = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  /** The lines of the table: from its heading to the footer of the view. */
  const section = async () => {
    const t = await lines()
    const from = t.indexOf('Hosts')
    expect(from).toBeGreaterThan(-1)
    return t.slice(from, t.findIndex((l, i) => i > from && (l === '⚠' || l.startsWith('updated '))))
  }
  /** The cells of a host's row, its name left out. */
  const cells = async (host: string) => {
    const found = await ui.find({ key: `capacity-${host}` })
    expect(found).toBeDefined()
    return textsIn(found).filter(t => t.trim() !== host)
  }
  const labels = async () => (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  const why = async () => {
    const before = await lines()
    await ui.press({ key: 'hosts-why' })
    return (await lines()).filter(l => !before.includes(l) && l !== '⚠' && !l.startsWith('updated '))
  }
  /** What follows a host's figures; undefined where nothing does. */
  const notes = async (host: string) => ((await ui.find({ key: `notes-${host}` }))?.props as { label?: string } | undefined)?.label
  return { ui, lines, section, cells, labels, why, notes }
}
const reads = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json fleet'))
const failed = async ($: $t) => ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string).split('\n').filter(l => l.includes('ix-board fleet ledger:'))

test('each host is a row of working, stuck and idle lanes, CPU and finished work per hour', async ($, on) => {
  trace("FR-032-AC-1")
  const w = await setup($, on)
  const d = await draw($, w)
  const header = (await d.section()).slice(0, 7)
  expect(header).toEqual(['Hosts', '  host', 'working', 'stuck', 'idle', 'CPU', 'done/h'])
  expect(await d.cells('draco')).toEqual(['2', '0', '1', '◔ 42%', '3 (best 6)'])
  expect(await d.notes('draco')).toBe('↓ 3')
  expect(await d.cells('luna')).toEqual(['0', '0', '1', '◕ 99%', '—'])
  expect((await d.section()).join('\n')).not.toMatch(/Busy|Ready deficit|unavailable|of level/)
  await d.ui.unmount()
})

test('every cell of the Hosts table starts in the column of its heading', async ($, on) => {
  trace("FR-032-AC-1")
  const w = await setup($, on)
  const d = await draw($, w)
  const lines = paint((await d.ui.findAll({ type: 'Box' }))[0])
  const head = lines.find(l => l.includes('working') && l.includes('stuck'))!
  const columns = ['working', 'stuck', 'idle', 'CPU', 'done/h'].map(name => head.indexOf(name))
  for (const [host, cells] of [['draco', ['2', '0', '1', '◔ 42%', '3 (best 6)']], ['luna', ['0', '0', '1', '◕ 99%', '—']]] as const) {
    const row = lines.find(l => l.includes(` ${host} `))!
    expect(cells.map((c, i) => row.slice(columns[i]!, columns[i]! + c.length))).toEqual([...cells])
  }
  await d.ui.unmount()
})

test('a CPU sample that is old, doubled or not a ratio reads a dash, and the ○ says so', async ($, on) => {
  trace("FR-032-AC-2", "FR-032-AC-8")
  const w = await setup($, on, { busy: [
    { host: 'aged', ratio: 0.5, age: 61 },
    { host: 'edge', ratio: 0.5, age: 60 },
    { host: 'moved', ratio: 0.9, age: 900, job: 'old' }, { host: 'Moved', ratio: 0.2, age: 5 },
    { host: 'twice', ratio: 0.1, age: 5 }, { host: 'twice', ratio: 0.2, age: 7, job: 'other' },
    { host: 'wild', ratio: 1.5 }, { host: 'nil', ratio: 0 },
  ] }, rowsOf([]))
  const d = await draw($, w)
  const cpu = async (host: string) => (await d.cells(host))[0]
  expect(await d.section()).not.toContain('done/h')
  expect(await cpu('aged')).toBe('—')
  expect(await cpu('edge')).toBe('◑ 50%')
  expect(await cpu('moved')).toBe('○ 20%')
  expect(await cpu('twice')).toBe('—')
  expect(await cpu('wild')).toBe('—')
  expect(await cpu('nil')).toBe('○ 0%')
  const said = await d.why()
  expect(await d.section()).not.toContain('done/h')
  for (const host of ['aged', 'twice', 'wild']) expect(said).toContain(`${host}: no current CPU sample`)
  await d.ui.unmount()
})

test('a lane counts in the state of its newest current series, and an ended lane in none', async ($, on) => {
  trace("FR-032-AC-3")
  const w = await setup($, on, { lanes: [
    // It was working until a moment ago: Prometheus still has that series.
    ['draco', 'hub:A:one', 'working', 45], ['draco', 'hub:A:one', 'idle', 10],
    ['draco', 'hub:A:two', 'working'],
    ['draco', 'hub:A:gone', 'ended'],
    // A series the watcher stopped pushing.
    ['draco', 'hub:A:old', 'working', 121],
    ['silent', 'hub:C:one', 'working', 600],
  ] }, rowsOf([]))
  const d = await draw($, w)
  expect((await d.cells('draco')).slice(0, 3)).toEqual(['1', '0', '1'])
  expect((await d.cells('silent')).slice(0, 3)).toEqual(['—', '—', '—'])
  expect(await d.why()).toContain('silent: no current lane state')
  await d.ui.unmount()
})

test('blocked and stuck lanes are stuck, listed with their reason by a press, and a wait loop is waiting', async ($, on) => {
  trace("FR-032-AC-4")
  const w = await setup($, on, {
    lanes: [['draco', 'hub:A:ask', 'blocked'], ['draco', 'hub:A:tool', 'stuck'], ['draco', 'hub:A:build', 'blocked'], ['draco', 'hub:A:mute', 'blocked'], ['draco', 'hub:A:ok', 'working']],
    reasons: [['draco', 'hub:A:ask', 'permission'], ['draco', 'hub:A:build', 'wait_loop'], ['draco', 'hub:A:mute', 'dialog', 600]],
  }, rowsOf([]))
  const d = await draw($, w)
  expect(await d.labels()).toContain('▸ draco')
  expect((await d.cells('draco')).filter(c => !/[▸▾]/.test(c))).toEqual(['1', '3', '0'])
  expect(await d.notes('draco')).toBe('◌ 1')
  await d.ui.press({ key: 'notes-draco' })
  expect(await d.lines()).toContain('     ◌ 1 lane waiting: repeats a sleep or poll line')
  await d.ui.press({ key: 'notes-draco' })
  expect((await d.lines()).join('\n')).not.toContain('lane waiting')
  expect((await d.lines()).join('\n')).not.toContain('hub:A:')
  await d.ui.press({ key: 'host-draco' })
  expect((await d.lines()).filter(l => l.includes('hub:A:')).map(l => l.trim())).toEqual([
    'hub:A:ask  stuck: permission',
    'hub:A:build  waiting: repeats a sleep or poll line',
    'hub:A:mute  stuck: reason not published',
    'hub:A:tool  stuck: a tool call ran past its limit',
  ])
  expect(await d.labels()).toContain('▾ draco')
  await d.ui.press({ key: 'host-draco' })
  expect((await d.lines()).join('\n')).not.toContain('hub:A:')
  await d.ui.unmount()
})

test('done/h is the output of the host’s ledger row with the best recorded, and a dash until there is one', async ($, on) => {
  trace("FR-032-AC-5")
  const hosts = ['best', 'part', 'zero', 'nobest', 'old', 'null', 'split', 'twin', 'norow']
  const w = await setup($, on, { lanes: hosts.map(h => [h, `hub:${h}:a`, 'idle']), busy: hosts.map(host => ({ host, ratio: 0.1 })) }, rowsOf([
    row('best', { output_per_hour: 6 }), row('part', { output_per_hour: 2.25 }), row('zero', { output_per_hour: 0 }),
    row('nobest', { recorded_output_per_hour: null }), row('old', {}, 11),
    row('null', { output_per_hour: null, unavailable_reason: 'coverage_below_90_percent' }),
    row('split'), row('split', { output_per_hour: 4 }), row('twin'), row('twin'),
  ]))
  const d = await draw($, w)
  const done = async (host: string) => (await d.cells(host))[4]
  expect(await d.section()).toContain('done/h')
  // Nothing but done/h is missing here, so there is no ○.
  expect(await d.ui.find({ key: 'hosts-why' })).toBeUndefined()
  expect(await Promise.all(hosts.map(done))).toEqual(['6 (best 6)', '2.3 (best 6)', '0 (best 6)', '3', '—', '—', '—', '3 (best 6)', '—'])
  await d.ui.unmount()
})

for (const [name, deficit, age, shown] of [
  ['above 0', 3, 2, true], ['of 0', 0, 2, false], ['from a sample over 10 minutes old', 3, 11, false],
] as [string, number, number, boolean][]) {
  test(`a shortfall of ready work ${name} ${shown ? 'reads ↓ with its words by a press' : 'says nothing'}`, async ($, on) => {
    trace("FR-032-AC-6")
    const w = await setup($, on, { lanes: [['draco', 'a', 'idle']], deficit: [['draco', deficit]], deficitAge: age })
    const d = await draw($, w)
    expect(await d.notes('draco')).toBe(shown ? `↓ ${deficit}` : undefined)
    expect((await d.lines()).join('\n')).not.toContain('needs work')
    if (shown) {
      await d.ui.press({ key: 'notes-draco' })
      expect(await d.lines()).toContain(`     ↓ needs work: ${deficit} more ready tickets`)
    }
    await d.ui.unmount()
  })
}

for (const [name, lanes, done, most, earlier, shown] of [
  ['lanes working and nothing finished for 2h', 'working', 0, 0, 0, true],
  ['no lane working', 'idle', 0, 0, 0, false],
  ['work finished now', 'working', 2, 0.5, 0, false],
  ['work finished within the 2h', 'working', 0, 0.5, 0, false],
  ['no sample 2h ago', 'working', 0, 0, null, false],
  ['no done/h data', 'working', null, 0, 0, false],
] as [string, string, number | null, number, number | null, boolean][]) {
  test(`with ${name} a host ${shown ? 'reads churning' : 'does not read churning'}`, async ($, on) => {
    trace("FR-032-AC-7")
    const w = await setup($, on, { lanes: [['draco', 'a', lanes]], most: [['draco', most]], earlier: earlier === null ? [] : [['draco', earlier]] }, rowsOf(done === null ? [] : [row('draco', { output_per_hour: done })]))
    const d = await draw($, w)
    expect((await d.notes('draco'))?.includes('⏱ 2h') === true).toBe(shown)
    await d.ui.unmount()
  })
}

test('with nothing to show the section is its heading and one ○, which says why', async ($, on) => {
  trace("FR-032-AC-8")
  const w = await setup($, on, {}, rowsOf([]))
  const d = await draw($, w)
  expect(await d.section()).toEqual(['Hosts'])
  expect((await d.labels()).filter(l => l === '○' || l.startsWith('▸ '))).toContain('○')
  expect(await d.why()).toEqual(['Prometheus has no ix_fleet_lane_state_ratio sample', 'Prometheus has no ix_fleet_host_busy_ratio sample'])
  await d.ui.unmount()
})

for (const [what, ledger, reason, isFailure] of [
  ['has no such view', () => out('', 3, 'fleet ledger: unknown ledger view host_output_share_of_recorded_level\n'), 'this ix-board has no host_output_share_of_recorded_level view', false],
  ['has no ledger query', () => out('', 2, "error: unrecognized subcommand 'ledger'\n\nFor more information, try '--help'.\n"), 'this ix-board has no `fleet ledger query`', false],
  ['fails', () => out('', 3, 'fleet ledger: schema version 9 is not supported\n'), 'fleet ledger: schema version 9 is not supported', true],
  ['prints no JSON', () => out('rows'), 'the answer is not JSON', true],
  ['answers no rows', () => out('{"view":"x"}'), 'the answer is not rows of hosts', true],
  ['is cut short', () => ({ ...rowsOf([])(), isStdoutTruncated: true }), 'the answer was cut at 4 MiB', true],
] as [string, () => Run, string, boolean][]) {
  test(`an ix-board that ${what} leaves out the done/h column, with no ○ and the other columns drawn`, async ($, on) => {
    trace("FR-032-AC-8")
    const w = await setup($, on, FULL, ledger)
    const d = await draw($, w)
    expect(await d.cells('draco')).toEqual(['2', '0', '1', '◔ 42%'])
    expect(await d.section()).not.toContain('done/h')
    expect((await d.lines()).join('\n')).not.toContain(reason)
    expect(await d.ui.find({ key: 'hosts-why' })).toBeUndefined()
    expect(await failed($)).toEqual(isFailure ? [expect.stringContaining(reason)] : [])
    await d.ui.unmount()
  })
}

test('a failing Prometheus query leaves out its columns and is said behind the ○, with why a done/h is lacking', async ($, on) => {
  trace("FR-032-AC-8")
  const w = await setup($, on, { ...FULL, failing: /lane_state|host_busy/ })
  const d = await draw($, w)
  const section = await d.section()
  for (const column of ['working', 'stuck', 'idle', 'CPU']) expect(section).not.toContain(column)
  expect(await d.cells('draco')).toEqual(['3 (best 6)'])
  expect(await d.why()).toEqual(['ix_fleet_lane_state_ratio: Prometheus 500', 'ix_fleet_host_busy_ratio: Prometheus 500', 'luna done/h: no best recorded in this machine’s ledger'])
  await d.ui.unmount()
})

test('before the first read the section says it is reading', async ($, on) => {
  trace("FR-032-AC-8")
  const w = await setup($, on, FULL, () => new Promise<Run>(() => undefined))
  const d = await draw($, w)
  expect(await d.section()).toEqual(['Hosts', 'reading…'])
  await d.ui.unmount()
})

test('only the ledger query is run, once a minute and on r', async ($, on) => {
  trace("FR-032-AC-9")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(reads(w)).toEqual([LEDGER])
  await w.clock!.advance(30 * SEC)
  expect(reads(w)).toHaveLength(1)
  await w.clock!.advance(45 * SEC)
  expect(reads(w)).toHaveLength(2)
  await d.ui.press({ key: 'refresh' })
  await w.clock!.advance(SEC)
  expect(reads(w)).toHaveLength(3)
  expect(reads(w).every(l => l === LEDGER)).toBe(true)
  expect(w.ran.filter(l => /fleet (saturation|capacity)/.test(l))).toEqual([])
  await d.ui.unmount()
})

test('the one-line widget reads nothing of the hosts', async ($, on) => {
  trace("FR-032-AC-9")
  const w = await setup($, on)
  const d = await draw($, w, 3 * MIN, 'widget')
  expect(reads(w)).toEqual([])
  expect(w.queries.filter(q => q.includes('ix_fleet_'))).toEqual([])
  await d.ui.unmount()
})
