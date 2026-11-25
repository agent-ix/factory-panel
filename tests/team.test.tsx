import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { classesOf } from '../hooks/team'
import { FP, out, startSession, world } from './world'
import type { World } from './world'

// Tests for the Team tab: its tiles, teams, daily rows and retro health (FR-029).

type $t = Parameters<TestBody>[0]
const MIN = 60_000
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'team', props: { title: 'Team', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const CONFIG = '/home/test/.local/state/team-retro/QSL/config.json'

const STEP = 300

/** One series the exporter publishes: six hours of samples ending `ago` seconds before now, with its other labels. */
type Series = { name: string; id: string; key?: string; scope?: string; day?: number; metric?: string; values?: number[]; ago?: number }

const series = (name: string, values: number[], more: Partial<Series> = {}): Series => ({ name: `ix_team_${name}`, id: 'fsl', values, ...more })
/** A daily series' samples, by the day each counts: 0 is today. */
const daily = (name: string, days: Record<number, number>, more: Partial<Series> = {}): Series[] => Object.entries(days).map(([day, n]) => series(name, [n], { day: Number(day), ...more }))
const coverage = (metric: string, value: number, more: Partial<Series> = {}): Series => series('metric_coverage', [value], { metric, ...more })

/** What the exporter publishes for team fsl: some series, and none for the first-review latency, the oldest stage age or executing agents. */
const SERIES: Series[] = [
  series('effort_per_verified_path_closure_seconds_24h', [7200, 5400]),
  series('verified_path_closed_24h', [3, 4]),
  series('review_prs_with_findings_share_24h', [0.5, 0.25]),
  series('review_findings_confirmed_high_24h', [0, 2]),
  series('review_findings_confirmed_medium_24h', [0, 0]),
  series('ready_issues', [6, 7]),
]

/** Answers a range query with the raw series of the metric it names, as the exporter labels them. */
function answerRange(published: readonly Series[], body: string): string {
  const field = (name: string) => Number(new RegExp(`[?&]${name}=([0-9]+)`).exec(body)?.[1])
  const end = field('end')
  const step = field('step')
  const named = /ix_team_[a-z0-9_]+/.exec(body)?.[0]
  expect(step).toBe(STEP)
  const result = published.filter(x => x.name === named).flatMap(x => {
    const values = (x.values ?? []).map((v, i, all): [number, string] => [end - (x.ago ?? 0) - (all.length - 1 - i) * STEP, String(v)])
    const labels = { team_id: x.id, scope_id: x.scope ?? 'completion', team_key: x.key, days_ago: x.day === undefined ? undefined : String(x.day), metric: x.metric }
    return values.length === 0 ? [] : [{ metric: Object.fromEntries(Object.entries(labels).filter(([, v]) => v !== undefined)), values }]
  })
  return JSON.stringify({ status: 'success', data: { resultType: 'matrix', result } })
}

const metric = (id: string, cls: string | null, status = 'ok', regressing = false) => ({ id, ...(cls === null ? {} : { class: cls }), status, regressing, direction: 'down', unit: 'issues', value: status === 'ok' ? 1 : null, since_baseline: { state: 'changed' }, since_previous: { state: 'changed' } })
const deltaOf = (metrics: unknown[]) => () => out(JSON.stringify({ latest: '2026-11-24T16:23:18Z', previous: '2026-11-24T16:20:21Z', team: 'QSL', metrics }))
const DELTA = JSON.stringify({
  baseline: '2026-11-24T16:20:21Z', baseline_kind: 'snapshot', latest: '2026-11-24T16:23:18Z', previous: '2026-11-24T16:20:21Z', team: 'QSL',
  metrics: [metric('path_remaining', 'progress'), metric('path_closed', 'progress'), metric('prs_idle', 'flow', 'ok', true), metric('prs_open', 'flow'), metric('in_progress_stale', 'scope'), metric('issues_without_project', 'scope', 'unavailable'), metric('disk_bytes', 'resource', 'unavailable'), metric('orphan_slots', 'resource', 'unavailable')],
})

type Arrange = { delta?: () => ReturnType<typeof out>; arrange?: (w: World) => void; published?: readonly Series[] }

async function setup($: $t, on: Parameters<TestBody>[1], { delta = () => out(DELTA), arrange = () => undefined, published = SERIES }: Arrange = {}): Promise<World & { queries: string[] }> {
  const queries: string[] = []
  const w = Object.assign(world(on, true), { queries })
  w.fetch.value = (url, body) => {
    if (!url.endsWith('/query_range')) return undefined
    queries.push(body)
    return { value: { status: 200, ok: true, headers: {}, text: answerRange(published, body) } }
  }
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv.join(' ') === `ix-board --json retro delta --config ${CONFIG}`) return delta()
    return prior?.(argv, init)
  }
  arrange(w)
  await startSession($)
  return w
}

async function draw($: $t, w: World, wait = 1000) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(wait)
  const els = async () => (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text ?? '', color: (t.props as { color?: string }).color }))
  const lines = (await els()).map(e => e.text)
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  return { ui, lines, els, buttons }
}
const after = (lines: string[], label: string) => lines[lines.indexOf(label) + 1]
const retroCalls = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json retro delta'))

test('a team draws its tiles in three rows: velocity and effort, review quality, flow and capacity', async ($, on) => {
  trace("FR-029-AC-1")
  const w = await setup($, on)
  const d = await draw($, w)
  const at = (t: string) => d.lines.indexOf(t)
  expect(at('Velocity and effort')).toBeGreaterThan(at('fsl'))
  expect(at('Review quality')).toBeGreaterThan(at('Velocity and effort'))
  expect(at('Flow and capacity')).toBeGreaterThan(at('Review quality'))
  expect(at('Verified closures · 24h')).toBeLessThan(at('Review quality'))
  expect(at('Confirmed findings · high')).toBeGreaterThan(at('Review quality'))
  expect(at('Ready issues')).toBeGreaterThan(at('Flow and capacity'))
  expect(after(d.lines, 'Ready issues')).toBe('7')
  expect(after(d.lines, 'Confirmed findings · high')).toBe('2')
  await d.ui.unmount()
})

test('a metric the exporter publishes no series for reads a dash, never 0', async ($, on) => {
  trace("FR-029-AC-2")
  const w = await setup($, on)
  const d = await draw($, w)
  for (const label of ['First review · median', 'Oldest in a stage', 'Executing agents', 'Changes requested']) expect(after(d.lines, label)).toBe('—')
  // The ones with series show their value; a zero reading is a 0 and the absent ones are not.
  expect(after(d.lines, 'Confirmed findings · medium')).toBe('0')
  await d.ui.unmount()
})

test('a share is drawn as a percentage and effort per closure is a duration', async ($, on) => {
  trace("FR-029-AC-3")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(after(d.lines, 'PRs with findings')).toBe('25%')
  expect(after(d.lines, 'Effort per closure')).toBe('1.5h')
  await d.ui.unmount()
})

test('the retro strip draws a mark per class: red for a regressing class, amber for missing values, green for a sound one', async ($, on) => {
  trace("FR-029-AC-4")
  const w = await setup($, on)
  const d = await draw($, w)
  const els = await d.els()
  const markOf = (cls: string) => els[els.findIndex(e => e.text === cls) - 1]
  expect(markOf('flow')).toEqual({ text: '●', color: 'error' })
  expect(markOf('progress')).toEqual({ text: '●', color: 'success' })
  expect(markOf('scope')).toEqual({ text: '●', color: 'warning' })
  // Every metric of the class lacks a value: a hollow mark.
  expect(markOf('resource')).toEqual({ text: '○', color: 'inactive' })
  expect(d.lines).toContain('Health · QSL')
  await d.ui.unmount()
  expect(classesOf([{ id: 'path_remaining', class: 'progress', status: 'ok', regressing: false }]).map(c => c.rating)).toEqual(['green'])
})

/** The class names of a drawn health strip, in the order drawn: each follows its mark. */
const drawnClasses = (lines: string[]) => lines.filter((_, i) => /^[●○]$/.test(lines[i - 1] ?? ''))

test('a metric is drawn in the class its class field names, in the order the answer names the classes', async ($, on) => {
  trace("FR-029-AC-10")
  // Ids ix-board files elsewhere today, and a class and a metric the mod has never heard of.
  const w = await setup($, on, { delta: deltaOf([metric('path_remaining', 'stability', 'ok', true), metric('brand_new_metric', 'quality'), metric('prs_open', 'progress')]) })
  const d = await draw($, w)
  expect(drawnClasses(d.lines)).toEqual(['stability', 'quality', 'progress'])
  await d.ui.press({ key: 'retro-QSL' })
  expect((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('stability: path remaining')
  await d.ui.unmount()
})

test('a delta from an ix-board that names no class says which version is needed and draws no mark', async ($, on) => {
  trace("FR-029-AC-11")
  const w = await setup($, on, { delta: deltaOf([metric('path_remaining', null), metric('prs_idle', null, 'ok', true)]) })
  const d = await draw($, w)
  expect(d.lines).toContain('needs ix-board ≥0.11.0')
  expect(drawnClasses(d.lines)).toEqual([])
  for (const word of ['progress', 'flow', 'other', 'unclassified', 'retro unavailable', 'no retro baseline']) expect(d.lines).not.toContain(word)
  expect(d.buttons.filter(b => /regressing|^\d+$/.test(b))).toEqual([])
  await d.ui.unmount()
})

test('a metric with no class beside classed ones is drawn as unclassified, last, and in no other class', async ($, on) => {
  trace("FR-029-AC-12")
  const w = await setup($, on, { delta: deltaOf([metric('prs_idle', null, 'ok', true), metric('path_remaining', 'progress')]) })
  const d = await draw($, w)
  expect(drawnClasses(d.lines)).toEqual(['progress', 'unclassified'])
  await d.ui.press({ key: 'retro-QSL' })
  expect((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('unclassified: prs idle')
  await d.ui.unmount()
})

test('a delta with no metric reads no retro delta yet, with no mark and no warning', async ($, on) => {
  trace("FR-029-AC-13")
  const w = await setup($, on, { delta: () => out(JSON.stringify({ team: 'QSL', message: 'no delta: 1 snapshot record(s) in the store, two are needed', metrics: [] })) })
  const d = await draw($, w)
  expect(d.lines).toContain('no retro delta yet')
  expect(d.lines).not.toContain('needs ix-board ≥0.11.0')
  expect(drawnClasses(d.lines)).toEqual([])
  expect(d.buttons.filter(b => /regressing|^\d+$/.test(b))).toEqual([])
  await d.ui.unmount()
})

test('the strip expands to the regressing metrics, named by class', async ($, on) => {
  trace("FR-029-AC-5")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(d.buttons).toContain('▸ 1 regressing')
  expect(d.lines).not.toContain('flow: prs idle')
  await d.ui.press({ key: 'retro-QSL' })
  expect(((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? ''))).toContain('flow: prs idle')
  await d.ui.unmount()
})

test('a team whose retro delta fails reads no retro baseline and draws no mark', async ($, on) => {
  trace("FR-029-AC-6")
  const w = await setup($, on, { delta: () => out('', 3, 'retro config /x: cannot read') })
  const d = await draw($, w)
  expect(d.lines).toContain('no retro baseline')
  expect(d.lines).not.toContain('flow')
  await d.ui.unmount()
  expect(retroCalls(w).length).toBeGreaterThan(0)
})

for (const [why, failing] of [['exits 1', () => out('', 1, 'ix-board: boom')], ['prints text that is not JSON', () => out('not json')]] as const) {
  test(`a retro delta that ${why} is retro unavailable with a warning, not no baseline`, async ($, on) => {
    trace("FR-029-AC-9")
    const w = await setup($, on, { delta: failing })
    const d = await draw($, w)
    expect(d.lines).toContain('retro unavailable')
    expect(d.lines).not.toContain('no retro baseline')
    expect(d.buttons).toContain('1')
    await d.ui.unmount()
  })
}

test('the retro health waits for the session to know its team, and claims nothing before', async ($, on) => {
  trace("FR-029-AC-14")
  const w = await setup($, on, { arrange: w => {
    const prior = w.stub.value
    w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg whoami' ? w.clock!.sleep(3000).then(() => out('draco:QSL:code  (location)  model unknown')) : prior?.(argv, init))
  } })
  const d = await draw($, w, 1000)
  expect(d.lines).toContain('Health: reading retro snapshots…')
  expect(d.lines.join('\n')).not.toMatch(/no retro baseline|no team selected/)
  expect(retroCalls(w)).toEqual([])
  await w.clock!.advance(4000)
  expect(retroCalls(w)).toEqual([`ix-board --json retro delta --config ${CONFIG}`])
  expect((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('Health · QSL')
  await d.ui.unmount()
})

test('a changed teams choice reads the new team’s retro delta at once', async ($, on) => {
  trace("FR-029-AC-15")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(retroCalls(w)).toHaveLength(1)
  w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify({ focus: 'team', teams: ['ENG'] }))
  await w.clock!.advance(MIN)
  expect(retroCalls(w).at(-1)).toBe(`ix-board --json retro delta --config ${CONFIG.replace('/QSL/', '/ENG/')}`)
  await d.ui.unmount()
})

test('a session with no team to ask for says so and asks for no delta', async ($, on) => {
  trace("FR-029-AC-16")
  const w = await setup($, on, { arrange: w => {
    w.whoami.value = undefined
  } })
  const d = await draw($, w, 6000)
  expect(d.lines).toContain('Health: no team selected')
  expect(d.lines).not.toContain('Health: no retro baseline')
  expect(retroCalls(w)).toEqual([])
  await d.ui.unmount()
})

test('the retro delta is asked for the focus teams with their config path, and at most once in five minutes', async ($, on) => {
  trace("FR-029-AC-7")
  const w = await setup($, on)
  const d = await draw($, w, 1000)
  expect(retroCalls(w)).toEqual([`ix-board --json retro delta --config ${CONFIG}`])
  await w.clock!.advance(4 * MIN)
  expect(retroCalls(w)).toHaveLength(1)
  await w.clock!.advance(2 * MIN)
  expect(retroCalls(w)).toHaveLength(2)
  await d.ui.unmount()
})

// ---------------------------------------------------------------- teams, current values and the daily rows

/** The lines drawn under the heading of `team`, up to the next team's heading or the footer. */
function under(lines: string[], team: string, next?: string): string[] {
  const from = lines.indexOf(team)
  expect(from).toBeGreaterThan(-1)
  const to = next === undefined ? lines.length : lines.indexOf(next)
  return lines.slice(from + 1, to)
}
/** One daily row: its seven values, and the trend after them. */
const row = (lines: string[], label: string) => ({ days: (after(lines, label) ?? '').trim().split(/ +/), trend: lines.slice(lines.indexOf(label) + 2, lines.indexOf(label) + 4).join(' ') })

test('a team is headed by its team key, and the samples of its exporter id from before the label belong to it', async ($, on) => {
  trace("FR-029-AC-17")
  const w = await setup($, on, { published: [
    // The upgrade: the keyless series stopped twenty minutes ago and the keyed one has run since.
    series('ready_issues', [3, 4], { ago: 1200 }),
    series('ready_issues', [9], { key: 'QSL' }),
    series('wip_active', [5], { key: 'QSL' }),
    series('wip_active', [1]),
    series('blocked_issues', [2]),
  ] })
  const d = await draw($, w)
  expect(d.lines).not.toContain('fsl')
  expect(d.lines).not.toContain('exporter id, no team key')
  const mine = under(d.lines, 'QSL')
  expect(after(mine, 'Ready issues')).toBe('9')
  expect(after(mine, 'Work in progress')).toBe('5')
  expect(after(mine, 'Blocked')).toBe('2')
  await d.ui.unmount()
})

test('a team no series gives a key is headed by the exporter id and says it has no key', async ($, on) => {
  trace("FR-029-AC-18")
  const w = await setup($, on, { published: [series('ready_issues', [2], { key: 'QSL' }), series('ready_issues', [7], { id: 'swarm-tools' }), series('wip_active', [1], { id: 'blank', key: '' })] })
  const d = await draw($, w)
  expect(after(d.lines, 'swarm-tools')).toBe('exporter id, no team key')
  expect(after(d.lines, 'blank')).toBe('exporter id, no team key')
  expect(after(d.lines, 'QSL')).not.toBe('exporter id, no team key')
  await d.ui.unmount()
})

test('exporter ids with one team key make one team: counts added, durations at their largest', async ($, on) => {
  trace("FR-029-AC-19")
  const w = await setup($, on, { published: [
    series('ready_issues', [2], { id: 'a', key: 'QSL' }),
    series('ready_issues', [3], { id: 'b', key: 'QSL' }),
    series('stage_oldest_age_seconds', [3600], { id: 'a', key: 'QSL' }),
    series('stage_oldest_age_seconds', [7200], { id: 'b', key: 'QSL' }),
  ] })
  const d = await draw($, w)
  expect(d.lines.filter(l => l === 'QSL')).toHaveLength(1)
  expect(after(d.lines, 'Ready issues')).toBe('5')
  expect(after(d.lines, 'Oldest in a stage')).toBe('2.0h')
  await d.ui.unmount()
})

test('effort and changes requested are the exporter’s own series, derived from nothing else', async ($, on) => {
  trace("FR-029-AC-20")
  const w = await setup($, on, { published: [
    series('verified_path_closed_24h', [4]),
    series('execution_seconds_total', [100, 90000]),
    series('prs_changes_requested', [2]),
    series('prs_open', [8]),
  ] })
  const d = await draw($, w)
  expect(after(d.lines, 'Effort per closure')).toBe('—')
  expect(after(d.lines, 'Changes requested')).toBe('—')
  expect(w.queries.filter(q => /execution_seconds_total|prs_changes_requested\b|prs_open/.test(q))).toEqual([])
  expect(w.queries.some(q => q.includes('ix_team_pr_changes_requested_share)'))).toBe(true)
  await d.ui.unmount()
})

test('a series that stopped more than a step ago reads a dash and keeps its history', async ($, on) => {
  trace("FR-029-AC-21")
  const w = await setup($, on, { published: [series('ready_issues', [6, 8], { ago: 600 }), series('wip_active', [2, 3], { ago: 300 })] })
  const d = await draw($, w)
  expect(after(d.lines, 'Ready issues')).toBe('—')
  expect(d.lines[d.lines.indexOf('Ready issues') + 2]).toMatch(/^[\u2800-\u28ff]+$/)
  expect(after(d.lines, 'Work in progress')).toBe('3')
  await d.ui.unmount()
})

test('the daily rows show the seven days oldest first with today last, and a dash for a day with no current sample', async ($, on) => {
  trace("FR-029-AC-22")
  const w = await setup($, on, { published: [
    ...daily('closures_day', { 6: 1, 5: 0, 3: 5, 1: 2, 0: 7 }),
    ...daily('merged_prs_day', { 2: 12, 1: 2, 0: 124 }),
    // A sample that stopped is not a count of its day any more.
    series('merged_prs_day', [40], { day: 4, ago: 600 }),
    series('verified_path_closed_24h', [9]),
  ] })
  const d = await draw($, w)
  expect(d.lines).toContain('Per UTC day · today so far at right · trend is yesterday’s')
  expect(row(d.lines, 'Completed').days).toEqual(['1', '0', '—', '5', '—', '2', '7'])
  expect(row(d.lines, 'Merged PRs').days).toEqual(['—', '—', '—', '—', '12', '2', '124'])
  expect(after(d.lines, 'Verified closures · 24h')).toBe('9')
  expect(w.queries.filter(q => q.includes('last_over_time') || q.includes('pr_merges_per_hour_24h)') && q.includes('days_ago'))).toEqual([])
  await d.ui.unmount()
})

for (const [name, days, trend] of [
  ['above the average of the earlier days', { 3: 2, 2: 4, 1: 5, 0: 0 }, '↑ prior avg 3.0'],
  ['below it, however large today is', { 3: 2, 2: 4, 1: 1, 0: 99 }, '↓ prior avg 3.0'],
  ['level with it', { 6: 2, 2: 4, 1: 3 }, '= prior avg 3.0'],
  ['with no earlier day', { 1: 3, 0: 8 }, 'no earlier day'],
  ['with no yesterday', { 3: 2, 2: 4, 0: 9 }, ''],
] as [string, Record<number, number>, string][]) {
  test(`the daily row says its trend ${name}`, async ($, on) => {
    trace("FR-029-AC-23")
    const w = await setup($, on, { published: daily('closures_day', days) })
    const d = await draw($, w)
    const at = d.lines.indexOf('Completed')
    const drawn = d.lines.slice(at + 2, d.lines.indexOf('Merged PRs')).join(' ')
    expect(drawn).toBe(trend)
    await d.ui.unmount()
  })
}

test('a team with two scopes shows each day as at least the larger count, with no trend', async ($, on) => {
  trace("FR-029-AC-27")
  const w = await setup($, on, { published: [
    ...daily('closures_day', { 2: 4, 1: 9 }, { key: 'QSL', scope: 'release' }),
    ...daily('closures_day', { 2: 6, 1: 2, 0: 1 }, { key: 'QSL', scope: 'completion' }),
    ...daily('closures_day', { 2: 1, 1: 5 }, { id: 'swm', key: 'SWM' }),
  ] })
  const d = await draw($, w)
  const mine = under(d.lines, 'QSL', 'SWM')
  expect(row(mine, 'Completed').days).toEqual(['—', '—', '—', '—', '≥6', '≥9', '≥1'])
  expect(mine.join(' ')).not.toMatch(/prior avg|no earlier day/)
  const other = under(d.lines, 'SWM')
  expect(row(other, 'Completed').days).toEqual(['—', '—', '—', '—', '1', '5', '—'])
  expect(other.join(' ')).toContain('↑ prior avg 1.0')
  await d.ui.unmount()
})

/** A scope the exporter publishes: it says of every scope whether its sources answer. */
const scoped = (scope: string, more: Partial<Series> = {}): Series => series('source_available', [1], { scope, ...more })
const COUNT_TILES = ['Verified closures · 24h', 'PR merges / hour', 'Confirmed findings · high', 'Confirmed findings · medium', 'Confirmed findings · low']

test('a team with two scopes shows its 24 hour counts as at least the larger, and one scope shows them exactly', async ($, on) => {
  trace("FR-029-AC-28")
  // One scope's latest closure sample is a step older than the other's: both are current.
  const both = (name: string, release: number, completion: number) => [series(name, [release], { key: 'QSL', scope: 'release' }), series(name, [completion], { key: 'QSL', scope: 'completion', ago: name === 'verified_path_closed_24h' ? 300 : 0 })]
  const w = await setup($, on, { published: [
    ...both('verified_path_closed_24h', 4, 6),
    ...both('pr_merges_per_hour_24h', 0.5, 0.25),
    ...both('review_findings_confirmed_high_24h', 1, 3),
    ...both('review_findings_confirmed_medium_24h', 2, 0),
    ...both('review_findings_confirmed_low_24h', 0, 0),
    series('verified_path_closed_24h', [2], { id: 'swm', key: 'SWM' }),
    series('pr_merges_per_hour_24h', [1.5], { id: 'swm', key: 'SWM' }),
  ] })
  const d = await draw($, w)
  const mine = under(d.lines, 'QSL', 'SWM')
  expect(COUNT_TILES.map(label => after(mine, label))).toEqual(['≥6', '≥0.5', '≥3', '≥2', '≥0'])
  const other = under(d.lines, 'SWM')
  expect(COUNT_TILES.map(label => after(other, label))).toEqual(['2', '1.5', '—', '—', '—'])
  await d.ui.unmount()
  const widget = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'terminal' } as never)
  await w.clock!.advance(1000)
  expect((await widget.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('≥8 closures / 24h')
  await widget.unmount()
})

for (const [name, published, shown] of [
  ['reports none of them', [series('verified_path_closed_24h', [6], { key: 'QSL' }), scoped('completion', { key: 'QSL' }), scoped('release', { key: 'QSL' })], '≥6'],
  ['reports them without the team key', [series('verified_path_closed_24h', [2], { key: 'QSL' }), series('verified_path_closed_24h', [9], { scope: 'release' })], '≥9'],
  ['is only the same scope before the key', [series('verified_path_closed_24h', [4]), series('verified_path_closed_24h', [5], { key: 'QSL' }), scoped('completion'), scoped('completion', { key: 'QSL' })], '5'],
] as [string, Series[], string][]) {
  test(`the 24 hour counts of a team whose other scope ${name} read ${shown}`, async ($, on) => {
    trace("FR-029-AC-29")
    const w = await setup($, on, { published: [...published, ...daily('closures_day', { 1: 3 }, { key: 'QSL' })] })
    const d = await draw($, w)
    expect(after(d.lines, 'Verified closures · 24h')).toBe(shown)
    expect(row(d.lines, 'Completed').days.at(-2)).toBe(shown.startsWith('≥') ? '≥3' : '3')
    await d.ui.unmount()
  })
}

test('a tile says how much of its population was measured where that is not all of it', async ($, on) => {
  trace("FR-029-AC-26")
  const w = await setup($, on, { published: [
    series('executing_agents', [3]),
    coverage('executing_agents', 0.96875),
    // No value: the coverage says why.
    coverage('effort_per_verified_path_closure_seconds_24h', 0.4),
    series('stage_oldest_age_seconds', [3600]),
    coverage('stage_oldest_age_seconds_coding', 1),
    coverage('stage_oldest_age_seconds_review', 0.5),
    // The weaker scope is the one that shows.
    coverage('pr_changes_requested_share', 0.9),
    coverage('pr_changes_requested_share', 0.755, { scope: 'release' }),
    series('new_pr_first_review_median_seconds_24h', [60]),
    coverage('new_pr_first_review_median_seconds_24h', 1),
    // Coverage that stopped says nothing.
    series('ready_issues', [4]),
    coverage('ready_issues', 0.1, { ago: 600 }),
  ] })
  const d = await draw($, w)
  const tile = (label: string) => d.lines.slice(d.lines.indexOf(label) + 1, d.lines.indexOf(label) + 3)
  expect(tile('Executing agents')).toEqual(['3', '96% covered'])
  expect(tile('Effort per closure')).toEqual(['—', '40% covered'])
  expect(tile('Oldest in a stage')).toEqual(['1.0h', '50% covered'])
  expect(tile('Changes requested')).toEqual(['—', '75% covered'])
  expect(d.lines.filter(l => l.endsWith('% covered'))).toHaveLength(4)
  await d.ui.unmount()
})

for (const [name, published, text] of [
  ['the closures of all teams', [series('verified_path_closed_24h', [3]), series('verified_path_closed_24h', [4], { id: 'b' })], '7 closures / 24h'],
  ['at least them where a team has none', [series('verified_path_closed_24h', [3]), series('ready_issues', [1], { id: 'b' })], '≥3 closures / 24h'],
  ['a dash where no team has any', [series('ready_issues', [1])], '— closures / 24h'],
] as [string, Series[], string][]) {
  test(`the widget reads ${name}`, async ($, on) => {
    trace("FR-029-AC-24")
    const w = await setup($, on, { published })
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'terminal' } as never)
    await w.clock!.advance(1000)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain(text)
    await ui.unmount()
  })
}
