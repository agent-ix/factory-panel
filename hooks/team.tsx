import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DailyRow, RetroClass, RetroMeta, RetroView, TeamMeta, TeamMetric, TeamView } from '../types'
import { CARD_BG, INK, ago, errorText, promRange, sparkline } from './shared'
import { ACCENT, dots } from './ui/glyphs'
import type { Options, RangeSeries } from './shared'
import { track } from './schedule'
import { drawCapacity, pollCapacity } from './capacity'
import { headlineViews, viewsOf } from './band/modules'
import { drawRoles, retroTeams } from './roles'
import { home, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'

// The Team pane: coder velocity, review quality and flow per team, from the same ix_team_* series as
// Grafana's "Team flow and effort" dashboard, each tile with six hours of history and how much of its population was
// measured, the completed issues and merged PRs of each of the last seven days, and above them the health of each
// selected team's departments from its stored retro snapshots and its role evaluations (hooks/roles.tsx). Between
// those and the teams stands the fleet's capacity by host (hooks/capacity.tsx).

const PANE = 'team'
const TITLE = 'Team'
export const PANE_SPEC = { id: PANE, title: TITLE }
const HISTORY_SECS = 6 * 3600
const STEP_SECS = 300

const teams = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-5' })
/** The exporter ids with no team key whose tiles are open. */
const teamOpen = atom({ plugin: 'factory-panel', key: 'teamOpen' } as const, [] as string[])
/** Teams whose health strip lists its regressing metrics. */
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

// Velocity and effort, then review quality, then flow and capacity. Each tile is one series of the exporter, derived
// from nothing else: one it does not publish stays in its row as a tile reading "—", never 0.
const SPECS: Spec[] = [
  { key: 'closures', group: 'velocity', label: 'Verified closures · 24h', unit: 'count', better: 'up', series: 'ix_team_verified_path_closed_24h', combine: 'largest' },
  { key: 'effort', group: 'velocity', label: 'Effort per closure', unit: 'seconds', better: 'down', series: 'ix_team_effort_per_verified_path_closure_seconds_24h', combine: 'max' },
  { key: 'merges', group: 'velocity', label: 'PR merges / hour', unit: 'rate', better: 'up', series: 'ix_team_pr_merges_per_hour_24h', combine: 'largest' },
  { key: 'cycle', group: 'velocity', label: 'PR cycle · median', unit: 'seconds', better: 'down', series: 'ix_team_pr_cycle_median_seconds_24h', combine: 'max' },
  { key: 'firstReview', group: 'review', label: 'First review · median', unit: 'seconds', better: 'down', series: 'ix_team_new_pr_first_review_median_seconds_24h', combine: 'max' },
  { key: 'findingsShare', group: 'review', label: 'PRs with findings', unit: 'share', better: 'down', series: 'ix_team_review_prs_with_findings_share_24h', combine: 'max' },
  { key: 'high', group: 'review', label: 'Confirmed findings · high', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_high_24h', combine: 'largest' },
  { key: 'medium', group: 'review', label: 'Confirmed findings · medium', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_medium_24h', combine: 'largest' },
  { key: 'low', group: 'review', label: 'Confirmed findings · low', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_low_24h', combine: 'largest' },
  { key: 'changes', group: 'review', label: 'Changes requested', unit: 'share', better: 'down', series: 'ix_team_pr_changes_requested_share', combine: 'max' },
  { key: 'remaining', group: 'flow', label: 'Leaf work remaining', unit: 'count', better: 'down', series: 'ix_team_scope_leaf_remaining', combine: 'largest' },
  { key: 'wip', group: 'flow', label: 'Work in progress', unit: 'count', better: 'down', series: 'ix_team_wip_active', combine: 'largest' },
  { key: 'blocked', group: 'flow', label: 'Blocked', unit: 'count', better: 'down', series: 'ix_team_blocked_issues', combine: 'largest' },
  { key: 'unmerged', group: 'flow', label: 'Ready, unmerged PRs', unit: 'count', better: 'down', series: 'ix_team_prs_ready_unmerged', combine: 'largest' },
  { key: 'oldest', group: 'flow', label: 'Oldest in a stage', unit: 'seconds', better: 'down', series: 'ix_team_stage_oldest_age_seconds', combine: 'max' },
  { key: 'ready', group: 'flow', label: 'Ready issues', unit: 'count', better: 'up', series: 'ix_team_ready_issues', combine: 'largest' },
  { key: 'agents', group: 'flow', label: 'Executing agents', unit: 'count', better: 'up', series: 'ix_team_executing_agents', combine: 'largest' },
]

const DAYS = 7
const NO_SERIES = 'no series published'
const NO_SAMPLE = 'no current sample'
/** The daily rows: the exporter's counts of each UTC day, numbered by `days_ago` with 0 for today. */
const DAILY: { key: keyof TeamView['days']; label: string; series: string }[] = [
  { key: 'closures', label: 'Completed', series: 'ix_team_closures_day' },
  { key: 'merges', label: 'Merged PRs', series: 'ix_team_merged_prs_day' },
]
/** How much of its population the exporter measured, 0 to 1, for the series its `metric` label names. */
const COVERAGE = 'ix_team_metric_coverage'
/** Published for every scope of the exporter, so it names a team's scopes even where one counts nothing. */
const SCOPES = 'ix_team_source_available'

const GROUPS: { id: TeamMetric['group']; title: string }[] = [
  { id: 'velocity', title: 'Velocity and effort' },
  { id: 'review', title: 'Review quality' },
  { id: 'flow', title: 'Flow and capacity' },
]

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
    const query = (promql: string, span: number, step: number) => promRange($, options.prometheusUrl, promql, span, step)
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
          return { key: spec.key, group: spec.group, label: spec.label, unit: spec.unit, better: spec.better, value: shown, atLeast: shown !== null && (isStage || (isCount && isShared)), history: samples.map(([, v]) => v), coverage, reason }
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
    const ran = await $.process.run(['ix-board', '--json', 'retro', 'delta', '--config', `${dir}/${team}/config.json`], { timeoutMs: RETRO_TIMEOUT_MS })
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

const RATING_MARK: Record<RetroClass['rating'], { mark: string; color: string }> = {
  red: { mark: '●', color: 'error' },
  amber: { mark: '●', color: 'warning' },
  green: { mark: '●', color: 'success' },
  unknown: { mark: '○', color: 'inactive' },
}

const format = (m: TeamMetric): string => {
  if (m.value === null) return '—'
  return `${m.atLeast ? '≥' : ''}${plain(m, m.value)}`
}

const plain = (m: TeamMetric, value: number): string => {
  if (m.unit === 'seconds') {
    const h = value / 3600
    return h >= 1 ? `${h.toFixed(h >= 10 ? 0 : 1)}h` : `${Math.round(value / 60)}m`
  }
  if (m.unit === 'share') return `${Math.round(value * 100)}%`
  if (m.unit === 'rate') return value.toFixed(value >= 10 ? 0 : 1)
  return Math.round(value).toLocaleString('en-US')
}

/**
 * How yesterday, the newest whole day, compares with the average of the earlier days that have a value. Null where
 * yesterday has none, or where the counts are lower bounds, which say nothing of rise or fall.
 */
function dayTrend({ counts, atLeast }: DailyRow): { mark: string; color: string; text: string } | null {
  const newest = counts[DAYS - 2]
  if (atLeast || newest === null || newest === undefined) return null
  const earlier = counts.slice(0, DAYS - 2).filter((v): v is number => v !== null)
  if (earlier.length === 0) return { mark: '', color: 'subtle', text: 'no earlier day' }
  const average = earlier.reduce((a, b) => a + b, 0) / earlier.length
  const [mark, color] = newest > average ? ['↑', 'success'] : newest < average ? ['↓', 'warning'] : ['=', 'subtle']
  return { mark, color, text: `prior avg ${average.toFixed(1)}` }
}

/** The trend's colour: calm when it moves the right way or holds, amber when it moves the wrong way. */
const trendInk = (m: TeamMetric): string => {
  const first = m.history[0]
  const last = m.history[m.history.length - 1]
  if (first === undefined || last === undefined || first === last) return INK.calm
  const rising = last > first
  return rising === (m.better === 'up') ? INK.calm : INK.warning
}

/** Registers the command; called once at session start. register.tsx opens the pane, and hooks/visible.ts reads while it is drawn. */
export async function startTeam($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'team', description: 'Same as /factory team' })
}

export function registerTeam(on: On, options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const [list, meta, health, open, rmeta, warnOpen, opened] = await Promise.all([read($, teams), read($, teamMeta), read($, retro), read($, retroOpen), read($, retroMeta), read($, retroWarn), read($, teamOpen)])
    const selected = retroTeams()
    const { shown, unmatched, missing } = viewsOf(list, selected)
    const now = await $.clock.now()
    const dashboard = `${options.grafanaUrl.replace(/\/$/, '')}/d/ix-team-flow-effort`

    if (e.props.placement === 'widget') {
      const headline = headlineViews(list, selected)
      const closures = headline.map(t => t.metrics.find(m => m.key === 'closures'))
      const known = closures.flatMap(m => (m === undefined || m.value === null ? [] : [{ value: m.value, atLeast: m.atLeast }]))
      // A team with no reading, or only a lower bound, makes the sum one, as does a selected team with no series beside
      // one that has; with no reading at all it is unknown, not 0.
      const isBound = known.length < closures.length || known.some(m => m.atLeast) || (shown.length > 0 && missing.length > 0)
      const total = known.length === 0 ? '—' : `${isBound ? '≥' : ''}${Math.round(known.reduce((a, m) => a + m.value, 0))}`
      const why = known.length > 0 ? '' : ` · ${closures.find(m => m !== undefined && m.reason !== null)?.reason ?? NO_SERIES}`
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{headline.length > 0 ? `${total} closures / 24h${why}` : 'no team metrics'}</Text>
        </Box>
      )
    }

    const tile = (team: string, m: TeamMetric) => (
      <Box key={`${team}-${m.key}`} flexDirection="column" minWidth={20} flexGrow={1} padding={1} backgroundColor={CARD_BG}>
        <Text dimColor size="caption">
          {m.label}
        </Text>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="title" tabular>
              {format(m)}
            </Text>
            {m.coverage !== null && m.coverage < 1 && <Text dimColor size="caption">{`${Math.floor(m.coverage * 100 + 1e-9)}% covered`}</Text>}
          </Box>
          {!Svg && m.history.length > 0 && <Text color={ACCENT}>{dots(m.history.slice(-24), 1)[0]}</Text>}
          {Svg && (
            <Svg
              source={sparkline(m.history, trendInk(m))}
              alt={`${m.label}, last six hours, now ${format(m)}`}
              width={104}
              height={26}
            />
          )}
        </Box>
        {m.reason !== null && <Text dimColor size="caption">{m.reason}</Text>}
      </Box>
    )

    const dailyRows = (t: TeamView) => (
      <Box key={`${t.team}-daily`} flexDirection="column">
        <Text dimColor size="caption">
          {`Per UTC day · today so far at right · trend is yesterday’s${DAILY.some(day => t.days[day.key].counts.includes(null)) ? ' · — no current sample' : ''}`}
        </Text>
        {DAILY.map(day => {
          const { counts, atLeast } = t.days[day.key]
          const trend = dayTrend(t.days[day.key])
          const cells = counts.map(v => (v === null ? '—' : `${atLeast ? '≥' : ''}${v}`))
          const cell = Math.max(4, ...cells.map(c => c.length + 1))
          // A row with no day at all says why; what a dash among counts means is in the caption.
          const note = counts.every(v => v === null) ? t.days[day.key].reason : null
          return (
            <Box key={`${t.team}-daily-${day.key}`} flexDirection="row" gap={1}>
              <Box width={10}>
                <Text dimColor>{day.label}</Text>
              </Box>
              <Text tabular>{cells.map(c => c.padStart(cell)).join('')}</Text>
              {trend !== null && trend.mark !== '' && <Text color={trend.color}>{trend.mark}</Text>}
              {trend !== null && <Text dimColor>{trend.text}</Text>}
              {note !== null && <Text dimColor size="caption">{note}</Text>}
            </Box>
          )
        })}
      </Box>
    )

    const tiles = (t: TeamView) =>
      GROUPS.map(g => (
        <Box key={g.id} flexDirection="column">
          <Text dimColor size="caption">{g.title}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {t.metrics.filter(m => m.group === g.id).map(m => tile(t.team, m))}
          </Box>
          {g.id === 'velocity' && dailyRows(t)}
        </Box>
      ))

    // An id with no key may be any team: one closed row says what it has, and opens to its tiles.
    const unmatchedTeam = (t: TeamView) => {
      const isOpen = opened.includes(t.team)
      const valued = t.metrics.filter(m => m.value !== null).length
      return (
        <Box key={t.team} flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <Button key={`unkeyed-${t.team}`} plain label={isOpen ? '▾' : '▸'} onPress={() => void update($, teamOpen, l => (l.includes(t.team) ? l.filter(x => x !== t.team) : [...l, t.team]))} />
            <Text weight="semibold">{t.team}</Text>
            <Text dimColor size="caption">exporter id, no team key</Text>
            <Text dimColor size="caption">{`${valued} of ${t.metrics.length} metrics have a value`}</Text>
          </Box>
          {isOpen && tiles(t)}
        </Box>
      )
    }

    const healthStrip = (v: RetroView) => {
      const isOpen = open.includes(v.team)
      const regressing = v.classes?.flatMap(c => c.regressing.map(id => `${c.id}: ${id.replaceAll('_', ' ')}`)) ?? []
      return (
        <Box key={`health-${v.team}`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <Text dimColor size="caption">Health · {v.team}</Text>
            {v.classes === null && <Text dimColor>{v.reason ?? 'no retro baseline'}</Text>}
            {v.classes?.map(c => (
              <Box key={c.id} flexDirection="row" gap={1}>
                <Text color={RATING_MARK[c.rating].color}>{RATING_MARK[c.rating].mark}</Text>
                <Text size="caption">{c.id}</Text>
              </Box>
            ))}
            {regressing.length > 0 && (
              <Button key={`retro-${v.team}`} plain label={isOpen ? '▾ regressing' : `▸ ${regressing.length} regressing`} onPress={() => void update($, retroOpen, l => (l.includes(v.team) ? l.filter(x => x !== v.team) : [...l, v.team]))} />
            )}
          </Box>
          {isOpen && regressing.map(r => <Text key={r} color="warning" size="caption">{r}</Text>)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">
              Team
            </Text>
            <Text dimColor size="caption">
              last 6h
            </Text>
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Link href={dashboard} label="Grafana" />
            <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void Promise.all([pollTeam($, options), pollCapacity($, options)])} />
          </Box>
        </Box>

        {health.map(healthStrip)}
        {health.length === 0 && <Text dimColor size="caption">{rmeta.at === null && rmeta.error === null ? 'Health: reading retro snapshots…' : 'Health: no team selected'}</Text>}
        {await drawRoles($, els)}
        {await drawCapacity($, els)}

        {list.length === 0 && (
          <Box flexDirection="column" padding={1} backgroundColor={CARD_BG}>
            <Text>No team metrics yet.</Text>
            <Text dimColor size="footnote">
              This pane reads the ix_team_* series behind Grafana’s Team flow and effort dashboard. Prometheus has none
              of them yet; the tiles fill in once their exporter is pushing.
            </Text>
          </Box>
        )}

        {list.length > 0 && missing.length > 0 && (
          <Text dimColor wrap="wrap">{`No team series carries the key ${missing.join(', ')}.${unmatched.length > 0 ? ' The exporter ids below have no team_key (ix-board publishes it from 0.12.0), so which team each is cannot be told.' : ''}`}</Text>
        )}
        {shown.map(t => (
          <Box key={t.team} flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text weight="semibold">{t.team}</Text>
              {!t.keyed && <Text dimColor size="caption">exporter id, no team key</Text>}
            </Box>
            {tiles(t)}
          </Box>
        ))}
        {unmatched.map(unmatchedTeam)}

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
