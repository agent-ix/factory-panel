import type { EngineInterface } from 'claude-code'

// ---------------------------------------------------------------- options

export type Options = {
  prometheusUrl: string
  grafanaUrl: string
  teams: string[]
  refreshSeconds: number
}

export const readOptions = (options: Record<string, unknown>): Options => ({
  prometheusUrl: String(options.prometheusUrl ?? 'http://localhost:9090'),
  grafanaUrl: String(options.grafanaUrl ?? 'http://localhost:3000'),
  teams: String(options.teams ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean),
  refreshSeconds: Math.max(5, Number(options.refreshSeconds ?? 15) || 15),
})

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const ago = (at: number | null, now: number): string => {
  if (at === null) return 'never'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

// ---------------------------------------------------------------- Prometheus

export type Sample = { metric: Record<string, string>; value: [number, string] }
export type RangeSeries = { metric: Record<string, string>; values: [number, string][] }

async function promGet<T>($: EngineInterface, url: string, body: string): Promise<T> {
  const response = await $.http.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(`Prometheus ${response.status}`)
  const parsed = JSON.parse(response.text) as { status: string; data?: T; error?: string }
  if (parsed.status !== 'success' || parsed.data === undefined) {
    throw new Error(parsed.error ?? 'Prometheus query failed')
  }
  return parsed.data
}

export async function promQuery($: EngineInterface, base: string, query: string): Promise<Sample[]> {
  const data = await promGet<{ result?: Sample[] }>(
    $,
    `${base.replace(/\/$/, '')}/api/v1/query`,
    `query=${encodeURIComponent(query)}`,
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
): Promise<RangeSeries[]> {
  const end = Math.floor((await $.clock.now()) / 1000)
  const data = await promGet<{ result?: RangeSeries[] }>(
    $,
    `${base.replace(/\/$/, '')}/api/v1/query_range`,
    `query=${encodeURIComponent(query)}&start=${end - seconds}&end=${end}&step=${step}`,
  )
  return Array.isArray(data.result) ? data.result : []
}

// ---------------------------------------------------------------- commands

/** Runs a host command and parses its standard output as JSON, whatever its exit code. */
export async function runJson<T>($: EngineInterface, argv: string[], timeoutMs: number): Promise<T> {
  const ran = await $.process.run(argv, { timeoutMs })
  try {
    return JSON.parse(ran.stdout) as T
  } catch {
    const why = ran.stderr.trim().split('\n').pop()
    throw new Error(why || `${argv[0]} exited ${ran.exitCode}`)
  }
}

/** Runs a host command for its text; a non-zero exit throws with its last error line. */
export async function runText($: EngineInterface, argv: string[], timeoutMs: number): Promise<string> {
  const ran = await $.process.run(argv, { timeoutMs })
  if (ran.exitCode !== 0) {
    const why = ran.stderr.trim().split('\n').pop() || ran.stdout.trim().split('\n').pop()
    throw new Error(why || `${argv[0]} exited ${ran.exitCode}`)
  }
  return ran.stdout
}

// ---------------------------------------------------------------- drawing

// Status steps from the dataviz reference palette: they read on light and dark surfaces.
// Text never wears them; a mark beside the text carries the state.
export const INK = {
  calm: '#3b82c4',
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  track: 'rgba(128,128,128,0.22)',
  muted: 'rgba(128,128,128,0.38)',
}
export const CARD_BG = 'rgba(128,128,128,0.08)'
export const CARD_BG_OPEN = 'rgba(128,128,128,0.15)'

/** A horizontal progress bar: a track, and a rounded fill for done out of total. */
export const progressBar = (done: number, total: number, width: number, color = INK.calm): string => {
  const h = 6
  const share = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  const fill = share > 0 ? Math.max(h, share * width) : 0
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<rect x="0" y="0" width="${width}" height="${h}" rx="3" fill="${INK.track}"/>` +
    (fill > 0 ? `<rect x="0" y="0" width="${fill.toFixed(1)}" height="${h}" rx="3" fill="${color}"/>` : '') +
    `</svg>`
  )
}

/** A sparkline: a 2px line over a faint area, with a dot on the latest point. */
export const sparkline = (values: number[], color: string, width = 104, height = 26): string => {
  const points = values.filter(v => Number.isFinite(v))
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  if (points.length < 2) {
    const y = height - 3
    return `${open}<line x1="2" y1="${y}" x2="${width - 2}" y2="${y}" stroke="${INK.track}" stroke-width="2" stroke-linecap="round"/></svg>`
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = (width - 6) / (points.length - 1)
  const xy = points.map((v, i): [number, number] => [3 + i * step, 3 + (height - 6) * (1 - (v - min) / span)])
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const first = xy[0] ?? [3, height - 3]
  const last = xy[xy.length - 1] ?? first
  const area = `${line} L${last[0].toFixed(1)} ${height} L${first[0].toFixed(1)} ${height} Z`
  return (
    open +
    `<path d="${area}" fill="${color}" fill-opacity="0.12"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5" fill="${color}"/>` +
    `</svg>`
  )
}
