import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type {
  BoardAgent,
  BoardView,
  Freshness,
  HerdrAgent,
  HerdrView,
  Machine,
  RelayCheck,
  RelayView,
} from '../types'
import { CARD_BG, INK, ago, errorText, pausedText, promQuery, shortError } from './shared'
import { ACCENT, tempColor, usd } from './ui/glyphs'
import { widgets } from './ui/widgets'
import { gatedBoard } from './linear'
import { sourceFailed, sourceOk } from './sources'
import { getSelection, selectionReady } from './selection'
import type { Options, Sample } from './shared'

type Detail = 'none' | 'herdr' | 'relay' | 'board'

const PANE = 'factory'
const TITLE = 'Factory'
export const PANE_SPEC = { id: PANE, title: TITLE }

// A machine whose relay watcher has not pushed for this long reads as down.
const DOWN_AFTER_SECS = 120
const HOT_C = 80
const WARM_C = 65

const machines = atom({ plugin: 'factory-panel', key: 'machines' } as const, [] as Machine[], {
  shape: 'machines-1',
})
const herdr = atom(
  { plugin: 'factory-panel', key: 'herdr' } as const,
  { running: false, version: '', agents: [] } as HerdrView,
  { shape: 'herdr-1' },
)
const relay = atom(
  { plugin: 'factory-panel', key: 'relay' } as const,
  {
    ok: false,
    redis: 'unknown',
    watchers: [],
    warnings: 0,
    deadLetters: 0,
    inboxWaiting: 0,
    checks: [],
  } as RelayView,
  { shape: 'relay-1' },
)
const board = atom(
  { plugin: 'factory-panel', key: 'board' } as const,
  { teams: [], agents: [], error: null } as BoardView,
  { shape: 'board-1' },
)
const freshness = atom(
  { plugin: 'factory-panel', key: 'freshness' } as const,
  {
    prometheusAt: null,
    prometheusError: null,
    nodeMetricsSeen: false,
    herdrAt: null,
    herdrError: null,
    relayAt: null,
    relayError: null,
    boardAt: null,
    boardBusy: false,
  } as Freshness,
  { shape: 'freshness-1' },
)
const detail = atom({ plugin: 'factory-panel', key: 'detail' } as const, 'none' as Detail)



// ---------------------------------------------------------------- helpers


/** `node-a:9100`, `node-a.lan:9100` or `10.0.0.5:9100` reduced to the machine's short name. */
const machineOf = (metric: Record<string, string>): string => {
  if (metric.machine) return metric.machine
  const host = metric.nodename ?? (metric.instance ?? '').replace(/:\d+$/, '')
  return host.split('.')[0] || 'unknown'
}

const num = (sample: Sample): number | null => {
  const n = Number(sample.value[1])
  return Number.isFinite(n) ? n : null
}


const QUERIES = {
  // Which machines exist and when their relay watcher last pushed to Prometheus.
  lastSeen: 'time() - max by (machine) (timestamp(ix_relay_registrations))',
  leads: 'sum by (machine) (ix_relay_registrations)',
  panes: 'sum by (machine, status) (herdr_pane_status_ratio)',
  spend: 'sum by (machine) (increase(claude_code_cost_usage_USD_total[24h]))',
  // node_exporter: Linux first, then the macOS exporter's spellings (no MemAvailable, and
  // temperatures from Apple's die sensors; its battery and NAND sensors are left out).
  cpu: '100 * (1 - avg by (instance, nodename) (rate(node_cpu_seconds_total{mode="idle"}[2m])))',
  mem:
    '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) ' +
    'or 100 * (node_memory_active_bytes + node_memory_wired_bytes + node_memory_compressed_bytes) / node_memory_total_bytes',
  temp:
    'max by (instance, nodename) (node_hwmon_temp_celsius or node_thermal_zone_temp ' +
    'or node_thermal_temperature_celsius{sensor=~"PMU tdie.*"})',
}

async function pollPrometheus($: EngineInterface, options: Options): Promise<void> {
  const now = await $.clock.now()
  try {
    const [lastSeen, leads, panes, spend, cpu, mem, temp] = await Promise.all([
      promQuery($, options.prometheusUrl, QUERIES.lastSeen),
      promQuery($, options.prometheusUrl, QUERIES.leads),
      promQuery($, options.prometheusUrl, QUERIES.panes),
      promQuery($, options.prometheusUrl, QUERIES.spend),
      promQuery($, options.prometheusUrl, QUERIES.cpu).catch(() => [] as Sample[]),
      promQuery($, options.prometheusUrl, QUERIES.mem).catch(() => [] as Sample[]),
      promQuery($, options.prometheusUrl, QUERIES.temp).catch(() => [] as Sample[]),
    ])

    const byName = new Map<string, Machine>()
    const get = (name: string): Machine => {
      let m = byName.get(name)
      if (!m) {
        m = {
          name,
          lastSeenSecs: null,
          leads: 0,
          panesWorking: 0,
          panesIdle: 0,
          panesDone: 0,
          cpuPct: null,
          memPct: null,
          tempC: null,
          spend24hUsd: null,
        }
        byName.set(name, m)
      }
      return m
    }

    for (const s of lastSeen) get(machineOf(s.metric)).lastSeenSecs = num(s)
    for (const s of leads) get(machineOf(s.metric)).leads = num(s) ?? 0
    for (const s of panes) {
      const m = get(machineOf(s.metric))
      const n = num(s) ?? 0
      if (s.metric.status === 'working') m.panesWorking += n
      else if (s.metric.status === 'idle') m.panesIdle += n
      else m.panesDone += n
    }
    for (const s of spend) get(machineOf(s.metric)).spend24hUsd = num(s)
    for (const s of cpu) get(machineOf(s.metric)).cpuPct = num(s)
    for (const s of mem) get(machineOf(s.metric)).memPct = num(s)
    for (const s of temp) get(machineOf(s.metric)).tempC = num(s)

    const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    await update($, machines, () => list)
    await update($, freshness, f => ({
      ...f,
      prometheusAt: now,
      prometheusError: null,
      nodeMetricsSeen: cpu.length > 0 || mem.length > 0 || temp.length > 0,
    }))
    sourceOk('prometheus', now)
  } catch (error) {
    sourceFailed('prometheus', errorText(error))
    await update($, freshness, f => ({ ...f, prometheusError: errorText(error) }))
  }
}

type HerdrSnapshot = {
  result?: {
    snapshot?: {
      version?: string
      agents?: {
        agent: string
        agent_status: string
        terminal_title_stripped?: string
        terminal_title?: string
        pane_id: string
        workspace_id: string
      }[]
      workspaces?: { workspace_id: string; label: string }[]
    }
  }
}

async function pollHerdr($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  try {
    const ran = await $.process.run(['herdr', 'api', 'snapshot'], { timeoutMs: 10_000 })
    if (ran.exitCode !== 0) {
      throw new Error(ran.stderr.trim().split('\n')[0] || `herdr exited ${ran.exitCode}`)
    }
    const parsed = JSON.parse(ran.stdout) as HerdrSnapshot
    const snapshot = parsed.result?.snapshot
    const labels = new Map((snapshot?.workspaces ?? []).map(w => [w.workspace_id, w.label]))
    const agents: HerdrAgent[] = (snapshot?.agents ?? []).map(a => ({
      agent: a.agent,
      status: a.agent_status,
      title: a.terminal_title_stripped ?? a.terminal_title ?? '',
      workspace: labels.get(a.workspace_id) ?? a.workspace_id,
      paneId: a.pane_id,
    }))
    const order: Record<string, number> = { working: 0, idle: 1, done: 2 }
    agents.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
    await update($, herdr, () => ({ running: true, version: snapshot?.version ?? '', agents }))
    await update($, freshness, f => ({ ...f, herdrAt: now, herdrError: null }))
  } catch (error) {
    await update($, herdr, h => ({ ...h, running: false }))
    await update($, freshness, f => ({ ...f, herdrError: errorText(error) }))
  }
}

async function pollRelay($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  try {
    const ran = await $.process.run(['agent-msg', 'doctor', '--json'], { timeoutMs: 30_000 })
    // A doctor that fails outright prints its reason on stderr, not JSON; show that reason.
    let parsed: { ok: boolean; checks: RelayCheck[] }
    try {
      parsed = JSON.parse(ran.stdout) as { ok: boolean; checks: RelayCheck[] }
    } catch (error) {
      const reason = (ran.stderr.trim() || ran.stdout.trim()).split('\n')[0]
      throw reason === undefined || reason === '' ? error : new Error(reason)
    }
    const checks = parsed.checks ?? []
    const redis = checks.find(c => c.check === 'redis')?.status ?? 'unknown'
    const watchers = checks
      .filter(c => c.check === 'watcher')
      .map(c => ({ machine: c.subject ?? '?', status: c.status, message: c.message }))
    const count = (kind: string, pattern: RegExp): number =>
      checks
        .filter(c => c.check === kind)
        .reduce((sum, c) => sum + Number(c.message.match(pattern)?.[1] ?? 0), 0)
    await update($, relay, () => ({
      ok: parsed.ok,
      redis,
      watchers,
      warnings: checks.filter(c => c.status !== 'ok').length,
      deadLetters: count('dead_letter', /(\d+) dead letter/),
      inboxWaiting: count('inbox', /(\d+) waiting/),
      checks: checks.map(c => ({ ...c, message: c.message.slice(0, 160) })),
    }))
    await update($, freshness, f => ({ ...f, relayAt: now, relayError: null }))
  } catch (error) {
    await update($, freshness, f => ({ ...f, relayError: errorText(error) }))
  }
}

type BoardOutput = {
  agents?: {
    team?: string
    agent: string
    herdr_status?: string
    verdict?: string
    machine?: string
    pane_id?: string
    title?: string
    excerpt?: string
    last_turn_age_secs?: number | null
  }[]
  errors?: string[]
  missing_teams?: string[]
}

type BoardRead = { agents: BoardAgent[]; notes: string[] }

/** The teams ix-board is asked about: those the selection names, else the `teams` setting. */
const boardTeams = (options: Options): string[] => {
  const picked = getSelection().teams.value
  return picked.length > 0 ? picked : options.teams
}

export async function pollBoard($: EngineInterface, options: Options): Promise<void> {
  await selectionReady()
  const teams = boardTeams(options)
  if (teams.length === 0) return
  await update($, freshness, f => ({ ...f, boardBusy: true }))
  try {
    const read = await gatedBoard($, `agents:${teams.join(',')}`, () => readBoard($, teams))
    const now = await $.clock.now()
    const notes = read.data?.notes ?? []
    const error =
      read.backoffUntil !== null
        ? pausedText(read.backoffUntil, now)
        : (read.error ?? (notes.length > 0 ? notes.join(' · ').slice(0, 200) : null))
    await update($, board, b => ({ teams, agents: read.data?.agents ?? b.agents, error }))
    await update($, freshness, f => ({ ...f, boardAt: read.at }))
  } finally {
    await update($, freshness, f => ({ ...f, boardBusy: false }))
  }
}

async function readBoard($: EngineInterface, teams: string[]): Promise<BoardRead> {
  {
    const ran = await $.process.run(['ix-board', '--json', 'agents', ...teams], {
      timeoutMs: 180_000,
    })
    if (ran.isStdoutTruncated) throw new Error('ix-board output was cut at 4 MiB')
    let parsed: BoardOutput
    try {
      // ix-board exits 4 when a machine's collection was partial but still prints the report.
      parsed = JSON.parse(ran.stdout) as BoardOutput
    } catch {
      throw new Error(ran.stderr.trim().split('\n').pop() || `ix-board exited ${ran.exitCode}`)
    }
    const agents: BoardAgent[] = (parsed.agents ?? []).map(a => ({
      team: a.team ?? '',
      agent: a.agent,
      status: a.herdr_status ?? a.verdict?.toLowerCase() ?? 'unknown',
      machine: a.machine ?? '',
      paneId: a.pane_id ?? '',
      title: a.title ?? (a.excerpt ?? '').match(/title "([^"]*)"/)?.[1] ?? '',
      lastTurnAgeSecs: a.last_turn_age_secs ?? null,
    }))
    const order: Record<string, number> = { working: 0, idle: 1, done: 2 }
    agents.sort(
      (a, b) =>
        a.team.localeCompare(b.team) || (order[a.status] ?? 3) - (order[b.status] ?? 3),
    )
    const notes = [
      ...(parsed.missing_teams ?? []).map(t => `no workspace named ${t}`),
      ...(parsed.errors ?? []),
    ]
    return { agents, notes }
  }
}



const pct = (v: number | null): string => (v === null ? '--' : `${Math.round(v)}%`)

// ---------------------------------------------------------------- drawing

// Status steps from the dataviz reference palette: they read on light and dark surfaces,
// and text never wears them; a mark beside the text carries the state.

const loadInk = (v: number | null): string =>
  v === null ? INK.track : v >= 90 ? INK.critical : v >= 70 ? INK.warning : INK.calm
const tempInk = (t: number | null): string =>
  t === null ? INK.track : t >= HOT_C ? INK.critical : t >= WARM_C ? INK.warning : INK.calm

/** A ring gauge: the track, and an arc for `value` out of 100 (none for null). */
const ring = (value: number | null, color: string): string => {
  const r = 11
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.max(0, Math.min(100, value))
  const dash = ((v / 100) * c).toFixed(2)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">` +
    `<circle cx="15" cy="15" r="${r}" fill="none" stroke="${INK.track}" stroke-width="3.5"/>` +
    (value === null
      ? ''
      : `<circle cx="15" cy="15" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" ` +
        `stroke-linecap="round" stroke-dasharray="${dash} ${c.toFixed(2)}" transform="rotate(-90 15 15)"/>`) +
    `</svg>`
  )
}

/** A thin segmented bar: working, idle, done, with a surface gap between fills. */
const segments = (working: number, idle: number, done: number): string => {
  const total = working + idle + done
  const width = 120
  const parts = [
    [working, INK.calm],
    [idle, INK.warning],
    [done, INK.muted],
  ] as const
  let x = 0
  let rects = ''
  for (const [n, color] of parts) {
    if (n <= 0 || total === 0) continue
    const w = Math.max(3, (n / total) * width - 2)
    rects += `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="4" rx="2" fill="${color}"/>`
    x += w + 2
  }
  if (total === 0) rects = `<rect x="0" y="0" width="${width}" height="4" rx="2" fill="${INK.track}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="4" viewBox="0 0 ${width} 4">${rects}</svg>`
}

const compactUsd = (v: number): string =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`

const staleness = (f: Freshness, now: number): number | null => {
  const ats = [f.prometheusAt, f.herdrAt, f.relayAt].filter((t): t is number => t !== null)
  return ats.length === 0 ? null : now - Math.min(...ats)
}

// ---------------------------------------------------------------- register

export async function refreshAll($: EngineInterface, options: Options): Promise<void> {
  await Promise.all([pollPrometheus($, options), pollHerdr($), pollRelay($)])
}

async function toggleDetail($: EngineInterface, which: Detail): Promise<void> {
  await update($, detail, d => (d === which ? 'none' : which))
}

/** Registers the command and starts polling; called once at session start. register.tsx opens the pane. */
export async function startFactory($: EngineInterface, options: Options): Promise<void> {
  await $.command.register({
    name: 'factory',
    description: 'Open more detail, and choose what the band shows. /factory help says how',
    argumentHint: 'help | focus | escalations | relay | team | use | teams | hosts | show | reset',
  })

  void refreshAll($, options)
  void pollBoard($, options)
  $.clock.every(options.refreshSeconds * 1000, () => refreshAll($, options))
  // The gate holds each ix-board read to once per BOARD_INTERVAL_MS across sessions; this only asks.
  $.clock.every(60 * 1000, () => pollBoard($, options))

}

export function registerFactory(on: On, options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    // The terminal has no Svg: there a gauge is its number alone.
    // The test host's terminal table also lists Svg, so the surface name decides first.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const [list, hv, r, b, f, open] = await Promise.all([
      read($, machines),
      read($, herdr),
      read($, relay),
      read($, board),
      read($, freshness),
      read($, detail),
    ])
    const now = await $.clock.now()
    const isUp = (m: Machine) => m.lastSeenSecs !== null && m.lastSeenSecs < DOWN_AFTER_SECS
    const up = list.filter(isUp).length
    const allUp = list.length > 0 && up === list.length
    const herdrWorking = hv.agents.filter(a => a.status === 'working').length
    const herdrIdle = hv.agents.filter(a => a.status === 'idle').length
    const herdrDone = hv.agents.filter(a => a.status === 'done').length
    const boardWorking = b.agents.filter(a => a.status === 'working').length
    const hottest = list.reduce<number | null>(
      (max, m) => (m.tempC !== null && (max === null || m.tempC > max) ? m.tempC : max),
      null,
    )
    const errors = [f.prometheusError === null ? null : shortError('prometheus', f.prometheusError), f.herdrError, f.relayError].filter((t): t is string => t !== null)
    // A shortened Prometheus error keeps its full text for the open detail.
    const promFull = f.prometheusError !== null && shortError('prometheus', f.prometheusError) !== f.prometheusError ? f.prometheusError : null
    const stale = staleness(f, now)
    const isFresh = stale !== null && stale < options.refreshSeconds * 3000 && errors.length === 0
    const statusColor = (status: string) =>
      status === 'working' ? 'claude' : status === 'idle' ? 'warning' : 'inactive'
    const statusMark = (status: string) =>
      status === 'working' ? '◐' : status === 'idle' ? '◌' : '✓'

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={allUp ? 'success' : 'error'} weight="semibold">
            {list.length > 0 ? `${up}/${list.length} up` : 'no data'}
          </Text>
          <Text>· {herdrWorking} working</Text>
          <Text color={r.ok ? 'success' : 'warning'}>· relay {r.ok ? 'ok' : 'warn'}</Text>
          {hottest !== null && <Text>· {Math.round(hottest)}°</Text>}
        </Box>
      )
    }

    const gauge = (label: string, value: number | null, text: string, ink: string) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        {Svg && <Svg source={ring(value, ink)} alt={`${label} ${text}`} width={30} height={30} />}
        <Box flexDirection="column">
          <Text weight="semibold" tabular>
            {text}
          </Text>
          <Text dimColor size="caption">
            {label}
          </Text>
        </Box>
      </Box>
    )

    const card = (m: Machine) => (
      <Box
        key={m.name}
        flexDirection="column"
        flexGrow={1}
        minWidth={34}
        padding={1}
        gap={1}
        backgroundColor={CARD_BG}
      >
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={isUp(m) ? 'success' : 'error'} weight="semibold">
              {isUp(m) ? '●' : '○'} {m.name}
            </Text>
            {!isUp(m) && (
              <Text color="error" size="caption">
                {m.lastSeenSecs === null ? 'never seen' : `silent ${Math.round(m.lastSeenSecs / 60)}m`}
              </Text>
            )}
          </Box>
          {m.spend24hUsd !== null && m.spend24hUsd >= 0.01 && (
            <Text dimColor size="caption" tabular>
              {compactUsd(m.spend24hUsd)} / 24h
            </Text>
          )}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1}>
          {gauge('CPU', m.cpuPct, m.cpuPct === null ? '–' : `${Math.round(m.cpuPct)}%`, loadInk(m.cpuPct))}
          {gauge('Mem', m.memPct, m.memPct === null ? '–' : `${Math.round(m.memPct)}%`, loadInk(m.memPct))}
          {gauge(
            'Temp',
            m.tempC,
            m.tempC === null ? '–' : `${Math.round(m.tempC)}°`,
            tempInk(m.tempC),
          )}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          {Svg && (
            <Svg
              source={segments(m.panesWorking, m.panesIdle, m.panesDone)}
              alt={`${m.panesWorking} working, ${m.panesIdle} idle, ${m.panesDone} done`}
              width={120}
              height={4}
            />
          )}
          <Text dimColor size="caption">
            {m.panesWorking} working · {m.panesIdle} idle · {m.panesDone} done · {m.leads} leads
          </Text>
        </Box>
      </Box>
    )

    // The terminal has no Svg, so a machine is three tight rows of text and block glyphs.
    const { statTile, gaugeLine, statusChip, chipRow } = widgets(els)
    const compactCard = (m: Machine) => (
      <Box key={m.name} flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text color={isUp(m) ? 'success' : 'error'} weight="semibold">
              {isUp(m) ? '●' : '○'} {m.name}
            </Text>
            {!isUp(m) && (
              <Text color="error" size="caption">
                {m.lastSeenSecs === null ? 'never seen' : `silent ${Math.round(m.lastSeenSecs / 60)}m`}
              </Text>
            )}
          </Box>
          {m.spend24hUsd !== null && m.spend24hUsd >= 0.01 && (
            <Text dimColor size="caption" tabular>
              {usd(m.spend24hUsd)} / 24h
            </Text>
          )}
        </Box>
        <Box flexDirection="row" gap={2}>
          {gaugeLine(`${m.name}-cpu`, 'CPU', m.cpuPct, m.cpuPct === null ? '–' : `${Math.round(m.cpuPct)}%`)}
          {gaugeLine(`${m.name}-mem`, 'Mem', m.memPct, m.memPct === null ? '–' : `${Math.round(m.memPct)}%`)}
          <Text color={tempColor(m.tempC)} weight="semibold" tabular>
            {m.tempC === null ? '–' : `${Math.round(m.tempC)}°`}
          </Text>
        </Box>
        <Text dimColor size="caption">
          {m.panesWorking} working · {m.panesIdle} idle · {m.panesDone} done · {m.leads} leads
        </Text>
      </Box>
    )

    const totalWorking = list.reduce((s, m) => s + m.panesWorking, 0)
    const totalIdle = list.reduce((s, m) => s + m.panesIdle, 0)
    const totalSpend = list.reduce((s, m) => s + (m.spend24hUsd ?? 0), 0)
    const summaryTiles = (
      <Box flexDirection="row" gap={1}>
        {statTile('t-working', 'working', String(totalWorking), `${totalIdle} idle · ${list.length} machines`, 'claude')}
        {statTile('t-spend', 'spend 24h', usd(totalSpend), 'all machines')}
        {statTile(
          't-relay',
          'relay waiting',
          String(r.inboxWaiting),
          `${r.deadLetters} dead letters`,
          r.deadLetters > 0 ? 'warning' : undefined,
        )}
      </Box>
    )

    const agentRow = (key: string, status: string, where: string, title: string, tail: string) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Text color={statusColor(status)}>{statusMark(status)}</Text>
        <Text dimColor>{where}</Text>
        <Text>{title}</Text>
        <Text dimColor>{tail}</Text>
      </Box>
    )

    const detailRows: RenderElement[] =
      open === 'herdr'
        ? hv.agents.map(a => agentRow(a.paneId, a.status, a.workspace, a.title || a.paneId, a.agent))
        : open === 'relay'
          ? r.checks
              .filter(c => c.status !== 'ok' || c.check === 'watcher')
              .map((c, i) => (
                <Box key={`${c.check}-${i}`} flexDirection="row" gap={1}>
                  <Text color={c.status === 'ok' ? 'success' : 'warning'}>{c.status === 'ok' ? '●' : '▲'}</Text>
                  <Text dimColor>{c.check}</Text>
                  <Text>{c.message}</Text>
                </Box>
              ))
          : open === 'board'
            ? b.agents.map(a =>
                agentRow(
                  `${a.machine}:${a.paneId}`,
                  a.status,
                  a.team,
                  a.title || a.paneId,
                  `${a.agent}${a.machine ? ` · ${a.machine}` : ''}`,
                ),
              )
            : []

    const boardError = b.error !== null
    const [boardMark, boardColor]: [string, 'success' | 'warning' | 'inactive'] = boardError
      ? ['▲', 'warning']
      : !f.boardBusy && b.agents.length > 0
        ? ['●', 'success']
        : ['◌', 'inactive']
    const detailSummary =
      open === 'herdr'
        ? `${herdrWorking} working · ${herdrIdle} idle · ${herdrDone} done`
        : open === 'relay'
          ? `${r.watchers.filter(w => w.status === 'ok').length}/${r.watchers.length} watchers · ` +
            `${r.inboxWaiting} waiting · ${r.deadLetters} dead letters`
          : `${b.teams.join(' · ') || 'no teams configured'} · ${b.agents.length > 0 ? `${boardWorking}/${b.agents.length} working` : f.boardBusy ? 'collecting…' : 'no data'}`
    const detailError = open === 'herdr' ? f.herdrError : open === 'relay' ? f.relayError : open === 'board' ? b.error : null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading" color={Svg ? undefined : ACCENT}>
              Factory
            </Text>
            <Text color={allUp ? 'success' : list.length > 0 ? 'error' : 'inactive'} size="caption">
              {list.length > 0 ? `${up}/${list.length} up` : 'waiting for Prometheus'}
            </Text>
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Link href={options.grafanaUrl} label="Grafana" />
            <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void refreshAll($, options)} />
          </Box>
        </Box>

        {f.prometheusError !== null && (
          <Text color="warning" size="caption">
            {`Metrics unavailable: ${shortError('prometheus', f.prometheusError)}${f.prometheusAt !== null && list.length > 0 ? ` · values from ${ago(f.prometheusAt, now)}` : ''}`}
          </Text>
        )}

        {!Svg && list.length > 0 && summaryTiles}

        {Svg ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {list.map(card)}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {list.map(compactCard)}
          </Box>
        )}

        {chipRow([
          statusChip('herdr', 'herdr', 'h', ...chipMark(f.herdrError, f.herdrAt, hv.running, '○', 'error'), open === 'herdr', () => void toggleDetail($, 'herdr')),
          statusChip('relay', 'ix-relay', 'x', ...chipMark(f.relayError, f.relayAt, r.ok, '▲', 'warning'), open === 'relay', () => void toggleDetail($, 'relay')),
          statusChip('board', 'ix-board', 'b', boardMark, boardColor, open === 'board', () => void toggleDetail($, 'board')),
        ])}

        {open !== 'none' && (
          <Box flexDirection="column" paddingX={1}>
            <Text dimColor size="caption">
              {detailSummary}
            </Text>
            {promFull && (
              <Text dimColor size="caption">
                prometheus: {promFull}
              </Text>
            )}
            {detailError && (
              <Text color="warning" size="caption">
                {detailError}
              </Text>
            )}
            {detailRows}
          </Box>
        )}

        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor size="caption">
            {list.length > 0 && !f.nodeMetricsSeen ? 'CPU, memory and temperature appear once a node exporter is scraped.' : ''}
          </Text>
          <Text color={isFresh ? 'subtle' : 'warning'} size="caption" wrap="truncate-end">
            {errors.length > 0 ? errors[0] : stale === null ? 'connecting…' : `updated ${ago(now - stale, now)}`}
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

type ChipState = ['●' | '▲' | '○' | '◌', 'success' | 'warning' | 'error' | 'inactive']

/** A chip's mark: a failed read is ▲ first, a service not yet read is ◌, else up is ● and down is `downMark`. */
function chipMark(error: string | null, readAt: number | null, isUp: boolean, downMark: '○' | '▲', downColor: 'error' | 'warning'): ChipState {
  if (error !== null) return ['▲', 'warning']
  if (readAt === null) return ['◌', 'inactive']
  return isUp ? ['●', 'success'] : [downMark, downColor]
}
