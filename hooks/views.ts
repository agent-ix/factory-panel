import type { EngineInterface } from 'claude-code'

import { PANE_SPEC as ESCALATIONS_PANE } from './escalations'
import { PANE_SPEC as FACTORY_PANE } from './factory'
import { PANE_SPEC as FOCUS_PANE } from './focus'
import { PANE_SPEC as RELAY_PANE } from './relay'
import { PANE_SPEC as TEAM_PANE } from './team'
import type { Options } from './shared'

// The five detail views. Each is a pane; a band cell, `/factory <view>` and the old per-pane
// commands all open one through showView, so they behave the same way.

export type ViewId = 'factory' | 'focus' | 'escalations' | 'relay' | 'team'

export const VIEW_IDS: readonly ViewId[] = ['factory', 'focus', 'escalations', 'relay', 'team']

export const VIEW_SPECS: Record<ViewId, { id: string; title: string }> = {
  factory: FACTORY_PANE,
  focus: FOCUS_PANE,
  escalations: ESCALATIONS_PANE,
  relay: RELAY_PANE,
  team: TEAM_PANE,
}

export const isViewId = (text: string): text is ViewId => (VIEW_IDS as readonly string[]).includes(text)

/** The view a plain `/factory` opens: Focus when the focus module is shown, Factory otherwise. */
export const defaultView = (modules: readonly string[]): ViewId => (modules.includes('focus') ? 'focus' : 'factory')

/**
 * Opens one view with the keyboard (Esc closes it); drawing it reads whatever of its data is out of
 * date (hooks/visible.ts). In the classic layout the other views are closed first so the one shown
 * replaces them; the fullscreen dock keeps its tabs. Returns a line saying what happened.
 */
export async function showView($: EngineInterface, _options: Options, view: ViewId, isFullscreen: boolean): Promise<string> {
  const spec = VIEW_SPECS[view]
  if (!isFullscreen) {
    for (const other of VIEW_IDS) {
      if (other !== view) await $.ui.close({ id: VIEW_SPECS[other].id }).catch(() => undefined)
    }
  }
  const opened = await $.ui.open(isFullscreen ? { id: spec.id, title: spec.title, focus: true, closeOnEscape: true } : { id: spec.id, title: spec.title, focus: true, closeOnEscape: true, rows: 14 })
  if (!opened.isPlaced) return `${spec.title} is waiting: ${opened.reason}`
  return isFullscreen ? `${spec.title} is focused at the right.` : `${spec.title} is open. Type another cell's number to switch, r refreshes, Esc closes.`
}
