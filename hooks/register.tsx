import type { Register } from 'claude-code'

import { PANE_SPEC as FACTORY_PANE, registerFactory, startFactory } from './factory'
import { PANE_SPEC as FOCUS_PANE, registerFocus, startFocus } from './focus'
import { PANE_SPEC as RELAY_PANE, registerRelay, startRelay } from './relay'
import { PANE_SPEC as TEAM_PANE, registerTeam, startTeam } from './team'
import { guarded, openPanes, paneIdsToReopen, readOptions, settlePanes } from './shared'

// Each pane lives in its own file; open panes show as tabs beside the chat.
const PANES = [FACTORY_PANE, FOCUS_PANE, RELAY_PANE, TEAM_PANE]
const SETTLE_MS = 15_000
// Ids this session has opened at least once; one the person closed afterwards is not reopened.
const everOpened = new Set<string>()

export const register: Register = (on, rawOptions) => {
  const options = readOptions(rawOptions as Record<string, unknown>)
  registerFactory(on, options)
  registerFocus(on, options)
  registerRelay(on, options)
  registerTeam(on, options)

  // One session-start hook for the whole mod: each pane registers its command and polls (a
  // failing one is logged, the others carry on), then the panes are opened and the host's
  // answer is read. A non-interactive run has no surface, so it opens and says nothing.
  on('session.start', async ($, e, next) => {
    await guarded($, 'Factory start', () => startFactory($, options))
    await guarded($, 'Focus start', () => startFocus($, options))
    await guarded($, 'Relay start', () => startRelay($, options))
    await guarded($, 'Team start', () => startTeam($, options))
    if (e.isInteractive) {
      PANES.forEach(p => everOpened.add(p.id))
      await openPanes($, PANES)
      $.clock.every(SETTLE_MS, () => void guarded($, 'pane settle', () => settlePanes($, PANES)))
    }
    return next(e)
  })

  // A pane opened before any surface was attached waits undrawn; a surface attaching is the
  // moment the host can place it. Opening an open pane only retitles it.
  on('session.attach', async ($, e, next) => {
    // Open only panes still listed as waiting and any never opened: a closed pane stays closed.
    const waiting = await paneIdsToReopen($).catch(() => new Set<string>())
    const reopen = PANES.filter(p => waiting.has(p.id) || !everOpened.has(p.id))
    reopen.forEach(p => everOpened.add(p.id))
    await openPanes($, PANES, reopen)
    await settlePanes($, PANES)
    return next(e)
  })
}
