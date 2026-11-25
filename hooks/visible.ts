import type { EngineInterface } from 'claude-code'

import type { ModuleId } from './band/modules'
import { originOf } from './endpoints'
import { pollEscalations } from './escalations'
import { pollBoard, pollDoctor, pollHerdr, pollPrometheus } from './factory'
import { pollFocus } from './focus'
import { pollRelay } from './relay'
import { isDue, markStale, track } from './schedule'
import type { SourceId } from './schedule'
import { getSelection, refreshSelection } from './selection'
import { guarded } from './shared'
import type { Options } from './shared'
import { pollTeam } from './team'
import { VIEW_SPECS } from './views'
import type { ViewId } from './views'

// A source is read only while something on screen draws its data. The engine runs a view's
// ui.render hook only while it draws that view: not for a tab behind another, a closed pane, a
// pane or band under a dialog, or either while the detailed transcript is up. So each drawing asks
// here for the sources behind it, and a heartbeat that redraws the sites keeps them coming. With
// nothing drawn nothing is asked, and nothing is read.

export type Surface = ViewId | 'band'

/** A drawing has to stand this long before it counts: panes opened one after another are each drawn for a moment. */
export const SETTLE_MS = 150
/** The longest the sites go without being redrawn, so that a source that has come due is read. */
export const HEARTBEAT_MS = 15 * 1000

const PANE_SOURCES: Record<ViewId, readonly SourceId[]> = {
  factory: ['selection', 'prometheus', 'herdr', 'relay', 'board'],
  focus: ['selection', 'focus'],
  escalations: ['escalations'],
  relay: ['announcements'],
  team: ['team'],
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
}

/** The sources a pane draws. The Factory widget (desktop, minimized) shows no agents and no teams. */
export const paneSources = (view: ViewId, isWidget = false): readonly SourceId[] =>
  isWidget && view === 'factory' ? ['prometheus', 'herdr', 'relay'] : PANE_SOURCES[view]

/**
 * The sources the band's selected modules draw. A module with nothing to say draws no cell, but its
 * source is still read while the band is up, or its cell could never appear.
 */
export const bandSources = (modules: readonly ModuleId[]): readonly SourceId[] => [...new Set<SourceId>(['selection', ...modules.flatMap(m => MODULE_SOURCES[m])])]

/** The focus and teams the leads and lanes were read for. */
let lastScope: string | undefined

/** Re-reads who the session is and what it chose; a changed focus or teams value makes the leads and lanes stale. */
async function readScope($: EngineInterface): Promise<boolean> {
  await refreshSelection($, true)
  const now = `${getSelection().focus.value}\u0000${getSelection().teams.value.join(',')}`
  // The first refresh only records the scope: the first reads already wait for it.
  if (lastScope !== undefined && lastScope !== now) markStale('focus', 'board')
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
    // The identity lookup is part of the selection's refresh.
    case 'whoami':
      return Promise.resolve()
  }
}

/** Surfaces with a read already waiting out SETTLE_MS. */
const pending = new Set<Surface>()

export function resetVisible(): void {
  pending.clear()
  lastScope = undefined
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

async function readDue($: EngineInterface, options: Options, surface: Surface, sources: readonly SourceId[]): Promise<void> {
  pending.delete(surface)
  if (surface !== 'band' && !(await isShown($, VIEW_SPECS[surface].id))) return
  const now = await $.clock.now()
  // A view can be drawn before session start has found the metrics address. Nothing is asked of an
  // unknown address, so it counts as no read; the redraw that ends session start asks.
  const isFound = originOf(options.prometheusUrl) !== undefined
  const due = sources.filter(id => (isFound || (id !== 'prometheus' && id !== 'team')) && isDue(id, now))
  // The selection is started first: the focus and the lanes wait for the scope it decides.
  await Promise.all(due.map(id => guarded($, `${id} read`, () => readSource($, options, id))))
}

/**
 * Called by every drawing of a view. Reads nothing itself (a drawing may not write state): when a
 * source behind the view is due, the read starts once the drawing has stood for SETTLE_MS.
 */
export async function drawn($: EngineInterface, options: Options, surface: Surface, sources: readonly SourceId[]): Promise<void> {
  if (pending.has(surface)) return
  const now = await $.clock.now()
  if (!sources.some(id => isDue(id, now))) return
  pending.add(surface)
  void $.clock.after(SETTLE_MS, () => void readDue($, options, surface, sources))
}
