import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { RetroClass, RetroMeta, RetroView, TeamMeta, TeamMetric, TeamView } from '../types'
import { CARD_BG, INK, ago, errorText, promRange, runText, sparkline } from './shared'
import { ACCENT, dots } from './ui/glyphs'
import type { Options } from './shared'
import { track } from './schedule'
import { focusTeams } from './band/modules'
import { getSelection, home, scopeOf } from './selection'
import { sourceFailed, sourceOk } from './sources'

// The Team pane: coder velocity, review quality and flow per team, from the same ix_team_* series as
// Grafana's "Team flow and effort" dashboard, each tile with six hours of history, and above them the
// health of each selected team's departments from its stored retro snapshots.

const PANE = 'team'
const TITLE = 'Team'
export const PANE_SPEC = { id: PANE, title: TITLE }
const HISTORY_SECS = 6 * 3600
const STEP_SECS = 300

const teams = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-1' })
/** Teams whose health strip lists its regressing metrics. */
const retroOpen = atom({ plugin: 'factory-panel', key: 'retroOpen' } as const, [] as string[])
const retro = atom({ plugin: 'factory-panel', key: 'retro' } as const, [] as RetroView[], { shape: 'retro-1' })
const retroMeta = atom({ plugin: 'factory-panel', key: 'retroMeta' } as const, { at: null, error: null } as RetroMeta, { shape: 'retroMeta-1' })
const teamMeta = atom(
  { plugin: 'factory-panel', key: 'teamMeta' } as const,
  { at: null, error: null } as TeamMeta,
  { shape: 'teamMeta-1' },
)

type Spec = Omit<TeamMetric, 'value' | 'history'> & { query: string }

// Velocity and effort, then review quality, then flow and capacity. A series the exporter does not publish
// stays in its row as a tile reading "—": it is never drawn as 0.
const SPECS: Spec[] = [
  { key: 'closures', group: 'velocity', label: 'Verified closures · 24h', unit: 'count', better: 'up', query: 'sum by (team_id) (ix_team_verified_path_closed_24h)' },
  // The exporter's own series where it publishes one, else the execution time of the day over the verified closures.
  { key: 'effort', group: 'velocity', label: 'Effort per closure', unit: 'seconds', better: 'down', query: 'max by (team_id) (ix_team_effort_per_verified_path_closure_seconds_24h) or (sum by (team_id) (increase(ix_team_execution_seconds_total[24h])) / (sum by (team_id) (ix_team_verified_path_closed_24h) > 0))' },
  { key: 'merges', group: 'velocity', label: 'PR merges / hour', unit: 'rate', better: 'up', query: 'sum by (team_id) (ix_team_pr_merges_per_hour_24h)' },
  { key: 'cycle', group: 'velocity', label: 'PR cycle · median', unit: 'seconds', better: 'down', query: 'max by (team_id) (ix_team_pr_cycle_median_seconds_24h)' },
  { key: 'firstReview', group: 'review', label: 'First review · median', unit: 'seconds', better: 'down', query: 'max by (team_id) (ix_team_new_pr_first_review_median_seconds_24h)' },
  { key: 'findingsShare', group: 'review', label: 'PRs with findings', unit: 'share', better: 'down', query: 'max by (team_id) (ix_team_review_prs_with_findings_share_24h)' },
  { key: 'high', group: 'review', label: 'Confirmed findings · high', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_review_findings_confirmed_high_24h)' },
  { key: 'medium', group: 'review', label: 'Confirmed findings · medium', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_review_findings_confirmed_medium_24h)' },
  { key: 'low', group: 'review', label: 'Confirmed findings · low', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_review_findings_confirmed_low_24h)' },
  // The exporter has no share series yet: the open PRs that carry a changes-requested review, over the open PRs.
  { key: 'changes', group: 'review', label: 'Changes requested', unit: 'share', better: 'down', query: 'max by (team_id) (ix_team_pr_changes_requested_share) or (sum by (team_id) (ix_team_prs_changes_requested) / (sum by (team_id) (ix_team_prs_open) > 0))' },
  { key: 'remaining', group: 'flow', label: 'Leaf work remaining', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_scope_leaf_remaining)' },
  { key: 'wip', group: 'flow', label: 'Work in progress', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_wip_active)' },
  { key: 'blocked', group: 'flow', label: 'Blocked', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_blocked_issues)' },
  { key: 'unmerged', group: 'flow', label: 'Ready, unmerged PRs', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_prs_ready_unmerged)' },
  { key: 'oldest', group: 'flow', label: 'Oldest in a stage', unit: 'seconds', better: 'down', query: 'max by (team_id) (ix_team_stage_oldest_age_seconds)' },
  { key: 'ready', group: 'flow', label: 'Ready issues', unit: 'count', better: 'up', query: 'sum by (team_id) (ix_team_ready_issues)' },
  { key: 'agents', group: 'flow', label: 'Executing agents', unit: 'count', better: 'up', query: 'sum by (team_id) (ix_team_executing_agents)' },
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

async function readTeam($: EngineInterface, options: Options): Promise<boolean> {
  const now = await $.clock.now()
  try {
    const results = await Promise.all(
      SPECS.map(async spec => ({ spec, series: await promRange($, options.prometheusUrl, spec.query, HISTORY_SECS, STEP_SECS) })),
    )
    // Every team any series names gets every tile: one the exporter lacks reads as unavailable, not as 0.
    const byTeam = new Map<string, Map<string, TeamMetric>>()
    for (const { spec, series } of results) {
      for (const s of series) {
        const team = s.metric.team_id ?? 'unknown'
        const history = s.values.map(([, v]) => Number(v)).filter(v => Number.isFinite(v))
        const metrics = byTeam.get(team) ?? new Map<string, TeamMetric>()
        byTeam.set(team, metrics)
        metrics.set(spec.key, { key: spec.key, group: spec.group, label: spec.label, unit: spec.unit, better: spec.better, value: history.length > 0 ? (history[history.length - 1] ?? null) : null, history })
      }
    }
    const views: TeamView[] = [...byTeam.entries()]
      .map(([team, have]) => ({
        team,
        metrics: SPECS.map((spec): TeamMetric => have.get(spec.key) ?? { key: spec.key, group: spec.group, label: spec.label, unit: spec.unit, better: spec.better, value: null, history: [] }),
      }))
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

/** The department class of each metric id of ix-board's retro catalog: the delta answer names none. */
const CLASS_OF: Record<string, string> = {
  path_remaining: 'progress', path_closed: 'progress', intake_new: 'progress', net_closed_minus_new: 'progress', gates_remaining: 'progress', path_closed_unverified: 'progress',
  prs_merged_per_hour: 'flow', pr_cycle_median_hours: 'flow', pr_cycle_p90_hours: 'flow', prs_open: 'flow', prs_idle: 'flow', prs_oversize: 'flow', prs_ready_unmerged: 'flow',
  fix_rounds_max: 'rework', fix_rounds_total: 'rework', head_force_pushes_max: 'rework', done_reopened: 'rework', full_gates_max: 'rework', repins_total: 'rework',
  main_red_incidents: 'stability', main_red_minutes: 'stability',
  issues_without_project: 'scope', issues_without_milestone: 'scope', in_progress_stale: 'scope', source_count_disagreement: 'scope', decisions_open: 'scope', decision_oldest_hours: 'scope',
  agents_working_share: 'utilization', agents_idle_minutes_max: 'utilization', messages_undelivered: 'utilization',
  worktrees_prunable: 'resource', disk_bytes: 'resource', orphan_slots: 'resource', build_lock_wait_minutes: 'resource',
}
const CLASS_ORDER = ['progress', 'flow', 'rework', 'stability', 'scope', 'utilization', 'resource', 'other']

type DeltaMetric = { id?: unknown; status?: unknown; regressing?: unknown }
type Delta = { latest?: unknown; metrics?: unknown }

/**
 * One class per department of the delta's metrics: red where any metric regresses, otherwise amber where some metric has
 * no value, unknown where none has, else green.
 */
export function classesOf(metrics: readonly DeltaMetric[]): RetroClass[] {
  const by = new Map<string, DeltaMetric[]>()
  for (const m of metrics) {
    const id = typeof m.id === 'string' ? m.id : ''
    const cls = CLASS_OF[id] ?? 'other'
    by.set(cls, [...(by.get(cls) ?? []), m])
  }
  return CLASS_ORDER.flatMap(id => {
    const members = by.get(id)
    if (members === undefined) return []
    const regressing = members.filter(m => m.regressing === true).map(m => String(m.id))
    const unavailable = members.filter(m => m.status !== 'ok').length
    const rating: RetroClass['rating'] = regressing.length > 0 ? 'red' : unavailable === members.length ? 'unknown' : unavailable > 0 ? 'amber' : 'green'
    return [{ id, rating, regressing, unavailable, total: members.length }]
  })
}

/** The teams whose retro health is shown: the teams the session's focus is about. */
function retroTeams(): string[] {
  const scope = scopeOf(getSelection())
  const picked = focusTeams(scope)
  if (picked !== null && picked.length > 0) return picked
  return scope.ownTeam !== null ? [scope.ownTeam] : scope.teams
}

async function readRetroTeam($: EngineInterface, dir: string, team: string): Promise<RetroView> {
  const none = (reason: string): RetroView => ({ team, classes: null, latest: null, reason })
  try {
    // Only the stored snapshots are read: the delta makes no network call.
    const text = await runText($, ['ix-board', '--json', 'retro', 'delta', '--config', `${dir}/${team}/config.json`], RETRO_TIMEOUT_MS)
    const delta = JSON.parse(text) as Delta
    if (!Array.isArray(delta.metrics)) return none('no retro baseline')
    return { team, classes: classesOf(delta.metrics as DeltaMetric[]), latest: typeof delta.latest === 'string' ? delta.latest : null, reason: null }
  } catch {
    return none('no retro baseline')
  }
}

/** Reads each selected team's retro delta; a team with no config or snapshots has no baseline, which is not a failure. */
export function pollRetro($: EngineInterface): Promise<boolean> {
  return track($, 'retro', async () => {
    try {
      const now = await $.clock.now()
      const dir = `${await home($)}/.local/state/team-retro`
      const views = await Promise.all(retroTeams().map(team => readRetroTeam($, dir, team)))
      await update($, retro, () => views)
      await update($, retroMeta, () => ({ at: now, error: null }))
      sourceOk('ix-board retro', await $.clock.now())
      return true
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
    const [list, meta, health, open] = await Promise.all([read($, teams), read($, teamMeta), read($, retro), read($, retroOpen)])
    const now = await $.clock.now()
    const dashboard = `${options.grafanaUrl.replace(/\/$/, '')}/d/ix-team-flow-effort`

    if (e.props.placement === 'widget') {
      const closures = list.flatMap(t => t.metrics.filter(m => m.key === 'closures'))
      const total = closures.reduce((s, m) => s + (m.value ?? 0), 0)
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{list.length > 0 ? `${Math.round(total)} closures / 24h` : 'no team metrics'}</Text>
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
        {health.length === 0 && <Text dimColor size="caption">Health: no retro baseline</Text>}

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
            <Text weight="semibold">{t.team}</Text>
            {GROUPS.map(g => (
              <Box key={g.id} flexDirection="column">
                <Text dimColor size="caption">{g.title}</Text>
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  {t.metrics.filter(m => m.group === g.id).map(m => tile(t.team, m))}
                </Box>
              </Box>
            ))}
          </Box>
        ))}

        <Box flexDirection="row" justifyContent="flex-end">
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
