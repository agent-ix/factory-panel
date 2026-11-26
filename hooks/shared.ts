import type { EngineInterface } from 'claude-code'
import { meter } from './meter'
import { ACCENT, DOING, READY, TRACK } from './ui/glyphs'

// ---------------------------------------------------------------- options

export type Options = {
  prometheusUrl: string
  grafanaUrl: string
  /** The teams ix-board may be asked about when the selection names none (herdr workspace labels). */
  teams: string[]
  refreshSeconds: number
  /** band | status | off: what a classic (non-fullscreen) session shows. */
  inlineView: 'band' | 'status' | 'off'
  /** Whether a docking layout opens the panes at session start; false leaves them to /factory. */
  openOnStart: boolean
}

export const readOptions = (options: Record<string, unknown>): Options => ({
  // Empty means "not set": session start fills it in from the shared ix config (hooks/endpoints.ts).
  prometheusUrl: String(options.prometheusUrl ?? '').trim(),
  grafanaUrl: String(options.grafanaUrl ?? '').trim(),
  teams: String(options.teams ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean),
  refreshSeconds: Math.max(5, Number(options.refreshSeconds ?? 15) || 15),
  // Quiet unless asked: nothing is drawn or read until the person opens a view.
  inlineView: ['band', 'status'].includes(String(options.inlineView)) ? (String(options.inlineView) as 'band' | 'status') : 'off',
  openOnStart: ['true', '1', 'yes', 'on'].includes(String(options.openOnStart ?? false).toLowerCase()),
})

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * A timeout reads as one short line (`prometheus: timed out`) that fits a 40-column pane; any
 * other text is unchanged, and so is a bad_data error that only names a `timeout` parameter.
 * The full text stays in the pane's detail.
 */
export const shortError = (source: string, text: string): string =>
  !/invalid parameter/i.test(text) && /\btimed?[ -]?out\b|\btimeout\b|\bno complete answer\b/i.test(text)
    ? `${source}: timed out`
    : text

export const ago = (at: number | null, now: number): string => {
  if (at === null) return 'never'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

/** An age without the "ago": 19h, 6m. */
export const agoShort = (at: number, now: number): string => ago(at, now).replace(/ ago$/, '')

/** How long until a moment: "58m", "2h". */
export const until = (at: number, now: number): string => ago(now, at).replace(/ ago$/, '')

/** The line a pane shows while Linear's rate limit holds. */
export const pausedText = (backoffUntil: number, now: number): string =>
  `Linear rate limit · paused ${until(backoffUntil, now)}`

// ---------------------------------------------------------------- files

/**
 * Writes a file by writing a temporary file and renaming it, so another session reads the old file or the new one,
 * never a part. Throws, leaving the old file, where it cannot.
 */
export async function writeWhole($: EngineInterface, path: string, text: string): Promise<void> {
  const temp = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`
  await $.fs.write(temp, text)
  const moved = await spawn($, ['mv', '-f', temp, path], 5_000)
  if (moved.exitCode === 0) return
  await spawn($, ['rm', '-f', temp], 5_000)
  throw new Error(moved.stderr.trim() || `could not write ${path}`)
}

// ---------------------------------------------------------------- Prometheus

export type Sample = { metric: Record<string, string>; value: [number, string] }
export type RangeSeries = { metric: Record<string, string>; values: [number, string][] }

/** A Prometheus call is given up on after this long. */
export const PROMETHEUS_TIMEOUT_MS = 5_000

/** Resolves true once `ms` have passed on the host's clock; never resolves where the clock cannot wait. */
export function after($: EngineInterface, ms: number): Promise<true> {
  return Promise.resolve()
    .then(() => $.clock.sleep(ms))
    .then(
      () => true as const,
      () => new Promise<true>(() => undefined),
    )
}

/** One Prometheus call, counted under `prometheus:<group>` with its round trip and the bytes it brought back. */
async function promGet<T>($: EngineInterface, url: string, body: string, group: string): Promise<T> {
  const began = Date.now()
  let bytes = 0
  let ok = false
  try {
    const data = await promCall<T>($, url, body, n => (bytes = n))
    ok = true
    return data
  } finally {
    meter.http(`prometheus:${group}`, Date.now() - began, bytes, ok)
  }
}

async function promCall<T>($: EngineInterface, url: string, body: string, sized: (bytes: number) => void): Promise<T> {
  const timedOut = after($, PROMETHEUS_TIMEOUT_MS).then((): never => {
    throw new Error(`Prometheus timed out after ${PROMETHEUS_TIMEOUT_MS}ms`)
  })
  const response = await Promise.race([
    $.http.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
    timedOut,
  ])
  sized(typeof response.text === 'string' ? response.text.length : 0)
  if (!response.ok) throw new Error(`Prometheus ${response.status}`)
  const parsed = JSON.parse(response.text) as { status: string; data?: T; error?: string }
  if (parsed.status !== 'success' || parsed.data === undefined) {
    throw new Error(parsed.error ?? 'Prometheus query failed')
  }
  return parsed.data
}

/** An instant query; `group` names the source it is counted under. */
export async function promQuery($: EngineInterface, base: string, query: string, group: string): Promise<Sample[]> {
  const data = await promGet<{ result?: Sample[] }>(
    $,
    `${base.replace(/\/$/, '')}/api/v1/query`,
    `query=${encodeURIComponent(query)}`,
    group,
  )
  return Array.isArray(data.result) ? data.result : []
}

/** A range query ending now: `seconds` of history at `step` seconds per point. */
export async function promRange(
  $: EngineInterface,
  base: string,
  query: string,
  seconds: number,
  step: number,
  group: string,
): Promise<RangeSeries[]> {
  const end = Math.floor((await $.clock.now()) / 1000)
  const data = await promGet<{ result?: RangeSeries[] }>(
    $,
    `${base.replace(/\/$/, '')}/api/v1/query_range`,
    `query=${encodeURIComponent(query)}&start=${end - seconds}&end=${end}&step=${step}`,
    group,
  )
  return Array.isArray(data.result) ? data.result : []
}

// ---------------------------------------------------------------- commands

/**
 * The one place the mod starts a host process, so that each is counted (hooks/meter.ts). `name` is the row it is
 * counted under: the source behind it where the caller names one, else the program.
 */
export async function spawn($: EngineInterface, argv: readonly string[], timeoutMs: number, name: string = argv[0] ?? '?') {
  const began = Date.now()
  try {
    return await $.process.run([...argv], { timeoutMs })
  } finally {
    meter.spawn(name, Date.now() - began)
  }
}

/** Runs a host command and parses its standard output as JSON, whatever its exit code. */
export async function runJson<T>($: EngineInterface, argv: string[], timeoutMs: number, name?: string): Promise<T> {
  const ran = await spawn($, argv, timeoutMs, name)
  try {
    return JSON.parse(ran.stdout) as T
  } catch {
    const why = ran.stderr.trim().split('\n').pop()
    throw new Error(why || `${argv[0]} exited ${ran.exitCode}`)
  }
}

/** Runs a host command for its text; a non-zero exit throws with its last error line. */
export async function runText($: EngineInterface, argv: string[], timeoutMs: number, name?: string): Promise<string> {
  const ran = await spawn($, argv, timeoutMs, name)
  if (ran.exitCode !== 0) {
    const why = ran.stderr.trim().split('\n').pop() || ran.stdout.trim().split('\n').pop()
    throw new Error(why || `${argv[0]} exited ${ran.exitCode}`)
  }
  return ran.stdout
}

const MAX_MESSAGE = 200

/** What ix-board said as it failed: its `error:` line where it leads with one, else its last line. */
export function failureText(stderr: string, exitCode: number): string {
  const lines = stderr.split('\n').map(l => l.trim()).filter(l => l !== '')
  const said = (lines[0]?.startsWith('error:') ? lines[0] : lines[lines.length - 1]) ?? `ix-board exited ${exitCode}`
  return said.length > MAX_MESSAGE ? `${said.slice(0, MAX_MESSAGE - 1)}…` : said
}

// ---------------------------------------------------------------- drawing

// Status steps from the dataviz reference palette: they read on light and dark surfaces.
// Text never wears them; a mark beside the text carries the state.
export const INK = {
  calm: ACCENT,
  doing: DOING,
  ready: READY,
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  track: 'rgba(128,128,128,0.22)',
  muted: 'rgba(128,128,128,0.38)',
}
export const CARD_BG = 'rgba(128,128,128,0.08)'
export const CARD_BG_OPEN = 'rgba(128,128,128,0.15)'

/** A horizontal progress bar: a track, then stacked fills for done, in progress and ready out of total. */
export const progressBar = (done: number, total: number, width: number, color = INK.calm, inProgress = 0, ready = 0): string => {
  const h = 6
  const d = total > 0 ? Math.max(0, Math.min(done, total)) : 0
  const i = total > 0 ? Math.max(0, Math.min(inProgress, total - d)) : 0
  const r = total > 0 ? Math.max(0, Math.min(ready, total - d - i)) : 0
  // Each fill runs from the left edge to the end of its own category; later categories sit under earlier ones.
  const extent = (n: number) => (n > 0 ? Math.min(width, Math.max(h, (n / total) * width)) : 0)
  const rect = (w: number, fill: string) =>
    w > 0 ? `<rect x="0" y="0" width="${w.toFixed(1)}" height="${h}" rx="3" fill="${fill}"/>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<rect x="0" y="0" width="${width}" height="${h}" rx="3" fill="${TRACK}"/>` +
    rect(extent(d + i + r), INK.ready) +
    rect(extent(d + i), INK.doing) +
    rect(extent(d), color) +
    `</svg>`
  )
}
// ---------------------------------------------------------------- panes

export type PaneSpec = { id: string; title: string }

/** Runs one startup step; a failure is logged and never stops the steps after it. */
export async function guarded($: EngineInterface, what: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (error) {
    $.ui.log(`factory-panel: ${what} failed: ${errorText(error)}`, { to: 'debug' })
  }
}

// The panes this module opened that the host has not placed, by id, and the host's reason.
// A non-empty map means the status line carries a "waiting" message this module wrote.
const waiting = new Map<string, string>()
let waitReason = ''
let waitingText: string | undefined

/** Writes the status line for the current waiting set, or clears it once the set is empty. */
function showWaiting($: EngineInterface, specs: readonly PaneSpec[]): void {
  const titles = specs.filter(s => waiting.has(s.id)).map(s => s.title)
  const text =
    titles.length === 0
      ? undefined
      : `${titles.join(', ')} waiting (${waitReason}). Type /factory to open.`
  if (text === waitingText) return
  waitingText = text
  $.ui.status(text)
}

/**
 * Opens the given panes one at a time and says what the host answered. A pane opened unasked
 * (session start, session.attach) is only drawn once the terminal is wide enough or the person
 * opens it; the host keeps it open and places it then. A refusal is shown in the status line
 * and written to the debug log, not dropped, so a missing sidebar says why. `all` is every
 * pane of the mod, so the message names every pane still waiting, not only those opened now.
 * Never throws.
 */
export async function openPanes(
  $: EngineInterface,
  all: readonly PaneSpec[],
  toOpen: readonly PaneSpec[] = all,
): Promise<void> {
  for (const spec of toOpen) {
    try {
      const opened = await $.ui.open(spec)
      if (opened.isPlaced) waiting.delete(spec.id)
      else {
        waiting.set(spec.id, spec.title)
        waitReason = opened.reason
      }
    } catch (error) {
      waiting.set(spec.id, spec.title)
      waitReason = errorText(error)
    }
  }
  if (waiting.size > 0) {
    $.ui.log(`factory-panel: ${all.filter(s => waiting.has(s.id)).map(s => s.title).join(', ')} waiting: ${waitReason}`, {
      to: 'debug',
    })
  }
  showWaiting($, all)
}

/**
 * Reads which panes the host now lists. A pane that is placed, or that the person closed,
 * leaves the waiting set; the status line is rewritten to the panes still waiting and cleared
 * when none remain (a widened terminal places them).
 */
export async function settlePanes($: EngineInterface, specs: readonly PaneSpec[]): Promise<void> {
  if (waiting.size === 0) return
  const panes = await $.ui.panes()
  for (const id of [...waiting.keys()]) {
    if (!panes.some(p => p.id === id && !p.isPlaced)) waiting.delete(id)
  }
  showWaiting($, specs)
}

/** The specs an attach should open: those still open but unplaced, and any never opened. */
export async function paneIdsToReopen($: EngineInterface): Promise<ReadonlySet<string>> {
  return new Set((await $.ui.panes()).filter(p => !p.isPlaced).map(p => p.id))
}

// ---------------------------------------------------------------- limits

/** Runs at most `places` of the calls given to it at once; the rest wait in turn (the pattern of `limited` in hooks/board.ts). */
export function limiter(places: number): <T>(run: () => Promise<T>) => Promise<T> {
  let busy = 0
  const waiting: (() => void)[] = []
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (busy < places) busy++
    else await new Promise<void>(resolve => waiting.push(resolve))
    try {
      return await run()
    } finally {
      const next = waiting.shift()
      if (next === undefined) busy--
      else next()
    }
  }
}
