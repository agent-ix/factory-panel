import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ChosenFocus, FocusOption, FocusInitiative, FocusMeta, FocusProject, FocusView, FocusWarning, SourceError } from '../types'
import { widgets } from './ui/widgets'
import { ACCENT } from './ui/glyphs'
import { CARD_BG, INK, after, ago, agoShort, errorText, pausedText, progressBar } from './shared'
import { LEAD_REUSE_MS, listLeads, readLead } from './leads'
import type { LeadRead, WorkReport } from './leads'
import { REFRESH_BUDGET_MS, resetBoard, selectorsOfScope } from './board'
import { loadProgress, progressKeyOf } from './progressview'
import { holdBoard, keepBoards } from './work'
import type { Selector } from './board'
import { focusNotice, labelOf, namesOf, parseRef, reportedRefs } from './focuschoice'
import { STALE_MS } from './progress'
import { setSelectorErrors, sourceClear, sourceFailed, sourceOk } from './sources'
import { focusDetail } from './showfocus'
import { isDue, markStale, track } from './schedule'
import { NO_FOCUS_BY, focusBanner, focusTeams, scopeFocuses, statusOf, teamOf } from './band/modules'
import { getSelection, refreshSelection, scopeKeyOf, scopeOf, selectionReady } from './selection'
import type { Selection } from './selection'
import type { Options } from './shared'

// The Focus pane: one card per focus. A focus belongs to a coordinator agent: its
// scope and focus line come from the coordinator's ix-relay work report, its progress from
// `ix-board focus status` over that scope. Today a coordinator holds one focus; the list
// is already a list, so more only add cards.

const PANE = 'focus'
const TITLE = 'Focus'
export const PANE_SPEC = { id: PANE, title: TITLE }
export const NO_SELECTORS = 'no selectors'
/** The first drawing of a choice waits at most this long for the leads' reports; the rest are drawn when they answer. */
const FIRST_DRAW_MS = 5_000

const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], {
  shape: 'focuses-8',
})
const focusMeta = atom(
  { plugin: 'factory-panel', key: 'focusMeta' } as const,
  { at: null, busy: false, error: null, errors: [] } as FocusMeta,
  { shape: 'focusMeta-5' },
)
export const focusCollapsed = atom({ plugin: 'factory-panel', key: 'focusCollapsed' } as const, [] as string[])
const focusShowDone = atom({ plugin: 'factory-panel', key: 'focusShowDone' } as const, false)
/** Whether the footer warning is expanded to its full messages. */
const focusWarnings = atom({ plugin: 'factory-panel', key: 'focusWarnings' } as const, false)

// ---------------------------------------------------------------- data

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
  selectors: [],
})

const leadEntry = (lead: string, report: WorkReport, note: string | null): Entry => ({
  view: {
    ...blank(report.binding?.address ?? lead),
    notes: note === null ? [] : [note],
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
    selectors: selectorsOfScope(report.scope),
  },
  selectors: selectorsOfScope(report.scope),
})

/** The card of the chosen initiative or project: its progress is ix-board's over that one selector. */
function chosenEntry(value: string, name: string | null): Entry {
  const { kind, id } = parseRef(value)!
  const selectors: Selector[] = [{ kind, ref: id }]
  return {
    view: { ...blank(value), kind, title: labelOf(value, name), via: 'chosen', selectors, scope: { initiatives: kind === 'initiative' ? 1 : 0, projects: kind === 'project' ? 1 : 0, tickets: 0 } },
    selectors,
  }
}

/** Whether a read has finished for the focus and teams now selected, so that what it did not find is known to be absent. */
const isRead = (meta: FocusMeta, sel: Selection): boolean => meta.at !== null && meta.scope === scopeKeyOf(scopeOf(sel))

/** The banner line for the focuses now held; `/factory show` prints the same line. */
export async function focusBannerNow($: EngineInterface, sel: Selection): Promise<string | null> {
  const scope = scopeOf(sel)
  const all = await read($, focuses)
  const banner = focusBanner(scope, all)
  if (isRead(await read($, focusMeta), sel)) return banner
  // Before a read, that no focus is reported is not known.
  return banner?.startsWith(NO_FOCUS_BY) ? null : banner
}

/**
 * The lines of `/factory show` for the focuses the selection shows: how old the data is, or that it is not read yet,
 * then notes, totals, and every initiative and project with its numbers.
 */
export async function focusDetailNow($: EngineInterface, sel: Selection): Promise<string[]> {
  const all = await read($, focuses)
  const meta = await read($, focusMeta)
  const now = await $.clock.now()
  const shown = scopeFocuses(all, scopeOf(sel))
  const notice = meta.heldFor === scopeKeyOf(scopeOf(sel)) ? focusNotice(meta.chosen) : null
  const detail = [...(notice === null ? [] : [notice]), ...focusDetail(shown, now)]
  if (!isRead(meta, sel)) {
    const failure = meta.error ?? meta.errors.find(e => e.source === 'agent-msg work')?.text
    const why = running !== null ? ': it is being read now, run /factory show again' : failure === undefined ? '' : `: the last read failed: ${failure}`
    return [`focus data: not read yet${why}`, ...detail]
  }
  const answered = shown.flatMap(f => (f.fetchedAt === null ? [] : [f.fetchedAt]))
  const age = `focus data: read ${ago(meta.at!, now)}${answered.length === 0 ? '' : `, progress from ${ago(Math.min(...answered), now)}`}`
  return [age, ...detail]
}

/** One refresh at a time: a tick that arrives during one is run once, after it. */
let running: Promise<void> | null = null
let again = false
let againManual = false
let againAnew = false

/** Reads every focus. `anew` reads the leads' reports again even where the other view has just read them. */
export function pollFocus($: EngineInterface, manual = false, anew = manual): Promise<void> {
  if (running !== null) {
    again = true
    againManual ||= manual
    againAnew ||= anew
    return running
  }
  running = (async () => {
    try {
      let asManual = manual
      let asAnew = anew
      let isFirstPass = true
      do {
        again = false
        againManual = false
        againAnew = false
        const how = asManual
        const reuse = asAnew ? 0 : LEAD_REUSE_MS
        const early = isFirstPass
        isFirstPass = false
        await track($, 'focus', () => refreshFocus($, how, reuse, early))
        asManual = againManual
        asAnew = againAnew
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

/** How long a typed command waits for the read it asks for before it answers with what is held. */
export const COMMAND_WAIT_MS = 5_000

/**
 * The read a typed command asks for. A command is on screen, so the focuses are read although no view may be drawn,
 * through the same gates as a view's reads: ix-board is never asked sooner than its gate allows. A choice (`changed`)
 * reads for what is now selected; otherwise only a source that is due is read, and a read under way is waited for.
 */
export async function readForCommand($: EngineInterface, changed: boolean): Promise<void> {
  const reading = changed || isDue('focus', await $.clock.now()) ? pollFocus($, false, changed) : running
  if (reading !== null) await Promise.race([reading, after($, COMMAND_WAIT_MS)])
}

/** The focuses held and how they were read, which the Work view filters by. */
export async function focusHeld($: EngineInterface): Promise<{ focuses: FocusView[]; meta: FocusMeta }> {
  const [held, meta] = await Promise.all([read($, focuses), read($, focusMeta)])
  return { focuses: held, meta }
}

/** Whether a read of the focuses has ended, well or not: the focus statuses it asked for are then held. */
export async function focusWasRead($: EngineInterface): Promise<boolean> {
  const meta = await read($, focusMeta)
  return meta.at !== null || meta.error !== null
}

/**
 * Reads what a choice just written selects: the selection, the focuses for it, and marks the lanes and leads the scope
 * reads as due at the next drawing of a view that shows them.
 */
export async function choiceApplied($: EngineInterface): Promise<Selection> {
  const sel = await refreshSelection($)
  markStale('focus', 'board', 'work', 'tickets', 'retro')
  // Where none can be made, what is held is drawn.
  await readForCommand($, true).catch(() => undefined)
  $.ui.invalidate('ui.render')
  return sel
}

/** Forgets the refresh state of an earlier session; the tests start each session from nothing. */
export function resetFocus(): void {
  resetBoard()
  running = null
  again = false
  againManual = false
  againAnew = false
}

/**
 * One refresh of every focus; false when the relay could not be read (ix-board's reads have their own gate). With
 * `early`, a choice not yet drawn is drawn from the reports in after FIRST_DRAW_MS, and another refresh is asked for.
 */
async function refreshFocus($: EngineInterface, manual: boolean, reuseMs: number, early: boolean): Promise<boolean> {
  await update($, focusMeta, m => ({ ...m, busy: true }))
  try {
    // The scope needs to know who this session is before it knows which leads to read.
    await selectionReady()
    const scope = scopeOf(getSelection())
    const teams = focusTeams(scope)
    const choice = parseRef(scope.focus) === null ? null : scope.focus
    const errors: SourceError[] = []

    // Where the leads cannot be listed nothing is known of them: this read says nothing about what is absent.
    let listed = true
    // The same where some leads have not answered yet.
    let isPartial = false
    const isNewChoice = (await read($, focusMeta)).scope !== scopeKeyOf(scope)
    const gather = async (): Promise<{ lead: string; report: WorkReport; note: string | null }[]> => {
      let leads: string[]
      try {
        leads = (await listLeads($)).filter(a => teams === null || teams.some(t => t.toLowerCase() === teamOf(a).toLowerCase()))
      } catch (error) {
        listed = false
        errors.push({ source: 'agent-msg work', text: errorText(error) })
        sourceFailed('agent-msg work', errorText(error))
        return []
      }
      const answered: LeadRead[] = []
      const all = Promise.all(leads.map(async lead => void answered.push(await readLead($, lead, reuseMs))))
      isPartial = early && isNewChoice && (await Promise.race([all.then(() => false), after($, FIRST_DRAW_MS)]))
      if (!isPartial) await all
      else {
        listed = false
        again = true
        againManual ||= manual
      }
      const reports = [...answered]
      // A lead another session is reading says nothing yet, so this read says nothing about what is absent.
      if (reports.some(r => r.pending === true)) listed = false
      const failedReads = reports.flatMap(r => (r.error === null ? [] : [{ lead: r.address, error: r.error }]))
      // A failure is shown for the leads inside the team filter, and, when every lead is read, any lead if all of them
      // failed (one with no live agent is normal there).
      const shownFails = failedReads.filter(() => teams !== null || failedReads.length === reports.length)
      // Whether the relay failed is told once every lead has answered.
      if (isPartial) return drawn(reports, await $.clock.now())
      if (shownFails.length > 0) {
        const text = shownFails.map(x => `${x.lead}: ${x.error}`).join(' · ')
        errors.push({ source: 'agent-msg work', text })
        sourceFailed('agent-msg work', text)
      } else sourceOk('agent-msg work', await $.clock.now())
      return drawn(reports, await $.clock.now())
    }
    // A report that could not be read now is drawn as it was last read, and says so.
    const drawn = (reports: readonly LeadRead[], now: number): { lead: string; report: WorkReport; note: string | null }[] =>
      reports.flatMap(r => (r.report ? [{ lead: r.address, report: r.report, note: r.error === null ? null : `work report not read, as read ${ago(r.at, now)}` }] : []))
    const reports = await gather()
    const prior = await read($, focusMeta)

    // The focuses that can be chosen are those the reports name.
    const refs = reportedRefs(reports.map(r => r.report.scope))
    let chosen: ChosenFocus | undefined
    if (choice !== null) {
      let name = [...(prior.options ?? []), ...(prior.chosen === undefined ? [] : [prior.chosen])].find(o => o.value === choice)?.name ?? null
      // One no lead reports is a focus only where Linear names it, which is asked before anything is drawn for it.
      if (!refs.includes(choice) && name === null) name = (await namesOf($, [choice]))[0]?.name ?? null
      chosen = { value: choice, name, known: refs.includes(choice) || name !== null }
    }

    const leadEntries = reports
      .filter(r => selectorsOfScope(r.report.scope).length > 0 || Boolean(r.report.focus?.summary))
      .map(r => leadEntry(r.lead, r.report, r.note))
    // A choice that is no focus shows what `all` shows.
    const entries: Entry[] = chosen?.known === true ? [chosenEntry(chosen.value, chosen.name)] : leadEntries
    entries.sort((a, b) => a.view.address.localeCompare(b.view.address))

    // Each source is drawn when it answers: the reports and definitions first, with the progress of the last refresh.
    const before = await read($, focuses)
    const first = entries.map(e => {
      const prior = before.find(f => f.address === e.view.address)
      const noSelectors = e.selectors.length === 0
      return { ...e.view, ...(prior === undefined ? {} : { initiatives: prior.initiatives, loose: prior.loose, header: prior.header, warnings: prior.warnings, fetchedAt: prior.fetchedAt }), notes: [...e.view.notes, ...(noSelectors ? [NO_SELECTORS] : [])] }
    })
    await update($, focuses, () => first)
    const heldFor = scopeKeyOf(scope)
    await update($, focusMeta, m => ({ ...m, errors, heldFor, chosen }))
    // The Work tab keeps the answers of the focuses now shown only, so that none of an earlier choice places a ticket.
    await keepBoards($, new Set(entries.filter(e => e.selectors.length > 0).map(e => progressKeyOf(e.selectors))))

    // Names are read beside the progress, so that the choices are listed without waiting for it.
    const publish = async (options: FocusOption[]) => {
      const name = chosen === undefined ? null : (options.find(o => o.value === chosen!.value)?.name ?? chosen.name)
      if (chosen !== undefined) chosen = { ...chosen, name }
      await update($, focusMeta, m => ({ ...m, options, chosen }))
      if (name !== null) await update($, focuses, list => list.map(f => (f.via === 'chosen' && f.address === chosen!.value ? { ...f, title: name } : f)))
      return options
    }
    const naming = namesOf($, refs).then(publish)
    const failed = new Map<string, { name: string; error: string }>()
    // The 30 seconds of the refresh count from here, the first ix-board call, not from the lookups above.
    const endsAt = (await $.clock.now()) + REFRESH_BUDGET_MS
    await Promise.all(
      entries.map(async e => {
        if (e.selectors.length === 0) return
        const loaded = await loadProgress($, e.selectors, manual, endsAt, failed)
        // Another session is reading and has left nothing yet: this focus has not answered.
        await holdBoard($, progressKeyOf(e.selectors), loaded?.board ?? { board: null, at: null, error: null })
        if (loaded === null) return
        const { progress } = loaded
        await update($, focuses, list => list.map(f => (f.address === e.view.address ? { ...f, ...progress, notes: [...e.view.notes, ...(progress.notes ?? [])] } : f)))
      }),
    )
    // The progress just read may name what nothing else did.
    let options = await naming
    if (options.some(o => o.name === null) || (chosen !== undefined && chosen.name === null)) options = await publish(await namesOf($, refs))
    // A source nobody asks any more says nothing: ix-board when no focus has a selector.
    if (entries.every(e => e.selectors.length === 0)) sourceClear('ix-board')
    setSelectorErrors(failed)
    const now = await $.clock.now()
    // With nothing to draw and reports still coming in, the views keep saying that the focuses are being read.
    await update($, focusMeta, m => ({ at: isPartial && entries.length === 0 ? m.at : now, busy: isPartial, error: null, errors, heldFor, chosen, options, ...(listed ? { scope: scopeKeyOf(scope) } : {}) }))
    return errors.length === 0
  } catch (error) {
    await update($, focusMeta, m => ({ ...m, busy: false, error: errorText(error) }))
    return false
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

/** Registers the command; called once at session start. register.tsx opens the pane, and hooks/visible.ts reads while it is drawn. */
export async function startFocus($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'focuses', description: 'Same as /factory focus' })
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
    const list = scopeFocuses(all, scope)
    const notice = meta.heldFor === scopeKeyOf(scope) ? focusNotice(meta.chosen) : null
    // Under each team's name where the focuses of several teams are listed.
    const grouped = list.every(f => f.via !== 'chosen') && new Set(list.map(f => teamOf(f.address).toLowerCase())).size > 1
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
          {first && total > 0 && <Text dimColor>· {Math.min(first.header && (first.header.partial || first.header.oldestAt !== null || first.header.notExpanded > 0) ? 99 : 100, Math.round((100 * done) / total))}% {first.title ?? first.address}</Text>}
        </Box>
      )
    }

    /** A bare UUID in a name is shown as its first 8 characters, on one line. */
    const shortId = (n: string) => n.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '$1')
    const age = (at: number) => agoShort(at, now)
    const isDone = (p: FocusProject) => !p.failed && p.total > 0 && p.done >= p.total
    const oldNote = (at: number | null) => (at === null ? null : `includes old data (oldest ${age(at)})`)

    /** The columns every bar of the card shares: set by the card before its rows are drawn. */
    let cols = { name: 16, bar: 12 }
    /** The count column is a constant: `999/999 13m` fits, so no row's content ever moves a bar. */
    const COUNT = 12
    const clip = (t: string, cells: number) => (t.length > cells ? `${t.slice(0, Math.max(1, cells - 1))}…` : t)

    /** One row: a name (or a button) in the name column, a bar of the shared width and `done/total` in the right column; a failed one has a dim empty bar and a dash. */
    const row = (key: string, name: any, x: { done: number; total: number; inProgress: number; failed: boolean; ageText?: string; stale?: boolean }, indent: number, complete: boolean) => {
      const total = x.failed ? 1 : x.total
      const done = x.failed ? 0 : x.done
      const inProgress = x.failed ? 0 : x.inProgress
      return (
        <Box key={key} flexDirection="row" gap={1} alignItems="center">
          <Box width={cols.name + indent} paddingLeft={indent}>{name}</Box>
          {Svg ? bar(done, inProgress, 0, total, cols.bar - indent, complete) : segmentBar(`${key}-bar`, done, inProgress, 0, total, cols.bar - indent)}
          <Box width={COUNT} flexDirection="row" justifyContent="flex-end">
            <Text dimColor size="caption" tabular wrap="truncate-end">{x.failed ? '—' : `${x.done}/${x.total}`}</Text>
            {!x.failed && x.ageText ? <Text dimColor={!x.stale} color={x.stale ? 'warning' : undefined} size="caption" tabular>{` ${x.ageText}`}</Text> : null}
          </Box>
        </Box>
      )
    }

    const INDENT = 2
    const projectLabel = (p: FocusProject) => shortId(p.name)
    const projectRow = (p: FocusProject, prefix: string, indent: number) => {
      const label = clip(projectLabel(p), cols.name)
      const dim = p.failed || isDone(p) || p.old
      return row(`${prefix}-${p.key}`, <Text dimColor={dim} wrap="truncate-end">{label}</Text>, { ...p, ageText: !p.failed && p.old && p.at !== null ? age(p.at) : '', stale: p.at !== null && now - p.at > STALE_MS }, indent, isDone(p) && !p.old)
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
      cols = { name: nameCol, bar: Math.max(6 + INDENT, width - 3 - nameCol - COUNT - 2) }

      // The overall bar spans the card: the width minus the count column, on one row with the total.
      const headBar = Math.max(8, width - 3 - COUNT - 1)

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
                <Box width={COUNT} justifyContent="flex-end">
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
    const prose = [...(banner === null ? [] : [banner]), ...list.flatMap(proseOf)]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading">Focus</Text>
            <Text dimColor size="caption">{list.length} {list.length === 1 ? 'focus' : 'focuses'}</Text>
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollFocus($, true)} />
        </Box>

        {notice !== null && <Text color="warning">{notice}</Text>}

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
