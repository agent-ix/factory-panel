// Text-glyph drawing that works on every surface: the terminal has no Svg, and block
// characters render the same in a terminal pane, the desktop app and a test.

/** The saturated light blue accent: done work, bars, big numbers and heading accents. Any string a Text or Box takes. */
export const ACCENT = '#4db8ff'
/** A vivid teal-green for in-progress work: apart from the accent, and not a state colour. */
export const DOING = '#00d4a0'
/** A vivid violet for ready work: cool like the other two, and apart from both on a dark background. */
export const READY = '#b06bff'
/** The track: the remainder of a bar, a dim grey-blue that still reads as a rail on a dark background. */
export const TRACK = '#3f4b5e'

const BLOCKS = '▁▂▃▄▅▆▇█'
const EIGHTHS = '▏▎▍▌▋▊▉'

/** A sparkline: one block per value, scaled between the series' own min and max. */
export const spark = (values: readonly number[]): string => {
  const points = values.filter(v => Number.isFinite(v))
  if (points.length === 0) return ''
  const min = Math.min(...points)
  const span = Math.max(...points) - min
  return points.map(v => BLOCKS[span === 0 ? 0 : Math.round(((v - min) / span) * (BLOCKS.length - 1))]).join('')
}


/** `share` (0..1) of `cells` cells, in eighths: full blocks plus one partial cell. */
const fill = (share: number | null, cells: number): { full: number; partial: string } => {
  const s = share === null || Number.isNaN(share) ? 0 : Math.max(0, Math.min(1, share))
  // Short of the whole, always leave one step of track so a bar never reads as complete.
  const steps = Math.min(Math.round(s * cells * 8), s < 1 ? cells * 8 - 1 : cells * 8)
  const full = Math.floor(steps / 8)
  return { full, partial: steps % 8 === 0 ? '' : (EIGHTHS[(steps % 8) - 1] ?? '') }
}

/** A bar of `cells` cells filled to `share` (0..1) in eighth-block steps: ███▎░░. */
export const bar = (share: number | null, cells: number): string => {
  const { full, partial } = fill(share, cells)
  return '█'.repeat(full) + partial + '░'.repeat(cells - full - partial.length)
}


const LEFT = [0, 0x40, 0x44, 0x46, 0x47]
const RIGHT = [0, 0x80, 0xa0, 0xb0, 0xb8]

/**
 * A braille dot histogram: two samples per character, four dot levels per row, filled from
 * the bottom. Values scale between the series' own minimum and maximum, the lowest still
 * drawing one dot; a constant series draws half height. Non-finite values are skipped.
 * Returns one string per row, top row first. Needs a terminal font with braille.
 */
export const dots = (values: readonly number[], rows = 1): string[] => {
  const points = values.filter(v => Number.isFinite(v))
  const levels = 4 * rows
  const min = Math.min(...points)
  const span = Math.max(...points) - min
  const heights = points.map(v => (span === 0 ? levels / 2 : 1 + Math.round(((v - min) / span) * (levels - 1))))
  return Array.from({ length: rows }, (_, r) => {
    const below = 4 * (rows - 1 - r)
    let line = ''
    for (let i = 0; i < heights.length; i += 2) {
      const lit = (h: number | undefined) => Math.max(0, Math.min(4, (h ?? 0) - below))
      line += String.fromCharCode(0x2800 + (LEFT[lit(heights[i])] ?? 0) + (RIGHT[lit(heights[i + 1])] ?? 0))
    }
    return line
  })
}
/** The semantic color a load percentage wears. */
export const loadColor = (pct: number | null): 'success' | 'warning' | 'error' | 'inactive' =>
  pct === null ? 'inactive' : pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'success'

/** The semantic color a temperature in Celsius wears. */
export const tempColor = (c: number | null): 'success' | 'warning' | 'error' | 'inactive' =>
  c === null ? 'inactive' : c >= 90 ? 'error' : c >= 80 ? 'warning' : 'success'

/** Money as people write it: $8.51, $107, $1.2k. */
export const usd = (n: number): string => {
  // Round first so a value that rounds up into the next band is written in that band.
  const r = n >= 100 ? Math.round(n) : Math.round(n * 100) / 100
  return r >= 1000 ? `$${(r / 1000).toFixed(1)}k` : r >= 100 ? `$${r}` : `$${r.toFixed(2)}`
}


/** The category of a section of a bar: done, in progress, ready, or the remainder (the track). */
export type BarCategory = 0 | 1 | 2 | 3

/** A run of consecutive cells drawn alike: `fg` is the section on the left, `bg` the section on the right of a boundary cell. */
export type BarRun = { fg: BarCategory; bg: BarCategory | null; text: string }

/**
 * A stacked progress bar of `cells` cells, each eight units (eighths of a cell), the whole bar
 * standing for `total` items. Sections stack from the left: done, in progress, ready, then the
 * remainder. Whole cells are `█` in the section's colour. A cell where a section ends is a
 * left-aligned eighth block (`▏▎▍▌▋▊▉`) whose foreground is the section on the left and whose
 * background is the section on the right, so one cell shows both colours with 1/8 precision.
 * When a cell holds three sections the left one is the foreground and the background is the track
 * if the cell holds any, else the later section covering more of the rest (the first on a tie), so the cell then
 * shows the two sections' colours only. Boundaries sit at round(cumulative * units / total) so
 * the units add up; a non-zero section gets at least one unit (taken from the largest section);
 * counts are clamped so they never pass total; and while work remains (done under total) the
 * bar is never completely full. NaN and a zero total give an all-remainder bar. Runs of equal
 * `fg` and `bg` are merged, for the caller to colour.
 */
export const stackBar = (
  done: number,
  inProgress: number,
  ready: number,
  total: number,
  cells: number,
): BarRun[] => {
  const ok = Number.isFinite(total) && total > 0
  const fin = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)
  const d = ok ? Math.min(fin(done), total) : 0
  const i = ok ? Math.min(fin(inProgress), total - d) : 0
  const r = ok ? Math.min(fin(ready), total - d - i) : 0
  const U = cells * 8
  const edge = (cumulative: number) => (ok ? Math.round((cumulative * U) / total) : 0)
  const u = [edge(d), edge(d + i) - edge(d), edge(d + i + r) - edge(d + i)]
  const counts = [d, i, r]
  const rest = () => U - u[0]! - u[1]! - u[2]!
  const take = () => {
    const v = [u[0]!, u[1]!, u[2]!, rest()]
    const from = v.indexOf(Math.max(...v))
    return v[from]! > 1 ? from : -1
  }
  for (let k = 0; k < 3; k++) {
    if (counts[k]! > 0 && u[k] === 0) {
      const from = take()
      if (from >= 0 && from < 3) u[from]!--
      if (from >= 0) u[k] = 1
    }
  }
  if (ok && d < total && rest() <= 0) {
    const from = take()
    if (from >= 0 && from < 3) u[from]!--
  }
  const edges = [u[0]!, u[0]! + u[1]!, u[0]! + u[1]! + u[2]!]
  const category = (unit: number): BarCategory => (unit < edges[0]! ? 0 : unit < edges[1]! ? 1 : unit < edges[2]! ? 2 : 3)
  const runs: BarRun[] = []
  for (let c = 0; c < cells; c++) {
    const per = [0, 0, 0, 0]
    for (let s = c * 8; s < c * 8 + 8; s++) per[category(s)]!++
    const fg = category(c * 8)
    let bg: BarCategory | null = null
    let glyph = '█'
    if (per[fg] !== 8) {
      const left = per[fg]!
      const after = [0, 1, 2, 3].filter(k => k > fg && per[k]! > 0)
      // Any track unit in the cell makes the track the background, so a bar with work left never looks full.
      bg = (per[3]! > 0 ? 3 : after.reduce((best, k) => (per[k]! > per[best]! ? k : best), after[0]!)) as BarCategory
      glyph = EIGHTHS[left - 1] ?? '█'
    }
    const last = runs[runs.length - 1]
    if (last && last.fg === fg && last.bg === bg) last.text += glyph
    else runs.push({ fg, bg, text: glyph })
  }
  return runs
}

/** A whole-cell bar of `cells` cells filled to `share` (0..1), rounded to whole cells: ███░░░. The Factory gauges use it. */
export const cellBar = (share: number | null, cells: number): string => {
  const filled = share === null || Number.isNaN(share) ? 0 : Math.round(Math.max(0, Math.min(1, share)) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}
