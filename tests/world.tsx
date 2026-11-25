import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { resetSelection } from '../hooks/selection'
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
}

export function world(on: On, withClock = false): World {
  resetSelection()
  const w: World = { opens: [], closes: [], asks: [], statuses: [], store: new Map(), whoami: { value: 'draco:QSL:code' }, listed: { value: undefined }, relayFails: { value: false }, registered: [], files: new Map(), writes: [], ran: [], leads: new Map(), boardAgents: [], whoamiTimeout: { value: undefined }, whoamiMode: { value: 'answer' }, reads: [], clock: undefined }
  if (withClock) w.clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 12, 0) })
  on('command.register', (_, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('ui.open', (_, e) => {
    w.opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape, rows: e.rows })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: (w.listed.value ?? []) as never }))
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
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status: 'success', data: { result: [] } }) } }))
  on('process.run', (_, e) => {
    if (e.argv.join(' ') === 'agent-msg whoami') {
      w.whoamiTimeout.value = e.init?.timeoutMs
      // The call stays out until the host's five second limit passes on the moving clock, then fails as it does.
      if (w.whoamiMode.value === 'hang') return w.clock!.sleep(5000).then(() => { throw new Error('timed out after 5000ms') }) as never
      if (w.whoamiMode.value === 'timeout') throw new Error('timed out after 5000ms')
    }
    return { value: answerRun(w, e.argv, e.init) }
  })
  return w
}


type Init = { timeoutMs?: number } | undefined
const out = (stdout: string, exitCode = 0, stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** What the commands the mod runs answer in this world. */
export function answerRun(w: World, argv: readonly string[], init: Init) {
  const line = argv.join(' ')
  w.ran.push(line)
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
    clock: { now: async () => Date.UTC(2026, 10, 24, 12, 0) },
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

/** A work report that gives a lead a focus summary and no tracker scope, so no ix-board read follows. */
export const report = (address: string, summary: string, status = 'working') => ({ binding: { address, machine: address.split(':')[0] }, focus: { summary }, status })

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
