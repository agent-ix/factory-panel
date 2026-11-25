import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FocusInitiative, FocusMeta, FocusProject, FocusView, FocusWarning, SourceError } from '../types'
import { widgets } from './ui/widgets'
import { ACCENT } from './ui/glyphs'
import { CARD_BG, INK, ago, errorText, pausedText, progressBar, runJson, runText } from './shared'
import { REFRESH_BUDGET_MS, resetBoard, selectorsOfScope } from './board'
import { loadProgress } from './progressview'
import type { Selector } from './board'
import { matchLeads, resolveDefinitions } from './namedfocus'
import type { Resolved } from './namedfocus'
import { STALE_MS } from './progress'
import { setSelectorErrors, sourceClear, sourceFailed, sourceOk } from './sources'
import { focusDetail } from './showfocus'
import { focusBanner, focusTeams, scopeFocuses, statusOf, teamOf } from './band/modules'
import { getSelection, scopeOf, selectionReady } from './selection'
import type { Selection } from './selection'
import type { Options } from './shared'

// The Focus pane: one card per named focus. A focus belongs to a coordinator agent: its
// scope and focus line come from the coordinator's ix-relay work report, its progress from
// `ix-board focus status` over that scope. Today a coordinator holds one focus; the list
// is already a list, so named focuses only add cards.

const PANE = 'focus'
const TITLE = 'Focus'
export const PANE_SPEC = { id: PANE, title: TITLE }
const POLL_MS = 2 * 60 * 1000
/** an agent-msg call is given up on after this long. */
const WORK_TIMEOUT_MS = 5_000
export const NO_SELECTORS = 'no selectors'

const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], {
  shape: 'focuses-5',
})
const focusMeta = atom(
  { plugin: 'factory-panel', key: 'focusMeta' } as const,
  { at: null, busy: false, error: null, errors: [] } as FocusMeta,
  { shape: 'focusMeta-2' },
)
export const focusCollapsed = atom({ plugin: 'factory-panel', key: 'focusCollapsed' } as const, [] as string[])
const focusShowDone = atom({ plugin: 'factory-panel', key: 'focusShowDone' } as const, false)
/** Whether the footer warning is expanded to its full messages. */
const focusWarnings = atom({ plugin: 'factory-panel', key: 'focusWarnings' } as const, false)

// ---------------------------------------------------------------- data

type WorkReport = {
  binding?: { machine?: string; kind?: string; address?: string }
  agents?: { status?: string }[]
  scope?: { initiatives?: string[]; projects?: string[]; tickets?: string[]; reported_at_ms?: number } | null
  focus?: { summary?: string; reported_at_ms?: number } | null
}

/** The verified lead addresses `agent-msg who` lists; unverified rows start with `-`. */
async function listLeads($: EngineInterface): Promise<string[]> {
  const text = await runText($, ['agent-msg', 'who'], WORK_TIMEOUT_MS)
  return text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(address => address.split(':').length === 3)
}

/** `agent-msg work show` prints `null` for a lead that has reported nothing: that is no report, not a failure. */
async function readReport($: EngineInterface, lead: string): Promise<{ report: WorkReport | null } | { error: string }> {
  try {
    return { report: await runJson<WorkReport | null>($, ['agent-msg', 'work', '--lead', lead, 'show'], WORK_TIMEOUT_MS) }
  } catch (error) {
    return { error: errorText(error) }
  }
}

type Entry = { view: FocusView; selectors: Selector[] }

const blank = (address: string): FocusView => ({
  address,
  machine: address.split(':')[0] ?? '',
  kind: '',
  summary: '',
  status: 'unknown',
  scope: { initiatives: 0, projects: 0, tickets: 0 },
  focusReportedAt: null,
  fetchedAt: null,
  initiatives: [],
  loose: [],
  header: null,
  warnings: [],
  title: null,
  via: null,
  notes: [],
})

const leadEntry = (lead: string, report: WorkReport): Entry => ({
  view: {
    ...blank(report.binding?.address ?? lead),
    machine: report.binding?.machine ?? lead.split(':')[0] ?? '',
    kind: report.binding?.kind ?? '',
    summary: report.focus?.summary ?? '',
    status: statusOf(report.agents),
    scope: {
      initiatives: report.scope?.initiatives?.length ?? 0,
      projects: report.scope?.projects?.length ?? 0,
      tickets: report.scope?.tickets?.length ?? 0,
    },
    focusReportedAt: report.focus?.reported_at_ms ?? report.scope?.reported_at_ms ?? null,
  },
  selectors: selectorsOfScope(report.scope),
})

const definitionEntry = (d: Resolved): Entry => ({
  view: {
    ...blank(d.focusId),
    kind: 'named focus',
    title: d.name,
    via: 'definition',
    notes: d.notes,
    scope: {
      initiatives: d.selectors.filter(s => s.kind === 'initiative').length,
      projects: d.selectors.filter(s => s.kind === 'project' || s.kind === 'milestone').length,
      tickets: d.selectors.filter(s => s.kind === 'ticket').length,
    },
  },
  selectors: d.unavailable ? [] : d.selectors,
})

/** The banner line for the focuses now held; `/factory show` prints the same line. */
export async function focusBannerNow($: EngineInterface, sel: Selection): Promise<string | null> {
  const scope = scopeOf(sel)
  return focusBanner(scope, await read($, focuses))
}

/** The lines of `/factory show` for the focuses the selection shows: notes, totals, and every initiative and project with its numbers. */
export async function focusDetailNow($: EngineInterface, sel: Selection): Promise<string[]> {
  const all = await read($, focuses)
  const { shown, note } = scopeFocuses(all, scopeOf(sel))
  return [...(note === null ? [] : [note]), ...focusDetail(shown, await $.clock.now())]
}

/** One refresh at a time: a tick that arrives during one is run once, after it. */
let running: Promise<void> | null = null
let again = false
let againManual = false

export function pollFocus($: EngineInterface, manual = false): Promise<void> {
  if (running !== null) {
    again = true
    againManual ||= manual
    return running
  }
  running = (async () => {
    try {
      let asManual = manual
      do {
        again = false
        againManual = false
        await refreshFocus($, asManual)
        asManual = againManual
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

/** Forgets the refresh state of an earlier session; the tests start each session from nothing. */
export function resetFocus(): void {
  resetBoard()
  running = null
  again = false
  againManual = false
}

async function refreshFocus($: EngineInterface, manual: boolean): Promise<void> {
  await update($, focusMeta, m => ({ ...m, busy: true }))
  try {
    // The scope needs to know who this session is before it knows which leads to read.
    await selectionReady()
    const scope = scopeOf(getSelection())
    const teams = focusTeams(scope)
    const name = scope.focus.trim()
    const isName = name !== '' && !['own', 'team'].includes(name.toLowerCase())
    const errors: SourceError[] = []

    const gather = async (): Promise<{ lead: string; report: WorkReport }[]> => {
      let leads: string[]
      try {
        leads = (await listLeads($)).filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
      } catch (error) {
        errors.push({ source: 'agent-msg work', text: errorText(error) })
        sourceFailed('agent-msg work', errorText(error))
        return []
      }
      const read = await Promise.all(leads.map(async lead => ({ lead, read: await readReport($, lead) })))
      const failedReads = read.flatMap(r => ('error' in r.read ? [{ lead: r.lead, error: r.read.error }] : []))
      // A failure is shown for the leads the scope is about: those inside the team filter, those whose address is
      // the name typed, and, when every lead is read, any lead if all of them failed (one with no live agent is normal there).
      const named = isName ? matchLeads(name, leads).map(a => a.toLowerCase()) : []
      const shownFails = failedReads.filter(x => teams !== null || named.includes(x.lead.toLowerCase()) || failedReads.length === read.length)
      if (shownFails.length > 0) {
        const text = shownFails.map(x => `${x.lead}: ${x.error}`).join(' · ')
        errors.push({ source: 'agent-msg work', text })
        sourceFailed('agent-msg work', text)
      } else sourceOk('agent-msg work', await $.clock.now())
      return read.flatMap(r => ('report' in r.read && r.read.report !== null ? [{ lead: r.lead, report: r.read.report }] : []))
    }
    const lookup = async (): Promise<Resolved[]> => {
      if (!isName) return []
      let failed: string | null = null
      const found = await resolveDefinitions($, name, scope.identity === 'detected' ? scope.ownTeam : null, m => {
        failed = failed === null ? m : `${failed} · ${m}`
      })
      if (failed !== null) {
        errors.push({ source: 'agent-msg focuses', text: failed })
        sourceFailed('agent-msg focuses', failed)
      } else sourceOk('agent-msg focuses', await $.clock.now())
      return found
    }
    const [reports, defs] = await Promise.all([gather(), lookup()])

    const leadEntries = reports
      .filter(r => selectorsOfScope(r.report.scope).length > 0 || Boolean(r.report.focus?.summary))
      .map(r => leadEntry(r.lead, r.report))
    let entries: Entry[]
    if (!isName) entries = leadEntries
    else if (defs.length > 0) entries = defs.map(definitionEntry)
    else {
      const addresses = matchLeads(name, reports.map(r => r.lead))
      const byAddress = leadEntries.filter(e => addresses.some(a => a.toLowerCase() === e.view.address.toLowerCase()))
      if (byAddress.length > 0) entries = byAddress.map(e => ({ ...e, view: { ...e.view, via: 'lead' as const } }))
      else {
        const picked = scopeFocuses(leadEntries.map(e => e.view), scope).shown
        entries = leadEntries.filter(e => picked.includes(e.view)).map(e => ({ ...e, view: { ...e.view, via: 'summary' as const } }))
      }
    }
    entries.sort((a, b) => a.view.address.localeCompare(b.view.address))

    // Each source is drawn when it answers: the reports and definitions first, with the progress of the last refresh.
    const before = await read($, focuses)
    const first = entries.map(e => {
      const prior = before.find(f => f.address === e.view.address)
      const noSelectors = e.selectors.length === 0 && e.view.via !== 'definition'
      return { ...e.view, ...(prior === undefined ? {} : { initiatives: prior.initiatives, loose: prior.loose, header: prior.header, warnings: prior.warnings, fetchedAt: prior.fetchedAt }), notes: [...e.view.notes, ...(noSelectors ? [NO_SELECTORS] : [])] }
    })
    await update($, focuses, () => first)
    await update($, focusMeta, m => ({ ...m, errors }))

    const failed = new Map<string, { name: string; error: string }>()
    // The 30 seconds of the refresh count from here, the first ix-board call, not from the lookups above.
    const endsAt = (await $.clock.now()) + REFRESH_BUDGET_MS
    await Promise.all(
      entries.map(async e => {
        if (e.selectors.length === 0) return
        const progress = await loadProgress($, e.selectors, manual, endsAt, failed)
        if (progress === null) return
        await update($, focuses, list => list.map(f => (f.address === e.view.address ? { ...f, ...progress, notes: [...e.view.notes, ...(progress.notes ?? [])] } : f)))
      }),
    )
    // Sources nobody asks any more say nothing: ix-board when no focus has a selector, the named focus lookup when the choice is not a name.
    if (!isName) sourceClear('agent-msg focuses')
    if (entries.every(e => e.selectors.length === 0)) sourceClear('ix-board')
    setSelectorErrors(failed)
    const now = await $.clock.now()
    await update($, focusMeta, () => ({ at: now, busy: false, error: null, errors }))
  } catch (error) {
    await update($, focusMeta, m => ({ ...m, busy: false, error: errorText(error) }))
  }
}

async function toggleCollapsed($: EngineInterface, address: string): Promise<void> {
  await update($, focusCollapsed, list =>
    list.includes(address) ? list.filter(a => a !== address) : [...list, address],
  )
}

async function toggleWarnings($: EngineInterface): Promise<void> {
  await update($, focusWarnings, v => !v)
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
    const [all, meta, collapsed, showDone, warnOpen] = await Promise.all([
      read($, focuses),
      read($, focusMeta),
      read($, focusCollapsed),
      read($, focusShowDone),
      read($, focusWarnings),
    ])
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    // Only the focuses the selection shows; the team scope groups them under each team.
    const scope = scopeOf(getSelection())
    const { shown: list, note } = scopeFocuses(all, scope)
    const grouped = scope.focus.trim().toLowerCase() === 'team'
    const banner = focusBanner(scope, all)

    const bar = (done: number, inProgress: number, ready: number, total: number, cells: number, complete = false) =>
      Svg && (
      <Svg source={progressBar(done, total, cells * 7, complete ? INK.good : INK.calm, inProgress, ready)} alt={`${done} of ${total} done`} width={cells * 7} height={6} />
      )

    if (e.props.placement === 'widget') {
      const first = list[0]
      const done = first?.header?.done ?? 0
      const total = first?.header?.total ?? 0
      return (
        <Box flexDirection="row" gap={1}>
          <Text weight="semibold">{list.length} focus{list.length === 1 ? '' : 'es'}</Text>
          {first && total > 0 && <Text dimColor>· {Math.round((100 * done) / total)}% {first.address}</Text>}
        </Box>
      )
    }

    /** A bare UUID in a name is shown as its first 8 characters, on one line. */
    const shortId = (n: string) => n.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '$1')
    const age = (at: number) => agoShort(at, now)
    const isDone = (p: FocusProject) => !p.failed && p.total > 0 && p.done >= p.total
    const oldNote = (at: number | null) => (at === null ? null : `includes old data (oldest ${age(at)})`)

    /** The columns every bar of the card shares: set by the card before its rows are drawn. */
    let cols = { name: 16, bar: 12, count: 7 }
    const clip = (t: string, cells: number) => (t.length > cells ? `${t.slice(0, Math.max(1, cells - 1))}…` : t)

    /** One row: a name (or a button) in the name column, a bar of the shared width and `done/total` in the right column; a failed one has a dim empty bar and a dash. */
    const row = (key: string, name: any, x: { done: number; total: number; inProgress: number; failed: boolean; ageText?: string }, indent: number, complete: boolean) => {
      const total = x.failed ? 1 : x.total
      const done = x.failed ? 0 : x.done
      const inProgress = x.failed ? 0 : x.inProgress
      return (
        <Box key={key} flexDirection="row" gap={1} alignItems="center">
          {indent > 0 && <Box width={indent} />}
          <Box width={cols.name}>{name}</Box>
          {Svg ? bar(done, inProgress, 0, total, cols.bar - indent, complete) : segmentBar(`${key}-bar`, done, inProgress, 0, total, cols.bar - indent)}
          <Box width={cols.count} justifyContent="flex-end">
            <Text dimColor size="caption" tabular wrap="truncate-end">{x.failed ? '—' : `${x.done}/${x.total}${x.ageText ? ` ${x.ageText}` : ''}`}</Text>
          </Box>
        </Box>
      )
    }

    const INDENT = 2
    const projectLabel = (p: FocusProject) => shortId(p.name)
    const projectRow = (p: FocusProject, prefix: string, indent: number) => {
      const label = clip(projectLabel(p), cols.name)
      const dim = p.failed || isDone(p) || p.old
      return row(`${prefix}-${p.key}`, <Text dimColor={dim} wrap="truncate-end">{label}</Text>, { ...p, ageText: !p.failed && p.old && p.at !== null ? age(p.at) : '' }, indent, isDone(p) && !p.old)
    }

    const plural = (n: number) => (n === 1 ? '1 initiative not expanded' : `${n} initiatives not expanded`)
    /** The prose of one card, shown only in the footer expansion. */
    const proseOf = (f: FocusView): string[] => {
      const lines: string[] = []
      const hd = f.header
      for (const i of f.initiatives) {
        if (i.failed !== null) {
          lines.push(`${i.name}: ${i.failed}`)
          continue
        }
        for (const p of i.projects) if (!p.failed) lines.push(`${i.name} / ${p.name}: ${p.total - p.done} remaining · ready ${p.ready ?? '-'} · blocked ${p.blocked ?? '-'}`)
        const old = oldNote(i.oldestAt)
        lines.push(`${i.name}: ${i.counted} of ${i.enumerated} projects${i.partial ? ', partial' : ''}${old === null ? '' : `, ${old}`}`)
      }
      if (f.loose.length > 0 && f.initiatives.length > 0) lines.push(`not in a selected initiative: ${f.loose.map(p => p.name).join(', ')}`)
      if (hd !== null) {
        const old = oldNote(hd.oldestAt)
        lines.push(`total: ${hd.counted} of ${hd.enumerated} projects${hd.partial ? ', partial' : ''}${old === null ? '' : `, ${old}`}${hd.notExpanded > 0 ? `, ${plural(hd.notExpanded)}` : ''}`)
        if (hd.stages.length > 0) lines.push(hd.stages.map(([k, v]) => `${k} ${v}`).join(' · '))
      } else if (f.initiatives.some(i => i.failed !== null)) lines.push(plural(f.initiatives.filter(i => i.failed !== null).length))
      lines.push(...f.notes)
      return lines
    }

    const card = (f: FocusView) => {
      const hd = f.header
      const uncertain = hd !== null && (hd.partial || hd.oldestAt !== null)
      const reached = hd !== null && hd.complete
      const pct = hd === null || hd.total === 0 ? null : Math.min(uncertain ? 99 : 100, Math.round((100 * hd.done) / hd.total))
      const barDone = hd === null ? 0 : uncertain && hd.total > 0 ? Math.min(hd.done, hd.total - 1) : hd.done
      const isOpen = !collapsed.includes(f.address)
      const hiddenCount = [...f.initiatives.flatMap(i => i.projects), ...f.loose].filter(isDone).length
      const visible = (list: FocusProject[]) => (showDone ? list : list.filter(p => !isDone(p)))
      // Two fixed bar columns, functions of the card width only: top-level rows start their bar at A, child rows at A plus the
      // indent, both ending at the same right edge, so no bar moves when rows come, go, collapse or fail.
      const nameCol = Math.max(10, Math.floor(width * 0.35))
      // The count column is as wide as the widest done/total shown (an old row adds its age); the bars take the rest.
      const countOf = (p: FocusProject) => (p.failed ? 1 : `${p.done}/${p.total}`.length + (p.old && p.at !== null ? 1 + age(p.at).length : 0))
      const shownRows = [...f.initiatives.flatMap(i => (collapsed.includes(i.key) || i.failed !== null ? [] : visible(i.projects))), ...visible(f.loose)]
      const countCol = Math.max(1, hd === null ? 0 : `${hd.done}/${hd.total}`.length, ...f.initiatives.map(i => (i.failed !== null ? 1 : `${i.done}/${i.total}`.length)), ...shownRows.map(countOf))
      cols = { name: nameCol, bar: Math.max(6 + INDENT, width - 3 - nameCol - countCol - 2), count: countCol }

      // The overall bar spans the card: the width minus the count column, on one row with the total.
      const headBar = Math.max(8, width - 3 - cols.count - 1)

      const initiativeBlock = (i: FocusInitiative) => {
        const shut = collapsed.includes(i.key)
        const label = clip(`${shut ? '▸' : '▾'} ${shortId(i.name)}`, cols.name)
        const iu = i.partial || i.oldestAt !== null
        const done = iu && i.total > 0 ? Math.min(i.done, i.total - 1) : i.done
        const name = <Button key={`ini-${f.address}-${i.key}`} plain label={label} onPress={() => void toggleCollapsed($, i.key)} />
        return (
          <Box key={`init-${f.address}-${i.key}`} flexDirection="column">
            {row(`irow-${f.address}-${i.key}`, name, { done, total: i.total, inProgress: i.inProgress, failed: i.failed !== null || i.counted === 0 }, 0, !iu && i.total > 0 && i.done >= i.total)}
            {!shut && i.failed === null && visible(i.projects).map(p => projectRow(p, `${f.address}-${i.key}`, INDENT))}
          </Box>
        )
      }

      return (
        <Box key={f.address} flexDirection="column" padding={1} gap={1} backgroundColor={CARD_BG}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Button key={`focus-${f.address}`} plain label={`${isOpen ? '▾' : '▸'} ${f.title ?? f.address}`} onPress={() => void toggleCollapsed($, f.address)} />
            {pct !== null && (
              <Text weight="semibold" size="heading" tabular color={Svg ? undefined : ACCENT}>{pct}%</Text>
            )}
          </Box>

          {f.summary && <Text dimColor size="caption">{f.summary}</Text>}

          {hd !== null && (
            <Box flexDirection="column">
              <Box key={`head-${f.address}`} flexDirection="row" gap={1} alignItems="center">
                {Svg ? bar(barDone, hd.inProgress, 0, hd.total, headBar, reached) : segmentBar(`all-${f.address}`, barDone, hd.inProgress, 0, hd.total, headBar)}
                <Box width={cols.count} justifyContent="flex-end">
                  <Text dimColor size="caption" tabular>{hd.done}/{hd.total}</Text>
                </Box>
              </Box>
              {legend()}
            </Box>
          )}

          {isOpen && (f.initiatives.length > 0 || f.loose.length > 0) && (
            <Box flexDirection="column">
              {f.initiatives.map(initiativeBlock)}
              {visible(f.loose).map(p => projectRow(p, `${f.address}-loose`, 0))}
            </Box>
          )}

          {isOpen && hiddenCount > 0 && (
            <Button key={`done-${f.address}`} plain label={showDone ? 'hide complete' : `+ ${hiddenCount} complete`} onPress={() => void toggleShowDone($)} />
          )}

          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor size="caption">{f.kind}</Text>
            <Text dimColor size="caption" tabular>
              {[f.focusReportedAt !== null && `focus ${age(f.focusReportedAt)}`, f.fetchedAt !== null && `synced ${age(f.fetchedAt)}`].filter(Boolean).join(' · ')}
            </Text>
          </Box>
        </Box>
      )
    }

    // Every error of the pane folds into one list: the failed projects and initiatives of each card (a project once), and the source errors.
    const seen = new Set<string>()
    const warnings: FocusWarning[] = []
    for (const f of list) {
      for (const w of f.warnings) {
        const id = `${w.kind}:${w.id ?? w.name}`
        if (!seen.has(id)) {
          seen.add(id)
          warnings.push(w)
        }
      }
    }
    for (const x of meta.errors) warnings.push({ kind: 'source', name: x.source, text: x.text, id: null })
    if (meta.error) warnings.push({ kind: 'source', name: 'refresh', text: meta.error, id: null })
    const messages = warnings.map(w => (w.kind === 'source' ? `${w.name}: ${w.text}` : `${w.name}${w.id !== null ? ` (${w.id})` : ''}: ${w.text}`))
    const prose = [...(banner === null ? [] : [banner]), ...(meta.at !== null && note !== null ? [note] : []), ...list.flatMap(proseOf)]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">Focus</Text>
            <Text dimColor size="caption">{list.length} {list.length === 1 ? 'focus' : 'focuses'}</Text>
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

        {list.map((f, i) => (
          <Box key={f.address} flexDirection="column" gap={1}>
            {grouped && (i === 0 || teamOf(list[i - 1]!.address).toLowerCase() !== teamOf(f.address).toLowerCase()) && (
              <Text weight="semibold">{teamOf(f.address)}</Text>
            )}
            {card(f)}
          </Box>
        ))}

        {warnings.length > 0 && warnOpen && (
          <Box key="warnings" flexDirection="column">
            {messages.map((t, i) => (
              <Text key={`w-${i}`} color="warning" size="caption">{t}</Text>
            ))}
            {prose.map((t, i) => (
              <Text key={`p-${i}`} dimColor size="caption">{t}</Text>
            ))}
          </Box>
        )}
        <Box flexDirection="row" justifyContent="flex-end" gap={2} alignItems="center">
          {warnings.length > 0 && (
            <Box key="warnings-chip" flexDirection="row" gap={1}>
              <Text color="warning">⚠</Text>
              <Button key="warnings-toggle" plain label={String(warnings.length)} onPress={() => void toggleWarnings($)} />
            </Box>
          )}
          <Text color="subtle" size="caption">
            {meta.busy ? 'refreshing…' : `updated ${ago(meta.at, now)}`}
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
const agoShort = (at: number, now: number): string => ago(at, now).replace(/ ago$/, '')
