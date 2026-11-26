import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { FP, hangs, out, startSession, world } from './world'
import type { Run, World } from './world'

// Tests for the Roles section of the Team tab (FR-031). The answers follow the published shape of
// `ix-board retro eval --json`, schema version 1.

type $t = Parameters<TestBody>[0]
type Init = { timeoutMs?: number } | undefined
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 10, 24, 12, 0)
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'team', props: { title: 'Team', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
const configOf = (team: string) => `/home/test/.local/state/team-retro/${team}/config.json`
const evalOf = (team: string) => `ix-board --json retro eval --config ${configOf(team)} --since 24h`
const GATE = `${FP}/linear-gate.json`
const MISSING = "error: unrecognized subcommand 'eval'\n\nUsage: ix-board retro [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n"

type Rule = Record<string, unknown>
const rule = (id: string, status: string, more: Rule = {}): Rule => ({ id, query: `query.${id}`, status, value: status === 'pass' || status === 'fail' ? 3 : null, comparator: '<=', target: 1, evidence_refs: [], ...more })
const role = (name: string, rules: Rule[], passed: number, evaluated: number, rate: number | null, trend: number | null, matched?: number) => ({ role: name, score: { passed, evaluated, pass_rate: rate }, previous_score: { passed, evaluated, pass_rate: rate }, trend, trend_matched_rules: matched, rules, failing_rules: rules.filter(r => r.status === 'fail').map(r => r.id), session_ids: [] })
/** An answer whose 24 hour window ended `agoMin` minutes before the session started. */
const answer = (roles: unknown[], agoMin = 3, schema = 1) => out(JSON.stringify({ schema_version: schema, team: 'QSL', window: { start_ms: NOW - agoMin * MIN - 24 * HOUR, end_ms: NOW - agoMin * MIN }, previous_window: { start_ms: 0, end_ms: 1 }, roles, sessions: [] }))

/** The coder of the published sample: one rule of each status. */
const CODER = role('coder', [
  rule('CODE-R1', 'pass', { query: 'hooks.role_turns', value: 12, comparator: '>=' }),
  rule('CODE-R2', 'fail', { query: 'retro.review_findings_open', value: 3 }),
  rule('CODE-R3', 'unavailable', { query: 'github.merged_prs', comparator: '>=', reason: 'github.merged_prs: source returned no complete population for this window' }),
  rule('CODE-R4', 'not_applicable', { query: 'prom.host_build_pause_interval', comparator: '>=', reason: 'no pause producer' }),
  rule('CODE-J1', 'judgement_required', { query: 'CODE-RUBRIC-1', comparator: 'manual', target: 0, rubric_id: 'CODE-RUBRIC-1', judgement_required: true }),
], 1, 2, 0.5, 0, 2)

type Answering = (team: string, init: Init, w: World) => Run | Promise<Run>

async function setup($: $t, on: Parameters<TestBody>[1], answering: Answering = () => answer([CODER]), arrange: (w: World) => void = () => undefined): Promise<World> {
  const w = world(on, true)
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const found = /^ix-board --json retro eval --config \S+\/(\w+)\/config\.json --since 24h$/.exec(argv.join(' '))
    return found ? answering(found[1]!, init, w) : prior?.(argv, init)
  }
  arrange(w)
  await startSession($)
  return w
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string; props: unknown }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

async function draw($: $t, w: World, wait = SEC, placement: 'dock' | 'widget' = 'dock') {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement }, surface: 'terminal' } as never)
  await w.clock!.advance(wait)
  // With nothing evaluated the section is one line: pressed, it says why.
  if ((await ui.findAll({ type: 'Button' })).some(b => b.key === 'roles-why-QSL')) await ui.press({ key: 'roles-why-QSL' })
  const lines = () => texts(ui)
  const marked = async (text: string) => {
    const all = (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text ?? '', color: (t.props as { color?: string }).color }))
    const at = all.findIndex(e => e.text.startsWith(text))
    expect(at).toBeGreaterThan(0)
    return all[at - 1]
  }
  const buttons = async () => (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  return { ui, lines, marked, buttons }
}
const evals = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json retro eval'))
/** The lines of `/factory show` about the evaluations: a failing source has one. */
const failed = async ($: $t) => ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string).split('\n').filter(l => l.includes('ix-board retro eval:'))

test('a role draws its pass rate, counts and trend, and expanded its failing rules with what they want', async ($, on) => {
  trace("FR-031-AC-1")
  const w = await setup($, on, () => answer([CODER, role('planner', [rule('PLAN-R1', 'pass')], 1, 1, 1, 0.25)]))
  const d = await draw($, w)
  const lines = await d.lines()
  expect(lines).toContain('Roles · QSL')
  expect(lines).toContain('24h window · ended 3m ago')
  expect(await d.buttons()).toEqual(expect.arrayContaining(['▸ coder', '▸ planner']))
  const at = lines.indexOf('50% · 1/2 passed')
  expect(lines.slice(at, at + 3)).toEqual(['50% · 1/2 passed', '= no change over 2 rules', '1 failing · 1 unavailable · 1 not applicable · 1 judgement'])
  const planner = lines.indexOf('100% · 1/1 passed')
  expect(lines.slice(planner, planner + 2)).toEqual(['100% · 1/1 passed', '↑ +25 pts'])
  expect(lines.join('\n')).not.toContain('CODE-R2')
  await d.ui.press({ key: 'role-QSL-coder' })
  expect(await d.lines()).toContain('CODE-R2 · 3, wants ≤ 1 · retro.review_findings_open')
  expect((await d.marked('CODE-R2'))).toEqual({ text: '●', color: 'error' })
  expect((await d.lines()).join('\n')).not.toMatch(/CODE-R1|PLAN-R1/)
  expect(await d.buttons()).toContain('▾ coder')
  await d.ui.press({ key: 'role-QSL-coder' })
  expect((await d.lines()).join('\n')).not.toContain('CODE-R2')
  await d.ui.unmount()
})

test('rules that are not scored say why, with no value and no pass mark', async ($, on) => {
  trace("FR-031-AC-2")
  const extra = [rule('CODE-R5', 'unavailable'), rule('CODE-R6', 'deferred', { reason: 'a status of a later ix-board' })]
  const w = await setup($, on, () => answer([{ ...CODER, rules: [...CODER.rules, ...extra] }]))
  const d = await draw($, w)
  await d.ui.press({ key: 'role-QSL-coder' })
  const lines = await d.lines()
  const unscored = [
    ['CODE-R3 · unavailable · github.merged_prs: source returned no complete population for this window', '○', 'inactive'],
    ['CODE-R4 · not applicable · no pause producer', '◌', 'subtle'],
    ['CODE-J1 · judgement required · rubric CODE-RUBRIC-1', '▲', 'subtle'],
    ['CODE-R5 · unavailable · no reason given', '○', 'inactive'],
    ['CODE-R6 · deferred · a status of a later ix-board', '○', 'inactive'],
  ] as const
  for (const [text, mark, color] of unscored) {
    expect(lines).toContain(text)
    expect(await d.marked(text)).toEqual({ text: mark, color })
  }
  await d.ui.unmount()
})

test('no score and no trend are said, never 0, and a trend reads by its sign and size', async ($, on) => {
  trace("FR-031-AC-3")
  const scored = [rule('R', 'pass')]
  const w = await setup($, on, () => answer([
    role('none', [rule('N', 'unavailable')], 0, 0, null, null),
    role('down', scored, 1, 3, 1 / 3, -0.5),
    role('slight', scored, 249, 250, 0.996, 0.004),
    role('zero', [rule('Z', 'fail')], 0, 4, 0, -0.004),
  ]))
  const d = await draw($, w)
  const lines = await d.lines()
  const rowAt = (score: string) => lines.slice(lines.indexOf(score), lines.indexOf(score) + 2)
  expect(rowAt('no score')).toEqual(['no score', 'trend — · none in the answer'])
  expect(rowAt('33% · 1/3 passed')).toEqual(['33% · 1/3 passed', '↓ −50 pts'])
  expect(rowAt('99% · 249/250 passed')).toEqual(['99% · 249/250 passed', '↑ <1 pts'])
  expect(rowAt('0% · 0/4 passed')).toEqual(['0% · 0/4 passed', '↓ <1 pts'])
  expect(lines.filter(l => l.startsWith('0%'))).toHaveLength(1)
  await d.ui.unmount()
})

test('the trend says over how many rules it was compared', async ($, on) => {
  trace("FR-031-AC-13")
  const scored = [rule('R', 'pass')]
  const w = await setup($, on, () => answer([
    role('up', scored, 1, 1, 1, 0.5, 4),
    role('single', scored, 1, 2, 0.5, -0.25, 1),
    // A whole score now, and nothing scored in both windows: the answer's trend is null.
    role('unmatched', scored, 2, 2, 0.9, null, 0),
    role('older', scored, 3, 4, 0.75, 0.25),
  ]))
  const d = await draw($, w)
  const lines = await d.lines()
  const after = (score: string) => lines[lines.indexOf(score) + 1]
  expect(after('100% · 1/1 passed')).toBe('↑ +50 pts over 4 rules')
  expect(after('50% · 1/2 passed')).toBe('↓ −25 pts over 1 rule')
  expect(after('90% · 2/2 passed')).toBe('trend — · no rule scored in both windows')
  expect(after('75% · 3/4 passed')).toBe('↑ +25 pts')
  await d.ui.unmount()
})

test('a role is marked red when failing, amber when partly unavailable, hollow when unscored and green when sound', async ($, on) => {
  trace("FR-031-AC-4")
  const w = await setup($, on, () => answer([
    role('red', [rule('A', 'fail'), rule('B', 'unavailable')], 0, 1, 0, null),
    role('amber', [rule('C', 'pass'), rule('D', 'unavailable')], 1, 1, 1, null),
    role('hollow', [rule('E', 'not_applicable'), rule('F', 'judgement_required')], 0, 0, null, null),
    role('green', [rule('G', 'pass'), rule('H', 'pass'), rule('I', 'not_applicable'), rule('J', 'judgement_required')], 2, 2, 1, null),
  ]))
  const d = await draw($, w)
  expect(await d.marked('0% · 0/1 passed')).toEqual({ text: '●', color: 'error' })
  expect(await d.marked('100% · 1/1 passed')).toEqual({ text: '●', color: 'warning' })
  expect(await d.marked('no score')).toEqual({ text: '○', color: 'inactive' })
  expect(await d.marked('100% · 2/2 passed')).toEqual({ text: '●', color: 'success' })
  await d.ui.press({ key: 'role-QSL-green' })
  expect(await d.lines()).toContain('no failing rule')
  await d.ui.press({ key: 'role-QSL-green' })
  await d.ui.press({ key: 'role-QSL-hollow' })
  expect(await d.lines()).not.toContain('no failing rule')
  await d.ui.unmount()
})

test('the evaluation runs with the team config once in 30 minutes, however often the view is drawn', async ($, on) => {
  trace("FR-031-AC-5")
  const w = await setup($, on)
  const d = await draw($, w)
  expect(evals(w)).toEqual([evalOf('QSL')])
  await w.clock!.advance(28 * MIN)
  await d.ui.press({ key: 'refresh' })
  await w.clock!.advance(MIN)
  expect(evals(w)).toHaveLength(1)
  await w.clock!.advance(3 * MIN)
  expect(evals(w)).toHaveLength(2)
  await d.ui.unmount()
})

test('the one-line widget runs no evaluation', async ($, on) => {
  trace("FR-031-AC-5")
  const w = await setup($, on)
  const d = await draw($, w, 40 * MIN, 'widget')
  expect(evals(w)).toEqual([])
  await d.ui.unmount()
})

test('two teams are evaluated one at a time, the first drawn while the second runs', async ($, on) => {
  trace("FR-031-AC-5")
  const w = await setup($, on, (team, _, w) => w.clock!.sleep(2 * MIN).then(() => answer([role(`${team.toLowerCase()}-lead`, [rule('L', 'pass')], 1, 1, 1, null)])), w => {
    w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify({ focus: 'team', teams: ['QSL', 'ENG'] }))
  })
  const d = await draw($, w)
  expect(evals(w)).toEqual([evalOf('QSL')])
  await w.clock!.advance(2 * MIN)
  expect(evals(w)).toEqual([evalOf('QSL'), evalOf('ENG')])
  expect(await d.buttons()).toContain('▸ qsl-lead')
  expect(await d.buttons()).not.toContain('▸ eng-lead')
  await w.clock!.advance(3 * MIN)
  expect(await d.buttons()).toEqual(expect.arrayContaining(['▸ qsl-lead', '▸ eng-lead']))
  expect(evals(w)).toHaveLength(2)
  await d.ui.unmount()
})

/** What a session leaves in the gate file for the team's evaluation. */
const gateEntry = (entry: Record<string, unknown>, backoffUntil: number | null = null) => JSON.stringify({ backoffUntil, entries: { 'eval:QSL': entry } })
const KEPT = { report: { startMs: NOW - 25 * HOUR, endMs: NOW - HOUR, roles: [{ role: 'shared', passed: 1, evaluated: 1, passRate: 1, trend: null, rules: [] }] } }

test('an evaluation another session left in the gate file is drawn with no run', async ($, on) => {
  trace("FR-031-AC-6")
  const w = await setup($, on, undefined, w => void w.files.set(GATE, gateEntry({ at: NOW - 10 * MIN, claimAt: null, data: KEPT })))
  const d = await draw($, w)
  expect(await d.buttons()).toContain('▸ shared')
  expect(await d.lines()).toContain('24h window · ended 1h ago')
  expect(evals(w)).toEqual([])
  await d.ui.unmount()
})

test('an evaluation another session is running is waited for', async ($, on) => {
  trace("FR-031-AC-6")
  // Claimed four and a half minutes ago: past the gate's usual claim, within an evaluation's.
  const w = await setup($, on, undefined, w => void w.files.set(GATE, gateEntry({ at: null, claimAt: NOW - 4.5 * MIN, data: null })))
  const d = await draw($, w)
  expect(await d.lines()).toContain('another session is reading it')
  w.files.set(GATE, gateEntry({ at: NOW, claimAt: null, data: KEPT }))
  await w.clock!.advance(MIN)
  expect(await d.buttons()).toContain('▸ shared')
  expect(await d.lines()).not.toContain('another session is reading it')
  expect(evals(w)).toEqual([])
  await d.ui.unmount()
})

test('an ix-board with no retro eval says so, fails no source and is asked again after 5 minutes', async ($, on) => {
  trace("FR-031-AC-7")
  const w = await setup($, on, () => out('', 2, MISSING))
  const d = await draw($, w)
  expect(await d.lines()).toContain('this ix-board has no `retro eval` command')
  expect((await d.buttons()).filter(b => /^[▸▾] [a-z]/.test(b))).toEqual([])
  expect(await failed($)).toEqual([])
  await w.clock!.advance(4 * MIN)
  expect(evals(w)).toHaveLength(1)
  await w.clock!.advance(2 * MIN)
  expect(evals(w)).toHaveLength(2)
  await d.ui.unmount()
})

const noConfig = (team: string) => out('', 3, `retro config ${configOf(team)}: cannot read: No such file or directory (os error 2)\n`)

test('a team with no retro configuration reads no retro baseline, fails no source and is held for 30 minutes', async ($, on) => {
  trace("FR-031-AC-14")
  const w = await setup($, on, team => noConfig(team))
  const d = await draw($, w)
  expect(await d.lines()).toContain('no retro baseline')
  expect((await d.lines()).join('\n')).not.toMatch(/retro eval:|cannot read/)
  expect(await failed($)).toEqual([])
  await w.clock!.advance(29 * MIN)
  expect(evals(w)).toHaveLength(1)
  await w.clock!.advance(2 * MIN)
  expect(evals(w)).toHaveLength(2)
  await d.ui.unmount()
})

test('a configuration that is there and cannot be read is a failure', async ($, on) => {
  trace("FR-031-AC-14", "FR-031-AC-8")
  const w = await setup($, on, team => out('', 3, `retro config ${configOf(team)}: cannot read: Permission denied (os error 13)\n`))
  const d = await draw($, w)
  expect((await d.lines()).join('\n')).toMatch(/retro eval: retro config .*Permission denied/)
  expect(await failed($)).toHaveLength(1)
  await d.ui.unmount()
})

test('an expanded role lists its objective metrics with value and unit, or why there is none, never 0', async ($, on) => {
  trace("FR-031-AC-15")
  const objectives = [
    { id: 'CODE-M01', query: 'github.ticket_start_to_pr_open_median_hours', value: 3.5, status: 'pass', unit: 'hours', evidence_refs: [] },
    { id: 'CODE-M02', query: 'prom.share', value: null, status: 'unavailable', unit: 'ratio', evidence_refs: [], reason: 'no complete sample' },
    { id: 'CODE-M03', query: 'retro.prs_open', value: null, status: 'unavailable', unit: 'pull_requests', evidence_refs: [] },
  ]
  const w = await setup($, on, () => answer([{ ...CODER, objective_metrics: objectives }]))
  const d = await draw($, w)
  expect((await d.lines()).join('\n')).not.toContain('CODE-M01')
  await d.ui.press({ key: 'role-QSL-coder' })
  const lines = await d.lines()
  expect(lines).toContain('objective metrics')
  expect(lines).toContain('CODE-M01 · 3.5 hours · github.ticket_start_to_pr_open_median_hours')
  expect(lines).toContain('CODE-M02 · unavailable · no complete sample · prom.share')
  expect(lines).toContain('CODE-M03 · unavailable · no reason given · retro.prs_open')
  await d.ui.unmount()
})

const NO_SETTINGS = 'retro evaluation failed: /home/test/.local/state/team-retro/QSL/eval.json: No such file or directory (os error 2)'
for (const [why, failing, said] of [
  ['exits non-zero', () => out('', 3, `${NO_SETTINGS}\n`), NO_SETTINGS],
  ['refuses a flag', () => out('', 2, "error: unexpected argument '--since' found\n\nFor more information, try '--help'.\n"), "error: unexpected argument '--since' found"],
  ['is cut short', () => ({ ...answer([CODER]), isStdoutTruncated: true }), 'the answer was cut at 4 MiB'],
  ['is not a report', () => out('{"roles": 3}'), 'the answer is not a retro eval report'],
  ['is of another schema', () => answer([CODER], 3, 2), 'schema_version 2 is not one this mod reads'],
] as [string, () => Run, string][]) {
  test(`an evaluation that ${why} says so, marks the source failed and is soon asked again`, async ($, on) => {
    trace("FR-031-AC-8")
    const w = await setup($, on, failing)
    const d = await draw($, w)
    expect(await d.lines()).toContain(`retro eval: ${said}`)
    expect((await d.lines()).join('\n')).not.toMatch(/passed|no score/)
    expect(await failed($)).toEqual([expect.stringContaining(`QSL: ${said}`)])
    await w.clock!.advance(4 * MIN)
    expect(evals(w)).toHaveLength(1)
    await w.clock!.advance(2 * MIN)
    expect(evals(w)).toHaveLength(2)
    await d.ui.unmount()
  })
}

test('an evaluation is given 5 minutes, the rest of the view drawn meanwhile', async ($, on) => {
  trace("NFR-004-M-7", "FR-031-AC-5")
  const limits: (number | undefined)[] = []
  const w = await setup($, on, (_, init, w) => (limits.push(init?.timeoutMs), hangs(w, init)))
  const d = await draw($, w)
  expect(limits).toEqual([5 * MIN])
  expect(await d.lines()).toContain('reading the role evaluation, which can take minutes')
  expect(await d.lines()).toContain('QSL')
  await d.ui.unmount()
})

const timeouts: (number | undefined)[] = []
for (const [why, failing] of [
  // The test host drops the message of a call that throws; what is said is whatever the host says.
  ['times out', ((_, init, w) => (timeouts.push(init?.timeoutMs), hangs(w, init))) as Answering],
  ['fails after 11 seconds', ((_, __, w) => w.clock!.sleep(11 * SEC).then(() => out('', 1, 'boom'))) as Answering],
] as [string, Answering][]) {
  test(`an evaluation that ${why} is held for 30 minutes`, async ($, on) => {
    trace("FR-031-AC-8")
    const w = await setup($, on, failing)
    const d = await draw($, w, 6 * MIN)
    expect((await d.lines()).filter(l => l.startsWith('retro eval: '))).toHaveLength(1)
    expect(await failed($)).toHaveLength(1)
    if (why === 'times out') expect(timeouts).toEqual([5 * MIN])
    await w.clock!.advance(23 * MIN)
    expect(evals(w)).toHaveLength(1)
    await w.clock!.advance(8 * MIN)
    expect(evals(w)).toHaveLength(2)
    await d.ui.unmount()
  })
}

test('a refresh that fails keeps the earlier evaluation, with its age, under the error', async ($, on) => {
  trace("FR-031-AC-9")
  let runs = 0
  const w = await setup($, on, () => (++runs === 1 ? answer([CODER]) : out('', 1, 'linear is down')))
  const d = await draw($, w)
  await w.clock!.advance(32 * MIN)
  const lines = await d.lines()
  expect(evals(w)).toHaveLength(2)
  expect(lines.indexOf('retro eval: linear is down')).toBeGreaterThan(-1)
  expect(lines).toContain('24h window · ended 35m ago')
  expect(await d.buttons()).toContain('▸ coder')
  await d.ui.unmount()
})

test('the section says it is reading while the rest of the view is drawn, and a changed team is read at once', async ($, on) => {
  trace("FR-031-AC-10")
  const w = await setup($, on, (_, __, w) => w.clock!.sleep(2 * MIN).then(() => answer([CODER])))
  const d = await draw($, w)
  expect(await d.lines()).toContain('reading the role evaluation, which can take minutes')
  expect(await d.lines()).toContain('QSL')
  await w.clock!.advance(2 * MIN)
  expect(await d.buttons()).toContain('▸ coder')
  // Looked at again meanwhile, so nothing would be due for most of another minute.
  await w.clock!.advance(20 * SEC)
  w.files.set(`${FP}/features/draco_QSL_code.json`, JSON.stringify({ focus: 'team', teams: ['ENG'] }))
  await w.clock!.advance(20 * SEC)
  expect(evals(w).at(-1)).toBe(evalOf('ENG'))
  expect(await d.buttons()).toContain('Roles ▸')
  await d.ui.unmount()
})

test('under a Linear rate limit no evaluation runs and the section says reads are paused', async ($, on) => {
  trace("FR-031-AC-12")
  const w = await setup($, on, undefined, w => void w.files.set(GATE, gateEntry({ at: null, claimAt: null, data: null }, NOW + HOUR)))
  const d = await draw($, w)
  expect((await d.lines()).join('\n')).toMatch(/Linear.*(rate|limit|paused)/i)
  expect(evals(w)).toEqual([])
  await d.ui.unmount()
})

test('an evaluation that names no role says so', async ($, on) => {
  trace("FR-031-AC-12")
  const w = await setup($, on, () => answer([]))
  const d = await draw($, w)
  expect(await d.lines()).toContain('the evaluation names no role')
  await d.ui.unmount()
})
