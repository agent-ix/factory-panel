import type { EngineInterface, Register, RenderViewport } from 'claude-code'

import { PANE_SPEC as ESCALATIONS_PANE, registerEscalations, startEscalations } from './escalations'
import { PANE_SPEC as FACTORY_PANE, registerFactory, startFactory } from './factory'
import { PANE_SPEC as FOCUS_PANE, registerFocus, startFocus } from './focus'
import { PANE_SPEC as RELAY_PANE, registerRelay, startRelay } from './relay'
import { PANE_SPEC as TEAM_PANE, registerTeam, startTeam } from './team'
import { resolveEndpoints } from './endpoints'
import { lastDraw, registerBand, renderBand, startBand, syncStatus } from './band'
import { guarded, openPanes, paneIdsToReopen, readOptions, settlePanes } from './shared'

// Each pane lives in its own file; open panes show as tabs beside the chat.
const PANES = [FACTORY_PANE, FOCUS_PANE, ESCALATIONS_PANE, RELAY_PANE, TEAM_PANE]
const SETTLE_MS = 15_000
// Ids this session has opened at least once; one the person closed afterwards is not reopened.
const everOpened = new Set<string>()
// An unasked pane is seated inline above the prompt, over the chat, unless the terminal runs
// the fullscreen layout that docks it beside the transcript. session.start cannot tell which
// layout is coming, so the panes are opened only once a render event reports it: docked
// layouts open them, any other layout leaves them to /factory (an open the person asked for).
let isInteractive = false
let isLayoutDecided = false

const HINT = 'panes open beside the chat in the fullscreen layout. Type /factory to open them here.'

/** Opens the panes once the layout is known to dock them; otherwise leaves a hint. */
function decideLayout($: EngineInterface, viewport: RenderViewport | undefined, inlineView: string): void {
  if (isLayoutDecided || viewport?.isFullscreen === undefined) return
  isLayoutDecided = true
  if (viewport.isFullscreen !== true) {
    if (inlineView === 'off') $.ui.status(HINT)
    return
  }
  PANES.forEach(p => everOpened.add(p.id))
  // The settle timer starts after the opens answer: it reads the panes the host now lists.
  void guarded($, 'pane open', async () => {
    await openPanes($, PANES)
    $.clock.every(SETTLE_MS, () => void guarded($, 'pane settle', () => settlePanes($, PANES)))
  })
}

export const register: Register = (on, rawOptions) => {
  const options = readOptions(rawOptions as Record<string, unknown>)
  registerFactory(on, options)
  registerFocus(on, options)
  registerEscalations(on, options)
  registerRelay(on, options)
  registerTeam(on, options)
  registerBand(on, options)

  // One session-start hook for the whole mod: each pane registers its command and polls (a
  // failing one is logged, the others carry on). The panes are not opened here: see above.
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await guarded($, 'Endpoint discovery', () => resolveEndpoints($, options))
    await guarded($, 'Factory start', () => startFactory($, options))
    await guarded($, 'Focus start', () => startFocus($, options))
    await guarded($, 'Escalations start', () => startEscalations($, options))
    await guarded($, 'Relay start', () => startRelay($, options))
    await guarded($, 'Team start', () => startTeam($, options))
    await guarded($, 'Band start', () => startBand($, options))
    // The first draw happens before this hook finishes; draw again now the state and role are in.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The prompt band is drawn on every terminal, so its first render carries the layout. The
  // hook adds nothing to the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    decideLayout($, e.viewport, options.inlineView)
    // A classic layout has no dock, so the band is the compact view; fullscreen keeps its panes.
    // A layout the host has not reported counts as classic: a band is harmless, a blank is not.
    lastDraw.at = Date.now()
    lastDraw.isFullscreen = e.viewport?.isFullscreen
    lastDraw.interactive = isInteractive
    if (e.viewport?.isFullscreen === true) lastDraw.reason = 'panes dock in fullscreen, no band'
    else if (options.inlineView !== 'band' && options.inlineView !== 'status') lastDraw.reason = 'inlineView is off'
    else {
      await syncStatus($, options, false)
      if (options.inlineView === 'band') {
        const band = await renderBand($, e, options)
        lastDraw.reason = band === null ? 'band has no modules with data' : 'band drawn'
        if (band !== null) return band
      } else lastDraw.reason = 'status-line mode'
    }
    return next(e)
  })

  // A surface joining later (the desktop app, a phone) reports its own layout; a pane opened
  // before it came waits undrawn and is placed now. Only a docking layout opens panes, and a
  // pane the person closed stays closed.
  on('session.attach', async ($, e, next) => {
    if (isInteractive && e.viewport?.isFullscreen === true) {
      const waiting = await paneIdsToReopen($).catch(() => new Set<string>())
      const reopen = PANES.filter(p => waiting.has(p.id) || !everOpened.has(p.id))
      reopen.forEach(p => everOpened.add(p.id))
      await openPanes($, PANES, reopen)
      await settlePanes($, PANES)
    }
    return next(e)
  })
}
