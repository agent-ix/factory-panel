import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { resetFocus } from '../hooks/focus'
import { resetSelection } from '../hooks/selection'
import { resetSources } from '../hooks/sources'
import type { Options } from '../hooks/shared'

// A stand-in world for the tests of the mod: the host's answers (relay, files, panes) held in
// memory so a test sets what the session would see and reads back what the mod did.

export type On = Parameters<TestBody>[1]
export const FULLSCREEN = { columns: 200, rows: 50, isFullscreen: true }
export const CLASSIC = { columns: 200, rows: 50, isFullscreen: false }
export const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bandColumns: 180, bodyColumns: 180, scroll: { offset: 0, bodyRows: 4 }, view: {} } as never

export const HOME = '/home/test'
export const FP = `${HOME}/.ix/factory-panel`

export const options = (over: Partial<Options> = {}): Options => ({
  prometheusUrl: 'http://prom.test',
  grafanaUrl: 'http://graf.test',
  teams: [],
  refreshSeconds: 15,
  inlineView: 'band',
  ...over,
})

export type World = {
  opens: { id: string; focus?: boolean; closeOnEscape?: boolean; rows?: number }[]
  closes: string[]
  asks: string[]
  statuses: (string | undefined)[]
  store: Map<string, unknown>
  /** What `agent-msg whoami` answers; undefined means it fails like an unplaced session. */
  whoami: { value: string | undefined }
  /** Panes the host lists as open (id → placed). */
  listed: { value: { id: string; title: string; isPlaced: boolean }[] | undefined }
  relayFails: { value: boolean }
  registered: string[]
  /** The files the mod can read, by absolute path; every other path is missing. */
  files: Map<string, string>
  /** Paths written, in order. */
  writes: string[]
  /** Every argv run, joined. */
  ran: string[]
  /** `agent-msg who` rows, `agent-msg work --lead <a> show` reports by address, `ix-board agents` rows. */
  leads: Map<string, unknown>
  boardAgents: { team: string; agent: string; herdr_status: string; machine: string }[]
  /** The timeout the whoami call asked for. */
  whoamiTimeout: { value: number | undefined }
  /** `answer` as usual, `hang` stays out until the clock has moved five seconds (needs a world with a clock) and then fails, `timeout` fails at once. */
  whoamiMode: { value: 'answer' | 'hang' | 'timeout' }
  /** Paths the mod tried to read. */
  reads: string[]
  /** The moving clock, when the world was made with one. */
  clock: MockClock | undefined
  /** Answers a command before the usual ones; undefined falls through. A promise lets a call stay out. */
  stub: { value: ((argv: string[], init: Init) => Run | Promise<Run> | undefined) | undefined }
  /** Makes `mv` fail, as an interrupted write would. */
  mvFails: { value: boolean }
  /** What `http.fetch` (Prometheus) answers: undefined for the usual empty answer. */
  fetch: { value: ((url: string) => unknown) | undefined }
}

/** The five panes, each shown and placed. */
export const SHOWN = ['factory', 'focus', 'escalations', 'relay', 'team'].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true }))

export function world(on: On, withClock = false): World {
  resetSelection()
  resetSources()
  resetFocus()
  const w: World = { opens: [], closes: [], asks: [], statuses: [], store: new Map(), whoami: { value: 'draco:QSL:code  (location)  model unknown' }, listed: { value: undefined }, relayFails: { value: false }, registered: [], files: new Map(), writes: [], ran: [], leads: new Map(), boardAgents: [], whoamiTimeout: { value: undefined }, whoamiMode: { value: 'answer' }, reads: [], clock: undefined, stub: { value: undefined }, mvFails: { value: false }, fetch: { value: undefined } }
  if (withClock) w.clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 12, 0) })
  on('command.register', (_, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('ui.open', (_, e) => {
    w.opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape, rows: e.rows })
    return { value: { isPlaced: true } }
  })
  // Unless a test lists its own, the host shows whichever view a test mounts.
  on('ui.panes', () => ({ value: (w.listed.value ?? SHOWN) as never }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.close', (_, e) => (w.closes.push(e.id), { value: undefined }))
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  if (!withClock) {
    on('clock.now', () => ({ value: Date.UTC(2026, 10, 24, 12, 0) }))
    on('clock.every', () => ({ value: undefined }))
    // The short wait between a view's first drawing and its read passes at once.
    on('clock.after', () => ({ value: undefined }))
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    const text = w.files.get(e.path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.writes.push(e.path)
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('http.fetch', (_, e) => {
    const custom = w.fetch.value?.(e.url)
    if (custom !== undefined) return custom as never
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } }
  })
  on('process.run', (_, e) => {
    if (e.argv.join(' ') === 'agent-msg whoami') {
      w.whoamiTimeout.value = e.init?.timeoutMs
      // The call stays out until the host's five second limit passes on the moving clock, then fails as it does.
      if (w.whoamiMode.value === 'hang') return w.clock!.sleep(5000).then(() => { throw new Error('timed out after 5000ms') }) as never
      if (w.whoamiMode.value === 'timeout') throw new Error('timed out after 5000ms')
    }
    const answered = answerRun(w, e.argv, e.init)
    return (answered instanceof Promise ? answered.then(value => ({ value })) : { value: answered }) as never
  })
  return w
}


type Init = { timeoutMs?: number } | undefined
export type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
export const out = (stdout: string, exitCode = 0, stderr = ''): Run => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** What the commands the mod runs answer in this world. */
export function answerRun(w: World, argv: readonly string[], init: Init): Run | Promise<Run> {
  const line = argv.join(' ')
  w.ran.push(line)
  const stubbed = w.stub.value?.([...argv], init)
  if (stubbed !== undefined) return stubbed
  if (argv[0] === 'mv' && argv[1] === '-f') {
    if (w.mvFails.value) return out('', 1, 'mv: interrupted')
    w.files.set(argv[3]!, w.files.get(argv[2]!) ?? '')
    w.files.delete(argv[2]!)
    return out('')
  }
  if (argv[0] === 'rm' && argv[1] === '-f') return (w.files.delete(argv[2]!), out(''))
  if (line === 'printenv HOME') return out(`${HOME}\n`)
  if (line === 'hostname -s') return out('draco\n')
  if (line === 'agent-msg whoami') {
    w.whoamiTimeout.value = init?.timeoutMs
    return w.whoami.value === undefined ? out('', 1, 'agent-msg: this session has no verified Herdr placement') : out(w.whoami.value)
  }
  if (line === 'agent-msg who') return out([...w.leads.keys()].map(a => `${a}  draco  codex  seen 11-24 16:26  pane p1  -  Herdr w1:w1:t1`).join('\n'))
  if (line.startsWith('agent-msg work --lead ') && line.endsWith(' show')) {
    const found = w.leads.get(line.slice('agent-msg work --lead '.length, -' show'.length))
    return found === undefined ? out('', 1, 'no report') : out(JSON.stringify(found))
  }
  if (line === 'agent-msg doctor --json') return w.relayFails.value ? out('', 1, 'redis down') : out(JSON.stringify({ ok: true, checks: [] }))
  if (line.startsWith('ix-board --json agents')) return out(JSON.stringify({ agents: w.boardAgents }))
  return out('', 1, `not stubbed: ${line}`)
}

/** A stand-in for the mod's $ for the code that only runs commands, reads files and opens views. */
export function fake$(w: World) {
  return {
    process: { run: async (argv: string[], init?: Init) => answerRun(w, argv, init) },
    http: { fetch: async (url: string) => (w.fetch.value?.(url) as never) ?? { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } },
    fs: {
      read: async (path: string) => {
        w.reads.push(path)
        const text = w.files.get(path)
        if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return text
      },
      write: async (path: string, text: string) => void (w.writes.push(path), w.files.set(path, text)),
    },
    store: { get: async (k: string) => w.store.get(k), set: async (k: string, v: unknown) => void w.store.set(k, v) },
    clock: { now: async () => w.clock?.now() ?? Date.UTC(2026, 10, 24, 12, 0), sleep: (ms: number) => (w.clock ? w.clock.sleep(ms) : new Promise<void>(() => undefined)) },
    ui: {
      open: async (spec: { id: string; focus?: true; closeOnEscape?: true; rows?: number }) => {
        w.opens.push({ id: spec.id, focus: spec.focus, closeOnEscape: spec.closeOnEscape, rows: spec.rows })
        return { isPlaced: true as const }
      },
      close: async (spec: { id: string }) => void w.closes.push(spec.id),
      invalidate: () => undefined,
      log: () => undefined,
    },
  }
}

/**
 * A work report in the shape `agent-msg work show` prints (relay-core WorkReport): a focus summary and
 * no tracker scope, so no ix-board read follows, and one agent for each status given.
 */
export const report = (address: string, summary: string, agentStatuses: string[] = ['running'], scope: { initiatives?: string[]; projects?: string[]; tickets?: string[] } | null = null) => ({
  binding: { machine: address.split(':')[0], pane: 'w1:p1', session: 'sess-1', process_id: 4242, kind: 'codex', address },
  scope: scope === null ? null : { initiatives: [], projects: [], tickets: [], ...scope, reported_at_ms: 1795216041262 },
  focus: { summary, tickets: [], reported_at_ms: 1795214759001 },
  agents: agentStatuses.map((status, i) => ({ agent_id: `a${i}`, name: `agent ${i}`, ticket: 'QSL-1', role: 'coder', status, pane: null, session: null, reported_at_ms: 1795214759001 })),
})

/** What `agent-msg whoami` prints for a lead: the address, the source of the location, then the models. */
export const whoamiLine = (address: string) => `${address}  (location)  model unknown`

export const startSession = ($: Parameters<TestBody>[0], isInteractive = true, cwd = '/proj') => $.session.start({ cwd, surface: 'terminal', isInteractive })

export async function drawBand($: Parameters<TestBody>[0], viewport?: typeof CLASSIC) {
  return $.ui.mount({ plugin: 'factory-panel', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport })
}
export const settle = () => new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => resolve(), 200))

/** The ids of the buttons in a drawn band, in order. */
export async function bandCells(ui: Awaited<ReturnType<typeof drawBand>>): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key!)
}

/** The text of the band's one problem line, if it has one. */
export async function bandLine(ui: Awaited<ReturnType<typeof drawBand>>): Promise<string | undefined> {
  const lines = (await ui.findAll({ type: 'Text' })).filter(t => (t.props as { wrap?: string }).wrap === 'truncate-end')
  return lines.length === 0 ? undefined : lines.map(l => l.text).join('')
}

// ---------------------------------------------------------------- ix-board and agent-msg focuses

/** A project id for tests: a UUID made from a number, so ids are real in shape and distinct. */
export const pid = (n: number | string): string => {
  const hex = typeof n === 'number' ? n.toString(16) : [...n].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0), 0x811c9dc5).toString(16)
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`
}

export type ProjectSpec = {
  name: string
  done: number
  total: number
  inProgress?: number
  id?: string
  /** `ready_queue` entries; null leaves the key out as an answer without it */
  ready?: number | null
  /** `blocker_layers` entries by classification; null leaves the key out */
  layers?: { open: number; completed: number } | null
  states?: { state: string; count: number }[]
}

const projectEntry = (p: ProjectSpec) => ({
  id: p.id ?? pid(p.name),
  identifier: p.id ?? pid(p.name),
  in_progress: Array.from({ length: p.inProgress ?? 0 }, (_, i) => ({ id: `t${i}`, identifier: `QSL-${i}`, state: 'In Progress', title: 'a ticket' })),
  membership: 'full_project',
  milestones: [],
  name: p.name,
  open_by_state: p.states ?? [{ count: p.total - p.done, state: 'In Progress' }],
  progress: { completed_percent: p.total === 0 ? 0 : (100 * p.done) / p.total, done: p.done, total: p.total },
  target_date: null,
  unmilestoned: { in_progress: [], open_by_state: [], progress: { done: p.done, total: p.total } },
})

const readyEntry = (project: string, i: number) => ({ identifier: `QSL-${100 + i}`, next_step: 'specify', project, reason: 'all recursive blockers are Completed', title: 'a ready ticket' })
const layerEntry = (classification: string, i: number) => ({ classification, focus_root_ids: [], identifier: `QSL-${200 + i}`, state: classification === 'Completed' ? 'Done' : 'In Progress', title: 'a blocker' })

/**
 * What `ix-board --json focus status` prints: the keys of a real answer (`blocker_layers`, `excluded_ready_count`,
 * `fetched_at`, `projects` with their `id`, `identifier`, `progress`, `open_by_state`, `in_progress`..., `ready_queue`,
 * `work_milestones`). A project call holds one project and a ready queue of its own; an initiative call holds many.
 */
export const statusJson = (projects: ProjectSpec[], ready = 0) => {
  const first = projects[0]
  const layers = first?.layers === undefined ? [] : first.layers
  const queue = projects.flatMap(p => (p.ready === null ? [] : Array.from({ length: p.ready ?? (projects.length === 1 ? ready : 0) }, (_, i) => readyEntry(p.name, i))))
  const answer: Record<string, unknown> = {
    excluded_ready_count: 0,
    fetched_at: Math.floor(Date.UTC(2026, 10, 24, 11, 55) / 1000),
    projects: projects.map(projectEntry),
    work_milestones: [],
  }
  if (!(projects.length === 1 && first?.ready === null)) answer.ready_queue = queue
  if (layers !== null) answer.blocker_layers = [[...Array.from({ length: layers.open }, (_, i) => layerEntry('Open', i)), ...Array.from({ length: layers.completed }, (_, i) => layerEntry('Completed', layers.open + i))]]
  return JSON.stringify(answer)
}

export type RoadmapSpec = { name: string; id?: string; projects: { name: string; id?: string; also_in?: string[] }[] }

/** What `ix-board --json roadmap` prints: the envelope with `result.initiatives[].projects[]` (names, `also_in`, no ids unless given). */
export const roadmapJson = (initiatives: RoadmapSpec[]) =>
  JSON.stringify({
    age_seconds: 0,
    failure_reason: null,
    last_full_reconciliation: 1795575673,
    last_successful_sync: 1795576785,
    rate_limit_until: null,
    result: {
      initiatives: initiatives.map(i => ({
        health: null,
        ...(i.id === undefined ? {} : { id: i.id }),
        name: i.name,
        projects: i.projects.map(p => ({ also_in: p.also_in ?? [], canceled: null, done: null, last_activity: null, ...(p.id === undefined ? {} : { id: p.id }), name: p.name, open: null, progress_percent: 50, progress_source: 'linear_native', status: 'Started' })),
        status: 'Active',
      })),
      initiatives_without_projects: [],
      missing_scope_initiatives: [],
      missing_scope_projects: [],
      project_membership_mismatches: [],
      projects_in_multiple_initiatives: [],
      projects_missing_from_scope: [],
      unplaced_projects: [],
    },
    stale: false,
  })

/** The error ix-board prints for the dangling milestone (SWM-295), as captured for project a31003a8 and initiative 674ffba8. */
export const BAD_MILESTONE = 'issue QSL-3236 references unavailable milestone 871dbc77-cb19-474d-bd13-4db7145e8ec8 in project a31003a8-790b-482e-b28d-78f1d26a1cbf'

/** A row of `agent-msg focuses list --json` that decodes. */
export const defRow = (focusId: string, name: string, team: string, state = 'active') => ({ focus_id: focusId, team, name, state, latest_revision: 1, owner_id: 'o1', owner_epoch: 1, owner_state: 'live' })
/** A row of `list --json` that cannot be used: only its id, `available` false, a code and a reason. */
export const stubRow = (focusId: string, reason = 'the stored selection is not readable') => ({ focus_id: focusId, available: false, code: 'unavailable_definition', reason })
export const listJson = (...definitions: unknown[]) => JSON.stringify({ definitions })

type Members = { initiatives?: string[]; projects?: string[]; milestones?: [string, string][]; tickets?: string[] }
const memberSet = (m: Members = {}) => ({
  initiatives: (m.initiatives ?? []).map(ref => ({ ref, label: `label ${ref}` })),
  projects: (m.projects ?? []).map(ref => ({ ref, label: `label ${ref}` })),
  milestones: (m.milestones ?? []).map(([ref, project]) => ({ ref, project, label: `label ${ref}` })),
  tickets: (m.tickets ?? []).map(ref => ({ ref, label: `label ${ref}` })),
})
/** `agent-msg focuses show <id> --json`: the definition under `definition`, and `empty_selection`. */
export const showJson = (name: string, team: string, include: Members, exclude: Members = {}, over: { empty?: boolean; definition?: null } = {}) =>
  JSON.stringify({
    focus_id: 'foc-x',
    state: 'active',
    latest_revision: 1,
    empty_selection: over.empty ?? false,
    definition: over.definition === null ? null : { team, name, description: '', include: memberSet(include), exclude: memberSet(exclude) },
  })

export const NEVER = (): Promise<never> => new Promise<never>(() => undefined)
/** A call that stays out until its own timeout passes on the moving clock, then fails as the host does. */
export const hangs = (w: World, init: Init): Promise<never> => w.clock!.sleep(init?.timeoutMs ?? 5000).then(() => { throw new Error(`timed out after ${init?.timeoutMs}ms`) })

/** The `--project` refs of an ix-board argv, in order. */
export const projectRefs = (args: readonly string[]): string[] => args.flatMap((a, i) => (a === '--project' ? [args[i + 1]!] : []))

/**
 * The answer of one combined `focus status` call made of the answers its projects would give alone: like ix-board, the
 * whole call fails with the first failing project's text; else the projects, ready queues and blocker layers are one.
 */
export function combine(runs: readonly Run[]): Run {
  const failed = runs.find(r => r.exitCode !== 0)
  if (failed !== undefined) return failed
  if (runs.length === 1) return runs[0]!
  const answers = runs.map(r => JSON.parse(r.stdout) as Record<string, unknown[] | undefined>)
  const joined: Record<string, unknown> = { ...answers[0], projects: answers.flatMap(a => a.projects ?? []) }
  for (const key of ['ready_queue', 'blocker_layers']) {
    delete joined[key]
    if (answers.some(a => a[key] !== undefined)) joined[key] = answers.flatMap(a => a[key] ?? [])
  }
  return out(JSON.stringify(joined))
}
