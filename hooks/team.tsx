import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { RetroClass, RetroMeta, RetroView, TeamMeta, TeamMetric, TeamView } from '../types'
import { CARD_BG, INK, ago, errorText, promRange, sparkline } from './shared'
import { ACCENT, dots } from './ui/glyphs'
import type { Options, RangeSeries } from './shared'
import { track } from './schedule'
import { focusTeams } from './band/modules'
import { getSelection, home, scopeOf, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'

// The Team pane: coder velocity, review quality and flow per team, from the same ix_team_* series as
// Grafana's "Team flow and effort" dashboard, each tile with six hours of history and the closures and merges of
// each of the last seven days, and above them the health of each selected team's departments from its stored
// retro snapshots.

const PANE = 'team'
const TITLE = 'Team'
export const PANE_SPEC = { id: PANE, title: TITLE }
const HISTORY_SECS = 6 * 3600
const STEP_SECS = 300

const teams = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-2' })
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

/** How the samples several exporter series of one team have at one time make one. */
type Combine = 'sum' | 'max'
type Spec = Omit<TeamMetric, 'value' | 'history'> & { series: string; combine: Combine }

// Velocity and effort, then review quality, then flow and capacity. Each tile is one series of the exporter, derived
// from nothing else: one it does not publish stays in its row as a tile reading "—", never 0.
const SPECS: Spec[] = [
  { key: 'closures', group: 'velocity', label: 'Verified closures · 24h', unit: 'count', better: 'up', series: 'ix_team_verified_path_closed_24h', combine: 'sum' },
  { key: 'effort', group: 'velocity', label: 'Effort per closure', unit: 'seconds', better: 'down', series: 'ix_team_effort_per_verified_path_closure_seconds_24h', combine: 'max' },
  { key: 'merges', group: 'velocity', label: 'PR merges / hour', unit: 'rate', better: 'up', series: 'ix_team_pr_merges_per_hour_24h', combine: 'sum' },
  { key: 'cycle', group: 'velocity', label: 'PR cycle · median', unit: 'seconds', better: 'down', series: 'ix_team_pr_cycle_median_seconds_24h', combine: 'max' },
  { key: 'firstReview', group: 'review', label: 'First review · median', unit: 'seconds', better: 'down', series: 'ix_team_new_pr_first_review_median_seconds_24h', combine: 'max' },
  { key: 'findingsShare', group: 'review', label: 'PRs with findings', unit: 'share', better: 'down', series: 'ix_team_review_prs_with_findings_share_24h', combine: 'max' },
  { key: 'high', group: 'review', label: 'Confirmed findings · high', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_high_24h', combine: 'sum' },
  { key: 'medium', group: 'review', label: 'Confirmed findings · medium', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_medium_24h', combine: 'sum' },
  { key: 'low', group: 'review', label: 'Confirmed findings · low', unit: 'count', better: 'down', series: 'ix_team_review_findings_confirmed_low_24h', combine: 'sum' },
  { key: 'changes', group: 'review', label: 'Changes requested', unit: 'share', better: 'down', series: 'ix_team_pr_changes_requested_share', combine: 'max' },
  { key: 'remaining', group: 'flow', label: 'Leaf work remaining', unit: 'count', better: 'down', series: 'ix_team_scope_leaf_remaining', combine: 'sum' },
  { key: 'wip', group: 'flow', label: 'Work in progress', unit: 'count', better: 'down', series: 'ix_team_wip_active', combine: 'sum' },
  { key: 'blocked', group: 'flow', label: 'Blocked', unit: 'count', better: 'down', series: 'ix_team_blocked_issues', combine: 'sum' },
  { key: 'unmerged', group: 'flow', label: 'Ready, unmerged PRs', unit: 'count', better: 'down', series: 'ix_team_prs_ready_unmerged', combine: 'sum' },
  { key: 'oldest', group: 'flow', label: 'Oldest in a stage', unit: 'seconds', better: 'down', series: 'ix_team_stage_oldest_age_seconds', combine: 'max' },
  { key: 'ready', group: 'flow', label: 'Ready issues', unit: 'count', better: 'up', series: 'ix_team_ready_issues', combine: 'sum' },
  { key: 'agents', group: 'flow', label: 'Executing agents', unit: 'count', better: 'up', series: 'ix_team_executing_agents', combine: 'sum' },
]

const DAY_SECS = 86_400
const DAYS = 7
/** The daily rows. Each sample of these series covers the 24 hours before it; `per` makes it a count of that day. */
const DAILY: { key: keyof TeamView['days']; label: string; series: string; per: number }[] = [
  { key: 'closures', label: 'Closures', series: 'ix_team_verified_path_closed_24h', per: 1 },
  { key: 'merges', label: 'Merges', series: 'ix_team_pr_merges_per_hour_24h', per: 24 },
]

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
function joined(series: readonly RangeSeries[], combine: Combine): [number, number][] {
  const keyed = new Map<number, number>()
  const keyless = new Map<number, number>()
  for (const s of series) {
    const into = s.metric.team_key ? keyed : keyless
    for (const [time, text] of s.values) {
      const value = Number(text)
      if (!Number.isFinite(value)) continue
      const had = into.get(time)
      into.set(time, had === undefined ? value : combine === 'sum' ? had + value : Math.max(had, value))
    }
  }
  return [...new Map([...keyless, ...keyed])].sort(([a], [b]) => a - b)
}

/** The counts of the last DAYS days, oldest first; `null` for a day with no sample. */
function perDay(samples: readonly [number, number][], now: number, per: number): (number | null)[] {
  const days = Array<number | null>(DAYS).fill(null)
  for (const [time, value] of samples) {
    const ago = Math.round((now - time) / DAY_SECS)
    if (ago >= 0 && ago < DAYS) days[DAYS - 1 - ago] = Math.round(value * per)
  }
  return days
}

async function readTeam($: EngineInterface, options: Options): Promise<boolean> {
  const now = await $.clock.now()
  const seconds = Math.floor(now / 1000)
  try {
    const query = (promql: string, span: number, step: number) => promRange($, options.prometheusUrl, promql, span, step)
    const [tiles, daily] = await Promise.all([
      Promise.all(SPECS.map(async spec => ({ spec, series: await query(`${spec.combine} by (team_id, team_key) (${spec.series})`, HISTORY_SECS, STEP_SECS) }))),
      // The last sample of the hour before each day's end, so that a missed scrape does not lose the day.
      Promise.all(DAILY.map(async day => ({ day, series: await query(`sum by (team_id, team_key) (last_over_time(${day.series}[1h]))`, (DAYS - 1) * DAY_SECS, DAY_SECS) }))),
    ])
    const every = [...tiles, ...daily].flatMap(r => r.series)
    const nameOf = teamNamer(every)
    // Every team any series names gets every tile: one the exporter lacks reads as unavailable, not as 0.
    const named = new Map<string, boolean>()
    for (const { team, keyed } of every.map(nameOf)) named.set(team, keyed || (named.get(team) ?? false))
    const views: TeamView[] = [...named]
      .map(([team, keyed]) => {
        const of = (series: readonly RangeSeries[], combine: Combine) => joined(series.filter(s => nameOf(s).team === team), combine)
        const metrics = tiles.map(({ spec, series }): TeamMetric => {
          const samples = of(series, spec.combine)
          const last = samples[samples.length - 1]
          // A series that stopped has no current value, whatever it last said.
          const value = last !== undefined && seconds - last[0] <= STEP_SECS ? last[1] : null
          return { key: spec.key, group: spec.group, label: spec.label, unit: spec.unit, better: spec.better, value, history: samples.map(([, v]) => v) }
        })
        const days = { closures: [], merges: [] } as TeamView['days']
        for (const { day, series } of daily) days[day.key] = perDay(of(series, 'sum'), seconds, day.per)
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

/** The teams whose retro health is shown: the teams the session's focus is about. */
function retroTeams(): string[] {
  const scope = scopeOf(getSelection())
  const picked = focusTeams(scope)
  if (picked !== null && picked.length > 0) return picked
  return scope.ownTeam !== null ? [scope.ownTeam] : scope.teams
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
  if (m.unit === 'seconds') {
    const h = m.value / 3600
    return h >= 1 ? `${h.toFixed(h >= 10 ? 0 : 1)}h` : `${Math.round(m.value / 60)}m`
  }
  if (m.unit === 'share') return `${Math.round(m.value * 100)}%`
  if (m.unit === 'rate') return m.value.toFixed(m.value >= 10 ? 0 : 1)
  return Math.round(m.value).toLocaleString('en-US')
}

/** How the newest day compares with the average of the earlier days that have a value; null where it has none. */
function dayTrend(days: readonly (number | null)[]): { mark: string; color: string; text: string } | null {
  const newest = days[days.length - 1]
  if (newest === null || newest === undefined) return null
  const earlier = days.slice(0, -1).filter((v): v is number => v !== null)
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
    const [list, meta, health, open, rmeta, warnOpen] = await Promise.all([read($, teams), read($, teamMeta), read($, retro), read($, retroOpen), read($, retroMeta), read($, retroWarn)])
    const now = await $.clock.now()
    const dashboard = `${options.grafanaUrl.replace(/\/$/, '')}/d/ix-team-flow-effort`

    if (e.props.placement === 'widget') {
      const closures = list.map(t => t.metrics.find(m => m.key === 'closures')?.value ?? null)
      const known = closures.filter((v): v is number => v !== null)
      // A team with no reading makes the sum a lower bound; with none at all it is unknown, not 0.
      const total = known.length === 0 ? '—' : `${known.length < closures.length ? '≥' : ''}${Math.round(known.reduce((a, b) => a + b, 0))}`
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{list.length > 0 ? `${total} closures / 24h` : 'no team metrics'}</Text>
        </Box>
      )
    }

    const tile = (team: string, m: TeamMetric) => (
      <Box key={`${team}-${m.key}`} flexDirection="column" minWidth={20} flexGrow={1} padding={1} backgroundColor={CARD_BG}>
        <Text dimColor size="caption">
          {m.label}
        </Text>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text weight="semibold" size="title" tabular>
            {format(m)}
          </Text>
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
      </Box>
    )

    const dailyRows = (t: TeamView) => (
      <Box key={`${t.team}-daily`} flexDirection="column">
        <Text dimColor size="caption">Per day · last 7 days · verified closures, merged PRs</Text>
        {DAILY.map(day => {
          const trend = dayTrend(t.days[day.key])
          return (
            <Box key={`${t.team}-daily-${day.key}`} flexDirection="row" gap={1}>
              <Box width={8}>
                <Text dimColor>{day.label}</Text>
              </Box>
              <Text tabular>{t.days[day.key].map(v => (v === null ? '—' : String(v)).padStart(4)).join('')}</Text>
              {trend !== null && trend.mark !== '' && <Text color={trend.color}>{trend.mark}</Text>}
              {trend !== null && <Text dimColor>{trend.text}</Text>}
            </Box>
          )
        })}
      </Box>
    )

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
            <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollTeam($, options)} />
          </Box>
        </Box>

        {health.map(healthStrip)}
        {health.length === 0 && <Text dimColor size="caption">{rmeta.at === null && rmeta.error === null ? 'Health: reading retro snapshots…' : 'Health: no team selected'}</Text>}

        {list.length === 0 && (
          <Box flexDirection="column" padding={1} backgroundColor={CARD_BG}>
            <Text>No team metrics yet.</Text>
            <Text dimColor size="footnote">
              This pane reads the ix_team_* series behind Grafana’s Team flow and effort dashboard. Prometheus has none
              of them yet; the tiles fill in once their exporter is pushing.
            </Text>
          </Box>
        )}

        {list.map(t => (
          <Box key={t.team} flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text weight="semibold">{t.team}</Text>
              {!t.keyed && <Text dimColor size="caption">exporter id, no team key</Text>}
            </Box>
            {GROUPS.map(g => (
              <Box key={g.id} flexDirection="column">
                <Text dimColor size="caption">{g.title}</Text>
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  {t.metrics.filter(m => m.group === g.id).map(m => tile(t.team, m))}
                </Box>
                {g.id === 'velocity' && dailyRows(t)}
              </Box>
            ))}
          </Box>
        ))}

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
