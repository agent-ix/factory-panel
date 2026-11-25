import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { classesOf } from '../hooks/team'
import { FP, out, startSession, world } from './world'
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

const metric = (id: string, cls: string | null, status = 'ok', regressing = false) => ({ id, ...(cls === null ? {} : { class: cls }), status, regressing, direction: 'down', unit: 'issues', value: status === 'ok' ? 1 : null, since_baseline: { state: 'changed' }, since_previous: { state: 'changed' } })
const deltaOf = (metrics: unknown[]) => () => out(JSON.stringify({ latest: '2026-11-24T16:23:18Z', previous: '2026-11-24T16:20:21Z', team: 'QSL', metrics }))
const DELTA = JSON.stringify({
  baseline: '2026-11-24T16:20:21Z', baseline_kind: 'snapshot', latest: '2026-11-24T16:23:18Z', previous: '2026-11-24T16:20:21Z', team: 'QSL',
  metrics: [metric('path_remaining', 'progress'), metric('path_closed', 'progress'), metric('prs_idle', 'flow', 'ok', true), metric('prs_open', 'flow'), metric('in_progress_stale', 'scope'), metric('issues_without_project', 'scope', 'unavailable'), metric('disk_bytes', 'resource', 'unavailable'), metric('orphan_slots', 'resource', 'unavailable')],
})

async function setup($: $t, on: Parameters<TestBody>[1], delta: () => ReturnType<typeof out> = () => out(DELTA), arrange: (w: World) => void = () => undefined): Promise<World> {
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
  const w = await setup($, on, deltaOf([metric('path_remaining', 'stability', 'ok', true), metric('brand_new_metric', 'quality'), metric('prs_open', 'progress')]))
  const d = await draw($, w)
  expect(drawnClasses(d.lines)).toEqual(['stability', 'quality', 'progress'])
  await d.ui.press({ key: 'retro-QSL' })
  expect((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('stability: path remaining')
  await d.ui.unmount()
})

test('a delta from an ix-board that names no class says which version is needed and draws no mark', async ($, on) => {
  trace("FR-029-AC-11")
  const w = await setup($, on, deltaOf([metric('path_remaining', null), metric('prs_idle', null, 'ok', true)]))
  const d = await draw($, w)
  expect(d.lines).toContain('needs ix-board ≥0.11.0')
  expect(drawnClasses(d.lines)).toEqual([])
  for (const word of ['progress', 'flow', 'other', 'unclassified', 'retro unavailable', 'no retro baseline']) expect(d.lines).not.toContain(word)
  expect(d.buttons.filter(b => /regressing|^\d+$/.test(b))).toEqual([])
  await d.ui.unmount()
})

test('a metric with no class beside classed ones is drawn as unclassified, last, and in no other class', async ($, on) => {
  trace("FR-029-AC-12")
  const w = await setup($, on, deltaOf([metric('prs_idle', null, 'ok', true), metric('path_remaining', 'progress')]))
  const d = await draw($, w)
  expect(drawnClasses(d.lines)).toEqual(['progress', 'unclassified'])
  await d.ui.press({ key: 'retro-QSL' })
  expect((await d.ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('unclassified: prs idle')
  await d.ui.unmount()
})

test('a delta with no metric reads no retro delta yet, with no mark and no warning', async ($, on) => {
  trace("FR-029-AC-13")
  const w = await setup($, on, () => out(JSON.stringify({ team: 'QSL', message: 'no delta: 1 snapshot record(s) in the store, two are needed', metrics: [] })))
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
  const w = await setup($, on, () => out('', 3, 'retro config /x: cannot read'))
  const d = await draw($, w)
  expect(d.lines).toContain('no retro baseline')
  expect(d.lines).not.toContain('flow')
  await d.ui.unmount()
  expect(retroCalls(w).length).toBeGreaterThan(0)
})

for (const [why, failing] of [['exits 1', () => out('', 1, 'ix-board: boom')], ['prints text that is not JSON', () => out('not json')]] as const) {
  test(`a retro delta that ${why} is retro unavailable with a warning, not no baseline`, async ($, on) => {
    trace("FR-029-AC-9")
    const w = await setup($, on, failing)
    const d = await draw($, w)
    expect(d.lines).toContain('retro unavailable')
    expect(d.lines).not.toContain('no retro baseline')
    expect(d.buttons).toContain('1')
    await d.ui.unmount()
  })
}

test('the retro health waits for the session to know its team, and claims nothing before', async ($, on) => {
  trace("FR-029-AC-14")
  const w = await setup($, on, undefined, w => {
    const prior = w.stub.value
    w.stub.value = (argv, init) => (argv.join(' ') === 'agent-msg whoami' ? w.clock!.sleep(3000).then(() => out('draco:QSL:code  (location)  model unknown')) : prior?.(argv, init))
  })
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
  const w = await setup($, on, undefined, w => {
    w.whoami.value = undefined
  })
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
