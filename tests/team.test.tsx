import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { classesOf } from '../hooks/team'
import { out, startSession, world } from './world'
import type { World } from './world'

// Tests for the Team tab's review, flow and retro-health additions (FR-029).

type $t = Parameters<TestBody>[0]
const MIN = 60_000
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'team', props: { title: 'Team', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const CONFIG = '/home/test/.local/state/team-retro/QSL/config.json'

const matrix = (team: string, values: number[]) => JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [{ metric: { team_id: team }, values: values.map((v, i) => [1795000000 + i * 300, String(v)]) }] } })
const EMPTY = JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [] } })

/** What the exporter publishes for team fsl: some series, and none for the first-review latency, the oldest stage age or executing agents. */
const SERIES: [string, number[]][] = [
  ['ix_team_effort_per_verified_path_closure_seconds_24h', [7200, 5400]],
  ['sum by (team_id) (ix_team_verified_path_closed_24h)', [3, 4]],
  ['ix_team_review_prs_with_findings_share_24h', [0.5, 0.25]],
  ['ix_team_review_findings_confirmed_high_24h', [0, 2]],
  ['ix_team_review_findings_confirmed_medium_24h', [0, 0]],
  ['ix_team_ready_issues', [6, 7]],
]

const metric = (id: string, status = 'ok', regressing = false) => ({ id, status, regressing, direction: 'down', unit: 'issues', value: status === 'ok' ? 1 : null, since_baseline: { state: 'changed' }, since_previous: { state: 'changed' } })
const DELTA = JSON.stringify({
  baseline: '2026-11-24T16:20:21Z', baseline_kind: 'snapshot', latest: '2026-11-24T16:23:18Z', previous: '2026-11-24T16:20:21Z', team: 'QSL',
  metrics: [metric('path_remaining'), metric('path_closed'), metric('prs_idle', 'ok', true), metric('prs_open'), metric('in_progress_stale'), metric('issues_without_project', 'unavailable'), metric('disk_bytes', 'unavailable'), metric('orphan_slots', 'unavailable')],
})

async function setup($: $t, on: Parameters<TestBody>[1], delta: () => ReturnType<typeof out> = () => out(DELTA)): Promise<World> {
  const w = world(on, true)
  w.fetch.value = (url, body) => {
    if (!url.endsWith('/query_range')) return undefined
    const query = /query=(.*)$/.exec(body)?.[1] ?? ''
    const hit = SERIES.find(([needle]) => query.includes(needle))
    // The effort query names the closures series too, so it is listed first.
    return { value: { status: 200, ok: true, headers: {}, text: hit === undefined ? EMPTY : matrix("fsl", hit[1]) } }
  }
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv.join(' ') === `ix-board --json retro delta --config ${CONFIG}`) return delta()
    return prior?.(argv, init)
  }
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
  trace('FR-029-AC-1')
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
  trace('FR-029-AC-2')
  const w = await setup($, on)
  const d = await draw($, w)
  for (const label of ['First review · median', 'Oldest in a stage', 'Executing agents', 'Changes requested']) expect(after(d.lines, label)).toBe('—')
  // The ones with series show their value; a zero reading is a 0 and the absent ones are not.
  expect(after(d.lines, 'Confirmed findings · medium')).toBe('0')
  await d.ui.unmount()
})

test('a share is drawn as a percentage and effort per closure is a duration', async ($, on) => {
  trace('FR-029-AC-3')
  const w = await setup($, on)
  const d = await draw($, w)
  expect(after(d.lines, 'PRs with findings')).toBe('25%')
  expect(after(d.lines, 'Effort per closure')).toBe('1.5h')
  await d.ui.unmount()
})

test('the retro strip draws a mark per class: red for a regressing class, amber for missing values, green for a sound one', async ($, on) => {
  trace('FR-029-AC-4')
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
  expect(classesOf([{ id: 'path_remaining', status: 'ok', regressing: false }]).map(c => c.rating)).toEqual(['green'])
})

test('the strip expands to the regressing metrics, named by class', async ($, on) => {
  trace('FR-029-AC-5')
  const w = await setup($, on)
  const d = await draw($, w)
  expect(d.buttons).toContain('▸ 1 regressing')
  expect(d.lines).not.toContain('flow: prs idle')
  await d.ui.press({ key: 'retro-QSL' })
  expect(((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? ''))).toContain('flow: prs idle')
  await d.ui.unmount()
})

test('a team whose retro delta fails reads no retro baseline and draws no mark', async ($, on) => {
  trace('FR-029-AC-6')
  const w = await setup($, on, () => out('', 3, 'retro config /x: cannot read'))
  const d = await draw($, w)
  expect(d.lines).toContain('no retro baseline')
  expect(d.lines).not.toContain('flow')
  await d.ui.unmount()
  expect(retroCalls(w).length).toBeGreaterThan(0)
})

for (const [why, failing] of [['exits 1', () => out('', 1, 'ix-board: boom')], ['prints text that is not JSON', () => out('not json')]] as const) {
  test(`a retro delta that ${why} is retro unavailable with a warning, not no baseline`, async ($, on) => {
    trace('FR-029-AC-9')
    const w = await setup($, on, failing)
    const d = await draw($, w)
    expect(d.lines).toContain('retro unavailable')
    expect(d.lines).not.toContain('no retro baseline')
    expect(d.buttons).toContain('1')
    await d.ui.unmount()
  })
}

test('the retro delta is asked for the focus teams with their config path, and at most once in five minutes', async ($, on) => {
  trace('FR-029-AC-7')
  const w = await setup($, on)
  const d = await draw($, w, 1000)
  expect(retroCalls(w)).toEqual([`ix-board --json retro delta --config ${CONFIG}`])
  await w.clock!.advance(4 * MIN)
  expect(retroCalls(w)).toHaveLength(1)
  await w.clock!.advance(2 * MIN)
  expect(retroCalls(w)).toHaveLength(2)
  await d.ui.unmount()
})
