import type { EngineInterface } from 'claude-code'

import type { ChosenFocus, FocusOption } from '../types'
import { projectName, roadmapNames } from './board'
import { isUuid, nameFor, readFile } from './progress'

// The focus choice is `all`, or one Linear initiative or project that leads report in the scope of their work report,
// kept as `initiative:<Linear ID>` or `project:<Linear ID>`. Names are Linear's, as ix-board gives them. Nothing is
// matched against a lead's address or summary.

export type FocusKind = 'initiative' | 'project'

/** What is said of a stored or declared value that is no focus. */
export const NOT_A_FOCUS = 'is not a Linear initiative or project focus'

export function parseRef(value: string): { kind: FocusKind; id: string } | null {
  const m = /^(initiative|project):(.+)$/i.exec(value)
  return m !== null && isUuid(m[2]!) ? { kind: m[1]!.toLowerCase() as FocusKind, id: m[2]!.toLowerCase() } : null
}

export const refOf = (kind: FocusKind, id: string): string => `${kind}:${id.toLowerCase()}`

type Scope = { initiatives?: string[]; projects?: string[] } | null | undefined

/** The initiatives and projects the scopes name by Linear ID, each once; an entry that is no Linear ID is left out. */
export function reportedRefs(scopes: readonly Scope[]): string[] {
  const refs = scopes.flatMap(s => [
    ...(s?.initiatives ?? []).filter(isUuid).map(id => refOf('initiative', id)),
    ...(s?.projects ?? []).filter(isUuid).map(id => refOf('project', id)),
  ])
  return [...new Set(refs)]
}

/** The name of a focus, or its kind and the start of its ID where no name is known. */
export const labelOf = (value: string, name: string | null | undefined): string => {
  const ref = parseRef(value)
  return name ?? (ref === null ? value : `${ref.kind} ${ref.id.slice(0, 8)}`)
}

/**
 * The focuses with their Linear names, by name: from the progress already held, else `ix-board roadmap`, else, for a
 * project the roadmap does not hold, `ix-board project-chunk`.
 */
export async function namesOf($: EngineInterface, refs: readonly string[]): Promise<FocusOption[]> {
  const file = await readFile($)
  const options: FocusOption[] = refs.flatMap(value => {
    const ref = parseRef(value)
    if (ref === null) return []
    const held = ref.kind === 'project' ? nameFor(file, ref.id)?.name : file.initiatives[ref.id]?.name
    return [{ value, kind: ref.kind, id: ref.id, name: held ?? null }]
  })
  if (options.some(o => o.name === null)) {
    const roadmap = await roadmapNames($)
    for (const o of options) o.name ??= roadmap.get(o.value) ?? null
  }
  await Promise.all(options.filter(o => o.name === null && o.kind === 'project').map(async o => void (o.name = await projectName($, o.id))))
  return options.sort((a, b) => labelOf(a.value, a.name).localeCompare(labelOf(b.value, b.name)))
}

/** The focuses that can be chosen, one line each. */
export const choicesText = (options: readonly FocusOption[]): string =>
  options.length === 0
    ? 'No lead of the selected teams reports an initiative or project.'
    : ['The focuses are:', ...options.map(o => `  ${labelOf(o.value, o.name)}  ${o.value}`), '  all'].join('\n')

/** What is wrong with the chosen focus; null where nothing is. */
export const focusNotice = (chosen: ChosenFocus | undefined): string | null =>
  chosen === undefined || chosen.known ? null : `focus ${labelOf(chosen.value, chosen.name)} is not known: showing all`
