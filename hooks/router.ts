import type { EngineInterface, On } from 'claude-code'

import { MODULE_IDS } from './band/modules'
import { pollFocus } from './focus'
import { pollBoard } from './factory'
import { clearChoice, getSelection, normalizeModules, refreshSelection, writeChoice } from './selection'
import type { Feature, Selection } from './selection'
import { defaultView, isViewId, showView } from './views'
import type { ViewId } from './views'
import type { Options } from './shared'

// The one command. `/factory` opens the detail, `/factory <view>` opens that view, `use`, `focus`,
// `teams`, `hosts`, `show` and `reset` choose and inspect what the band shows, and `/factory help`
// explains. The old per-view commands are aliases for one release.

const VALID_HOSTS = 'all, local'
const VALID_MODULES = MODULE_IDS.join(', ')

/** The skill snippet: the declaration an agent writes for its own session. */
export const snippetFor = (sel: Selection): string => {
  const example = { modules: ['queue', 'lanes'], hosts: 'local', focus: 'own', teams: sel.identity.status === 'detected' ? [sel.identity.team] : ['QSL'] }
  return [
    'Skill snippet (the agent writes this file for its own session; writing it again replaces the earlier choice):',
    `  Write ~/.ix/factory-panel/features/${sel.key}.json with this content:`,
    `  ${JSON.stringify(example)}`,
    `  Keys, all optional: modules (${VALID_MODULES}), hosts (${VALID_HOSTS}), focus (own, team or a focus name), teams (a list of team names).`,
  ].join('\n')
}

const CHOICE_HELP = [
  '  Choose:      what to display (your choice beats a skill\'s, which beats the automatic view)',
  '    /factory use queue,lanes     the modules, in this order',
  '    /factory focus team          own | team | a focus name, e.g. /factory focus Release Train',
  '    /factory teams QSL,ENG       the teams whose leads and lanes show',
  '    /factory hosts all           all | local machines',
  '    /factory show                what is shown and where each value came from',
  '    /factory reset               back to the skill\'s selection or the automatic view',
].join('\n')

const CLASSIC_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the line above the prompt. Each cell starts with a number.',
  '  Open more:   /factory, or /factory focus | escalations | relay | team | factory',
  "  Switch:      type a cell's number at an empty prompt. r refreshes, Esc closes.",
  CHOICE_HELP,
].join('\n')

const FULLSCREEN_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the panel at the right of the chat, one tab for each view.',
  '  Open more:   /factory (focuses the panel), or /factory focus | escalations | relay | team | factory',
  '  Switch:      click a tab, or type /factory and the view name. r refreshes.',
  CHOICE_HELP,
].join('\n')

export const helpText = (isFullscreen: boolean, sel: Selection = getSelection()): string => `${isFullscreen ? FULLSCREEN_HELP : CLASSIC_HELP}\n\n${snippetFor(sel)}`

const SOURCE_NOTE: Record<string, string> = { user: 'your choice', declaration: 'a skill\'s declaration', default: 'automatic' }

/** What is shown and where each value came from. */
export const showText = (sel: Selection): string => {
  const line = (name: Feature, value: string, source: string) => `  ${name.padEnd(8)} ${value}   [${source}] ${SOURCE_NOTE[source]}`
  const id = sel.identity
  return [
    id.status === 'detected' ? `Session key: ${sel.key} (address ${id.address}, third segment: ${id.segment})` : `Session key: ${sel.key} (could not tell who this session is)`,
    line('modules', sel.modules.value.join(', '), sel.modules.source),
    line('hosts', sel.hosts.value, sel.hosts.source),
    line('focus', sel.focus.value, sel.focus.source),
    line('teams', sel.teams.value.length > 0 ? sel.teams.value.join(', ') : 'every team', sel.teams.source),
    sel.hasChoices ? 'Your choices: set. /factory reset clears them.' : 'Your choices: none.',
    ...sel.notes.map(n => `Note: ${n}`),
  ].join('\n')
}

const list = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean)

/** After a choice: re-read, say what is now shown, and refresh the data the scope reads. */
async function applied($: EngineInterface, options: Options, lead: string): Promise<string> {
  const sel = await refreshSelection($)
  void pollFocus($).catch(() => undefined)
  void pollBoard($, options).catch(() => undefined)
  $.ui.invalidate('ui.render')
  return `${lead}\n${showText(sel)}`
}

async function choose($: EngineInterface, options: Options, command: string, rest: string): Promise<string> {
  const failed = async (what: () => Promise<void>, lead: string): Promise<string> => {
    try {
      await what()
    } catch (error) {
      return `Could not save your choice: ${error instanceof Error ? error.message : String(error)}`
    }
    return applied($, options, lead)
  }
  switch (command) {
    case 'use': {
      const asked = list(rest)
      const modules = normalizeModules(asked)
      if (asked.length === 0) return `/factory use needs module names. The modules are: ${VALID_MODULES}.`
      const unknown = asked.filter(n => !(MODULE_IDS as readonly string[]).includes(n.toLowerCase()))
      if (unknown.length > 0) return `${unknown.join(', ')} is not a module. The modules are: ${VALID_MODULES}.`
      return failed(() => writeChoice($, c => ({ ...c, modules })), `Showing ${modules.join(', ')}.`)
    }
    case 'focus': {
      const focus = rest.trim()
      const value = ['own', 'team'].includes(focus.toLowerCase()) ? focus.toLowerCase() : focus
      return failed(() => writeChoice($, c => ({ ...c, focus: value })), `Focus: ${value}.`)
    }
    case 'teams': {
      const teams = list(rest)
      if (teams.length === 0) return '/factory teams needs team names, for example /factory teams QSL,ENG.'
      return failed(() => writeChoice($, c => ({ ...c, teams })), `Teams: ${teams.join(', ')}.`)
    }
    case 'hosts': {
      const hosts = rest.trim().toLowerCase()
      if (hosts !== 'all' && hosts !== 'local') return `"${rest.trim()}" is not a hosts scope. The values are: ${VALID_HOSTS}.`
      return failed(() => writeChoice($, c => ({ ...c, hosts })), `Hosts: ${hosts}.`)
    }
    default:
      return failed(() => clearChoice($), 'Cleared your choices; each feature follows a skill\'s declaration or the automatic view.')
  }
}

/** Runs one `/factory` command and returns the line to print. */
export async function runFactory($: EngineInterface, options: Options, args: string, isFullscreen: boolean): Promise<string> {
  const text = args.trim()
  const command = (text.split(/\s+/)[0] ?? '').toLowerCase()
  const rest = text.slice(command.length).trim()
  // Every command sees the files as they are now, so a declaration written a moment ago counts.
  const sel = await refreshSelection($)
  if (command === 'help' && rest === '') return helpText(isFullscreen, sel)
  if (command === 'show' && rest === '') return showText(sel)
  if (command === 'reset' && rest === '') return choose($, options, 'reset', '')
  if (command === 'focus' && rest !== '') return choose($, options, 'focus', rest)
  if (['use', 'teams', 'hosts'].includes(command)) return choose($, options, command, rest)
  let view: ViewId
  if (text === '') view = defaultView(sel.modules.value)
  else if (isViewId(command) && rest === '') view = command
  else return `"${text}" is not a /factory command.\n\n${helpText(isFullscreen, sel)}`
  return showView($, options, view, isFullscreen)
}

/** `/factory` and the per-view aliases, which take the arguments of the matching `/factory` command. */
export function registerRouter(on: On, options: Options): void {
  const full = (e: { presentation?: { isFullscreen?: boolean } }) => e.presentation?.isFullscreen === true
  on('command.run', { command: 'factory' }, async ($, e) => ({ text: await runFactory($, options, e.args ?? '', full(e)) }))
  on('command.run', { command: 'focuses' }, async ($, e) => ({ text: await runFactory($, options, `focus ${e.args ?? ''}`, full(e)) }))
  on('command.run', { command: 'escalations' }, async ($, e) => ({ text: await runFactory($, options, `escalations ${e.args ?? ''}`, full(e)) }))
  on('command.run', { command: 'relay' }, async ($, e) => ({ text: await runFactory($, options, `relay ${e.args ?? ''}`, full(e)) }))
  on('command.run', { command: 'team' }, async ($, e) => ({ text: await runFactory($, options, `team ${e.args ?? ''}`, full(e)) }))
}
