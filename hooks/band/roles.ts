import { MODULE_IDS } from './modules'
import type { ModuleId } from './modules'

export type Role = 'coordinator' | 'code-lead' | 'planner' | 'worker'

export const ROLES: readonly Role[] = ['coordinator', 'code-lead', 'planner', 'worker']

// What each role sees by default. Hosts belong to the program coordinator; a code lead sees this
// machine and its project. Changing a default is an edit to this table.
export const PRESETS: Record<Role, readonly ModuleId[]> = {
  coordinator: ['health', 'focus', 'attention', 'relay'],
  'code-lead': ['local', 'focus', 'lead', 'lanes'],
  planner: ['focus', 'queue', 'lead'],
  worker: ['local'],
}

/** Reads a role out of a relay address (`host:TEAM:code`); undefined when it names none. */
export const roleFromAddress = (text: string): Role | undefined => {
  const match = /\b[\w.-]+:[\w.-]+:([a-z]+)\b/i.exec(text)
  const word = match?.[1]?.toLowerCase()
  if (word === undefined) return undefined
  if (word === 'code' || word === 'lead') return 'code-lead'
  if (word === 'plan' || word === 'planner') return 'planner'
  if (word === 'arch' || word === 'coord' || word === 'program') return 'coordinator'
  if (word === 'coder' || word === 'review' || word === 'reviewer') return 'worker'
  return undefined
}

export const isRole = (text: string): text is Role => (ROLES as readonly string[]).includes(text)

/** The modules named in a comma list, unknown names dropped, in the order written. */
export const parseModules = (text: string): ModuleId[] =>
  text
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter((t): t is ModuleId => (MODULE_IDS as readonly string[]).includes(t))

/** The band's modules: the person's list when set, else the role's preset (a code lead when the role is unknown). */
export const modulesFor = (role: Role | undefined, override: string): readonly ModuleId[] => {
  const listed = parseModules(override)
  return listed.length > 0 ? listed : PRESETS[role ?? 'code-lead']
}
