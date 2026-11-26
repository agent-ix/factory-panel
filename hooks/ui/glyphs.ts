// Text-glyph drawing that works on every surface: the terminal has no Svg, and block
// characters render the same in a terminal pane, the desktop app and a test.

/** The blue accent: done work, bars, big numbers and heading accents. Any string a Text or Box takes. */
export const ACCENT = '#3b82c4'
/** A muted amber for in-progress work, apart from the accent and not a state colour. */
export const DOING = '#e0a34a'
/** A blue-grey for ready work. */
export const READY = '#7e8aa3'
/** The track: the remainder of a bar, a dark blue-grey below every section that still reads as a rail. */
export const TRACK = '#2d3543'

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

/** A sparkline of counts per day from 0: one block a day, and `·` for a day with no count. */
export const daySpark = (counts: readonly (number | null)[]): string => {
  const most = Math.max(0, ...counts.flatMap(v => v ?? []))
  return counts.map(v => (v === null ? '·' : BLOCKS[most === 0 ? 0 : Math.round((v / most) * (BLOCKS.length - 1))])).join('')
}

/** A share (0..1) as one circle filled by quarters. */
export const gauge = (share: number): string => ['○', '◔', '◑', '◕', '●'][Math.max(0, Math.min(4, Math.floor(share * 4)))]!

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

/** A run of consecutive whole cells in one section's colour. */
export type BarRun = { fg: BarCategory; text: string }

/**
 * A stacked progress bar of `cells` whole cells, one cell standing for total / cells items. The
 * cells are shared out among done, in progress, ready and the remainder by the largest-remainder
 * method (ties go to the earlier section), so the counts add up to `cells` exactly. A non-zero
 * section gets at least one cell when there is room (taken from the largest section). While work
 * remains (done under total) done takes at most `cells - 1` cells, and the remainder keeps a cell
 * when any item is neither done, in progress nor ready, so the bar never reads full. Every cell
 * is `█` in its section's colour: no fractions of a cell and no background colour. Adjacent cells
 * of one section are merged into a run. NaN and a zero total give an all-remainder bar.
 */
export const stackBar = (done: number, inProgress: number, ready: number, total: number, cells: number): BarRun[] => {
  if (cells <= 0) return []
  const ok = Number.isFinite(total) && total > 0
  const fin = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)
  const d = ok ? Math.min(fin(done), total) : 0
  const i = ok ? Math.min(fin(inProgress), total - d) : 0
  const r = ok ? Math.min(fin(ready), total - d - i) : 0
  const items = [d, i, r, ok ? total - d - i - r : 0]
  const n = [0, 0, 0, ok ? 0 : cells]
  if (ok) {
    const quota = items.map(c => (c * cells) / total)
    quota.forEach((q, k) => (n[k] = Math.floor(q)))
    let left = cells - n.reduce((a, b) => a + b, 0)
    const frac = quota.map(q => q - Math.floor(q))
    const order = [0, 1, 2, 3].sort((a, b) => frac[b]! - frac[a]! || a - b)
    for (let k = 0; left > 0; k = (k + 1) % 4, left--) n[order[k]!]!++
    const take = (): number => {
      const biggest = n.indexOf(Math.max(...n))
      return n[biggest]! > 1 ? biggest : -1
    }
    for (let k = 0; k < 4; k++) {
      if (items[k]! > 0 && n[k] === 0) {
        const from = take()
        if (from >= 0) {
          n[from]!--
          n[k] = 1
        }
      }
    }
    if (d < total && n[0]! > cells - 1) {
      n[0] = cells - 1
      const next = [1, 2, 3].find(k => items[k]! > 0) ?? 3
      n[next]!++
    }
  }
  const runs: BarRun[] = []
  n.forEach((count, k) => {
    if (count > 0) runs.push({ fg: k as BarCategory, text: '█'.repeat(count) })
  })
  return runs
}

/** A whole-cell bar of `cells` cells filled to `share` (0..1), rounded to whole cells: ███░░░. The Factory gauges use it. */
export const cellBar = (share: number | null, cells: number): string => {
  const filled = share === null || Number.isNaN(share) ? 0 : Math.round(Math.max(0, Math.min(1, share)) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}
