import type { EngineInterface } from 'claude-code'

import { MODULE_IDS } from './band/modules'
import type { ModuleId, Scope } from './band/modules'
import { errorText } from './shared'

// What the panel shows is selected per feature: modules, hosts, focus and teams. Each feature
// takes the highest source that selects it: the user's choice (`/factory use|focus|teams|hosts`,
// choices/<key>.json), then a declaration an agent wrote for the session (features/<key>.json),
// then defaults from the relay (`agent-msg whoami`), then the fallback. The mod only ever writes
// the choice file; it never writes a declaration. Nothing here asks a question.

/** The modules shown when neither the user nor a declaration selects any. */
export const FALLBACK_MODULES: readonly ModuleId[] = ['local', 'focus', 'lead', 'lanes']

export const FEATURES = ['modules', 'hosts', 'focus', 'teams'] as const
export type Feature = (typeof FEATURES)[number]
export type Source = 'user' | 'declaration' | 'default'
export type Hosts = 'all' | 'local'

/** `agent-msg whoami` gives up after this long: the band never waits longer than that. */
export const WHOAMI_TIMEOUT_MS = 5000

export type Identity =
  | { status: 'pending' | 'unknown' }
  | { status: 'detected'; address: string; host: string; team: string; segment: string }

/** The values one file selects; a feature the file does not select is absent. */
export type Picked = { modules?: ModuleId[]; hosts?: Hosts; focus?: string; teams?: string[] }

export type Selection = {
  identity: Identity
  /** The file name of the session: its address with `:` and anything outside [A-Za-z0-9_.-] as `_`. */
  key: string
  modules: { value: ModuleId[]; source: Source }
  hosts: { value: Hosts; source: Source }
  focus: { value: string; source: Source }
  teams: { value: string[]; source: Source }
  /** Notes about files or values that were ignored, each naming the file and the reason. */
  notes: string[]
  /** True when the user has a choice file with at least one choice. */
  hasChoices: boolean
}

// ---------------------------------------------------------------- pure parts

/** The module names in a list, in order, unknown names dropped and repeats after the first. */
export const normalizeModules = (names: readonly string[]): ModuleId[] =>
  names
    .map(t => t.trim().toLowerCase())
    .filter((t): t is ModuleId => (MODULE_IDS as readonly string[]).includes(t))
    .filter((t, i, all) => all.indexOf(t) === i)

/**
 * Reads `host:team:segment` out of `agent-msg whoami`: the first word of any line that has that
 * form (the real output is `host:team:segment  (location)  <models>`); `unknown` when none does.
 */
export const parseIdentity = (text: string): Identity => {
  for (const raw of text.split('\n')) {
    const m = /^([^\s:]+):([^\s:]+):([^\s:]+)$/.exec(raw.trim().split(/\s+/)[0] ?? '')
    if (m) return { status: 'detected', address: `${m[1]}:${m[2]}:${m[3]}`, host: m[1]!, team: m[2]!, segment: m[3]! }
  }
  return { status: 'unknown' }
}

/** The file name of a session: `default` without a placement. */
export const keyOf = (identity: Identity): string =>
  identity.status === 'detected' ? identity.address.replace(/:/g, '_').replace(/[^A-Za-z0-9_.-]/g, '_') : 'default'

/** `ignored` is true when the whole file was set aside, as if it did not exist. */
export type Parsed = { picked: Picked; notes: string[]; ignored?: boolean }

/** Reads a declaration or choice file's text. A file that is not a JSON object is ignored whole. */
export function parseFile(text: string, file: string): Parsed {
  const picked: Picked = {}
  const notes: string[] = []
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { picked, notes: [`${file}: ignored, not valid JSON`], ignored: true }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { picked, notes: [`${file}: ignored, not a JSON object`], ignored: true }
  const o = json as Record<string, unknown>
  for (const k of Object.keys(o)) if (!(FEATURES as readonly string[]).includes(k)) notes.push(`${file}: ignored unknown key ${k}`)
  const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : null)
  if ('modules' in o) {
    const list = strings(o.modules)
    const known = list === null ? [] : normalizeModules(list)
    if (list === null) notes.push(`${file}: modules ignored, not a list of names`)
    else if (known.length === 0) notes.push(`${file}: modules ignored, ${list.length === 0 ? 'the list is empty' : 'no known module name'}`)
    else picked.modules = known
  }
  if ('hosts' in o) {
    const v = typeof o.hosts === 'string' ? o.hosts.trim().toLowerCase() : ''
    if (v === 'all' || v === 'local') picked.hosts = v
    else notes.push(`${file}: hosts ignored, must be all or local`)
  }
  if ('focus' in o) {
    const v = typeof o.focus === 'string' ? o.focus.trim() : ''
    if (v !== '') picked.focus = v
    else notes.push(`${file}: focus ignored, must be own, team or a focus name`)
  }
  if ('teams' in o) {
    const list = strings(o.teams)?.map(t => t.trim()).filter(Boolean)
    if (list === undefined || list.length === 0) notes.push(`${file}: teams ignored, must be a list of team names`)
    else picked.teams = list.filter((t, i) => list.indexOf(t) === i)
  }
  return { picked, notes }
}

/** Decides each feature from the highest source that selects it. */
export function decide(identity: Identity, choice: Picked, declaration: Picked, notes: string[], hasChoices: boolean): Selection {
  const unknown = identity.status === 'unknown'
  const pick = <T,>(c: T | undefined, d: T | undefined, dflt: T): { value: T; source: Source } =>
    c !== undefined ? { value: c, source: 'user' } : d !== undefined ? { value: d, source: 'declaration' } : { value: dflt, source: 'default' }
  return {
    identity,
    key: keyOf(identity),
    modules: pick<ModuleId[]>(choice.modules, declaration.modules, [...FALLBACK_MODULES]),
    // With no way to tell who the session is, the automatic scope is the whole factory.
    hosts: pick<Hosts>(choice.hosts, declaration.hosts, unknown ? 'all' : 'local'),
    focus: pick(choice.focus, declaration.focus, 'own'),
    teams: pick<string[]>(choice.teams, declaration.teams, identity.status === 'detected' ? [identity.team] : []),
    notes,
    hasChoices,
  }
}

/** The scope the band's modules read. */
export const scopeOf = (s: Selection): Scope => ({
  hosts: s.hosts.value,
  focus: s.focus.value,
  teams: s.teams.value,
  ownTeam: s.identity.status === 'detected' ? s.identity.team : null,
  teamsSelected: s.teams.source !== 'default',
  identity: s.identity.status,
})

/** The modules to draw: the selection, with the host list first wherever the hosts scope is `all`. */
export const modulesToDraw = (s: Selection): ModuleId[] =>
  s.hosts.value === 'all' && !s.modules.value.includes('health') ? ['health', ...s.modules.value] : s.modules.value

// ---------------------------------------------------------------- state

const pendingSelection = (): Selection => decide({ status: 'pending' }, {}, {}, [], false)

let current: Selection = pendingSelection()
let homeDir: string | undefined
/** The note found by the latest refresh that no band has drawn yet, with the content it was found for. */
let pendingNote: { key: string; text: string; drawn: boolean } | undefined
/** The content of the last note a band drew, so an unchanged file does not repeat it. */
let shownNoteKey = ''
let ready: Promise<void> = Promise.resolve()
let identity: Identity = { status: 'pending' }
let lookup: Promise<void> | undefined

export const getSelection = (): Selection => current
/**
 * The note a band that is being drawn now shows. It stays on every draw until the next refresh;
 * a draw marks it drawn, and the refresh after that counts the content as shown. A refresh never
 * clears a note nobody has drawn, and a layout without a band never draws it.
 */
export function takeBandNote(): string | undefined {
  if (pendingNote === undefined) return undefined
  pendingNote.drawn = true
  return pendingNote.text
}
/** Resolves once the first identity lookup has answered or given up. */
export const selectionReady = (): Promise<void> => ready

/** Forgets everything the mod learned: a new session starts from the fallback. */
export function resetSelection(): void {
  current = pendingSelection()
  identity = { status: 'pending' }
  shownNoteKey = ''
  pendingNote = undefined
  lookup = undefined
  ready = Promise.resolve()
}

async function home($: EngineInterface): Promise<string> {
  if (homeDir !== undefined) return homeDir
  const ran = await $.process.run(['printenv', 'HOME'], { timeoutMs: 5_000 })
  homeDir = ran.stdout.trim()
  return homeDir
}

/** The directory of the mod's own state. */
export async function factoryDir($: EngineInterface): Promise<string> {
  return `${await home($)}/.ix/factory-panel`
}

async function lookupIdentity($: EngineInterface): Promise<void> {
  try {
    const who = await $.process.run(['agent-msg', 'whoami'], { timeoutMs: WHOAMI_TIMEOUT_MS })
    identity = who.exitCode === 0 ? parseIdentity(who.stdout) : { status: 'unknown' }
  } catch {
    identity = { status: 'unknown' }
  }
}

const shown = (file: string, base: string): string => file.replace(base, '~/.ix/factory-panel')

/**
 * Reads `<dir>/<key>.json`, else `<dir>/default.json`. A file that is missing or ignored (not a JSON
 * object, not valid JSON) counts as if it did not exist, so the next one is read; what an ignored
 * file said is a note. `raw` is what was read, to tell a changed file from an unchanged one.
 */
async function readParsed($: EngineInterface, dir: string, key: string, base: string): Promise<{ parsed: Parsed; raw: string }> {
  const notes: string[] = []
  let raw = ''
  for (const name of key === 'default' ? ['default'] : [key, 'default']) {
    const file = `${dir}/${name}.json`
    let text: string
    try {
      text = await $.fs.read(file)
    } catch {
      continue // missing: try the next
    }
    const parsed = parseFile(text, shown(file, base))
    raw += text
    notes.push(...parsed.notes)
    if (!parsed.ignored) return { parsed: { picked: parsed.picked, notes }, raw }
  }
  return { parsed: { picked: {}, notes }, raw }
}

/** The choices stored for this session, as the mod would apply them. */
async function readChoice($: EngineInterface, base: string, key: string): Promise<{ parsed: Parsed; raw: string; any: boolean }> {
  const found = await readParsed($, `${base}/choices`, key, base)
  return { ...found, any: Object.keys(found.parsed.picked).length > 0 }
}

/**
 * Reads the identity (until it is known), the declaration and the choices, and decides each
 * feature. Never throws and never waits on a missing file. The identity lookup gives up after
 * five seconds and leaves the session unidentified.
 */
export function refreshSelection($: EngineInterface): Promise<Selection> {
  const refreshed = readSelection($)
  // Whatever waits for the selection waits for the files too, not only for the identity.
  if (identity.status !== 'detected') ready = refreshed.then(() => undefined)
  return refreshed
}

async function readSelection($: EngineInterface): Promise<Selection> {
  try {
    if (identity.status !== 'detected') {
      lookup ??= lookupIdentity($).finally(() => {
        lookup = undefined
      })
      await lookup
    }
    const base = await factoryDir($)
    const key = keyOf(identity)
    const declared = await readParsed($, `${base}/features`, key, base)
    const decl = declared.parsed
    const choice = await readChoice($, base, key)
    const notes = [...decl.notes, ...choice.parsed.notes]
    // A note is kept for the next band that is drawn, unless that content has already been shown.
    const noteKey = notes.length === 0 ? '' : `${declared.raw}\u0000${choice.raw}\u0000${notes.join('\n')}`
    if (pendingNote?.drawn === true) shownNoteKey = pendingNote.key
    pendingNote = notes.length > 0 && noteKey !== shownNoteKey ? { key: noteKey, text: notes.join(' · '), drawn: false } : undefined
    if (notes.length === 0) shownNoteKey = ''
    current = decide(identity, choice.parsed.picked, decl.picked, notes, choice.any)
  } catch (error) {
    $.ui.log(`factory-panel: selection failed: ${errorText(error)}`, { to: 'debug' })
    current = decide(identity, {}, {}, [], false)
  }
  return current
}

/** Writes a change to the user's choices for this session's key; the declaration is never touched. */
export async function writeChoice($: EngineInterface, change: (c: Picked) => Picked): Promise<void> {
  const base = await factoryDir($)
  const { parsed } = await readChoice($, base, current.key)
  await $.fs.write(`${base}/choices/${current.key}.json`, `${JSON.stringify(change(parsed.picked), null, 2)}\n`)
}

/** Clears the user's choices for this session's key. */
export async function clearChoice($: EngineInterface): Promise<void> {
  await $.fs.write(`${await factoryDir($)}/choices/${current.key}.json`, '{}\n')
}
