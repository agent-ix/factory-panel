import type { EngineInterface } from 'claude-code'

import { isRole, roleFromAddress } from './band/roles'
import type { Role } from './band/roles'
import type { Options } from './shared'

// The person's role decides what the band shows and which view `/factory` opens first. Order:
// the `role` setting, the session's relay address, a stored answer for the working directory,
// and finally a question asked once when the person types `/factory`. Never asked at session start.

let detected: Role | undefined
let stored: Role | undefined
let cwd = ''

const CHOICES = ['Program coordinator', 'Code lead', 'Planner', 'Other'] as const
const BY_CHOICE: Record<(typeof CHOICES)[number], Role> = {
  'Program coordinator': 'coordinator',
  'Code lead': 'code-lead',
  Planner: 'planner',
  Other: 'worker',
}

const storeKey = (dir: string): string => `role.${dir}`

/** Reads the relay address and the stored answer for this working directory. Never throws. */
export async function startRole($: EngineInterface, options: Options, sessionCwd: string): Promise<void> {
  cwd = sessionCwd
  detected = undefined
  stored = undefined
  if (options.role === 'auto') {
    try {
      const who = await $.process.run(['agent-msg', 'whoami'], { timeoutMs: 5000 })
      detected = roleFromAddress(`${who.stdout} ${who.stderr}`)
    } catch {
      detected = undefined
    }
  }
  try {
    const value = await $.store.get(storeKey(cwd))
    if (typeof value === 'string' && isRole(value)) stored = value
  } catch {
    stored = undefined
  }
}

/** The role in force: the setting, else the relay address, else the stored answer; undefined when none. */
export const roleOf = (options: Options): Role | undefined =>
  isRole(options.role) ? options.role : (detected ?? stored)

/** True when the person has not yet said (and nothing detected) what they do here. */
export const isRoleUnknown = (options: Options): boolean => roleOf(options) === undefined && options.role === 'auto'

/**
 * Asks "What do you do in this session?" and keeps the answer for this working directory.
 * A dismissed question leaves the role unanswered. Returns the role in force afterwards.
 */
export async function askRole($: EngineInterface, options: Options): Promise<Role | undefined> {
  try {
    const answer = await $.ui.ask('What do you do in this session?', { options: [...CHOICES], header: 'Your role' })
    const role = BY_CHOICE[answer as (typeof CHOICES)[number]] ?? 'worker'
    stored = role
    await $.store.set(storeKey(cwd), role)
  } catch {
    // dismissed (or nobody to ask): stay unanswered and ask again next time
  }
  return roleOf(options)
}
