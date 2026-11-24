import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { TeamMeta, TeamMetric, TeamView } from '../types'
import { CARD_BG, INK, ago, errorText, promRange, sparkline } from './shared'
import { ACCENT, dots } from './ui/glyphs'
import type { Options } from './shared'

// The Team pane: coder velocity and quality per team, from the same ix_team_* series as
// Grafana's "Team flow and effort" dashboard, each tile with six hours of history.

const PANE = 'team'
const TITLE = 'Team'
export const PANE_SPEC = { id: PANE, title: TITLE }
const POLL_MS = 60 * 1000
const HISTORY_SECS = 6 * 3600
const STEP_SECS = 300

const teams = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-1' })
const teamMeta = atom(
  { plugin: 'factory-panel', key: 'teamMeta' } as const,
  { at: null, error: null } as TeamMeta,
  { shape: 'teamMeta-1' },
)

type Spec = Omit<TeamMetric, 'value' | 'history'> & { query: string }

// Velocity first, then queues, then quality of the flow.
const SPECS: Spec[] = [
  { key: 'closures', label: 'Verified closures · 24h', unit: 'count', better: 'up', query: 'sum by (team_id) (ix_team_verified_path_closed_24h)' },
  { key: 'merges', label: 'PR merges / hour', unit: 'rate', better: 'up', query: 'sum by (team_id) (ix_team_pr_merges_per_hour_24h)' },
  { key: 'remaining', label: 'Leaf work remaining', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_scope_leaf_remaining)' },
  { key: 'cycle', label: 'PR cycle · median', unit: 'seconds', better: 'down', query: 'max by (team_id) (ix_team_pr_cycle_median_seconds_24h)' },
  { key: 'wip', label: 'Work in progress', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_wip_active)' },
  { key: 'blocked', label: 'Blocked', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_blocked_issues)' },
  { key: 'unmerged', label: 'Ready, unmerged PRs', unit: 'count', better: 'down', query: 'sum by (team_id) (ix_team_prs_ready_unmerged)' },
  { key: 'agents', label: 'Executing agents', unit: 'count', better: 'up', query: 'sum by (team_id) (ix_team_executing_agents)' },
]

async function pollTeam($: EngineInterface, options: Options): Promise<void> {
  const now = await $.clock.now()
  try {
    const results = await Promise.all(
      SPECS.map(async spec => ({ spec, series: await promRange($, options.prometheusUrl, spec.query, HISTORY_SECS, STEP_SECS) })),
    )
    const byTeam = new Map<string, TeamMetric[]>()
    for (const { spec, series } of results) {
      for (const s of series) {
        const team = s.metric.team_id ?? 'unknown'
        const history = s.values.map(([, v]) => Number(v)).filter(v => Number.isFinite(v))
        const metric: TeamMetric = {
          key: spec.key,
          label: spec.label,
          unit: spec.unit,
          better: spec.better,
          value: history.length > 0 ? (history[history.length - 1] ?? null) : null,
          history,
        }
        byTeam.set(team, [...(byTeam.get(team) ?? []), metric])
      }
    }
    const order = new Map(SPECS.map((s, i) => [s.key, i]))
    const views: TeamView[] = [...byTeam.entries()]
      .map(([team, metrics]) => ({
        team,
        metrics: metrics.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
      }))
      .sort((a, b) => a.team.localeCompare(b.team))
    await update($, teams, () => views)
    await update($, teamMeta, () => ({ at: now, error: null }))
  } catch (error) {
    await update($, teamMeta, m => ({ ...m, error: errorText(error) }))
  }
}

const format = (m: TeamMetric): string => {
  if (m.value === null) return '–'
  if (m.unit === 'seconds') {
    const h = m.value / 3600
    return h >= 1 ? `${h.toFixed(h >= 10 ? 0 : 1)}h` : `${Math.round(m.value / 60)}m`
  }
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

/** Registers the command and starts polling; called once at session start. register.tsx opens the pane. */
export async function startTeam($: EngineInterface, options: Options): Promise<void> {
  await $.command.register({ name: 'team', description: 'Open the Team pane: coder velocity and quality' })
  void pollTeam($, options)
  $.clock.every(POLL_MS, () => pollTeam($, options))
}

export function registerTeam(on: On, options: Options): void {
  on('command.run', { command: 'team' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    void pollTeam($, options)
    return { text: opened.isPlaced ? 'Team pane opened.' : `Team pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const [list, meta] = await Promise.all([read($, teams), read($, teamMeta)])
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
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {t.metrics.map(m => tile(t.team, m))}
            </Box>
          </Box>
        ))}

        <Box flexDirection="row" justifyContent="flex-end">
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
            {meta.error ?? `updated ${ago(meta.at, now)}`}
          </Text>
        </Box>
      </Box>
    )
  })
}
