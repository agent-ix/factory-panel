import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FocusMeta, FocusProject, FocusView, SourceError } from '../types'
import { widgets } from './ui/widgets'
import { ACCENT } from './ui/glyphs'
import { CARD_BG, INK, ago, errorText, pausedText, progressBar, runJson, runText } from './shared'
import { gatedBoard } from './linear'
import { compose, focusKey, recordsOf, refreshProgress, selectorKey, selectorName, selectorsOfScope, REFRESH_BUDGET_MS } from './board'
import { resetBoard } from './board'
import type { Refresh } from './board'
import type { Selector } from './board'
import { matchLeads, resolveDefinitions } from './namedfocus'
import type { Resolved } from './namedfocus'
import { STALE_MS, readRecords, saveRecords } from './progress'
import { setSelectorErrors, sourceClear, sourceFailed, sourceOk } from './sources'
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
  shape: 'focuses-4',
})
const focusMeta = atom(
  { plugin: 'factory-panel', key: 'focusMeta' } as const,
  { at: null, busy: false, error: null, errors: [] } as FocusMeta,
  { shape: 'focusMeta-2' },
)
const focusCollapsed = atom({ plugin: 'factory-panel', key: 'focusCollapsed' } as const, [] as string[])
const focusShowDone = atom({ plugin: 'factory-panel', key: 'focusShowDone' } as const, false)

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
  projects: [],
  ready: 0,
  error: null,
  title: null,
  via: null,
  failures: [],
  counts: null,
  partial: false,
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

/** What one focus shows of its progress, from ix-board and the records of earlier successes. */
async function progressOf($: EngineInterface, view: FocusView, selectors: Selector[], manual: boolean, endsAt: number, failed: Map<string, { name: string; error: string }>): Promise<Partial<FocusView> | null> {
  const key = `focus:${selectors.map(selectorKey).join(' ')}`
  let ran = false
  const read = await gatedBoard(
    $,
    key,
    () => {
      ran = true
      return refreshProgress($, selectors, endsAt)
    },
    // A refresh that fell back to single calls, or lost a selector, is shown and not kept: the next poll asks again.
    { manual, keep: (r: Refresh) => r.combined !== null },
  )
  const now = await $.clock.now()
  const sourceError = read.backoffUntil !== null ? pausedText(read.backoffUntil, now) : read.error
  // Another session is reading it and has left nothing yet: keep what is drawn.
  if (read.data === null && sourceError === null) return null
  // After a failed read the cached result is an old one: only the records speak for the selectors.
  const refresh = read.error !== null ? null : read.data
  const whole = focusKey(view.address, selectors)
  const mine = recordsOf(selectors, refresh, await readRecords($), now, whole)
  const records = await saveRecords($, now, mine)
  const composed = compose(selectors, refresh, sourceError, records, { key: whole, name: view.title ?? view.address })
  if (sourceError !== null) sourceFailed('ix-board', sourceError)
  // Only a read that ran now is a success: an answer kept from earlier is not stamped as one.
  else if (ran && refresh !== null) sourceOk('ix-board', now)
  for (const s of selectors) {
    const outcome = refresh?.outcomes[selectorKey(s)]
    if (outcome?.ok === false) failed.set(selectorKey(s), { name: selectorName(s), error: outcome.error })
  }
  return {
    projects: composed.projects,
    ready: composed.ready,
    fetchedAt: composed.fetchedAt,
    failures: composed.failures,
    counts: composed.counts,
    partial: composed.partial,
    notes: [...composed.notes, ...(read.held === true && refresh !== null ? [`earlier outcome from ${ago(refresh.at, now)}: ix-board is asked again after 5 minutes, r asks now`] : [])],
    error: sourceError,
  }
}

/** The banner line for the focuses now held; `/factory show` prints the same line. */
export async function focusBannerNow($: EngineInterface, sel: Selection): Promise<string | null> {
  const scope = scopeOf(sel)
  return focusBanner(scope, await read($, focuses))
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
      return { ...e.view, ...(prior === undefined ? {} : { projects: prior.projects, ready: prior.ready, fetchedAt: prior.fetchedAt, failures: prior.failures, counts: prior.counts, partial: prior.partial, error: prior.error }), notes: [...e.view.notes, ...(noSelectors ? [NO_SELECTORS] : [])] }
    })
    await update($, focuses, () => first)
    await update($, focusMeta, m => ({ ...m, errors }))

    const failed = new Map<string, { name: string; error: string }>()
    // The 30 seconds of the refresh count from here, the first ix-board call, not from the lookups above.
    const endsAt = (await $.clock.now()) + REFRESH_BUDGET_MS
    await Promise.all(
      entries.map(async e => {
        if (e.selectors.length === 0) return
        const progress = await progressOf($, e.view, e.selectors, manual, endsAt, failed)
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
    const banner = focusBanner(scope, all)

    const bar = (done: number, inProgress: number, ready: number, total: number, cells: number, complete = false) =>
      Svg && (
      <Svg source={progressBar(done, total, cells * 7, complete ? INK.good : INK.calm, inProgress, ready)} alt={`${done} of ${total} done`} width={cells * 7} height={6} />
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
      // A partial aggregate is neither complete nor done: it never reads 100% and never wears the done colour.
      const reached = !f.partial && total > 0 && done >= total
      const pct = Math.min(f.partial ? 99 : 100, Math.round((100 * done) / Math.max(1, total)))
      const barDone = f.partial && total > 0 ? Math.min(done, total - 1) : done
      const counts = f.counts === null ? null : `${f.counts.fresh} fresh, ${f.counts.old} old, ${f.counts.failed} failed`
      const isOpen = !collapsed.includes(f.address)
      const open = f.projects.filter(p => p.done < p.total).sort((a, b) => b.total - b.done - (a.total - a.done))
      const finished = f.projects.filter(p => p.total > 0 && p.done >= p.total)
      // A selector whose refresh failed always keeps its row, so an old value is never hidden behind the toggle.
      const rows = showDone ? [...open, ...finished] : [...open, ...finished.filter(p => p.old)]
      const label = (p: FocusProject) => (p.old && p.at !== null ? `${p.name} · ${now - p.at > STALE_MS ? 'stale' : 'old'} ${age(p.at, now)}` : p.name)
      const nameCells = Math.min(38, Math.max(16, ...rows.map(p => label(p).length)))
      const barCells = Math.max(6, Math.min(18, width - nameCells - 14))
      // Terminal row width = name + bar + 10-column count + 2 gaps, inside the card's padding of 1 each side.
      const room = width - 3 - 12 // the card padding, one spare column, the row's two gaps and its 10-column count
      const termNameCells = Math.max(8, Math.min(30, room - 8, Math.max(10, ...rows.map(p => label(p).length))))
      const termBarCells = Math.max(8, room - termNameCells)
      const hidden = finished.filter(p => !p.old)

      return (
        <Box key={f.address} flexDirection="column" padding={1} gap={1} backgroundColor={CARD_BG}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Button
              key={`focus-${f.address}`}
              plain
              label={`${isOpen ? '▾' : '▸'} ${f.title ?? f.address}`}
              onPress={() => void toggleCollapsed($, f.address)}
            />
            {total > 0 && (
              <Text weight="semibold" size="heading" tabular color={Svg ? undefined : ACCENT}>
                {pct}%
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
                ? bar(barDone, inProgress, f.ready, total, Math.max(10, Math.min(48, width - 6)), reached)
                : segmentBar(`all-${f.address}`, barDone, inProgress, f.ready, total, termBarCells)}
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
                    {counts !== null && (
                      <Text color={f.partial ? 'warning' : undefined} dimColor={!f.partial} size="caption" tabular>
                        {counts}
                      </Text>
                    )}
                  </Box>
                ) : (
                  <Text dimColor size="caption" tabular wrap="truncate-end">
                    {done}/{total} done · {inProgress} in progress · {f.ready} ready{counts === null ? '' : ` · ${counts}`}
                  </Text>
                )}
              </Box>
              {f.partial && (
                <Text color="warning" size="caption">
                  partial
                </Text>
              )}
              {legend()}
            </Box>
          )}

          {total === 0 && counts !== null && (
            <Text dimColor size="caption" tabular>
              {counts}
            </Text>
          )}

          {f.error && (
            <Text color="warning" size="caption">
              {f.error}
            </Text>
          )}

          {f.notes.map(n => (
            <Text key={`note-${f.address}-${n}`} dimColor size="caption">
              {n}
            </Text>
          ))}

          {f.failures.map(x => (
            <Text key={`fail-${f.address}-${x.name}`} color="warning" size="caption">
              {x.name}: {x.error}
            </Text>
          ))}

          {isOpen && rows.length > 0 && (
            <Box flexDirection="column">
              {Svg
                ? rows.map(p => (
                    <Box key={p.name} flexDirection="column">
                      <Box flexDirection="row" gap={1} alignItems="center">
                        <Box width={nameCells}>
                          <Text dimColor={p.done >= p.total || p.old} wrap="truncate-end">
                            {label(p)}
                          </Text>
                        </Box>
                        {bar(p.done, p.inProgress, 0, p.total, barCells, p.done >= p.total && !p.old)}
                        <Box width={10} justifyContent="flex-end">
                          <Text dimColor size="caption" tabular>
                            {p.done}/{p.total}
                          </Text>
                        </Box>
                      </Box>
                      {p.error && (
                        <Text color="warning" size="caption">
                          {p.name}: {p.error}
                        </Text>
                      )}
                    </Box>
                  ))
                : rows.map(p => (
                    <Box key={`row-${f.address}-${p.name}`} flexDirection="column">
                      {progressRow(`p-${f.address}-${p.name}`, label(p), p.done, p.inProgress, 0, p.total, termNameCells, termBarCells, p.done >= p.total || p.old)}
                      {p.error && (
                        <Text color="warning" size="caption" wrap="truncate-end">
                          {p.name}: {p.error}
                        </Text>
                      )}
                    </Box>
                  ))}
            </Box>
          )}

          {isOpen && hidden.length > 0 && (
            <Button
              key={`done-${f.address}`}
              plain
              label={showDone ? 'hide complete' : `+ ${hidden.length} complete`}
              onPress={() => void toggleShowDone($)}
            />
          )}

          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor size="caption">
              {f.kind}
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
        {banner !== null && (
          <Text key="banner" size="caption">
            {banner}
          </Text>
        )}
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

        {meta.at !== null && note !== null && (
          <Text color="warning" size="caption">
            {note}
          </Text>
        )}
        {meta.errors.map(x => (
          <Text key={`err-${x.source}`} color="warning" size="caption">
            {x.source}: {x.text}
          </Text>
        ))}

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
