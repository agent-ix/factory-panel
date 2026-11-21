import type { Register } from 'claude-code'

import { registerFactory, startFactory } from './factory'
import { registerFocus, startFocus } from './focus'
import { registerRelay, startRelay } from './relay'
import { registerTeam, startTeam } from './team'
import { readOptions } from './shared'

// Each pane lives in its own file; open panes show as tabs beside the chat.
export const register: Register = (on, rawOptions) => {
  const options = readOptions(rawOptions as Record<string, unknown>)
  registerFactory(on, options)
  registerFocus(on, options)
  registerRelay(on, options)
  registerTeam(on, options)

  // One session-start hook for the whole mod: each pane registers its command, opens and polls.
  on('session.start', async ($, e, next) => {
    await startFactory($, options)
    await startFocus($, options)
    await startRelay($, options)
    await startTeam($, options)
    return next(e)
  })
}
