import type { EngineInterface, On } from 'claude-code'

import { MODULE_IDS } from './band/modules'
import { choiceApplied, focusBannerNow, focusDetailNow, focusHeld, readForCommand } from './focus'
import { readRecords } from './progress'
import { SOURCE_NAMES, selectorErrorList, sourceState } from './sources'
import { ALL, clearChoice, focusValue, getSelection, normalizeModules, refreshSelection, writeChoice } from './selection'
import type { Feature, Selection } from './selection'
import { defaultView, isViewId, showView } from './views'
import type { ViewId } from './views'
import { choicesText, listDefinitions, showDefinition } from './namedfocus'
import { ago, errorText } from './shared'
import type { Options } from './shared'

// The one command. `/factory` opens the detail, `/factory <view>` opens that view, `use`, `focus`,
// `teams`, `hosts`, `show` and `reset` choose and inspect what the band shows, and `/factory help`
// explains. The old per-view commands are aliases for one release.

const VALID_HOSTS = 'all, local'
const VALID_MODULES = MODULE_IDS.join(', ')

/** The skill snippet: the declaration an agent writes for its own session. */
export const snippetFor = (sel: Selection): string => {
  const example = { modules: ['queue', 'lanes'], hosts: 'local', focus: 'all', teams: sel.identity.status === 'detected' ? [sel.identity.team] : ['QSL'] }
  return [
    'Skill snippet (the agent writes this file for its own session; writing it again replaces the earlier choice):',
    `  Write ~/.ix/factory-panel/features/${sel.key}.json with this content:`,
    `  ${JSON.stringify(example)}`,
    `  Keys, all optional: modules (${VALID_MODULES}), hosts (${VALID_HOSTS}), focus (all or a focus definition ID), teams (a list of team names, or ["all"]).`,
  ].join('\n')
}

const CHOICE_HELP = [
  '  Choose:      what to display (your choice beats a skill\'s, which beats the automatic view)',
  '    /factory use queue,lanes     the modules, in this order',
  '    /factory focus Release Train one relay focus definition, by name or ID, within the teams; or all',
  '    /factory teams QSL,ENG       the teams whose leads and lanes show; all is every team',
  '    /factory hosts all           all | local machines',
  '    /factory show                what is shown and where each value came from',
  '    /factory reset               back to the skill\'s selection or the automatic view',
].join('\n')

const CLASSIC_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the line above the prompt. Each cell starts with a number.',
  '  Open more:   /factory, or /factory focus | work | escalations | relay | team | factory',
  "  Switch:      type a cell's number at an empty prompt. r refreshes, Esc closes.",
  CHOICE_HELP,
].join('\n')

const FULLSCREEN_HELP = [
  "factory-panel shows the factory's health, your project's progress and what needs you.",
  '  See it:      the panel at the right of the chat, one tab for each view.',
  '  Open more:   /factory (focuses the panel), or /factory focus | work | escalations | relay | team | factory',
  '  Switch:      click a tab, or type /factory and the view name. r refreshes.',
  CHOICE_HELP,
].join('\n')

export const helpText = (isFullscreen: boolean, sel: Selection = getSelection()): string => `${isFullscreen ? FULLSCREEN_HELP : CLASSIC_HELP}\n\n${snippetFor(sel)}`

const SOURCE_NOTE: Record<string, string> = { user: 'your choice', declaration: 'a skill\'s declaration', default: 'automatic' }

/** Every failing source with its error, and the age of its last success where there is one. */
async function sourceLines($: EngineInterface): Promise<string[]> {
  if (SOURCE_NAMES.every(n => sourceState(n).error === null) && selectorErrorList().length === 0) return []
  const now = await $.clock.now()
  const records = await readRecords($)
  const lines: string[] = []
  for (const source of SOURCE_NAMES) {
    const state = sourceState(source)
    if (state.error === null && !(source === 'ix-board' && selectorErrorList().length > 0)) continue
    // The age of an ix-board selector comes from its record in progress.json; the other sources' from memory.
    const newest = Object.values(records).reduce<number | null>((m, r) => (m === null || r.at_ms > m ? r.at_ms : m), null)
    const at = source === 'ix-board' ? newest : state.okAt
    if (state.error !== null) lines.push(`  ${source}: ${state.error}${at === null ? '' : ` (last success ${ago(at, now)})`}`)
    if (source === 'ix-board')
      for (const e of selectorErrorList()) {
        const rec = records[e.key]
        lines.push(`  ix-board ${e.name}: ${e.error}${rec === undefined ? '' : ` (last success ${ago(rec.at_ms, now)})`}`)
      }
  }
  return lines.length === 0 ? [] : ['Source errors:', ...lines]
}

/** What is shown and where each value came from. */
export const showText = async ($: EngineInterface, sel: Selection): Promise<string> => {
  const line = (name: Feature, value: string, source: string) => `  ${name.padEnd(8)} ${value}   [${source}] ${SOURCE_NOTE[source]}`
  const id = sel.identity
  // The state the panes keep is the host's; a caller without it just has no banner line.
  const banner = await focusBannerNow($, sel).catch(() => null)
  const detail = await focusDetailNow($, sel).catch(() => [])
  const chosen = await focusHeld($).then(held => held.meta.chosen, () => undefined)
  const focus = chosen?.id === sel.focus.value && chosen.name !== null ? `${chosen.name} (${sel.focus.value})` : sel.focus.value
  return [
    id.status === 'detected' ? `Session key: ${sel.key} (address ${id.address}, third segment: ${id.segment})` : `Session key: ${sel.key} (could not tell who this session is)`,
    line('modules', sel.modules.value.join(', '), sel.modules.source),
    line('hosts', sel.hosts.value, sel.hosts.source),
    line('focus', focus, sel.focus.source),
    line('teams', sel.teams.value.length > 0 ? sel.teams.value.join(', ') : 'every team', sel.teams.source),
    ...(banner === null ? [] : [banner]),
    ...detail,
    sel.hasChoices ? 'Your choices: set. /factory reset clears them.' : 'Your choices: none.',
    ...sel.notes.map(n => `Note: ${n}`),
    ...(await sourceLines($)),
  ].join('\n')
}

const list = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean)

/** A typed command is on screen: one gated read of the focuses it is about to print. Where none can be made, what is held is printed. */
const readFocuses = ($: EngineInterface, changed: boolean): Promise<void> => readForCommand($, changed).catch(() => undefined)

/** After a choice: re-read what it selects and say what is now shown. */
async function applied($: EngineInterface, lead: string): Promise<string> {
  const sel = await choiceApplied($)
  return `${lead}\n${await showText($, sel)}`
}

/**
 * The definition relay resolves a reference to: its ID, and its name to say. Where it names none that can be chosen,
 * `id` is null and `message` says why and lists those that can.
 */
async function chooseDefinition($: EngineInterface, reference: string): Promise<{ id: string | null; message: string }> {
  const refused = async (why: string): Promise<{ id: null; message: string }> => {
    const valid = await listDefinitions($).then(choicesText, error => `The definitions could not be listed: ${errorText(error)}`)
    return { id: null, message: `${why}. The focus is unchanged.\n${valid}` }
  }
  try {
    const answer = await showDefinition($, reference)
    if (answer.kind !== 'found') return refused(answer.message)
    const { focusId, name, isArchived } = answer.definition
    if (isArchived) return refused(`${name ?? focusId} is archived`)
    return { id: focusId, message: name ?? focusId }
  } catch (error) {
    return { id: null, message: `Could not ask relay for the focus: ${errorText(error)}. The focus is unchanged.` }
  }
}

async function choose($: EngineInterface, command: string, rest: string): Promise<string> {
  const failed = async (what: () => Promise<void>, lead: string): Promise<string> => {
    try {
      await what()
    } catch (error) {
      return `Could not save your choice: ${error instanceof Error ? error.message : String(error)}`
    }
    return applied($, lead)
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
      const reference = focusValue(rest)
      if (reference === ALL) return failed(() => writeChoice($, c => ({ ...c, focus: ALL })), 'Focus: all.')
      const found = await chooseDefinition($, reference)
      if (found.id === null) return found.message
      const id = found.id
      return failed(() => writeChoice($, c => ({ ...c, focus: id })), `Focus: ${found.message}.`)
    }
    case 'teams': {
      const named = list(rest)
      const teams = named.some(t => t.toLowerCase() === ALL) ? [ALL] : named
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
  if (command === 'show' && rest === '') {
    await readFocuses($, false)
    return showText($, sel)
  }
  if (command === 'reset' && rest === '') return choose($, 'reset', '')
  if (command === 'focus' && rest !== '') return choose($, 'focus', rest)
  if (['use', 'teams', 'hosts'].includes(command)) return choose($, command, rest)
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
