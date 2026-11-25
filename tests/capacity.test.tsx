import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { out, startSession, world } from './world'
import type { Run, World } from './world'

// Tests for the Capacity section of the Team tab (FR-032). The ledger rows follow the published shape of
// `fleet ledger query host_output_share_of_recorded_level --json`.

type $t = Parameters<TestBody>[0]
const SEC = 1000
const MIN = 60 * SEC
const NOW = Date.UTC(2026, 10, 24, 12, 0)
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'team', props: { title: 'Team', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const LEDGER = 'ix-board --json fleet ledger query host_output_share_of_recorded_level'

/** One busy ratio series: its host, value, the age of its last sample in seconds, and the job that pushed it. */
type Busy = { host: string; ratio: number | string; age?: number | null; job?: string }
type Fleet = {
  busy?: Busy[]
  deficit?: [string, number | string][]
  /** the age in minutes of each host's deficit sample; by default every deficit's sample is 2 minutes old */
  deficitAge?: [string, number][]
  deficitWhy?: [string, string][]
  share?: [string, number | string][]
  shareAge?: [string, number][]
  level?: [string, number][]
  discovery?: [string, string][]
  failing?: RegExp
}
const DEFICIT = 'ix_fleet_ready_buffer_deficit'
const SHARE = 'ix_fleet_host_output_share_of_recorded_level'
/** Series whose value is the time of a host's sample, in seconds. */
const times = (name: string, ages: [string, number][]) => vector(ages.map(([host, ago]) => sample({ __name__: name, host }, NOW / 1000 - ago * 60)))

const vector = (result: unknown[]) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }) } })
const sample = (metric: Record<string, string>, value: number | string) => ({ metric, value: [NOW / 1000, String(value)] })

function answer(fleet: Fleet, query: string) {
  if (fleet.failing?.test(query)) return { value: { status: 500, ok: false, headers: {}, text: '' } }
  const busy = fleet.busy ?? []
  const labels = (b: Busy) => ({ host: b.host, job: b.job ?? 'ix-relay-watcher' })
  if (query === 'last_over_time(ix_fleet_host_busy_ratio[1h])') return vector(busy.map(b => sample({ __name__: 'ix_fleet_host_busy_ratio', ...labels(b) }, b.ratio)))
  if (query.includes('timestamp(ix_fleet_host_busy_ratio)')) return vector(busy.flatMap(b => (b.age === null ? [] : [sample(labels(b), b.age ?? 10)])))
  if (query === DEFICIT) return vector((fleet.deficit ?? []).map(([host, n]) => sample({ __name__: query, host }, n)))
  if (query === `${DEFICIT}_timestamp_seconds`) return times(query, fleet.deficitAge ?? (fleet.deficit ?? []).map(([host]): [string, number] => [host, 2]))
  if (query === `${DEFICIT}_unavailable == 1`) return vector((fleet.deficitWhy ?? []).map(([host, reason]) => sample({ __name__: `${DEFICIT}_unavailable`, host, reason }, 1)))
  if (query === SHARE) return vector((fleet.share ?? []).map(([host, n]) => sample({ __name__: query, host }, n)))
  if (query === `${SHARE}_timestamp_seconds`) return times(query, fleet.shareAge ?? [])
  if (query === 'ix_fleet_capacity_recorded_level') return vector((fleet.level ?? []).map(([host, n]) => sample({ __name__: query, host }, n)))
  if (query === 'ix_fleet_capacity_discovery_state == 1') return vector((fleet.discovery ?? []).map(([host, state]) => sample({ __name__: 'ix_fleet_capacity_discovery_state', host, state }, 1)))
  return vector([])
}

/** A ledger row of the view, its sample `agoMin` minutes old. */
const row = (host: string, more: Record<string, unknown> = {}, agoMin = 2) => ({ host, output_basis: 'tickets_prs', output_per_hour: 6, recorded_output_per_hour: 6, share_percent: 100, at_ms: NOW - agoMin * MIN, unavailable_reason: null, source_basis: {}, ...more })
const rowsOf = (rows: unknown[]) => () => out(JSON.stringify({ view: 'host_output_share_of_recorded_level', since_ms: null, rows }))

const BUSY: Busy[] = [{ host: 'draco', ratio: 0.119 }, { host: 'luna', ratio: 0.999 }]
const FULL: Fleet = { busy: BUSY, deficit: [['draco', 3], ['luna', 0]], level: [['draco', 4], ['luna', 2]], discovery: [['draco', 'ended'], ['luna', 'ended']] }

async function setup($: $t, on: Parameters<TestBody>[1], fleet: Fleet = FULL, ledger: () => Run | Promise<Run> = rowsOf([row('draco'), row('luna', { share_percent: 33.9, output_per_hour: 1, recorded_output_per_hour: 3, output_basis: 'commits' })])): Promise<World & { queries: string[] }> {
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

async function draw($: $t, w: World, wait = SEC, placement: 'dock' | 'widget' = 'dock') {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement }, surface: 'terminal' } as never)
  await w.clock!.advance(wait)
  const all = async () => (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text ?? '', color: (t.props as { color?: string }).color }))
  const lines = async () => (await all()).map(e => e.text)
  /** The lines of the section: from its heading to the team part of the view. */
  const section = async () => {
    const t = await lines()
    const from = t.indexOf('Capacity')
    expect(from).toBeGreaterThan(-1)
    return t.slice(from, t.indexOf('No team metrics yet.'))
  }
  /** What a host's line says, with the mark before it where there is one. */
  const said = async (host: string, label: string) => {
    const t = await all()
    const from = t.findIndex(x => x.text === host)
    expect(from).toBeGreaterThan(-1)
    const at = t.findIndex((e, i) => i > from && e.text === label)
    expect(at).toBeGreaterThan(-1)
    const next = t[at + 1]!
    return /^[○▲]$/.test(next.text) ? `${next.text} ${t[at + 2]!.text}` : next.text
  }
  return { ui, lines, section, said }
}
const reads = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json fleet'))
const failed = async ($: $t) => ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string).split('\n').filter(l => l.includes('ix-board fleet ledger:'))

test('each host draws its busy ratio, deficit and output against its level, and no deficit is added', async ($, on) => {
  trace("FR-032-AC-1")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(await d.section()).toEqual([
    'Capacity', 'read 0s ago',
    'draco', 'Busy', '11%', 'Ready deficit', '3 · 2m ago', 'Output / level', '100% of level 4 · 6/h of 6/h tickets+PRs · 2m ago',
    'luna', 'Busy', '99%', 'Ready deficit', '0 · 2m ago', 'Output / level', '33% of level 2 · 1/h of 3/h commits · 2m ago',
  ])
  await d.ui.unmount()
})

test('a busy sample older than 60 seconds is stale, a fresh series wins, and two fresh ones or no ratio are unavailable', async ($, on) => {
  trace("FR-032-AC-2")
  const w = await setup($, on, { busy: [
    { host: 'aged', ratio: 0.5, age: 61 },
    { host: 'edge', ratio: 0.5, age: 60 },
    { host: 'gone', ratio: 0.25, age: 1500 },
    { host: 'blind', ratio: 0.75, age: null },
    { host: 'moved', ratio: 0.9, age: 900, job: 'old' }, { host: 'Moved', ratio: 0.2, age: 5 },
    { host: 'twice', ratio: 0.1, age: 5 }, { host: 'twice', ratio: 0.2, age: 7, job: 'other' },
    { host: 'wild', ratio: 1.5 }, { host: 'nan', ratio: 'NaN' },
  ] })
  const d = await draw($, w)
  expect(await d.said('aged', 'Busy')).toBe('▲ 50% · stale, 1m old')
  expect(await d.said('edge', 'Busy')).toBe('50%')
  expect(await d.said('gone', 'Busy')).toBe('▲ 25% · stale, 25m old')
  expect(await d.said('blind', 'Busy')).toBe('▲ 75% · stale, age unknown')
  expect(await d.said('moved', 'Busy')).toBe('20%')
  expect(await d.said('twice', 'Busy')).toBe('○ unavailable · 2 fresh samples for one host')
  expect(await d.said('wild', 'Busy')).toBe('○ unavailable · sample 1.5 is not between 0 and 1')
  expect(await d.said('nan', 'Busy')).toBe('○ unavailable · sample NaN is not between 0 and 1')
  expect((await d.lines()).filter(l => l === 'moved')).toHaveLength(1)
  await d.ui.unmount()
})

test('a deficit older than 10 minutes or of unknown age is marked, and one the exporter withholds gives its reason', async ($, on) => {
  trace("FR-032-AC-9")
  const w = await setup($, on, {
    deficit: [['fresh', 3], ['edge', 1], ['aged', 2], ['blind', 4]],
    deficitAge: [['fresh', 1], ['edge', 9], ['aged', 11], ['late', 25]],
    deficitWhy: [['late', 'sample_stale'], ['bare', 'sample_missing']],
  }, rowsOf([]))
  const d = await draw($, w)
  expect(await d.said('fresh', 'Ready deficit')).toBe('3 · 1m ago')
  expect(await d.said('edge', 'Ready deficit')).toBe('1 · 9m ago')
  expect(await d.said('aged', 'Ready deficit')).toBe('▲ 2 · stale, 11m old')
  expect(await d.said('blind', 'Ready deficit')).toBe('▲ 4 · stale, age unknown')
  // A host only the reason or the sample time names is listed, with no count.
  expect(await d.said('late', 'Ready deficit')).toBe('○ unavailable · sample_stale · sample 25m old')
  expect(await d.said('bare', 'Ready deficit')).toBe('○ unavailable · sample_missing')
  await d.ui.unmount()
})

test('with only reasons exported each host gives its own, and the section claims no missing source', async ($, on) => {
  trace("FR-032-AC-9", "FR-032-AC-6")
  const w = await setup($, on, { deficitWhy: [['draco', 'coverage_incomplete']] }, rowsOf([]))
  const d = await draw($, w)
  expect(await d.said('draco', 'Ready deficit')).toBe('○ unavailable · coverage_incomplete')
  expect((await d.section()).join('\n')).not.toMatch(/Prometheus has no ix_fleet_ready_buffer_deficit/)
  await d.ui.unmount()
})

test('a deficit whose sample time cannot be asked is of unknown age', async ($, on) => {
  trace("FR-032-AC-9")
  const w = await setup($, on, { ...FULL, failing: /deficit_timestamp/ })
  const d = await draw($, w)
  expect(await d.said('draco', 'Ready deficit')).toBe('▲ 3 · stale, age unknown')
  await d.ui.unmount()
})

test('a host with no row in this machine’s ledger shows the share Prometheus has, and a ledger row wins over it', async ($, on) => {
  trace("FR-032-AC-10")
  const w = await setup($, on, {
    share: [['draco', 0.5], ['luna', 0.339], ['terra', 1.25], ['titan', 0.8], ['wild', 'NaN']],
    shareAge: [['draco', 1], ['luna', 3], ['terra', 12], ['quiet', 7]],
    level: [['luna', 2]],
  }, rowsOf([row('draco', { share_percent: 70, step_no: 4 })]))
  const d = await draw($, w)
  expect(await d.said('draco', 'Output / level')).toBe('70% of the recorded level · 6/h of 6/h tickets+PRs · 2m ago')
  expect(await d.said('luna', 'Output / level')).toBe('33% of level 2 · from Prometheus · 3m ago')
  expect(await d.said('terra', 'Output / level')).toBe('▲ 125% of the recorded level · from Prometheus · stale, 12m old')
  expect(await d.said('titan', 'Output / level')).toBe('▲ 80% of the recorded level · from Prometheus · stale, age unknown')
  expect(await d.said('wild', 'Output / level')).toBe('○ unavailable · exported share NaN is not a share')
  expect(await d.said('quiet', 'Output / level')).toBe('○ unavailable · no row in this machine’s ledger')
  await d.ui.unmount()
})

test('without a ledger the shares of Prometheus are drawn and the failing command is still a failed source', async ($, on) => {
  trace("FR-032-AC-10", "FR-032-AC-6")
  const w = await setup($, on, { share: [['luna', 0.4]], shareAge: [['luna', 1]], busy: [{ host: 'draco', ratio: 0.1 }] }, () => out('', 3, 'fleet ledger: broken\n'))
  const d = await draw($, w)
  expect(await d.said('luna', 'Output / level')).toBe('40% of the recorded level · from Prometheus · 1m ago')
  expect(await d.said('draco', 'Output / level')).toBe('○ unavailable · no share exported for this host')
  expect((await d.section()).join('\n')).not.toMatch(/fleet ledger: broken/)
  expect(await failed($)).toEqual([expect.stringContaining('fleet ledger: broken')])
  await d.ui.unmount()
})

test('an output sample older than 10 minutes is stale with its age', async ($, on) => {
  trace("FR-032-AC-3")
  const w = await setup($, on, FULL, rowsOf([row('draco', {}, 11), row('luna', {}, 9), row('terra', { at_ms: null })]))
  const d = await draw($, w)
  expect(await d.said('draco', 'Output / level')).toBe('▲ 100% of level 4 · 6/h of 6/h tickets+PRs · stale, 11m old')
  expect(await d.said('luna', 'Output / level')).toBe('100% of level 2 · 6/h of 6/h tickets+PRs · 9m ago')
  expect(await d.said('terra', 'Output / level')).toBe('▲ 100% of the recorded level · 6/h of 6/h tickets+PRs · stale, age unknown')
  await d.ui.unmount()
})

test('a null or absent share is unavailable with its reason, never 0', async ($, on) => {
  trace("FR-032-AC-4")
  const nulled = { share_percent: null, output_per_hour: null }
  const { share_percent: _, ...keyless } = row('keyless')
  const w = await setup($, on, {}, rowsOf([
    row('own', { ...nulled, unavailable_reason: 'coverage_below_90_percent' }),
    row('basis', { ...nulled, source_basis: { tickets_closed: { reason: null }, prs_merged: { reason: 'series_missing' } } }),
    // As the view answers it before its source basis is parsed.
    row('quoted', { ...nulled, output_basis: 'commits', source_basis: JSON.stringify({ commits_pushed: { reason: 'github_unreadable' } }) }),
    row('mute', { share_percent: null, unavailable_reason: undefined, source_basis: undefined }),
    keyless,
  ]))
  const d = await draw($, w)
  expect(await d.said('own', 'Output / level')).toBe('○ unavailable · coverage_below_90_percent')
  expect(await d.said('basis', 'Output / level')).toBe('○ unavailable · series_missing')
  expect(await d.said('quoted', 'Output / level')).toBe('○ unavailable · github_unreadable')
  expect(await d.said('mute', 'Output / level')).toBe('○ unavailable · no reason published')
  expect(await d.said('keyless', 'Output / level')).toBe('○ unavailable · the row has no share_percent')
  expect((await d.section()).join('\n')).not.toMatch(/\b0%/)
  await d.ui.unmount()
})

test('a host with no deficit sample or output row says why, and rows that differ are unavailable', async ($, on) => {
  trace("FR-032-AC-5")
  const w = await setup($, on, {
    busy: [{ host: 'plain', ratio: 0.1 }],
    deficit: [['luna', 2], ['twice', 1], ['twice', 2], ['odd', -1]],
    level: [['draco', 4]],
    discovery: [['draco', 'ended'], ['luna', 'running']],
  }, rowsOf([row('twin'), row('twin'), row('split'), row('split', { share_percent: 50 })]))
  const d = await draw($, w)
  expect(await d.said('draco', 'Output / level')).toBe('○ unavailable · level 4 recorded, no row in this machine’s ledger')
  expect(await d.said('luna', 'Output / level')).toBe('○ unavailable · no recorded level, discovery running')
  expect(await d.said('plain', 'Output / level')).toBe('○ unavailable · no row in this machine’s ledger')
  expect(await d.said('plain', 'Ready deficit')).toBe('○ unavailable · no sample exported for this host')
  expect(await d.said('draco', 'Busy')).toBe('○ unavailable · no sample in the last hour')
  expect(await d.said('twice', 'Ready deficit')).toBe('○ unavailable · 2 samples for one host')
  expect(await d.said('odd', 'Ready deficit')).toBe('○ unavailable · sample -1 is not a count')
  expect(await d.said('twin', 'Output / level')).toMatch(/^100% of the recorded level/)
  expect(await d.said('split', 'Output / level')).toBe('○ unavailable · the view answers 2 differing rows')
  await d.ui.unmount()
})

for (const [why, ledger, reason, isFailure] of [
  ['has no such view', () => out('', 3, 'fleet ledger: unknown ledger view host_output_share_of_recorded_level\n'), 'this ix-board has no host_output_share_of_recorded_level view', false],
  ['has no ledger query', () => out('', 2, "error: unrecognized subcommand 'ledger'\n\nFor more information, try '--help'.\n"), 'this ix-board has no `fleet ledger query`', false],
  ['fails', () => out('', 3, 'fleet ledger: schema version 9 is not supported\n'), 'fleet ledger: schema version 9 is not supported', true],
  ['prints no JSON', () => out('rows'), 'the answer is not JSON', true],
  ['answers no rows', () => out('{"view":"x"}'), 'the answer is not rows of hosts', true],
  ['is cut short', () => ({ ...rowsOf([])(), isStdoutTruncated: true }), 'the answer was cut at 4 MiB', true],
] as [string, () => Run, string, boolean][]) {
  test(`an ix-board that ${why} is said once, with the other sources drawn`, async ($, on) => {
    trace("FR-032-AC-6")
    const w = await setup($, on, FULL, ledger)
    const d = await draw($, w)
    const section = await d.section()
    expect(section.filter(l => l === 'Output / level')).toHaveLength(1)
    expect(section).toContain(`unavailable · ${reason}`)
    expect(await d.said('draco', 'Busy')).toBe('11%')
    expect(await failed($)).toEqual(isFailure ? [expect.stringContaining(reason)] : [])
    await d.ui.unmount()
  })
}

test('with no fleet series each is said once, and the ledger rows are still drawn', async ($, on) => {
  trace("FR-032-AC-6")
  const w = await setup($, on, {}, rowsOf([row('draco')]))
  const d = await draw($, w)
  expect(await d.section()).toEqual([
    'Capacity', 'read 0s ago',
    'Busy', '○', 'unavailable · Prometheus has no ix_fleet_host_busy_ratio sample in the last hour',
    'Ready deficit', '○', 'unavailable · Prometheus has no ix_fleet_ready_buffer_deficit sample',
    'draco', 'Output / level', '100% of the recorded level · 6/h of 6/h tickets+PRs · 2m ago',
  ])
  await d.ui.unmount()
})

for (const [what, failing, label] of [
  ['busy values', /^last_over_time\(ix_fleet_host_busy/, 'Busy'],
  ['busy ages', /timestamp\(ix_fleet_host_busy/, 'Busy'],
  ['deficit', /ready_buffer_deficit$/, 'Ready deficit'],
] as [string, RegExp, string][]) {
  test(`a failing query of the ${what} is said once with its error, the rest drawn`, async ($, on) => {
    trace("FR-032-AC-6")
    const w = await setup($, on, { ...FULL, failing })
    const d = await draw($, w)
    const section = await d.section()
    expect(section.filter(l => l === label)).toHaveLength(1)
    expect(section).toContain('unavailable · Prometheus 500')
    expect(await d.said('draco', 'Output / level')).toMatch(/^100% of level 4/)
    await d.ui.unmount()
  })
}

test('an empty ledger view and no series says there is no row', async ($, on) => {
  trace("FR-032-AC-6")
  const w = await setup($, on, {}, rowsOf([]))
  const d = await draw($, w)
  expect(await d.section()).toContain('unavailable · the ledger view has no row')
  await d.ui.unmount()
})

test('before the first read the section says it is reading', async ($, on) => {
  trace("FR-032-AC-6")
  const w = await setup($, on, FULL, () => new Promise<Run>(() => undefined))
  const d = await draw($, w)
  expect(await d.section()).toEqual(['Capacity', 'reading capacity…'])
  await d.ui.unmount()
})

test('only the ledger query is run, once a minute and on r', async ($, on) => {
  trace("FR-032-AC-7")
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

test('the one-line widget reads nothing of the capacity', async ($, on) => {
  trace("FR-032-AC-7")
  const w = await setup($, on)
  const d = await draw($, w, 3 * MIN, 'widget')
  expect(reads(w)).toEqual([])
  expect(w.queries.filter(q => q.includes('ix_fleet_'))).toEqual([])
  await d.ui.unmount()
})
