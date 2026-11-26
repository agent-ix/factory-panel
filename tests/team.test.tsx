import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { classesOf } from '../hooks/team'
import { FP, drawBand, out, startSession, world } from './world'
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

/** What the exporter publishes for team fsl: some series, and none for the first-review latency, the oldest stage age or merged PRs. */
const SERIES: Series[] = [
  ...daily('closures_day', { 6: 1, 5: 0, 3: 5, 1: 2, 0: 7 }),
  series('wip_active', [3, 4]),
  series('blocked_issues', [0, 2]),
  series('pr_cycle_median_seconds_24h', [7200, 5400]),
  series('review_findings_confirmed_high_24h', [0, 2]),
  series('review_findings_confirmed_medium_24h', [0, 0]),
  series('pr_changes_requested_share', [0.5, 0.25]),
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

type Ui = Awaited<ReturnType<$t['ui']['mount']>>
const textsOf = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const buttonsOf = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => ({ key: b.key ?? '', label: String((b.props as { label?: string }).label ?? '') }))

/** Presses the closed keyless rows. */
async function openKeyless(ui: Ui) {
  for (const b of await buttonsOf(ui)) if (b.key.startsWith('unkeyed-') && b.label === '▸') await ui.press({ key: b.key })
}

/** Presses, once each, every `more` and every `○`. */
async function openAll(ui: Ui) {
  for (const b of await buttonsOf(ui)) if (b.key.startsWith('more-') || b.key.startsWith('why-')) await ui.press({ key: b.key })
}

/** Draws the pane after `wait`, with the keyless rows opened, and every `more` and `○` unless `opened` is false. */
async function draw($: $t, w: World, wait = 1000, opened = true, keyless = true) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(wait)
  if (keyless) await openKeyless(ui)
  if (opened) await openAll(ui)
  const els = async () => (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text ?? '', color: (t.props as { color?: string }).color }))
  const lines = (await els()).map(e => e.text)
  const buttons = (await buttonsOf(ui)).map(b => b.label)
  return { ui, lines, els, buttons }
}
const after = (lines: string[], label: string) => lines[lines.indexOf(label) + 1]
const retroCalls = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json retro delta'))

test('a team draws its figures by their own names, line by line and under no group label, with the rest behind more', async ($, on) => {
  trace("FR-029-AC-1")
  const w = await setup($, on)
  const closed = await draw($, w, 1000, false)
  const at = (t: string) => closed.lines.indexOf(t)
  const order = ['closed', 'in progress', 'blocked', 'ready', 'PR cycle'].map(at)
  expect(order.every((i, n) => i > (n === 0 ? at('fsl') : order[n - 1]!))).toBe(true)
  for (const label of ['Shipping', 'Flowing', 'Fed', 'Review']) expect(closed.lines).not.toContain(label)
  expect(after(closed.lines, 'closed')).toBe('7')
  expect(after(closed.lines, 'in progress')).toBe('4')
  expect(after(closed.lines, 'blocked')).toBe('2')
  expect(after(closed.lines, 'ready')).toBe('7')
  expect(after(closed.lines, 'PR cycle')).toBe('1.5h')
  expect(closed.buttons).toContain('▸ more')
  for (const label of ['findings high', 'changes requested']) expect(closed.lines).not.toContain(label)
  await closed.ui.press({ key: 'more-fsl' })
  const open = await textsOf(closed.ui)
  expect(after(open, 'findings high')).toBe('2')
  expect(after(open, 'findings medium')).toBe('0')
  expect(after(open, 'changes requested')).toBe('25%')
  expect((await buttonsOf(closed.ui)).map(b => b.label)).toContain('▾ more')
  expect(open.join('\n')).not.toMatch(/closures|Effort|merges \/ hour|with findings|Executing/i)
  expect(w.queries.filter(q => /verified_path_closed|effort_per|merges_per_hour|with_findings|executing_agents/.test(q))).toEqual([])
  await closed.ui.unmount()
})

test('a figure with no value is left out, and the team’s one ○ says what is missing and why', async ($, on) => {
  trace("FR-029-AC-2", "FR-029-AC-37")
  const w = await setup($, on)
  const d = await draw($, w, 1000, false)
  for (const label of ['first review', 'oldest', 'merged', '—']) expect(d.lines).not.toContain(label)
  expect(d.lines.join('\n')).not.toContain('no series published')
  expect((await buttonsOf(d.ui)).filter(b => b.label === '○' && b.key !== 'hosts-why').map(b => b.key)).toEqual(['why-QSL', 'why-fsl'])
  expect(d.lines.slice(d.lines.indexOf('fsl'), d.lines.indexOf('fsl') + 3)).toEqual(['fsl', 'no team key', 'closed'])
  await d.ui.press({ key: 'why-fsl' })
  expect((await textsOf(d.ui)).filter(l => /^  [^:]+: /.test(l))).toEqual([
    '  merged: no series published',
    '  oldest: no series published',
    '  first review: no series published',
    '  leaf remaining: no series published',
    '  ready unmerged PRs: no series published',
    '  findings low: no series published',
  ])
  await d.ui.press({ key: 'why-fsl' })
  expect((await textsOf(d.ui)).join('\n')).not.toContain('no series published')
  await d.ui.unmount()
})

test('a team with every figure has no ○, and one with none is its name and the ○', async ($, on) => {
  trace("FR-029-AC-2")
  const names = ['wip_active', 'blocked_issues', 'stage_oldest_age_seconds', 'ready_issues', 'new_pr_first_review_median_seconds_24h', 'pr_cycle_median_seconds_24h', 'scope_leaf_remaining', 'prs_ready_unmerged', 'review_findings_confirmed_high_24h', 'review_findings_confirmed_medium_24h', 'review_findings_confirmed_low_24h', 'pr_changes_requested_share']
  const full = { id: 'full', key: 'QSL' }
  const none = { id: 'none', key: 'SWM' }
  const w = await setup($, on, { arrange: declaring({ focus: 'team', teams: ['QSL', 'SWM'] }), published: [
    ...names.map(n => series(n, [259200], full)),
    ...daily('closures_day', { 0: 1 }, full),
    ...daily('merged_prs_day', { 0: 2 }, full),
    scoped('completion', none),
  ] })
  const d = await draw($, w, 1000, false)
  expect((await buttonsOf(d.ui)).filter(b => b.key.startsWith('why-')).map(b => b.key)).toEqual(['why-SWM'])
  expect(after(d.lines, 'oldest')).toBe('3d')
  const bare = under(d.lines, 'SWM')
  expect(bare[0]).toMatch(/^[◔○]$/)
  expect((await buttonsOf(d.ui)).map(b => b.key).filter(k => k.startsWith('more-'))).toEqual(['more-QSL'])
  await d.ui.unmount()
})

test('each figure draws its history: the last six hours, and for what shipped the last seven days', async ($, on) => {
  trace("FR-029-AC-3", "FR-029-AC-22")
  const w = await setup($, on, { published: [...SERIES, ...daily('merged_prs_day', { 2: 12, 1: 2, 0: 124 }), series('merged_prs_day', [40], { day: 4, ago: 600 })] })
  const d = await draw($, w)
  expect(after(d.lines, 'PR cycle')).toBe('1.5h')
  expect(d.lines[d.lines.indexOf('PR cycle') + 2]).toMatch(/^[▁▂▃▄▅▆▇█]+$/)
  // Seven days, oldest first and today last; `·` for a day with no current sample.
  expect(d.lines[d.lines.indexOf('closed') + 2]).toBe('▂▁·▆·▃█')
  expect(after(d.lines, 'merged')).toBe('124')
  expect(d.lines[d.lines.indexOf('merged') + 2]).toBe('····▂▁█')
  await d.ui.unmount()
})

const healthLabel = async (ui: Ui) => (await buttonsOf(ui)).find(b => b.key === 'retro-QSL')!.label
/** The mark before the health line, with its colour. */
const healthMarkOf = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text ?? '', color: (t.props as { color?: string }).color })).filter(e => /^[◔○]$/.test(e.text))[0]
/** What the opened health line says. */
async function healthLines(ui: Ui) {
  const before = await textsOf(ui)
  await ui.press({ key: 'retro-QSL' })
  return (await textsOf(ui)).filter(l => !before.includes(l) && l.startsWith('  '))
}
const RUN = '  run: ix-board retro snapshot --config ~/.local/state/team-retro/QSL/config.json'

test('retro health is one line, which says what it checks, what regresses, when it last ran and the command', async ($, on) => {
  trace("FR-029-AC-4", "FR-029-AC-5")
  const w = await setup($, on)
  const d = await draw($, w, 1000, false)
  expect(await healthLabel(d.ui)).toMatch(/^Health  retro \d+[smhd] ▸$/)
  expect(await healthMarkOf(d.ui)).toEqual({ text: '◔', color: 'error' })
  expect(d.lines.join('\n')).not.toMatch(/prs idle|snapshots/)
  expect(await healthLines(d.ui)).toEqual([
    '  checks 8 metrics of progress, flow, scope, resource against stored retro snapshots',
    '  regressing flow: prs idle',
    '  no value: scope 1, resource 2',
    '  last run 2026-11-24T16:23:18Z',
    RUN,
  ])
  expect(await healthLabel(d.ui)).toMatch(/▾$/)
  await d.ui.unmount()
  expect(classesOf([{ id: 'path_remaining', class: 'progress', status: 'ok', regressing: false }]).map(c => c.rating)).toEqual(['green'])
})

test('a metric is named in the class its class field names, in the order the answer names the classes', async ($, on) => {
  trace("FR-029-AC-10")
  // Ids ix-board files elsewhere today, and a class and a metric the mod has never heard of.
  const w = await setup($, on, { delta: deltaOf([metric('path_remaining', 'stability', 'ok', true), metric('brand_new_metric', 'quality'), metric('prs_open', 'progress')]) })
  const d = await draw($, w, 1000, false)
  const said = await healthLines(d.ui)
  expect(said[0]).toBe('  checks 3 metrics of stability, quality, progress against stored retro snapshots')
  expect(said).toContain('  regressing stability: path remaining')
  await d.ui.unmount()
})

test('a metric with no class beside classed ones is counted as unclassified, last', async ($, on) => {
  trace("FR-029-AC-12")
  const w = await setup($, on, { delta: deltaOf([metric('prs_idle', null, 'ok', true), metric('path_remaining', 'progress')]) })
  const d = await draw($, w, 1000, false)
  const said = await healthLines(d.ui)
  expect(said[0]).toBe('  checks 2 metrics of progress, unclassified against stored retro snapshots')
  expect(said).toContain('  regressing unclassified: prs idle')
  await d.ui.unmount()
})

/** A delta that gives no data is the line no retro, which says `reason` when pressed, with no warning. */
async function noRetro($: $t, on: Parameters<TestBody>[1], delta: () => ReturnType<typeof out>, reason: string) {
  const w = await setup($, on, { delta })
  const d = await draw($, w, 1000, false)
  expect(await healthLabel(d.ui)).toBe('Health  no retro ▸')
  expect(await healthMarkOf(d.ui)).toEqual({ text: '○', color: 'inactive' })
  expect(d.lines.join('\n')).not.toContain(reason)
  expect(await healthLines(d.ui)).toEqual(['  checks each department’s metrics against stored retro snapshots', `  ${reason}`, RUN])
  expect(d.buttons.filter(b => /^\d+$/.test(b))).toEqual([])
  expect(retroCalls(w).length).toBeGreaterThan(0)
  await d.ui.unmount()
}

test('a retro delta that names no class is no retro, and says which ix-board is needed', async ($, on) => {
  trace("FR-029-AC-11")
  await noRetro($, on, deltaOf([metric('path_remaining', null), metric('prs_idle', null, 'ok', true)]), 'needs ix-board ≥0.11.0')
})

test('a retro delta with no metric is no retro, and says there is no delta yet', async ($, on) => {
  trace("FR-029-AC-13")
  await noRetro($, on, () => out(JSON.stringify({ team: 'QSL', message: 'no delta: 1 snapshot record(s) in the store, two are needed', metrics: [] })), 'no retro delta yet')
})

test('a retro delta with no configuration to read is no retro, and says there is no baseline', async ($, on) => {
  trace("FR-029-AC-6")
  await noRetro($, on, () => out('', 3, 'retro config /x: cannot read'), 'no retro baseline')
})

for (const [why, failing] of [['exits 1', () => out('', 1, 'ix-board: boom')], ['prints text that is not JSON', () => out('not json')]] as const) {
  test(`a retro delta that ${why} is retro unavailable with a warning, not no baseline`, async ($, on) => {
    trace("FR-029-AC-9")
    const w = await setup($, on, { delta: failing })
    const d = await draw($, w, 1000, false)
    expect(await healthLabel(d.ui)).toBe('Health  no retro ▸')
    expect(d.buttons).toContain('1')
    const said = await healthLines(d.ui)
    expect(said).toContain('  retro unavailable')
    expect(said).not.toContain('  no retro baseline')
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
  expect(d.lines).toContain('○ Health  reading')
  expect(d.lines.join('\n')).not.toMatch(/no retro|○ Health  no team/)
  expect(retroCalls(w)).toEqual([])
  await w.clock!.advance(4000)
  expect(retroCalls(w)).toEqual([`ix-board --json retro delta --config ${CONFIG}`])
  expect(await healthLabel(d.ui)).toMatch(/^Health  retro /)
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
  expect(d.lines).toContain('○ Health  no team')
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

// ---------------------------------------------------------------- the selected teams

/** A session whose declaration selects `picked`. */
const declaring = (picked: Record<string, unknown>) => (w: World) => {
  w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify(picked))
}
const THREE = [series('ready_issues', [4], { key: 'QSL' }), series('ready_issues', [9], { id: 'swm', key: 'SWM' }), series('ready_issues', [2], { id: 'aaa', key: 'AAA' })]
const count = (lines: string[], text: string) => lines.filter(l => l === text).length
/** The team names of the headings drawn, in order. */
const headings = (lines: string[], names: string[]) => lines.filter(l => names.includes(l))

test('only the selected team keys have rows', async ($, on) => {
  trace("FR-029-AC-31")
  const w = await setup($, on, { published: THREE })
  const d = await draw($, w)
  expect(headings(d.lines, ['QSL', 'SWM', 'AAA'])).toEqual(['QSL'])
  expect(count(d.lines, 'ready')).toBe(1)
  expect(after(d.lines, 'ready')).toBe('4')
  expect(d.lines.join('\n')).not.toContain('no team series carries')
  await d.ui.unmount()
})

test('the selected teams are drawn in the order of the selection', async ($, on) => {
  trace("FR-029-AC-31")
  const w = await setup($, on, { published: THREE, arrange: declaring({ focus: 'Alpha', teams: ['SWM', 'QSL'] }) })
  const d = await draw($, w)
  expect(headings(d.lines, ['QSL', 'SWM', 'AAA'])).toEqual(['SWM', 'QSL'])
  await d.ui.unmount()
})

test('with no team selected every team is drawn, those with a key first', async ($, on) => {
  trace("FR-029-AC-31")
  const w = await setup($, on, { published: [series('ready_issues', [7], { id: 'aaa-id' }), series('ready_issues', [4], { key: 'QSL' })], arrange: w => {
    w.whoami.value = undefined
  } })
  const d = await draw($, w, 6000)
  expect(headings(d.lines, ['QSL', 'aaa-id'])).toEqual(['QSL', 'aaa-id'])
  expect(count(d.lines, 'ready')).toBe(2)
  await d.ui.unmount()
})

test('an exporter id with no key is one closed row that opens to its rows and closes again', async ($, on) => {
  trace("FR-029-AC-32")
  const w = await setup($, on, { published: [series('ready_issues', [4], { id: 'keyed', key: 'QSL' }), series('ready_issues', [7])] })
  const d = await draw($, w, 1000, false, false)
  expect(d.lines.slice(d.lines.indexOf('fsl'), d.lines.indexOf('fsl') + 2)).toEqual(['fsl', 'no team key'])
  expect(count(d.lines, 'ready')).toBe(1)
  await d.ui.press({ key: 'unkeyed-fsl' })
  expect(count(await textsOf(d.ui), 'ready')).toBe(2)
  await d.ui.press({ key: 'unkeyed-fsl' })
  expect(count(await textsOf(d.ui), 'ready')).toBe(1)
  await d.ui.unmount()
})

test('a selected team with no series is its name and the ○, which says why', async ($, on) => {
  trace("FR-029-AC-33")
  const w = await setup($, on, { published: [series('ready_issues', [7])] })
  const d = await draw($, w, 1000, false, false)
  expect(d.lines).toContain('QSL')
  expect((await buttonsOf(d.ui)).find(b => b.key === 'why-QSL')?.label).toBe('○')
  expect(d.lines.join('\n')).not.toContain('team_key')
  await d.ui.press({ key: 'why-QSL' })
  const said = await textsOf(d.ui)
  expect(said).toContain('  no team series carries the key QSL')
  expect(said).toContain('  ids with no team_key (published from ix-board 0.12.0) cannot be told apart')
  await d.ui.unmount()
})

test('a selected team with no series beside keyed ones of others is only named', async ($, on) => {
  trace("FR-029-AC-33")
  const w = await setup($, on, { published: [series('ready_issues', [9], { id: 'swm', key: 'SWM' })] })
  const d = await draw($, w)
  expect(d.lines).toContain('  no team series carries the key QSL')
  expect(d.lines.join('\n')).not.toContain('team_key')
  expect(d.lines).not.toContain('SWM')
  await d.ui.unmount()
})

for (const [title, picked] of [
  ['a teams choice with the default own focus', { teams: ['SWM'] }],
  ['a teams choice with focus team', { focus: 'team', teams: ['SWM'] }],
  ['a teams choice with a named focus', { focus: 'Alpha', teams: ['SWM'] }],
] as [string, Record<string, unknown>][])
  test(`${title} is the Team view’s selection, in place of the session’s own team`, async ($, on) => {
    trace("FR-029-AC-36")
    const w = await setup($, on, { published: THREE, arrange: declaring(picked) })
    const d = await draw($, w)
    expect(headings(d.lines, ['QSL', 'SWM', 'AAA'])).toEqual(['SWM'])
    expect(after(d.lines, 'ready')).toBe('9')
    await d.ui.unmount()
  })

for (const focus of ['own', 'team', 'Alpha'])
  test(`with no teams chosen the focus ${focus} selects the session’s own team`, async ($, on) => {
    trace("FR-029-AC-36")
    const w = await setup($, on, { published: THREE, arrange: declaring({ focus }) })
    const d = await draw($, w)
    expect(headings(d.lines, ['QSL', 'SWM', 'AAA'])).toEqual(['QSL'])
    await d.ui.unmount()
  })

const closures = (n: number, id: string, key?: string) => series('closures_day', [n], { day: 0, id, key })
const WIDGET: [string, Series[], string[], string][] = [
  ['the selected team only', [closures(4, 'fsl', 'QSL'), closures(9, 'swm', 'SWM'), closures(7, 'blank')], ['QSL'], '4 closed today'],
  ['a lower bound where a selected team has no series', [closures(4, 'fsl', 'QSL')], ['QSL', 'ENG'], '≥4 closed today'],
  ['no number where no series carries a selected key', [closures(7, 'fsl'), closures(2, 'swarm-tools'), closures(9, 'swm', 'SWM')], ['QSL'], '— closed today'],
  ['no number where no series carries any of the selected keys', [closures(9, 'swm', 'SWM')], ['QSL', 'ENG'], '— closed today'],
]
for (const [name, published, teams, text] of WIDGET)
  test(`the widget reads ${name} of the selection`, async ($, on) => {
    trace("FR-029-AC-34")
    const w = await setup($, on, { published, arrange: declaring({ focus: 'team', teams }) })
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'terminal' } as never)
    await w.clock!.advance(1000)
    expect(await textsOf(ui)).toContain(text)
    await ui.unmount()
  })

test('the band team cell reads the selected team, not the first published', async ($, on) => {
  trace("FR-029-AC-34")
  const w = await setup($, on, { published: [closures(9, 'aaa', 'AAA'), closures(4, 'fsl', 'QSL')], arrange: declaring({ modules: ['team'] }) })
  const band = await drawBand($)
  await w.clock!.advance(2000)
  const text = (await band.findAll({ type: 'Text' })).map(t => t.text ?? '').join('')
  expect(text).toContain('QSL closed 4')
  expect(text).not.toContain('AAA')
  await band.unmount()
})

// ---------------------------------------------------------------- teams, current values and the daily rows

/** The lines drawn under the heading of `team`, up to the next team's heading or the footer. */
function under(lines: string[], team: string, next?: string): string[] {
  const from = lines.indexOf(team)
  expect(from).toBeGreaterThan(-1)
  const to = next === undefined ? lines.length : lines.indexOf(next)
  return lines.slice(from + 1, to)
}
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
  expect(after(mine, 'ready')).toBe('9')
  expect(after(mine, 'in progress')).toBe('5')
  expect(after(mine, 'blocked')).toBe('2')
  await d.ui.unmount()
})

test('a team no series gives a key is headed by the exporter id and says it has no key', async ($, on) => {
  trace("FR-029-AC-18")
  const w = await setup($, on, { published: [series('ready_issues', [2], { key: 'QSL' }), series('ready_issues', [7], { id: 'swarm-tools' }), series('wip_active', [1], { id: 'blank', key: '' })] })
  const d = await draw($, w)
  expect(after(d.lines, 'swarm-tools')).toBe('no team key')
  expect(after(d.lines, 'blank')).toBe('no team key')
  expect(after(d.lines, 'QSL')).not.toBe('no team key')
  await d.ui.unmount()
})

test('exporter ids with one team key make one team: counts as lower bounds, durations at their largest', async ($, on) => {
  trace("FR-029-AC-19")
  const w = await setup($, on, { published: [
    series('ready_issues', [2], { id: 'a', key: 'QSL' }),
    series('ready_issues', [3], { id: 'b', key: 'QSL' }),
    series('stage_oldest_age_seconds', [3600], { id: 'a', key: 'QSL' }),
    series('stage_oldest_age_seconds', [7200], { id: 'b', key: 'QSL' }),
  ] })
  const d = await draw($, w)
  expect(d.lines.filter(l => l === 'QSL')).toHaveLength(1)
  expect(after(d.lines, 'ready')).toBe('≥3')
  expect(after(d.lines, 'oldest')).toBe('2.0h')
  await d.ui.unmount()
})

for (const [title, ages, stages, expected] of [
  ['a stage not measured and no age above zero is not drawn', [0], [1, 0], null],
  ['a stage not measured and no age at all is not drawn', [], [1, 0], null],
  ['a stage not measured beside an older one is a lower bound', [3600], [1, 0], '≥1.0h'],
  ['stages all measured read exactly', [0], [1, 1], '0m'],
] as [string, number[], number[], string | null][]) {
  test(`the oldest age: ${title}`, async ($, on) => {
    trace("FR-029-AC-35")
    const w = await setup($, on, { published: [
      series('ready_issues', [1]),
      ...(ages.length === 0 ? [] : [series('stage_oldest_age_seconds', ages)]),
      ...stages.map((value, i) => coverage(`stage_oldest_age_seconds_s${i}`, value)),
    ] })
    const d = await draw($, w)
    if (expected === null) {
      expect(d.lines).not.toContain('oldest')
      expect(d.lines.some(l => /^  oldest: (age not measured|no series published)$/.test(l))).toBe(true)
    } else expect(after(d.lines, 'oldest')).toBe(expected)
    await d.ui.unmount()
  })
}

test('changes requested is the exporter’s own series, derived from nothing else', async ($, on) => {
  trace("FR-029-AC-20")
  const w = await setup($, on, { published: [series('prs_changes_requested', [2]), series('prs_open', [8]), series('ready_issues', [1])] })
  const d = await draw($, w)
  expect(d.lines).toContain('  changes requested: no series published')
  expect(w.queries.filter(q => /prs_changes_requested\b|prs_open/.test(q))).toEqual([])
  expect(w.queries.some(q => q.includes('ix_team_pr_changes_requested_share)'))).toBe(true)
  await d.ui.unmount()
})

test('a series that stopped more than a step ago has no value now, and its why says so', async ($, on) => {
  trace("FR-029-AC-21", "FR-029-AC-37")
  const w = await setup($, on, { published: [series('ready_issues', [6, 8], { ago: 600 }), series('wip_active', [2, 3], { ago: 300 })] })
  const d = await draw($, w)
  expect(d.lines).not.toContain('ready')
  expect(d.lines).toContain('  ready: no current sample')
  expect(after(d.lines, 'in progress')).toBe('3')
  await d.ui.unmount()
})

test('a day with no sample at all says why, and a day count with none today draws its days', async ($, on) => {
  trace("FR-029-AC-22", "FR-029-AC-37")
  const w = await setup($, on, { published: daily('closures_day', { 1: 4 }) })
  const d = await draw($, w)
  expect(d.lines[d.lines.indexOf('closed') + 1]).toBe('·····█·')
  expect(d.lines).toContain('  closed today: no current sample')
  expect(d.lines).toContain('  merged: no series published')
  await d.ui.unmount()
})

test('a team with two scopes shows today as at least the larger count', async ($, on) => {
  trace("FR-029-AC-27")
  const w = await setup($, on, { arrange: declaring({ focus: 'team', teams: ['QSL', 'SWM'] }), published: [
    ...daily('closures_day', { 2: 4, 1: 9 }, { key: 'QSL', scope: 'release' }),
    ...daily('closures_day', { 2: 6, 1: 2, 0: 1 }, { key: 'QSL', scope: 'completion' }),
    ...daily('closures_day', { 2: 1, 0: 5 }, { id: 'swm', key: 'SWM' }),
  ] })
  const d = await draw($, w)
  expect(after(under(d.lines, 'QSL', 'SWM'), 'closed')).toBe('≥1')
  expect(after(under(d.lines, 'SWM'), 'closed')).toBe('5')
  await d.ui.unmount()
})

/** A scope the exporter publishes: it says of every scope whether its sources answer. */
const scoped = (scope: string, more: Partial<Series> = {}): Series => series('source_available', [1], { scope, ...more })
const COUNT_FIGURES = ['findings high', 'findings medium', 'findings low']

test('a team with two scopes shows its 24 hour counts as at least the larger, and one scope shows them exactly', async ($, on) => {
  trace("FR-029-AC-28")
  // One scope's latest sample is a step older than the other's: both are current.
  const both = (name: string, release: number, completion: number) => [series(name, [release], { key: 'QSL', scope: 'release' }), series(name, [completion], { key: 'QSL', scope: 'completion', ago: name.endsWith('high_24h') ? 300 : 0 })]
  const w = await setup($, on, { arrange: declaring({ focus: 'team', teams: ['QSL', 'SWM'] }), published: [
    ...both('review_findings_confirmed_high_24h', 1, 3),
    ...both('review_findings_confirmed_medium_24h', 2, 0),
    ...both('review_findings_confirmed_low_24h', 0, 0),
    series('review_findings_confirmed_high_24h', [2], { id: 'swm', key: 'SWM' }),
  ] })
  const d = await draw($, w)
  const mine = under(d.lines, 'QSL', 'SWM')
  expect(COUNT_FIGURES.map(label => after(mine, label))).toEqual(['≥3', '≥2', '≥0'])
  const other = under(d.lines, 'SWM')
  expect(after(other, 'findings high')).toBe('2')
  expect(other).toContain('  findings low: no series published')
  await d.ui.unmount()
})

const CURRENT_COUNTS: [string, string][] = [
  ['leaf remaining', 'scope_leaf_remaining'], ['in progress', 'wip_active'], ['blocked', 'blocked_issues'],
  ['ready unmerged PRs', 'prs_ready_unmerged'], ['ready', 'ready_issues'],
]

test('a team with two scopes shows its current counts as at least the larger, never their sum, and one scope shows them exactly', async ($, on) => {
  trace("FR-029-AC-30")
  const w = await setup($, on, { arrange: declaring({ focus: 'team', teams: ['QSL', 'SWM', 'TWO'] }), published: [
    ...CURRENT_COUNTS.flatMap(([, name], i) => [series(name, [i + 1], { key: 'QSL', scope: 'release' }), series(name, [10 + i], { key: 'QSL', scope: 'completion', ago: i % 2 === 0 ? 300 : 0 })]),
    ...CURRENT_COUNTS.map(([, name], i) => series(name, [i + 20], { id: 'swm', key: 'SWM' })),
    // Only one of this team's two scopes reports a count: the other still makes it a bound.
    series('wip_active', [4], { id: 'one', key: 'TWO' }),
    scoped('release', { id: 'one', key: 'TWO' }),
    scoped('completion', { id: 'one', key: 'TWO' }),
  ] })
  const d = await draw($, w)
  const shown = (team: string, next?: string) => CURRENT_COUNTS.map(([label]) => after(under(d.lines, team, next), label))
  expect(shown('QSL', 'SWM')).toEqual(['≥10', '≥11', '≥12', '≥13', '≥14'])
  expect(shown('SWM', 'TWO')).toEqual(['20', '21', '22', '23', '24'])
  expect(after(under(d.lines, 'TWO'), 'in progress')).toBe('≥4')
  expect(w.queries.filter(q => q.includes('sum by'))).toEqual([])
  await d.ui.unmount()
})

for (const [name, published, shown] of [
  ['reports none of them', [series('review_findings_confirmed_high_24h', [6], { key: 'QSL' }), scoped('completion', { key: 'QSL' }), scoped('release', { key: 'QSL' })], '≥6'],
  ['reports them without the team key', [series('review_findings_confirmed_high_24h', [2], { key: 'QSL' }), series('review_findings_confirmed_high_24h', [9], { scope: 'release' })], '≥9'],
  ['is only the same scope before the key', [series('review_findings_confirmed_high_24h', [4]), series('review_findings_confirmed_high_24h', [5], { key: 'QSL' }), scoped('completion'), scoped('completion', { key: 'QSL' })], '5'],
] as [string, Series[], string][]) {
  test(`the 24 hour counts of a team whose other scope ${name} read ${shown}`, async ($, on) => {
    trace("FR-029-AC-29")
    const w = await setup($, on, { published: [...published, ...daily('closures_day', { 0: 3 }, { key: 'QSL' })] })
    const d = await draw($, w)
    expect(after(d.lines, 'findings high')).toBe(shown)
    expect(after(d.lines, 'closed')).toBe(shown.startsWith('≥') ? '≥3' : '3')
    await d.ui.unmount()
  })
}

test('more says how much of a figure’s population was measured where that is not all of it', async ($, on) => {
  trace("FR-029-AC-26")
  const w = await setup($, on, { published: [
    series('wip_active', [3]),
    coverage('wip_active', 0.96875),
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
  expect(after(d.lines, 'in progress')).toBe('≥3')
  expect(after(d.lines, 'oldest')).toBe('≥1.0h')
  expect(d.lines.filter(l => l.endsWith('% covered'))).toEqual(['  in progress: 96% covered', '  oldest: 50% covered', '  changes requested: 75% covered'])
  await d.ui.unmount()
})

for (const [name, published, text] of [
  ['the tickets closed today of all teams', [...daily('closures_day', { 0: 3 }), ...daily('closures_day', { 0: 4 }, { id: 'b' })], '7 closed today'],
  ['at least them where a team has none', [...daily('closures_day', { 0: 3 }), series('ready_issues', [1], { id: 'b' })], '≥3 closed today'],
  ['a dash where no team has any', [series('ready_issues', [1])], '— closed today'],
] as [string, Series[], string][]) {
  test(`the widget reads ${name}`, async ($, on) => {
    trace("FR-029-AC-24")
    // A session that cannot say who it is selects no team, so the widget reads every one.
    const w = await setup($, on, { published, arrange: w => { w.whoami.value = undefined } })
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'terminal' } as never)
    await w.clock!.advance(1000)
    expect(await textsOf(ui)).toContain(text)
    await ui.unmount()
  })
}
