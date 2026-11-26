import type { EngineInterface, RenderSurface } from 'claude-code'

import type { ModuleId } from './band/modules'
import { pollCapacity } from './capacity'
import { originOf } from './endpoints'
import { pollEscalations } from './escalations'
import { pollBoard, pollDoctor, pollHerdr, pollPrometheus } from './factory'
import { pollFocus } from './focus'
import { isOnView, resetOnView } from './onview'
import { pollRelay } from './relay'
import { isDue, markStale, track } from './schedule'
import type { SourceId } from './schedule'
import { getSelection, refreshSelection } from './selection'
import { guarded } from './shared'
import type { Options } from './shared'
import { pollRetro, pollTeam } from './team'
import { pollEvents, pollTickets, pollWork } from './workview'
import { VIEW_SPECS } from './views'
import type { ViewId } from './views'

// A source is read only while something on screen draws its data. The engine runs a view's
// ui.render hook only while it draws that view: not for a tab behind another, a closed pane, a
// pane or band under a dialog, or either while the detailed transcript is up. So each drawing asks
// here for the sources behind it, and a heartbeat that redraws the sites keeps them coming. With
// nothing drawn nothing is asked, and nothing is read. The engine does draw into a terminal nobody
// can see, so a terminal drawing also has to pass hooks/onview.ts.

export type Surface = ViewId | 'band'

/** Where a drawing is made: the surface that asked for it and, for a pane, its seat there. */
export type Seat = { client: RenderSurface; placement?: 'dock' | 'inline' | 'widget' }

/** A drawing has to stand this long before it counts: panes opened one after another are each drawn for a moment. */
export const SETTLE_MS = 150
/** The longest the sites go without being redrawn, so that a source that has come due is read. */
export const HEARTBEAT_MS = 15 * 1000

const PANE_SOURCES: Record<ViewId, readonly SourceId[]> = {
  factory: ['selection', 'prometheus', 'herdr', 'relay', 'board'],
  focus: ['selection', 'focus'],
  work: ['selection', 'focus', 'work', 'events', 'tickets'],
  escalations: ['escalations'],
  relay: ['announcements'],
  team: ['selection', 'team', 'retro', 'capacity'],
}

const MODULE_SOURCES: Record<ModuleId, readonly SourceId[]> = {
  health: ['prometheus'],
  local: ['prometheus'],
  agents: ['prometheus'],
  spend: ['prometheus'],
  focus: ['focus'],
  queue: ['focus'],
  lead: ['focus', 'board'],
  lanes: ['board'],
  attention: ['escalations'],
  relay: ['relay'],
  team: ['team'],
  work: ['focus', 'work', 'tickets'],
}

/**
 * The sources a pane draws. The Factory widget (desktop, minimized) shows no agents and no teams, and the Team widget
 * no capacity.
 */
export const paneSources = (view: ViewId, isWidget = false): readonly SourceId[] => {
  if (!isWidget) return PANE_SOURCES[view]
  return view === 'factory' ? ['prometheus', 'herdr', 'relay'] : PANE_SOURCES[view].filter(s => s !== 'capacity')
}

/**
 * The sources the band's selected modules draw. A module with nothing to say draws no cell, but its
 * source is still read while the band is up, or its cell could never appear.
 */
export const bandSources = (modules: readonly ModuleId[]): readonly SourceId[] => [...new Set<SourceId>(['selection', ...modules.flatMap(m => MODULE_SOURCES[m])])]

/** The focus and teams the leads, lanes and retro health were read for. */
let lastScope: string | undefined

/** Re-reads who the session is and what it chose; a changed focus or teams value makes what was read for it stale. */
async function readScope($: EngineInterface): Promise<boolean> {
  await refreshSelection($, true)
  const now = `${getSelection().focus.value}\u0000${getSelection().teams.value.join(',')}`
  // The first refresh only records the scope: the first reads already wait for it.
  if (lastScope !== undefined && lastScope !== now) markStale('focus', 'board', 'work', 'tickets', 'retro')
  lastScope = now
  $.ui.invalidate('ui.render')
  return true
}

export function refreshScope($: EngineInterface): Promise<boolean> {
  return track($, 'selection', () => readScope($))
}

function readSource($: EngineInterface, options: Options, id: SourceId): Promise<unknown> {
  switch (id) {
    case 'selection':
      return refreshScope($)
    case 'prometheus':
      return pollPrometheus($, options)
    case 'herdr':
      return pollHerdr($)
    case 'relay':
      return pollDoctor($)
    case 'board':
      return pollBoard($, options)
    case 'focus':
      return pollFocus($)
    case 'escalations':
      return pollEscalations($)
    case 'announcements':
      return pollRelay($)
    case 'team':
      return pollTeam($, options)
    case 'work':
      return pollWork($)
    case 'events':
      return pollEvents($)
    case 'tickets':
      return pollTickets($)
    case 'retro':
      return pollRetro($)
    case 'capacity':
      return pollCapacity($, options)
    // The identity lookup is part of the selection's refresh.
    case 'whoami':
      return Promise.resolve()
  }
}

/** Drawings, by surface and view, with a read already waiting out SETTLE_MS. */
const pending = new Set<string>()

export function resetVisible(): void {
  pending.clear()
  lastScope = undefined
  resetOnView()
}

/** False for a pane the host no longer shows: closed, behind another tab, or waiting for a wider terminal. */
async function isShown($: EngineInterface, id: string): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === id && p.isShown && p.isPlaced)
  } catch {
    // With no list to ask, the drawing is the evidence.
    return true
  }
}

/** The sources behind a drawing that can be read now. */
function dueNow(options: Options, sources: readonly SourceId[], now: number): SourceId[] {
  // A view can be drawn before session start has found the metrics address. Nothing is asked of an
  // unknown address, so it counts as no read; the redraw that ends session start asks.
  const isFound = originOf(options.prometheusUrl) !== undefined
  return sources.filter(id => (isFound || (id !== 'prometheus' && id !== 'team' && id !== 'capacity')) && isDue(id, now))
}

async function readDue($: EngineInterface, options: Options, surface: Surface, sources: readonly SourceId[], seat: Seat): Promise<void> {
  pending.delete(`${seat.client} ${surface}`)
  // The list of panes and herdr or tmux speak of the terminal. Elsewhere, and for a widget, nothing
  // says what is on screen, so the drawing is taken as the evidence.
  const isTerminal = seat.client === 'terminal'
  if (surface !== 'band' && isTerminal && seat.placement !== 'widget' && !(await isShown($, VIEW_SPECS[surface].id))) return
  if (dueNow(options, sources, await $.clock.now()).length === 0) return
  if (isTerminal && !(await isOnView($))) return
  // Asked again after the waits, and started at once, so that two drawings do not start one read twice.
  const due = dueNow(options, sources, await $.clock.now())
  // The selection is started first: the focus and the lanes wait for the scope it decides.
  await Promise.all(due.map(id => guarded($, `${id} read`, () => readSource($, options, id))))
}

/**
 * Called by every drawing of a view. Reads nothing itself (a drawing may not write state): when a
 * source behind the view is due, the read starts once the drawing has stood for SETTLE_MS.
 */
export async function drawn($: EngineInterface, options: Options, surface: Surface, sources: readonly SourceId[], seat: Seat): Promise<void> {
  const key = `${seat.client} ${surface}`
  if (pending.has(key)) return
  const now = await $.clock.now()
  if (!sources.some(id => isDue(id, now))) return
  pending.add(key)
  void $.clock.after(SETTLE_MS, () => void readDue($, options, surface, sources, seat))
}
