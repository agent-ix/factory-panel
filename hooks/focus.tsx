import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FocusMeta, FocusProject, FocusView } from '../types'
import { widgets } from './ui/widgets'
import { ACCENT } from './ui/glyphs'
import { CARD_BG, INK, ago, errorText, pausedText, progressBar, runJson, runText } from './shared'
import { gatedBoard } from './linear'
import { focusTeams, scopeFocuses, teamOf } from './band/modules'
import { getSelection, scopeOf, selectionReady } from './selection'
import type { Options } from './shared'

// The Focus pane: one card per named focus. A focus belongs to a coordinator agent: its
// scope and focus line come from the coordinator's ix-relay work report, its progress from
// `ix-board focus status` over that scope. Today a coordinator holds one focus; the list
// is already a list, so named focuses only add cards.

const PANE = 'focus'
const TITLE = 'Focus'
export const PANE_SPEC = { id: PANE, title: TITLE }
const POLL_MS = 2 * 60 * 1000

const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], {
  shape: 'focuses-3',
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
  status?: string
  binding?: { machine?: string; kind?: string; model?: string; address?: string }
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

type FocusRead = { fetchedAt: number | null; ready: number; projects: FocusProject[] }

async function readFocus($: EngineInterface, args: string[]): Promise<FocusRead> {
  const status = await runJson<FocusStatus>($, ['ix-board', '--json', 'focus', 'status', ...args], 180_000)
  return {
    fetchedAt: typeof status.fetched_at === 'number' ? status.fetched_at * 1000 : null,
    ready: status.ready_queue?.length ?? 0,
    projects: (status.projects ?? []).map(
      (p): FocusProject => ({
        name: p.name,
        done: p.progress?.done ?? 0,
        total: p.progress?.total ?? 0,
        inProgress: Math.max(0, Math.min(p.in_progress?.length ?? 0, (p.progress?.total ?? 0) - (p.progress?.done ?? 0))),
      }),
    ),
  }
}

async function focusOf($: EngineInterface, lead: string, report: WorkReport, manual: boolean): Promise<FocusView> {
  const view: FocusView = {
    address: report.binding?.address ?? lead,
    machine: report.binding?.machine ?? lead.split(':')[0] ?? '',
    kind: report.binding?.kind ?? '',
    model: report.binding?.model ?? null,
    summary: report.focus?.summary ?? '',
    status: typeof report.status === 'string' ? report.status.toLowerCase() : '',
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
  const read = await gatedBoard($, `focus:${args.join(' ')}`, () => readFocus($, args), { manual })
  if (read.data) Object.assign(view, read.data)
  const now = await $.clock.now()
  view.error = read.backoffUntil !== null ? pausedText(read.backoffUntil, now) : read.error
  return view
}

export async function pollFocus($: EngineInterface, manual = false): Promise<void> {
  await update($, focusMeta, m => ({ ...m, busy: true }))
  try {
    // The scope needs to know who this session is before it knows which leads to read.
    await selectionReady()
    const scope = scopeOf(getSelection())
    const teams = focusTeams(scope)
    const leads = (await listLeads($)).filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
    const reports = await Promise.all(leads.map(async lead => ({ lead, report: await readReport($, lead) })))
    const withFocus = reports.filter(
      (r): r is { lead: string; report: WorkReport } =>
        r.report !== null && (scopeArgs(r.report).length > 0 || Boolean(r.report.focus?.summary)),
    )
    const views = await Promise.all(withFocus.map(r => focusOf($, r.lead, r.report, manual)))
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

/** Registers the command and starts polling; called once at session start. register.tsx opens the pane. */
export async function startFocus($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'focuses', description: 'Same as /factory focus' })
  void pollFocus($)
  $.clock.every(POLL_MS, () => pollFocus($))
}

export function registerFocus(on: On, _options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const { segmentBar, progressRow, legend } = widgets(els)
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const [all, meta, collapsed, showDone] = await Promise.all([
      read($, focuses),
      read($, focusMeta),
      read($, focusCollapsed),
      read($, focusShowDone),
    ])
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    // Only the focuses the selection shows; the team scope groups them under each team.
    const scope = scopeOf(getSelection())
    const { shown: list, note } = scopeFocuses(all, scope)
    const grouped = scope.focus.trim().toLowerCase() === 'team'

    const bar = (done: number, inProgress: number, ready: number, total: number, cells: number) =>
      Svg && (
      <Svg source={progressBar(done, total, cells * 7, total > 0 && done >= total ? INK.good : INK.calm, inProgress, ready)} alt={`${done} of ${total} done`} width={cells * 7} height={6} />
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
      const isOpen = !collapsed.includes(f.address)
      const open = f.projects.filter(p => p.done < p.total).sort((a, b) => b.total - b.done - (a.total - a.done))
      const finished = f.projects.filter(p => p.total > 0 && p.done >= p.total)
      const rows = showDone ? [...open, ...finished] : open
      const nameCells = Math.min(38, Math.max(16, ...rows.map(p => p.name.length)))
      const barCells = Math.max(6, Math.min(18, width - nameCells - 14))
      // Terminal row width = name + bar + 10-column count + 2 gaps, inside the card's padding of 1 each side.
      const room = width - 3 - 12 // the card padding, one spare column, the row's two gaps and its 10-column count
      const termNameCells = Math.max(8, Math.min(30, room - 8, Math.max(10, ...rows.map(p => p.name.length))))
      const termBarCells = Math.max(8, room - termNameCells)

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
              <Text weight="semibold" size="heading" tabular color={Svg ? undefined : ACCENT}>
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
              {Svg
                ? bar(done, inProgress, f.ready, total, Math.max(10, Math.min(48, width - 6)))
                : segmentBar(`all-${f.address}`, done, inProgress, f.ready, total, termBarCells)}
              <Box flexDirection="row" gap={2}>
                {Svg ? (
                  <Box flexDirection="row" gap={2}>
                    <Text size="caption" tabular>
                      {done} / {total} done
                    </Text>
                    <Text dimColor size="caption" tabular>
                      {inProgress} in progress
                    </Text>
                    <Text dimColor size="caption" tabular>
                      {f.ready} ready
                    </Text>
                  </Box>
                ) : (
                  <Text dimColor size="caption" tabular wrap="truncate-end">
                    {done}/{total} done · {inProgress} in progress · {f.ready} ready
                  </Text>
                )}
              </Box>
              {legend()}
            </Box>
          )}

          {f.error && (
            <Text color="warning" size="caption">
              {f.error}
            </Text>
          )}

          {isOpen && rows.length > 0 && (
            <Box flexDirection="column">
              {Svg
                ? rows.map(p => (
                    <Box key={p.name} flexDirection="row" gap={1} alignItems="center">
                      <Box width={nameCells}>
                        <Text dimColor={p.done >= p.total} wrap="truncate-end">
                          {p.name}
                        </Text>
                      </Box>
                      {bar(p.done, p.inProgress, 0, p.total, barCells)}
                      <Box width={10} justifyContent="flex-end">
                        <Text dimColor size="caption" tabular>
                          {p.done}/{p.total}
                        </Text>
                      </Box>
                    </Box>
                  ))
                : rows.map(p =>
                    progressRow(`p-${f.address}-${p.name}`, p.name, p.done, p.inProgress, 0, p.total, termNameCells, termBarCells, p.done >= p.total),
                  )}
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

          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor size="caption">
              {modelName(f.model) ?? f.kind}
            </Text>
            <Text dimColor size="caption" tabular>
              {[
                f.focusReportedAt !== null && `focus ${age(f.focusReportedAt, now)}`,
                f.fetchedAt !== null && `synced ${age(f.fetchedAt, now)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Box>
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
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollFocus($, true)} />
        </Box>

        {list.length === 0 && (
          <Text dimColor>
            {meta.busy || meta.at === null
              ? 'Reading coordinators’ focus reports…'
              : 'No coordinator has reported a focus. A coordinator sets one with agent-msg work scope and agent-msg work focus.'}
          </Text>
        )}

        {note !== null && (
          <Text color="warning" size="caption">
            {note}
          </Text>
        )}
        {scope.identity === 'unknown' && (
          <Text dimColor size="caption">
            Could not tell who this session is, so every focus is shown.
          </Text>
        )}

        {list.map((f, i) => (
          <Box key={f.address} flexDirection="column" gap={1}>
            {grouped && (i === 0 || teamOf(list[i - 1]!.address).toLowerCase() !== teamOf(f.address).toLowerCase()) && (
              <Text weight="semibold">{teamOf(f.address)}</Text>
            )}
            {card(f)}
          </Box>
        ))}

        <Box flexDirection="row" justifyContent="flex-end">
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
            {meta.error ?? (meta.busy ? 'refreshing…' : `updated ${ago(meta.at, now)}`)}
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

/** An age without the "ago": 19h, 6m. */
const age = (at: number, now: number): string => ago(at, now).replace(/ ago$/, '')

/** A model id as people say it: claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1 Sol. */
export const modelName = (id: string | null): string | null => {
  if (!id) return null
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (claude) return `${cap(claude[1] ?? '')} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/.exec(id)
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split('-').map(cap).join(' ')}` : ''}`
  return id
}
