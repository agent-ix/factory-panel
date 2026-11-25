import type { EngineInterface } from 'claude-code'

import type { Selector } from './board'
import { errorText } from './shared'

// Resolving the name of `/factory focus <name>`: the keywords, then the named focus
// definitions ix-relay stores, then a lead address, then a lead summary. This file is the
// definitions step. It only reads: `list` and `show` are the only `agent-msg focuses` subcommands
// the mod runs, and nothing creates, changes, archives or claims a definition.

export const LOOKUP_TIMEOUT_MS = 5_000

export const NOTE_EXCLUSIONS = 'exclusions are not applied to progress'
export const NOTE_EMPTY = 'this focus selects nothing'
export const NOTE_UNAVAILABLE = 'the selection of this focus is unavailable'

export type Resolved = {
  focusId: string
  name: string
  team: string | null
  /** The definition's `include` members, as selectors; empty when it selects nothing or cannot be read. */
  selectors: Selector[]
  notes: string[]
  /** Set for a row that is unavailable: no progress is computed. */
  unavailable: boolean
}

type Row = { focus_id?: unknown; name?: unknown; team?: unknown; state?: unknown; available?: unknown; reason?: unknown }
type Member = { ref?: unknown; label?: unknown; project?: unknown }
type MemberSet = { initiatives?: Member[]; projects?: Member[]; milestones?: Member[]; tickets?: Member[] }
type Shown = { empty_selection?: boolean; definition?: { include?: MemberSet; exclude?: MemberSet } | null }

const same = (a: unknown, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
const text = (v: unknown): v is string => typeof v === 'string'

const lastLine = (s: string): string => s.trim().split('\n').filter(Boolean).pop() ?? ''

/** Runs one `agent-msg focuses` call and parses its JSON; every failure is an Error with a line to show. */
async function call($: EngineInterface, argv: string[]): Promise<unknown> {
  const ran = await $.process.run(argv, { timeoutMs: LOOKUP_TIMEOUT_MS })
  const what = argv.slice(0, 4).join(' ')
  if (ran.exitCode !== 0) throw new Error(lastLine(ran.stderr) || lastLine(ran.stdout) || `${what} exited ${ran.exitCode}`)
  try {
    return JSON.parse(ran.stdout) as unknown
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
 * The active definitions this name matches, read with `list` and then `show` for each match. `team` is
 * the session's team when it is known. A failing call is handed to `fail` and the definitions that
 * could be read are returned, so the caller falls through to the lead address and summary steps.
 */
export async function resolveDefinitions($: EngineInterface, name: string, team: string | null, fail: (message: string) => void): Promise<Resolved[]> {
  let rows: Row[]
  try {
    const listed = (await call($, ['agent-msg', 'focuses', 'list', '--json'])) as { definitions?: unknown }
    if (!Array.isArray(listed?.definitions)) throw new Error('agent-msg focuses list printed no definitions list')
    rows = listed.definitions as Row[]
  } catch (error) {
    fail(`list: ${errorText(error)}`)
    return []
  }
  const matched = rows.filter(row => {
    if (typeof row !== 'object' || row === null || !text(row.focus_id)) return false
    // A row without a name, team or state can only be matched by its id.
    if (!text(row.name) || !text(row.team) || !text(row.state)) return same(row.focus_id, name)
    if (row.state !== 'active') return false
    if (team !== null && !same(row.team, team)) return false
    return same(row.name, name) || same(row.focus_id, name)
  })
  const found: Resolved[] = []
  for (const row of matched) {
    const focusId = row.focus_id as string
    const label = text(row.name) ? row.name : focusId
    const teamOf = text(row.team) ? row.team : null
    if (row.available === false) {
      found.push({ focusId, name: focusId, team: null, selectors: [], notes: [text(row.reason) ? row.reason : 'the definition is unavailable'], unavailable: true })
      continue
    }
    try {
      const shown = (await call($, ['agent-msg', 'focuses', 'show', focusId, '--json'])) as Shown
      const definition = shown?.definition ?? null
      const notes: string[] = []
      let selectors: Selector[] = []
      if (shown?.empty_selection === true) notes.push(NOTE_EMPTY)
      else if (definition === null) notes.push(NOTE_UNAVAILABLE)
      else {
        selectors = includeOf(definition.include)
        if (selectors.length === 0) notes.push(NOTE_EMPTY)
      }
      if (definition !== null && hasAny(definition.exclude)) notes.push(NOTE_EXCLUSIONS)
      found.push({ focusId, name: label, team: teamOf, selectors, notes, unavailable: false })
    } catch (error) {
      fail(`show ${focusId}: ${errorText(error)}`)
    }
  }
  return found
}

/** The leads whose address is `name` as `host:team:segment`, or whose `team:segment` end is `name`, ignoring case. */
export const matchLeads = (name: string, leads: readonly string[]): string[] => {
  const want = name.trim().toLowerCase()
  const colons = want.split(':').length - 1
  if (colons < 1 || colons > 2 || want.split(':').some(p => p === '')) return []
  return leads.filter(a => {
    const lower = a.toLowerCase()
    return colons === 2 ? lower === want : lower.endsWith(`:${want}`)
  })
}
