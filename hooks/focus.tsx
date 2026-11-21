import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FocusMeta, FocusProject, FocusView } from '../types'
import { CARD_BG, INK, ago, errorText, progressBar, runJson, runText } from './shared'
import type { Options } from './shared'

// The Focus pane: one card per named focus. A focus belongs to a coordinator agent: its
// scope and focus line come from the coordinator's ix-relay work report, its progress from
// `ix-board focus status` over that scope. Today a coordinator holds one focus; the list
// is already a list, so named focuses only add cards.

const PANE = 'focus'
const TITLE = 'Focus'
const POLL_MS = 2 * 60 * 1000

const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], {
  shape: 'focuses-1',
})
const focusMeta = atom(
  { plugin: 'factory-panel', key: 'focusMeta' } as const,
  { at: null, busy: false, error: null } as FocusMeta,
  { shape: 'focusMeta-1' },
)
const focusCollapsed = atom({ plugin: 'factory-panel', key: 'focusCollapsed' } as const, [] as string[])
const focusShowDone = atom({ plugin: 'factory-panel', key: 'focusShowDone' } as const, false)

// ---------------------------------------------------------------- data

type WorkReport = {
  binding?: { machine?: string; kind?: string; address?: string }
  scope?: { initiatives?: string[]; projects?: string[]; tickets?: string[]; reported_at_ms?: number }
  focus?: { summary?: string; reported_at_ms?: number }
}

type FocusStatus = {
  fetched_at?: number
  ready_queue?: unknown[]
  projects?: {
    name: string
    progress?: { done?: number; total?: number }
    in_progress?: unknown[]
  }[]
}

/** The verified lead addresses `agent-msg who` lists; unverified rows start with `-`. */
async function listLeads($: EngineInterface): Promise<string[]> {
  const text = await runText($, ['agent-msg', 'who'], 20_000)
  return text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(address => address.split(':').length === 3)
}

async function readReport($: EngineInterface, lead: string): Promise<WorkReport | null> {
  try {
    return await runJson<WorkReport>($, ['agent-msg', 'work', '--lead', lead, 'show'], 20_000)
  } catch {
    return null
  }
}

const scopeArgs = (report: WorkReport): string[] => [
  ...(report.scope?.initiatives ?? []).flatMap(id => ['--initiative', id]),
  ...(report.scope?.projects ?? []).flatMap(id => ['--project', id]),
  ...(report.scope?.tickets ?? []).flatMap(id => ['--issue', id]),
]

async function focusOf($: EngineInterface, lead: string, report: WorkReport): Promise<FocusView> {
  const view: FocusView = {
    address: report.binding?.address ?? lead,
    machine: report.binding?.machine ?? lead.split(':')[0] ?? '',
    kind: report.binding?.kind ?? '',
    summary: report.focus?.summary ?? '',
    scope: {
      initiatives: report.scope?.initiatives?.length ?? 0,
      projects: report.scope?.projects?.length ?? 0,
      tickets: report.scope?.tickets?.length ?? 0,
    },
    focusReportedAt: report.focus?.reported_at_ms ?? report.scope?.reported_at_ms ?? null,
    fetchedAt: null,
    projects: [],
    ready: 0,
    error: null,
  }
  const args = scopeArgs(report)
  if (args.length === 0) return view
  try {
    const status = await runJson<FocusStatus>($, ['ix-board', '--json', 'focus', 'status', ...args], 180_000)
    view.fetchedAt = typeof status.fetched_at === 'number' ? status.fetched_at * 1000 : null
    view.ready = status.ready_queue?.length ?? 0
    view.projects = (status.projects ?? []).map(
      (p): FocusProject => ({
        name: p.name,
        done: p.progress?.done ?? 0,
        total: p.progress?.total ?? 0,
        inProgress: p.in_progress?.length ?? 0,
      }),
    )
  } catch (error) {
    view.error = errorText(error)
  }
  return view
}

async function pollFocus($: EngineInterface): Promise<void> {
  await update($, focusMeta, m => ({ ...m, busy: true }))
  try {
    const leads = await listLeads($)
    const reports = await Promise.all(leads.map(async lead => ({ lead, report: await readReport($, lead) })))
    const withFocus = reports.filter(
      (r): r is { lead: string; report: WorkReport } =>
        r.report !== null && (scopeArgs(r.report).length > 0 || Boolean(r.report.focus?.summary)),
    )
    const views = await Promise.all(withFocus.map(r => focusOf($, r.lead, r.report)))
    views.sort((a, b) => a.address.localeCompare(b.address))
    await update($, focuses, () => views)
    const now = await $.clock.now()
    await update($, focusMeta, () => ({ at: now, busy: false, error: null }))
  } catch (error) {
    await update($, focusMeta, m => ({ ...m, busy: false, error: errorText(error) }))
  }
}

async function toggleCollapsed($: EngineInterface, address: string): Promise<void> {
  await update($, focusCollapsed, list =>
    list.includes(address) ? list.filter(a => a !== address) : [...list, address],
  )
}

async function toggleShowDone($: EngineInterface): Promise<void> {
  await update($, focusShowDone, v => !v)
}

// ---------------------------------------------------------------- pane

/** Registers the command, opens the pane and starts polling; called once at session start. */
export async function startFocus($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'focuses', description: 'Open the Focus pane: named focuses and their progress' })
  void $.ui.open({ id: PANE, title: TITLE })
  void pollFocus($)
  $.clock.every(POLL_MS, () => pollFocus($))
}

export function registerFocus(on: On, _options: Options): void {
  on('command.run', { command: 'focuses' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    void pollFocus($)
    return { text: opened.isPlaced ? 'Focus pane opened.' : `Focus pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Progress } = els
    const Svg = 'Svg' in els ? els.Svg : null
    const [list, meta, collapsed, showDone] = await Promise.all([
      read($, focuses),
      read($, focusMeta),
      read($, focusCollapsed),
      read($, focusShowDone),
    ])
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)

    const bar = (done: number, total: number, cells: number, key: string) =>
      Svg ? (
        <Svg source={progressBar(done, total, cells * 7)} alt={`${done} of ${total} done`} width={cells * 7} height={6} />
      ) : (
        <Progress key={key} label="" value={done} max={Math.max(1, total)} />
      )

    if (e.props.placement === 'widget') {
      const first = list[0]
      const done = first?.projects.reduce((s, p) => s + p.done, 0) ?? 0
      const total = first?.projects.reduce((s, p) => s + p.total, 0) ?? 0
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{list.length} focus{list.length === 1 ? '' : 'es'}</Text>
          {first && total > 0 && <Text dimColor>· {Math.round((100 * done) / total)}% {first.address}</Text>}
        </Box>
      )
    }

    const card = (f: FocusView) => {
      const done = f.projects.reduce((s, p) => s + p.done, 0)
      const total = f.projects.reduce((s, p) => s + p.total, 0)
      const inProgress = f.projects.reduce((s, p) => s + p.inProgress, 0)
      const left = total - done
      const isOpen = !collapsed.includes(f.address)
      const open = f.projects.filter(p => p.done < p.total).sort((a, b) => b.total - b.done - (a.total - a.done))
      const finished = f.projects.filter(p => p.total > 0 && p.done >= p.total)
      const rows = showDone ? [...open, ...finished] : open
      const nameCells = Math.min(38, Math.max(16, ...rows.map(p => p.name.length)))
      const barCells = Math.max(6, Math.min(18, width - nameCells - 22))

      return (
        <Box key={f.address} flexDirection="column" padding={1} gap={1} backgroundColor={CARD_BG}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Button
              key={`focus-${f.address}`}
              plain
              label={`${isOpen ? '▾' : '▸'} ${f.address}`}
              onPress={() => void toggleCollapsed($, f.address)}
            />
            {total > 0 && (
              <Text weight="semibold" size="heading" tabular>
                {Math.round((100 * done) / total)}%
              </Text>
            )}
          </Box>

          {f.summary && (
            <Text dimColor size="footnote">
              {f.summary}
            </Text>
          )}

          {total > 0 && (
            <Box flexDirection="column">
              {bar(done, total, Math.max(10, Math.min(48, width - 6)), `all-${f.address}`)}
              <Box flexDirection="row" gap={2}>
                <Text size="caption" tabular>
                  {done}/{total} done
                </Text>
                <Text dimColor size="caption" tabular>
                  {left} left
                </Text>
                <Text dimColor size="caption" tabular>
                  {inProgress} in progress
                </Text>
                <Text dimColor size="caption" tabular>
                  {f.ready} ready
                </Text>
              </Box>
            </Box>
          )}

          {f.error && (
            <Text color="warning" size="caption">
              {f.error}
            </Text>
          )}

          {isOpen && rows.length > 0 && (
            <Box flexDirection="column">
              {rows.map(p => (
                <Box key={p.name} flexDirection="row" gap={1} alignItems="center">
                  <Box width={nameCells}>
                    <Text dimColor={p.done >= p.total} wrap="truncate-end">
                      {p.name}
                    </Text>
                  </Box>
                  {bar(p.done, p.total, barCells, `p-${f.address}-${p.name}`)}
                  <Box width={8}>
                    <Text dimColor size="caption" tabular>
                      {p.done}/{p.total}
                    </Text>
                  </Box>
                  {p.done < p.total && (
                    <Text size="caption" tabular>
                      {p.total - p.done} left
                    </Text>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {isOpen && finished.length > 0 && (
            <Button
              key={`done-${f.address}`}
              plain
              label={showDone ? 'hide complete' : `+ ${finished.length} complete`}
              onPress={() => void toggleShowDone($)}
            />
          )}

          <Text dimColor size="caption">
            {f.kind && `${f.kind} · `}
            {f.fetchedAt !== null ? `Linear ${ago(f.fetchedAt, now)}` : 'no tracker data'}
            {f.focusReportedAt !== null && ` · focus set ${ago(f.focusReportedAt, now)}`}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">
              Focus
            </Text>
            <Text dimColor size="caption">
              {list.length} {list.length === 1 ? 'focus' : 'focuses'}
            </Text>
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollFocus($)} />
        </Box>

        {list.length === 0 && (
          <Text dimColor>
            {meta.busy || meta.at === null
              ? 'Reading coordinators’ focus reports…'
              : 'No coordinator has reported a focus. A coordinator sets one with agent-msg work scope and agent-msg work focus.'}
          </Text>
        )}

        {list.map(card)}

        <Box flexDirection="row" justifyContent="flex-end">
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
            {meta.error ?? (meta.busy ? 'refreshing…' : `updated ${ago(meta.at, now)}`)}
          </Text>
        </Box>
      </Box>
    )
  })
}
