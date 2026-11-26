import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DailyRow, RetroClass, RetroMeta, RetroView, TeamMeta, TeamMetric, TeamView } from '../types'
import { CARD_BG, ago, agoShort, errorText, promRange, spawn } from './shared'
import { ACCENT, daySpark, spark } from './ui/glyphs'
import type { Options, RangeSeries } from './shared'
import { track } from './schedule'
import { drawCapacity, pollCapacity } from './capacity'
import { headlineViews, selectedTeams, viewsOf } from './band/modules'
import { getSelection, home, scopeOf, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'

// The Team pane: for each team a few lines of figures from the ix_team_* series behind Grafana's "Team flow and effort"
// dashboard, each with its own name and history: tickets closed and PRs merged, what is in progress and blocked, what is
// ready, and how long review takes, with the rest behind `more`. Under the teams, each team's retro health in one line,
// and the fleet's hosts (hooks/capacity.tsx). A figure or line with no data is
// left out, and one `○` beside the team's name says what is missing and why when pressed.

const PANE = 'team'
const TITLE = 'Team'
export const PANE_SPEC = { id: PANE, title: TITLE }
const HISTORY_SECS = 6 * 3600
const STEP_SECS = 300

const teams = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-7' })
/** What is opened under the teams: `why-<team>`, `more-<team>` and `unkeyed-<id>`. */
const teamOpen = atom({ plugin: 'factory-panel', key: 'teamOpen' } as const, [] as string[])
/** Teams whose health line is opened. */
const retroOpen = atom({ plugin: 'factory-panel', key: 'retroOpen' } as const, [] as string[])
const retro = atom({ plugin: 'factory-panel', key: 'retro' } as const, [] as RetroView[], { shape: 'retro-1' })
const retroWarn = atom({ plugin: 'factory-panel', key: 'retroWarn' } as const, false)
const retroMeta = atom({ plugin: 'factory-panel', key: 'retroMeta' } as const, { at: null, error: null } as RetroMeta, { shape: 'retroMeta-1' })
const teamMeta = atom(
  { plugin: 'factory-panel', key: 'teamMeta' } as const,
  { at: null, error: null } as TeamMeta,
  { shape: 'teamMeta-1' },
)

/**
 * How the samples several exporter series of one team have at one time make one. `max` is for durations, ages and
 * shares. `largest` is for counts: scopes may count the same issues, PRs and agents, so theirs are not added; the
 * largest of one scope is a lower bound.
 */
type Combine = 'max' | 'largest'
type Spec = Omit<TeamMetric, 'value' | 'history' | 'coverage' | 'atLeast' | 'reason'> & { series: string; combine: Combine }

// Each figure is one series of the exporter, derived from nothing else.
const SPECS: Spec[] = [
  { key: 'wip', label: 'in progress', unit: 'count', series: 'ix_team_wip_active', combine: 'largest' },
  { key: 'blocked', label: 'blocked', unit: 'count', series: 'ix_team_blocked_issues', combine: 'largest' },
  { key: 'oldest', label: 'oldest', unit: 'seconds', series: 'ix_team_stage_oldest_age_seconds', combine: 'max' },
  { key: 'ready', label: 'ready', unit: 'count', series: 'ix_team_ready_issues', combine: 'largest' },
  { key: 'firstReview', label: 'first review', unit: 'seconds', series: 'ix_team_new_pr_first_review_median_seconds_24h', combine: 'max' },
  { key: 'cycle', label: 'PR cycle', unit: 'seconds', series: 'ix_team_pr_cycle_median_seconds_24h', combine: 'max' },
  { key: 'remaining', label: 'leaf remaining', unit: 'count', series: 'ix_team_scope_leaf_remaining', combine: 'largest' },
  { key: 'unmerged', label: 'ready unmerged PRs', unit: 'count', series: 'ix_team_prs_ready_unmerged', combine: 'largest' },
  { key: 'high', label: 'findings high', unit: 'count', series: 'ix_team_review_findings_confirmed_high_24h', combine: 'largest' },
  { key: 'medium', label: 'findings medium', unit: 'count', series: 'ix_team_review_findings_confirmed_medium_24h', combine: 'largest' },
  { key: 'low', label: 'findings low', unit: 'count', series: 'ix_team_review_findings_confirmed_low_24h', combine: 'largest' },
  { key: 'changes', label: 'changes requested', unit: 'share', series: 'ix_team_pr_changes_requested_share', combine: 'max' },
]

/** The lines of a team's figures under the daily counts, and what `more` holds. */
const LINES: string[][] = [['wip', 'blocked', 'oldest'], ['ready'], ['firstReview', 'cycle']]
const MORE = ['remaining', 'unmerged', 'high', 'medium', 'low', 'changes']
/** Points of a sparkline of the last six hours. */
const SPARK_CELLS = 12

const DAYS = 7
const NO_SERIES = 'no series published'
const NO_SAMPLE = 'no current sample'
/** The daily rows: the exporter's counts of each UTC day, numbered by `days_ago` with 0 for today. */
const DAILY: { key: keyof TeamView['days']; label: string; series: string }[] = [
  { key: 'closures', label: 'closed', series: 'ix_team_closures_day' },
  { key: 'merges', label: 'merged', series: 'ix_team_merged_prs_day' },
]
/** How much of its population the exporter measured, 0 to 1, for the series its `metric` label names. */
const COVERAGE = 'ix_team_metric_coverage'
/** Published for every scope of the exporter, so it names a team's scopes even where one counts nothing. */
const SCOPES = 'ix_team_source_available'

// Every figure stands in one grid: its name, its value right-aligned and its sparkline, each in a column of one width.
const NAME_CELLS = Math.max(...[...DAILY, ...SPECS].map(s => s.label.length))
const VALUE_CELLS = 7
export const FIGURE_CELLS = NAME_CELLS + 1 + VALUE_CELLS + 1 + SPARK_CELLS
/** Between the two figures of a line. */
const FIGURE_GAP = 2

/** How many figures stand on a line in a pane of `width` columns, the padding of a team's card taken off. */
const figuresAcross = (width: number): 1 | 2 => (width - 2 >= 2 * FIGURE_CELLS + FIGURE_GAP ? 2 : 1)

/** Reads the team series from Prometheus; false when it failed. */
export function pollTeam($: EngineInterface, options: Options): Promise<boolean> {
  return track($, 'team', () => readTeam($, options))
}

/**
 * The team each series belongs to: the `team_key` it carries, else the one key the other series of its exporter id
 * carry, else the id itself, which is no team key.
 */
function teamNamer(series: readonly RangeSeries[]): (s: RangeSeries) => { team: string; keyed: boolean } {
  const keys = new Map<string, Set<string>>()
  const idOf = (s: RangeSeries) => s.metric.team_id ?? 'unknown'
  for (const s of series) if (s.metric.team_key) keys.set(idOf(s), (keys.get(idOf(s)) ?? new Set<string>()).add(s.metric.team_key))
  return s => {
    const own = [...(keys.get(idOf(s)) ?? [])]
    const key = s.metric.team_key || (own.length === 1 ? own[0] : undefined)
    return key ? { team: key, keyed: true } : { team: idOf(s), keyed: false }
  }
}

/** One team's samples, oldest first, from its series: at each time those with the team key are used where any has one. */
function joined(series: readonly RangeSeries[]): [number, number][] {
  const keyed = new Map<number, number>()
  const keyless = new Map<number, number>()
  for (const s of series) {
    const into = s.metric.team_key ? keyed : keyless
    for (const [time, text] of s.values) {
      const value = Number(text)
      if (!Number.isFinite(value)) continue
      const had = into.get(time)
      into.set(time, had === undefined ? value : Math.max(had, value))
    }
  }
  return [...new Map([...keyless, ...keyed])].sort(([a], [b]) => a - b)
}

/** The value of samples now: the last one, where it is no older than a step. A series that stopped has none. */
function currentOf(samples: readonly [number, number][], now: number): number | null {
  const last = samples[samples.length - 1]
  return last !== undefined && now - last[0] <= STEP_SECS ? last[1] : null
}

/** One exporter scope of a team. */
const scopeIn = (s: RangeSeries): string => `${s.metric.team_id}/${s.metric.scope_id}`

/** The current values of a team's series, one for each distinct `part` of them, with the labels of one of its series. */
function currents(series: readonly RangeSeries[], part: (s: RangeSeries) => string, now: number): { labels: Record<string, string>; value: number }[] {
  const parts = new Map<string, RangeSeries[]>()
  for (const s of series) parts.set(part(s), [...(parts.get(part(s)) ?? []), s])
  return [...parts.values()].flatMap(same => {
    const value = currentOf(joined(same), now)
    return value === null ? [] : [{ labels: same[0]!.metric, value }]
  })
}

/** The largest sample of one scope at each time, each scope's own series joined as above. */
function largest(series: readonly RangeSeries[]): [number, number][] {
  const scopes = new Map<string, RangeSeries[]>()
  for (const s of series) scopes.set(scopeIn(s), [...(scopes.get(scopeIn(s)) ?? []), s])
  const most = new Map<number, number>()
  for (const own of scopes.values()) for (const [time, value] of joined(own)) most.set(time, Math.max(value, most.get(time) ?? value))
  return [...most].sort(([a], [b]) => a - b)
}

/**
 * A team's counts per day, oldest first and today last; `null` for a day with no current sample. Scopes may count the
 * same issues and PRs, so with several each day is the largest count of one, a lower bound.
 */
function dailyRow(series: readonly RangeSeries[], isShared: boolean, now: number): DailyRow {
  const counts = Array<number | null>(DAYS).fill(null)
  for (const { labels, value } of currents(series, s => `${scopeIn(s)}/${s.metric.days_ago}`, now)) {
    const ago = Number(labels.days_ago)
    if (!Number.isInteger(ago) || ago < 0 || ago >= DAYS) continue
    counts[DAYS - 1 - ago] = Math.max(counts[DAYS - 1 - ago] ?? 0, value)
  }
  return { counts, atLeast: isShared, reason: series.length === 0 ? NO_SERIES : NO_SAMPLE }
}

async function readTeam($: EngineInterface, options: Options): Promise<boolean> {
  const now = await $.clock.now()
  const seconds = Math.floor(now / 1000)
  try {
    const query = (promql: string, span: number, step: number) => promRange($, options.prometheusUrl, promql, span, step, 'team')
    // The daily counts and the coverage are drawn as they stand now, so one step of them is enough.
    const [tiles, daily, coverage, scopes] = await Promise.all([
      Promise.all(
        SPECS.map(async spec => {
          // A count is asked for scope by scope, since its scopes are not added.
          const by = spec.combine === 'largest' ? 'team_id, team_key, scope_id' : 'team_id, team_key'
          const promql = `max by (${by}) (${spec.series})`
          return { spec, series: await query(promql, HISTORY_SECS, STEP_SECS) }
        }),
      ),
      Promise.all(DAILY.map(async day => ({ day, series: await query(`max by (team_id, team_key, scope_id, days_ago) (${day.series})`, STEP_SECS, STEP_SECS) }))),
      query(`min by (team_id, team_key, scope_id, metric) (${COVERAGE})`, STEP_SECS, STEP_SECS),
      query(`max by (team_id, team_key, scope_id) (${SCOPES})`, STEP_SECS, STEP_SECS),
    ])
    const every = [...tiles.flatMap(r => r.series), ...daily.flatMap(r => r.series), ...coverage, ...scopes]
    const nameOf = teamNamer(every)
    // Every team any series names gets every tile: one the exporter lacks reads as unavailable, not as 0.
    const named = new Map<string, boolean>()
    for (const { team, keyed } of every.map(nameOf)) named.set(team, keyed || (named.get(team) ?? false))
    const views: TeamView[] = [...named]
      .map(([team, keyed]) => {
        const own = (series: readonly RangeSeries[]) => series.filter(s => nameOf(s).team === team)
        const measured = currents(own(coverage), s => `${scopeIn(s)}/${s.metric.metric}`, seconds)
        const byScope = [...tiles.filter(r => r.spec.combine === 'largest'), ...daily].flatMap(r => own(r.series))
        const isShared = new Set([...byScope, ...own(coverage), ...own(scopes)].filter(s => currentOf(joined([s]), seconds) !== null).map(scopeIn)).size > 1
        const metrics = tiles.map(({ spec, series }): TeamMetric => {
          const isCount = spec.combine === 'largest'
          const samples = isCount ? largest(own(series)) : joined(own(series))
          // A scope's last sample may be a step older than another's and still be what it counts now.
          const counts = isCount ? currents(own(series), scopeIn, seconds).map(c => c.value) : []
          const value = !isCount ? currentOf(samples, seconds) : counts.length === 0 ? null : Math.max(...counts)
          const name = spec.series.slice('ix_team_'.length)
          // The oldest stage age is measured stage by stage; the tile is only as covered as the least covered of them.
          const covered = measured.filter(({ labels }) => labels.metric === name || (spec.key === 'oldest' && labels.metric?.startsWith(`${name}_`))).map(m => m.value)
          const coverage = covered.length === 0 ? null : Math.min(...covered)
          // A stage not wholly measured may hold older work than any age shown, so the oldest age is a lower bound; with
          // a stage not measured at all and no age above zero, no age is known.
          const isStage = spec.key === 'oldest' && coverage !== null && coverage < 1
          const shown = isStage && coverage === 0 && !((value ?? 0) > 0) ? null : value
          // Why there is no value: the exporter publishes none for this team, measured none of it, or has stopped.
          const reason = shown !== null ? null : own(series).length === 0 ? NO_SERIES : value !== null ? 'age not measured' : NO_SAMPLE
          return { key: spec.key, label: spec.label, unit: spec.unit, value: shown, atLeast: shown !== null && (isStage || (isCount && isShared)), history: inCells(samples, seconds), coverage, reason }
        })
        const days = {} as TeamView['days']
        for (const { day, series } of daily) days[day.key] = dailyRow(own(series), isShared, seconds)
        return { team, keyed, metrics, days }
      })
      .sort((x, y) => x.team.localeCompare(y.team))
    await update($, teams, () => views)
    await update($, teamMeta, () => ({ at: now, error: null }))
    return true
  } catch (error) {
    await update($, teamMeta, m => ({ ...m, error: errorText(error) }))
    return false
  }
}

// ---------------------------------------------------------------- retro health

/** The selected teams, whose rows and retro health the Team view draws. */
const retroTeams = (): readonly string[] => selectedTeams(scopeOf(getSelection()))

const RETRO_TIMEOUT_MS = 10_000

/** Where a metric with no class of its own is drawn, among metrics that have one. */
const UNCLASSIFIED = 'unclassified'
/** The first ix-board whose delta names each metric's class. */
const NEEDS_CLASS = 'needs ix-board ≥0.11.0'

type DeltaMetric = { id?: unknown; class?: unknown; status?: unknown; regressing?: unknown }
type Delta = { latest?: unknown; metrics?: unknown }

const classOf = (m: DeltaMetric): string | null => (typeof m.class === 'string' && m.class !== '' ? m.class : null)

/**
 * One entry per class the delta's metrics name, in the order first named, those with none last: red where any metric
 * regresses, otherwise amber where some metric has no value, unknown where none has, else green.
 */
export function classesOf(metrics: readonly DeltaMetric[]): RetroClass[] {
  const by = new Map<string, DeltaMetric[]>()
  for (const m of metrics) {
    const cls = classOf(m) ?? UNCLASSIFIED
    by.set(cls, [...(by.get(cls) ?? []), m])
  }
  return [...by]
    .sort(([a], [b]) => Number(a === UNCLASSIFIED) - Number(b === UNCLASSIFIED))
    .map(([id, members]) => {
      const regressing = members.filter(m => m.regressing === true).map(m => String(m.id))
      const unavailable = members.filter(m => m.status !== 'ok').length
      const rating: RetroClass['rating'] = regressing.length > 0 ? 'red' : unavailable === members.length ? 'unknown' : unavailable > 0 ? 'amber' : 'green'
      return { id, rating, regressing, unavailable, total: members.length }
    })
}

/** ix-board's exit code for a retro config it cannot read: the team has no retro. */
const NO_CONFIG_EXIT = 3

/** One team's retro health. Only an unreadable config is "no retro baseline"; any other failure is an `error` to warn about. */
async function readRetroTeam($: EngineInterface, dir: string, team: string): Promise<{ view: RetroView; error: string | null }> {
  const none = (reason: string, error: string | null): { view: RetroView; error: string | null } => ({ view: { team, classes: null, latest: null, reason }, error })
  try {
    // Only the stored snapshots are read: the delta makes no network call.
    const ran = await spawn($, ['ix-board', '--json', 'retro', 'delta', '--config', `${dir}/${team}/config.json`], RETRO_TIMEOUT_MS, 'retro')
    if (ran.exitCode === NO_CONFIG_EXIT) return none('no retro baseline', null)
    if (ran.exitCode !== 0) return none('retro unavailable', `${team}: ${ran.stderr.trim().split('\n').pop() || `ix-board exited ${ran.exitCode}`}`)
    const delta = JSON.parse(ran.stdout) as Delta
    if (!Array.isArray(delta.metrics)) return none('retro unavailable', `${team}: the delta has no metrics`)
    const metrics = delta.metrics as DeltaMetric[]
    // Fewer than two snapshots make no delta, and an older ix-board names no class: neither is a failure.
    if (metrics.length === 0) return none('no retro delta yet', null)
    if (metrics.every(m => classOf(m) === null)) return none(NEEDS_CLASS, null)
    return { view: { team, classes: classesOf(metrics), latest: typeof delta.latest === 'string' ? delta.latest : null, reason: null }, error: null }
  } catch (error) {
    return none('retro unavailable', `${team}: ${errorText(error)}`)
  }
}

/** Reads each selected team's retro delta. A team with no config has no baseline, which is not a failure; any other failure is the source's error. */
export function pollRetro($: EngineInterface): Promise<boolean> {
  return track($, 'retro', async () => {
    try {
      // Which teams are asked for is the session's scope, which waits for its identity.
      await selectionReady()
      const now = await $.clock.now()
      const dir = `${await home($)}/.local/state/team-retro`
      const reads = await Promise.all(retroTeams().map(team => readRetroTeam($, dir, team)))
      const errors = reads.flatMap(r => (r.error === null ? [] : [r.error]))
      await update($, retro, () => reads.map(r => r.view))
      await update($, retroMeta, () => ({ at: now, error: errors.length === 0 ? null : errors.join(' · ') }))
      if (errors.length === 0) sourceOk('ix-board retro', now)
      else sourceFailed('ix-board retro', errors.join(' · '))
      return errors.length === 0
    } catch (error) {
      await update($, retroMeta, m => ({ ...m, error: errorText(error) }))
      sourceFailed('ix-board retro', errorText(error))
      return false
    }
  })
}

const RATING_COLOR: Record<RetroClass['rating'], string> = { red: 'error', amber: 'warning', green: 'success', unknown: 'inactive' }

const format = (m: TeamMetric): string => {
  if (m.value === null) return '—'
  return `${m.atLeast ? '≥' : ''}${plain(m, m.value)}`
}

const plain = (m: TeamMetric, value: number): string => {
  if (m.unit === 'seconds') {
    const h = value / 3600
    if (h >= 48) return `${Math.round(h / 24)}d`
    return h >= 1 ? `${h.toFixed(h >= 10 ? 0 : 1)}h` : `${Math.round(value / 60)}m`
  }
  if (m.unit === 'share') return `${Math.round(value * 100)}%`
  if (m.unit === 'rate') return value.toFixed(value >= 10 ? 0 : 1)
  return Math.round(value).toLocaleString('en-US')
}

/** The last sample of each of the SPARK_CELLS parts of the `span` seconds ending at `end`; null where a part has none. */
const inCells = (samples: readonly [number, number][], end: number): (number | null)[] => {
  const cells = Array<number | null>(SPARK_CELLS).fill(null)
  for (const [time, value] of samples) {
    const i = Math.floor(((time - (end - HISTORY_SECS)) / HISTORY_SECS) * SPARK_CELLS)
    if (i >= 0) cells[Math.min(i, SPARK_CELLS - 1)] = value
  }
  return cells
}

/** A cell's block, scaled over the cells that have a sample, and `·` for one that has none; '' where none has. */
const trailOf = (cells: readonly (number | null)[]): string => {
  const blocks = [...spark(cells.flatMap(v => v ?? []))]
  if (blocks.length === 0) return ''
  return cells.map(v => (v === null ? '·' : blocks.shift()!)).join('')
}

const configOf = (team: string): string => `~/.local/state/team-retro/${team}/config.json`

/** The mark of a team's retro: its worst class's colour, hollow with no retro. */
function healthMark(v: RetroView): { mark: string; color: string } {
  if (v.classes === null) return { mark: '○', color: 'inactive' }
  const worst = (['red', 'amber', 'green'] as const).find(r => v.classes!.some(c => c.rating === r)) ?? 'unknown'
  return { mark: '◔', color: RATING_COLOR[worst] }
}

/** The line's words: how old the retro is, or that there is none. */
function healthWords(v: RetroView, now: number): string {
  if (v.classes === null) return 'no retro'
  const at = v.latest === null ? NaN : Date.parse(v.latest)
  return Number.isFinite(at) ? `retro ${agoShort(at, now)}` : 'retro'
}

/** What an opened health line says: what it checks, what regresses, when it last ran and the command that runs it. */
function healthDetail(v: RetroView): string[] {
  const command = `run: ix-board retro snapshot --config ${configOf(v.team)}`
  if (v.classes === null) return [`checks each department’s metrics against stored retro snapshots`, v.reason ?? 'no retro baseline', command]
  const total = v.classes.reduce((n, c) => n + c.total, 0)
  const regressing = v.classes.flatMap(c => c.regressing.map(id => `${c.id}: ${id.replaceAll('_', ' ')}`))
  const unread = v.classes.filter(c => c.unavailable > 0).map(c => `${c.id} ${c.unavailable}`)
  return [
    `checks ${total} metrics of ${v.classes.map(c => c.id).join(', ')} against stored retro snapshots`,
    ...(regressing.length === 0 ? ['nothing regresses'] : regressing.map(r => `regressing ${r}`)),
    ...(unread.length === 0 ? [] : [`no value: ${unread.join(', ')}`]),
    `last run ${v.latest ?? 'not said'}`,
    command,
  ]
}

/** Registers the command; called once at session start. register.tsx opens the pane, and hooks/visible.ts reads while it is drawn. */
export async function startTeam($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'team', description: 'Same as /factory team' })
}

export function registerTeam(on: On, options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const [list, meta, health, open, rmeta, warnOpen, opened] = await Promise.all([read($, teams), read($, teamMeta), read($, retro), read($, retroOpen), read($, retroMeta), read($, retroWarn), read($, teamOpen)])
    const selected = retroTeams()
    const { shown, unmatched, missing } = viewsOf(list, selected)
    const now = await $.clock.now()
    const dashboard = `${options.grafanaUrl.replace(/\/$/, '')}/d/ix-team-flow-effort`

    if (e.props.placement === 'widget') {
      const headline = headlineViews(list, selected)
      const today = headline.map(t => ({ n: t.days.closures.counts[DAYS - 1] ?? null, atLeast: t.days.closures.atLeast }))
      const known = today.flatMap(d => (d.n === null ? [] : [{ n: d.n, atLeast: d.atLeast }]))
      // A team with no count, or only a lower bound, makes the sum one, as does a selected team with no series beside
      // one that has; with no count at all it is unknown, not 0.
      const isBound = known.length < today.length || known.some(d => d.atLeast) || (shown.length > 0 && missing.length > 0)
      // Series that carry no selected key are not known to be the selected teams': no number is read from them.
      const isUnmatched = list.length > 0 && selected.length > 0 && shown.length === 0
      const total = isUnmatched || known.length === 0 ? '—' : `${isBound ? '≥' : ''}${known.reduce((a, d) => a + d.n, 0)}`
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{`${total} closed today`}</Text>
        </Box>
      )
    }

    const press = (key: string) => () => void update($, teamOpen, l => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))
    const lines = (key: string, words: readonly string[]) => (opened.includes(key) ? words.map(w => <Text key={`${key}-${w}`} dimColor size="caption">{`  ${w}`}</Text>) : null)
    /** A name with, where something is missing, the one `○` that says what and why. */
    const heading = (key: string, name: string, why: readonly string[], before: unknown = null, note = '') => (
      <Box key={`head-${name}`} flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
          {before as never}
          <Text weight="semibold">{name}</Text>
          {note !== '' && <Text dimColor size="caption">{note}</Text>}
          {why.length > 0 && <Button key={key} plain label="○" onPress={press(key)} />}
        </Box>
        {lines(key, why)}
      </Box>
    )

    const across = figuresAcross(e.props.bodyColumns ?? 100)
    const figure = (key: string, label: string, value: string | null, trail: string) => (
      <Box key={key} flexDirection="row" gap={1} width={FIGURE_CELLS} flexShrink={0}>
        <Box flexDirection="row" width={NAME_CELLS} flexShrink={0}>
          <Text dimColor wrap="truncate-end">{label}</Text>
        </Box>
        <Box flexDirection="row" width={VALUE_CELLS} justifyContent="flex-end" flexShrink={0}>
          {value !== null && <Text weight="semibold" tabular>{value}</Text>}
        </Box>
        <Box flexDirection="row" width={SPARK_CELLS} flexShrink={0}>
          {trail !== '' && <Text color={ACCENT}>{trail}</Text>}
        </Box>
      </Box>
    )
    const metricOf = (t: TeamView, key: string): TeamMetric => t.metrics.find(m => m.key === key)!
    const metricFigure = (t: TeamView, m: TeamMetric) => figure(`${t.team}-${m.key}`, m.label, format(m), trailOf(m.history))
    const absent = (m: TeamMetric) => `${m.label}: ${m.reason}`

    /** The daily counts that have a day to draw. */
    const dailyFigures = (t: TeamView) =>
      DAILY.flatMap(day => {
        const { counts, atLeast } = t.days[day.key]
        const today = counts[DAYS - 1] ?? null
        return counts.every(v => v === null) ? [] : [figure(`${t.team}-${day.key}`, day.label, today === null ? null : `${atLeast ? '≥' : ''}${today}`, daySpark(counts))]
      })

    /** Everything the team lacks, `more` included, and why. */
    const missingOf = (t: TeamView): string[] => [
      ...DAILY.flatMap(day => {
        const { counts, reason } = t.days[day.key]
        if (counts.every(v => v === null)) return [`${day.label}: ${reason}`]
        return (counts[DAYS - 1] ?? null) === null ? [`${day.label} today: no current sample`] : []
      }),
      ...[...LINES.flat(), ...MORE].map(k => metricOf(t, k)).filter(m => m.value === null).map(absent),
    ]

    /** The figures of one group, at most `across` to a line, so that each starts in the column of the one above it. */
    const grid = (key: string, figures: readonly unknown[]) =>
      figures.length === 0 ? null : (
        <Box key={key} flexDirection="column">
          {Array.from({ length: Math.ceil(figures.length / across) }, (_, i) => (
            <Box key={`${key}-${i}`} flexDirection="row" gap={FIGURE_GAP}>
              {figures.slice(i * across, (i + 1) * across) as never}
            </Box>
          ))}
        </Box>
      )

    const more = (t: TeamView) => {
      const key = `more-${t.team}`
      const held = MORE.map(k => metricOf(t, k)).filter(m => m.value !== null)
      const covered = t.metrics.flatMap(m => (m.coverage !== null && m.coverage < 1 ? [`${m.label}: ${Math.floor(m.coverage * 100 + 1e-9)}% covered`] : []))
      if (held.length === 0 && covered.length === 0) return null
      return (
        <Box key={`${t.team}-more`} flexDirection="column">
          <Button key={key} plain label={`${opened.includes(key) ? '▾' : '▸'} more`} onPress={press(key)} />
          {opened.includes(key) && grid(`${key}-figures`, held.map(m => metricFigure(t, m)))}
          {lines(key, covered)}
        </Box>
      )
    }

    const rows = (t: TeamView) => (
      <Box key={`${t.team}-rows`} flexDirection="column">
        {grid(`${t.team}-daily`, dailyFigures(t))}
        {LINES.map(keys => grid(`${t.team}-${keys[0]}`, keys.map(k => metricOf(t, k)).filter(m => m.value !== null).map(m => metricFigure(t, m))))}
        {more(t)}
      </Box>
    )

    // An id with no key may be any team: one closed line, which opens to its figures.
    const unmatchedTeam = (t: TeamView) => {
      const key = `unkeyed-${t.team}`
      return (
        <Box key={t.team} flexDirection="column">
          {heading(`why-${t.team}`, t.team, missingOf(t), <Button key={key} plain label={opened.includes(key) ? '▾' : '▸'} onPress={press(key)} />, 'no team key')}
          {/* Indented as far as a team's card is, so that these figures stand in the same columns. */}
          {opened.includes(key) && <Box flexDirection="column" paddingLeft={1}>{rows(t)}</Box>}
        </Box>
      )
    }

    const unkeyedWhy = unmatched.length > 0 ? ['ids with no team_key (published from ix-board 0.12.0) cannot be told apart'] : []
    const noSeries = list.length === 0 ? [meta.error ?? 'Prometheus has no ix_team_* series'] : []

    const healthLine = (v: RetroView) => {
      const isOpen = open.includes(v.team)
      const { mark, color } = healthMark(v)
      const title = health.length > 1 ? `Health · ${v.team}` : 'Health'
      return (
        <Box key={`health-${v.team}`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={color}>{mark}</Text>
            <Button key={`retro-${v.team}`} plain label={`${title}  ${healthWords(v, now)} ${isOpen ? '▾' : '▸'}`} onPress={() => void update($, retroOpen, l => (l.includes(v.team) ? l.filter(x => x !== v.team) : [...l, v.team]))} />
          </Box>
          {isOpen && healthDetail(v).map(line => <Text key={line} dimColor size="caption">{`  ${line}`}</Text>)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="semibold" size="heading">
            Team
          </Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Link href={dashboard} label="Grafana" />
            <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void Promise.all([pollTeam($, options), pollCapacity($, options)])} />
          </Box>
        </Box>

        {meta.at === null && meta.error === null && <Text dimColor size="caption">reading…</Text>}
        {list.length === 0 && selected.length === 0 && (meta.at !== null || meta.error !== null) && heading('why-teams', 'Teams', noSeries)}
        {shown.map(t => (
          <Box key={t.team} flexDirection="column" padding={1} backgroundColor={CARD_BG}>
            {heading(`why-${t.team}`, t.team, missingOf(t), null, t.keyed ? '' : 'no team key')}
            {rows(t)}
          </Box>
        ))}
        {(meta.at !== null || meta.error !== null) && missing.map(name => (
          <Box key={name} flexDirection="column" padding={1} backgroundColor={CARD_BG}>
            {heading(`why-${name}`, name, [`no team series carries the key ${name}`, ...noSeries, ...unkeyedWhy])}
          </Box>
        ))}
        {unmatched.map(unmatchedTeam)}

        <Box key="health" flexDirection="column">
          {health.map(healthLine)}
          {health.length === 0 && <Text dimColor>{rmeta.at === null && rmeta.error === null ? '○ Health  reading' : '○ Health  no team'}</Text>}
        </Box>
        {await drawCapacity($, els)}

        {rmeta.error !== null && warnOpen && rmeta.error.split(' · ').map(x => <Text key={x} color="warning" size="caption">{`ix-board retro: ${x}`}</Text>)}
        <Box flexDirection="row" justifyContent="flex-end" gap={2} alignItems="center">
          {rmeta.error !== null && (
            <Box key="warnings-chip" flexDirection="row" gap={1}>
              <Text color="warning">⚠</Text>
              <Button key="warnings-toggle" plain label={String(rmeta.error.split(' · ').length)} onPress={() => void update($, retroWarn, v => !v)} />
            </Box>
          )}
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
            {meta.error ?? `updated ${ago(meta.at, now)}`}
          </Text>
        </Box>
        {e.props.placement === 'inline' && (
          <Text dimColor size="caption">
            Type a band number to switch views · r refresh · Esc close
          </Text>
        )}
      </Box>
    )
  })
}
