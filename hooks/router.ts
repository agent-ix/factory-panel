import type { EngineInterface, On } from 'claude-code'

import { askRole, isRoleUnknown, roleOf } from './role'
import { defaultView, isViewId, showView } from './views'
import type { ViewId } from './views'
import type { Options } from './shared'

// The one command. `/factory` opens the detail for the person's role, `/factory <view>` opens
// that view, `/factory role` asks the role question again and `/factory help` explains. The old
// per-view commands are aliases for one release.

const CLASSIC_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the line above the prompt. Each cell starts with a number.',
  '  Open more:   /factory (the detail for your role), or /factory focus | escalations | relay | team | factory',
  "  Switch:      type a cell's number at an empty prompt. r refreshes, Esc closes.",
  '  Your role:   /factory role (asked once for each project)',
].join('\n')

const FULLSCREEN_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the panel at the right of the chat, one tab for each view.',
  '  Open more:   /factory (focuses the panel on your role\'s tab), or /factory focus | escalations | relay | team | factory',
  '  Switch:      click a tab, or type /factory and the view name. r refreshes.',
  '  Your role:   /factory role (asked once for each project)',
].join('\n')

export const helpText = (isFullscreen: boolean): string => (isFullscreen ? FULLSCREEN_HELP : CLASSIC_HELP)

/** Runs one `/factory` command and returns the line to print. */
export async function runFactory($: EngineInterface, options: Options, args: string, isFullscreen: boolean): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'help') return helpText(isFullscreen)
  if (word === 'role') {
    const role = await askRole($, options)
    return role === undefined ? 'No role chosen. /factory role asks again.' : `Your role here is ${role}.`
  }
  let view: ViewId
  if (word === '') {
    if (isRoleUnknown(options)) await askRole($, options)
    view = defaultView(roleOf(options))
  } else if (isViewId(word)) {
    view = word
  } else {
    return `"${args.trim()}" is not a /factory command.\n\n${helpText(isFullscreen)}`
  }
  return showView($, options, view, isFullscreen)
}

/** `/factory` and the per-view aliases. */
export function registerRouter(on: On, options: Options): void {
  on('command.run', { command: 'factory' }, async ($, e) => ({ text: await runFactory($, options, e.args ?? '', (e.presentation?.isFullscreen === true)) }))
  on('command.run', { command: 'focuses' }, async ($, e) => ({ text: await runFactory($, options, 'focus', (e.presentation?.isFullscreen === true)) }))
  on('command.run', { command: 'escalations' }, async ($, e) => ({ text: await runFactory($, options, 'escalations', (e.presentation?.isFullscreen === true)) }))
  on('command.run', { command: 'relay' }, async ($, e) => ({ text: await runFactory($, options, 'relay', (e.presentation?.isFullscreen === true)) }))
  on('command.run', { command: 'team' }, async ($, e) => ({ text: await runFactory($, options, 'team', (e.presentation?.isFullscreen === true)) }))
}
