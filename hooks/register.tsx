import type { EngineInterface, Register, RenderViewport } from 'claude-code'

import { PANE_SPEC as ESCALATIONS_PANE, registerEscalations, startEscalations } from './escalations'
import { PANE_SPEC as FACTORY_PANE, registerFactory, startFactory } from './factory'
import { PANE_SPEC as FOCUS_PANE, registerFocus, resetFocus, startFocus } from './focus'
import { PANE_SPEC as RELAY_PANE, registerRelay, startRelay } from './relay'
import { PANE_SPEC as TEAM_PANE, registerTeam, startTeam } from './team'
import { resolveEndpoints } from './endpoints'
import { bandPlan, renderBand, startBand, syncStatus } from './band'
import { resetSchedule, setRefresh } from './schedule'
import { resetSelection } from './selection'
import { registerRouter } from './router'
import { guarded, openPanes, paneIdsToReopen, readOptions, settlePanes } from './shared'
import { isViewId } from './views'
import { HEARTBEAT_MS, bandSources, drawn, paneSources, refreshScope, resetVisible } from './visible'

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
// The heartbeat is started once per process, however often a session starts.
let isBeating = false

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
  setRefresh(options.refreshSeconds)

  // Registered ahead of the views' own drawings, so it hears every draw of a pane and passes it on.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (isViewId(e.requestId)) await drawn($, options, e.requestId, paneSources(e.requestId, e.props.placement === 'widget'), { client: e.surface, placement: e.props.placement })
    return next(e)
  })
  registerFactory(on, options)
  registerFocus(on, options)
  registerEscalations(on, options)
  registerRelay(on, options)
  registerTeam(on, options)
  registerRouter(on, options)

  // One session-start hook for the whole mod: each pane registers its command (a failing one is
  // logged, the others carry on). Nothing is polled here: a view's sources are read while it is
  // drawn (hooks/visible.ts). The panes are not opened here: see above.
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    resetSelection()
    resetFocus()
    resetSchedule()
    resetVisible()
    // The band paints from the fallback at once; who the session is, what a skill declared and
    // what the user chose follow when `agent-msg whoami` and the files answer (never waited for).
    // A session with nobody at it draws nothing and asks nothing.
    if (e.isInteractive) void guarded($, 'Selection', () => refreshScope($))
    if (!isBeating) {
      isBeating = true
      $.clock.every(Math.min(HEARTBEAT_MS, options.refreshSeconds * 1000), () => $.ui.invalidate('ui.render'))
    }
    await guarded($, 'Endpoint discovery', () => resolveEndpoints($, options))
    await guarded($, 'Factory start', () => startFactory($, options))
    await guarded($, 'Focus start', () => startFocus($, options))
    await guarded($, 'Escalations start', () => startEscalations($, options))
    await guarded($, 'Relay start', () => startRelay($, options))
    await guarded($, 'Team start', () => startTeam($, options))
    await guarded($, 'Band start', () => startBand($))
    // The first draw happens before this hook finishes; draw again now the state is in.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The prompt band is drawn on every terminal, so its first render carries the layout. The
  // hook adds nothing to the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    decideLayout($, e.viewport, options.inlineView)
    // A classic layout has no dock, so the band is the compact view; fullscreen keeps its panes.
    // A layout the host has not reported counts as classic: a band is harmless, a blank is not.
    if (e.viewport?.isFullscreen !== true && (options.inlineView === 'band' || options.inlineView === 'status')) {
      // A survey holds the whole slot, and a collapsed band draws nothing of its cells; the status line stays.
      const isHidden = e.props.hasSurvey || (options.inlineView === 'band' && e.props.isCollapsed)
      const plan = bandPlan(options)
      if (!isHidden && !plan.off) await drawn($, options, 'band', bandSources(plan.ids), { client: e.surface })
      await syncStatus($, options, false)
      if (options.inlineView === 'band') {
        const band = await renderBand($, e, options)
        if (band !== null) return band
      }
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
