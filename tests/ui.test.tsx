import { expect } from 'claude-code/testing'
import { test } from './loud'

import { ACCENT, DOING, READY, TRACK, bar, cellBar, loadColor, spark, stackBar, tempColor, usd } from '../hooks/ui/glyphs'
import { widgets } from '../hooks/ui/widgets'

// Colour maths for the palette test: WCAG contrast and HSL of a #rrggbb colour.
const channels = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(c => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio of two `#rrggbb` colours: (lighter + 0.05) / (darker + 0.05), 1 to 21. */
const contrastRatio = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** A `#rrggbb` colour as hue in degrees (0 to 360), saturation and lightness (0 to 1). */
const hslOf = (hex: string): { h: number; s: number; l: number } => {
  const [r, g, b] = channels(hex).map(c => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const raw = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (raw * 60 + 360) % 360, s, l }
}

test('glyph helpers draw bars, sparklines, colors and money', async () => {
  expect(bar(0.5, 6)).toBe('███░░░')
  expect(bar(null, 4)).toBe('░░░░')
  expect(bar(2, 4)).toBe('████')
  expect(spark([1, 2, 3])).toBe('▁▅█')
  expect(spark([5, 5])).toBe('▁▁')
  expect(spark([])).toBe('')
  expect(loadColor(26)).toBe('success')
  expect(loadColor(87)).toBe('warning')
  expect(loadColor(95)).toBe('error')
  expect(loadColor(null)).toBe('inactive')
  expect(tempColor(79)).toBe('success')
  expect(tempColor(91)).toBe('error')
  expect(usd(8.511)).toBe('$8.51')
  expect(usd(107.2)).toBe('$107')
  expect(usd(1234)).toBe('$1.2k')
  expect(usd(999.6)).toBe('$1.0k')
  expect(usd(99.995)).toBe('$100')
  expect(bar(NaN, 4)).toBe('░░░░')
  expect(bar(0.55, 6)).toBe('███▎░░')
  expect(bar(0.02, 6)).toBe('▏░░░░░')
  expect(bar(0.001, 6)).toBe('░░░░░░')
})

test('a status chip is a bracketed name, the name in the state color, with no counts, and marks the open one', async () => {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const { statusChip, chipRow } = widgets({ Box: el('Box'), Text: el('Text'), Button: el('Button') } as never)
  type Node = { type: string; props: { children?: unknown; [k: string]: unknown } }
  const kids = (n: Node) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(Boolean) as Node[]
  let pressed = 0
  const closed = statusChip('relay', 'ix-relay', 'x', 'warning', false, () => pressed++) as unknown as Node
  const [button, hidden, ...rest] = kids(closed)
  // The drawn button has no hotkey, so no `x:` prefix; a hidden twin keeps the key.
  expect(button.props).toMatchObject({ label: 'ix-relay', plain: true })
  expect(button.props.hotkey).toBeUndefined()
  const [open_, name, close_] = kids(button)
  expect(kids(button).map(t => [t.props.children].flat().join(''))).toEqual(['[', 'ix-relay', ']'])
  expect(name.props).toMatchObject({ color: 'warning' })
  for (const bracket of [open_, close_]) expect(bracket.props).toMatchObject({ dimColor: true })
  expect(hidden.props.display).toBe('none')
  expect(kids(hidden)[0].props).toMatchObject({ hotkey: 'x' })
  expect(rest).toHaveLength(0)
  ;(button.props.onPress as () => void)()
  ;(kids(hidden)[0].props.onPress as () => void)()
  expect(pressed).toBe(2)
  const open = statusChip('relay', 'ix-relay', 'x', 'success', true, () => {}) as unknown as Node
  expect([kids(open)[2].props.children].flat()).toEqual(['▾'])
  expect(chipRow([closed as never, open as never]).props.flexDirection).toBe('row')
})

test('a progress row is a name, a segment bar and a right-aligned count, with no percentage', async () => {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const { progressRow } = widgets({ Box: el('Box'), Text: el('Text'), Button: el('Button') } as never)
  const text = JSON.stringify(progressRow('r', 'Payments ledger', 34, 4, 0, 39, 20, 10))
  expect(text).toContain('Payments ledger')
  expect(text).toContain('"children":["34","/","39"]')
  expect(text).not.toContain('%')
  expect(text).toContain(DOING)
})

test('the whole-cell bar rounds to whole cells', async () => {
  expect(cellBar(0.5, 6)).toBe('███░░░')
  expect(cellBar(0.26, 6)).toBe('██░░░░')
  expect(cellBar(null, 4)).toBe('░░░░')
  expect(cellBar(NaN, 4)).toBe('░░░░')
  expect(cellBar(2, 4)).toBe('████')
  expect(cellBar(0.999, 4)).toBe('████')
})


const runs = (...a: Parameters<typeof stackBar>) => stackBar(...a).map(r => [r.fg, r.text])

test('a stacked bar is whole █ cells shared out by largest remainder, one colour per run', async () => {
  // Categories: 0 done, 1 in progress, 2 ready, 3 the remainder (track). A run is [category, text].
  expect(runs(16, 0, 0, 128, 16)).toEqual([[0, '██'], [3, '█'.repeat(14)]])
  expect(runs(0, 0, 0, 128, 4)).toEqual([[3, '████']])
  expect(runs(128, 0, 0, 128, 4)).toEqual([[0, '████']])
  // 2.5 cells of in progress round to 3 by largest remainder (the tie goes to the earlier section).
  expect(runs(16, 20, 0, 128, 16)).toEqual([[0, '██'], [1, '███'], [3, '█'.repeat(11)]])
  expect(runs(16, 20, 8, 128, 16)).toEqual([[0, '██'], [1, '███'], [2, '█'], [3, '█'.repeat(10)]])
  // 999 of 1000 never fills the bar: done takes at most cells - 1.
  expect(runs(999, 0, 0, 1000, 16)).toEqual([[0, '█'.repeat(15)], [3, '█']])
  // with one in progress the section takes a cell from done; nothing is left for the track.
  expect(runs(999, 1, 0, 1000, 16)).toEqual([[0, '█'.repeat(15)], [1, '█']])
  expect(runs(990, 0, 9, 1000, 16)).toEqual([[0, '█'.repeat(14)], [2, '█'], [3, '█']])
  // zero total and NaN give an all-track bar.
  expect(runs(3, 2, 1, 0, 4)).toEqual([[3, '████']])
  expect(runs(NaN, NaN, NaN, NaN, 4)).toEqual([[3, '████']])
  // a tiny non-zero section still gets one whole cell, taken from the largest.
  expect(runs(0, 1, 0, 1000, 10)).toEqual([[1, '█'], [3, '█'.repeat(9)]])
  // with no room (three sections in two cells) the later small sections get no cell.
  expect(runs(1, 1, 1, 16, 2)).toEqual([[0, '█'], [3, '█']])
  // no run carries a background colour or a partial block.
  expect(stackBar(55, 10, 5, 100, 12).every(r => /^█+$/.test(r.text) && !('bg' in r))).toBe(true)
})

test('stacked bar cells add up to the width, with every present section visible, for every mix', async () => {
  const bad: number[][] = []
  for (let d = 0; d <= 80; d++) {
    for (let i = 0; d + i <= 80; i++) {
      for (let r = 0; d + i + r <= 80; r++) {
        const out = stackBar(d, i, r, 80, 10)
        const n = [0, 0, 0, 0]
        out.forEach(run => (n[run.fg]! += run.text.length))
        const merged = out.every((run, k) => k === 0 || out[k - 1]!.fg !== run.fg)
        const rest = 80 - d - i - r
        const ok =
          n.reduce((a, b) => a + b, 0) === 10 &&
          merged &&
          out.every(run => /^█+$/.test(run.text)) &&
          (d === 0 || n[0]! >= 1) &&
          (i === 0 || n[1]! >= 1) &&
          (r === 0 || n[2]! >= 1) &&
          (rest === 0 || n[3]! >= 1) &&
          (d === 80 || n[0]! <= 9)
        if (!ok) bad.push([d, i, r])
      }
    }
  }
  expect(bad.slice(0, 5)).toEqual([])
})

test('the bar colours read on a dark terminal and the track sits below them', async () => {
  const bg = '#1e1e1e'
  const sections = [ACCENT, DOING, READY]
  for (const c of sections) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3)
  expect(contrastRatio(TRACK, bg)).toBeGreaterThanOrEqual(1.1)
  for (const c of sections) expect(contrastRatio(TRACK, c)).toBeGreaterThanOrEqual(2.9)
  // Adjacent pairs in bar order, at the owner's palette: the achieved ratios are done/in progress 1.84,
  // in progress/ready 1.57, ready/track 3.56, done/ready 1.17 and done/track 3.04; the floors are those less a margin.
  expect(contrastRatio(ACCENT, DOING)).toBeGreaterThanOrEqual(1.7)
  expect(contrastRatio(DOING, READY)).toBeGreaterThanOrEqual(1.45)
  expect(contrastRatio(READY, TRACK)).toBeGreaterThanOrEqual(3.3)
  expect(contrastRatio(ACCENT, READY)).toBeGreaterThanOrEqual(1.1)
  expect(contrastRatio(ACCENT, TRACK)).toBeGreaterThanOrEqual(2.9)
  expect(new Set([ACCENT, DOING, READY, TRACK]).size).toBe(4)
  expect(hslOf(ACCENT).h).toBeGreaterThan(200)
})
