import type { EngineInterface } from 'claude-code'

import type { ChosenFocus, FocusDefinition } from '../types'
import type { Selector } from './board'

// The focus choice is `all` or one named focus definition of ix-relay (relay FR-061), stored by its focus ID. The
// relay resolves a name or ID: the mod asks `agent-msg focuses show` and takes its answer or its typed refusal, and
// matches nothing itself. It only reads: `list` and `show` are the only `agent-msg focuses` subcommands the mod runs.

export const LOOKUP_TIMEOUT_MS = 5_000

export const NOTE_EXCLUSIONS = 'exclusions are not applied to progress'
export const NOTE_EMPTY = 'this focus selects nothing'
export const NOTE_UNAVAILABLE = 'the selection of this focus is unavailable'

/** What every focus ID is (relay FR-061): `foc-` and 32 lowercase hexadecimal characters. */
export const isFocusId = (value: string): boolean => /^foc-[0-9a-f]{32}$/.test(value)

/** How a definition is created, said where relay has none. */
export const CREATE_HINT = 'agent-msg focuses create --file <file.json>'
export const NO_DEFINITIONS = 'relay has no focus definitions'

export type Definition = {
  focusId: string
  /** null where the revision cannot be read */
  name: string | null
  isArchived: boolean
  /** The definition's `include` members, as selectors; empty when it selects nothing or cannot be read. */
  selectors: Selector[]
  notes: string[]
  /** True where the relay gives no selection for it. */
  isUnreadable: boolean
}

/** What relay says of a reference: the definition, or why there is none. */
export type Answer =
  | { kind: 'found'; definition: Definition }
  | { kind: 'unknown' | 'ambiguous' | 'unavailable'; message: string }

type Row = { focus_id?: unknown; name?: unknown; team?: unknown; state?: unknown; available?: unknown; reason?: unknown }
type Member = { ref?: unknown; label?: unknown; project?: unknown }
type MemberSet = { initiatives?: Member[]; projects?: Member[]; milestones?: Member[]; tickets?: Member[] }
type Shown = { focus_id?: unknown; state?: unknown; empty_selection?: boolean; definition?: { name?: unknown; include?: MemberSet; exclude?: MemberSet } | null }
type Refusal = { code?: unknown; message?: unknown; reason?: unknown }

const text = (v: unknown): v is string => typeof v === 'string'

const lastLine = (s: string): string => s.trim().split('\n').filter(Boolean).pop() ?? ''

/** The typed error object `--json` prints on standard error; null where it is something else. */
const refusalOf = (stderr: string): Refusal | null => {
  try {
    const parsed = JSON.parse(lastLine(stderr)) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Refusal) : null
  } catch {
    return null
  }
}

function parsed(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw new Error(`${what} printed text that is not JSON`)
  }
}

const members = (set: MemberSet | undefined, kind: Selector['kind'], key: keyof MemberSet): Selector[] =>
  (set?.[key] ?? []).flatMap((m): Selector[] =>
    text(m.ref) ? [{ kind, ref: m.ref, ...(kind === 'milestone' && text(m.project) ? { project: m.project } : {}), ...(text(m.label) && m.label !== '' ? { label: m.label } : {}) }] : [],
  )

/** The members of a `show` answer's include list, in the order initiatives, projects, milestones, tickets. */
export const includeOf = (set: MemberSet | undefined): Selector[] => [
  ...members(set, 'initiative', 'initiatives'),
  ...members(set, 'project', 'projects'),
  ...members(set, 'milestone', 'milestones'),
  ...members(set, 'ticket', 'tickets'),
]

const hasAny = (set: MemberSet | undefined): boolean => (['initiatives', 'projects', 'milestones', 'tickets'] as const).some(k => (set?.[k]?.length ?? 0) > 0)

/**
 * Asks relay for the definition a focus ID or exact name names. Its typed refusals are answers; any other failure is
 * thrown as an Error with a line to show.
 */
export async function showDefinition($: EngineInterface, reference: string): Promise<Answer> {
  const ran = await $.process.run(['agent-msg', 'focuses', 'show', reference, '--json'], { timeoutMs: LOOKUP_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    const refusal = refusalOf(ran.stderr)
    const message = text(refusal?.message) ? refusal.message : lastLine(ran.stderr) || lastLine(ran.stdout) || `agent-msg focuses show exited ${ran.exitCode}`
    if (refusal?.code === 'not_found') return { kind: 'unknown', message }
    if (refusal?.code === 'invalid_argument') return { kind: 'ambiguous', message }
    if (refusal?.code === 'unavailable_definition') return { kind: 'unavailable', message: text(refusal.reason) ? refusal.reason : message }
    throw new Error(message)
  }
  const shown = parsed(ran.stdout, 'agent-msg focuses show') as Shown
  if (!text(shown?.focus_id)) throw new Error('agent-msg focuses show printed no focus_id')
  const definition = shown.definition ?? null
  const notes: string[] = []
  let selectors: Selector[] = []
  const isUnreadable = definition === null && shown.empty_selection !== true
  if (shown.empty_selection === true) notes.push(NOTE_EMPTY)
  else if (definition === null) notes.push(NOTE_UNAVAILABLE)
  else {
    selectors = includeOf(definition.include)
    if (selectors.length === 0) notes.push(NOTE_EMPTY)
  }
  if (definition !== null && hasAny(definition.exclude)) notes.push(NOTE_EXCLUSIONS)
  return { kind: 'found', definition: { focusId: shown.focus_id, name: text(definition?.name) ? definition.name : null, isArchived: shown.state === 'archived', selectors, notes, isUnreadable } }
}

/** The definitions relay lists, archived ones left out as `list` leaves them, in its order. */
export async function listDefinitions($: EngineInterface): Promise<FocusDefinition[]> {
  const ran = await $.process.run(['agent-msg', 'focuses', 'list', '--json'], { timeoutMs: LOOKUP_TIMEOUT_MS })
  if (ran.exitCode !== 0) {
    const refusal = refusalOf(ran.stderr)
    throw new Error(text(refusal?.message) ? refusal.message : lastLine(ran.stderr) || lastLine(ran.stdout) || `agent-msg focuses list exited ${ran.exitCode}`)
  }
  const listed = parsed(ran.stdout, 'agent-msg focuses list') as { definitions?: unknown }
  if (!Array.isArray(listed?.definitions)) throw new Error('agent-msg focuses list printed no definitions list')
  return (listed.definitions as Row[]).flatMap((row): FocusDefinition[] => {
    if (!text(row?.focus_id) || row.state === 'archived') return []
    if (row.available === false || !text(row.name)) return [{ id: row.focus_id, name: null, team: null, reason: text(row.reason) ? row.reason : 'unavailable' }]
    return [{ id: row.focus_id, name: row.name, team: text(row.team) ? row.team : null, reason: null }]
  })
}

/** The definitions that can be chosen, one line each, or how one is made. */
export const choicesText = (definitions: readonly FocusDefinition[]): string => {
  const usable = definitions.filter(d => d.name !== null)
  if (usable.length === 0) return `${NO_DEFINITIONS}; create one with ${CREATE_HINT}`
  return ['The focus definitions are:', ...usable.map(d => `  ${d.name}${d.team === null ? '' : ` (${d.team})`}  ${d.id}`), '  all'].join('\n')
}

/** The one line that says what is wrong with the chosen definition, or that it is archived; null where nothing is. */
export const focusNotice = (chosen: ChosenFocus | undefined): string | null => {
  if (chosen === undefined) return null
  const name = chosen.name ?? chosen.id
  switch (chosen.state) {
    case 'active':
      return null
    case 'archived':
      return `focus ${name} is archived`
    case 'unknown':
      return `focus ${chosen.id} is not a relay focus definition: showing all`
    case 'unavailable':
      return `focus ${name} is unavailable (${chosen.reason}): showing all`
    case 'stale':
      return `focus ${name} could not be read again (${chosen.reason}): shown as last read`
    case 'unread':
      return `focus ${name} could not be read (${chosen.reason}): showing all`
  }
}
