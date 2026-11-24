import { expect, test } from 'claude-code/testing'

import { ACCENT, DOING, READY, TRACK, bar, cellBar, dots, loadColor, spark, stackBar, tempColor, usd } from '../hooks/ui/glyphs'
import { widgets } from '../hooks/ui/widgets'

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

test('a status chip is a mark and a named button, with no counts, and marks the open one', async () => {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const { statusChip, chipRow } = widgets({ Box: el('Box'), Text: el('Text'), Button: el('Button') } as never)
  type Node = { type: string; props: { children?: unknown; [k: string]: unknown } }
  const kids = (n: Node) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(Boolean) as Node[]
  let pressed = 0
  const closed = statusChip('relay', 'ix-relay', 'x', '▲', 'warning', false, () => pressed++) as unknown as Node
  const [mark, button, ...rest] = kids(closed)
  expect(mark.props).toMatchObject({ color: 'warning' })
  expect([mark.props.children].flat()).toEqual(['▲'])
  expect(button.props).toMatchObject({ label: 'ix-relay', hotkey: 'x' })
  expect(rest).toHaveLength(0)
  ;(button.props.onPress as () => void)()
  expect(pressed).toBe(1)
  const open = statusChip('relay', 'ix-relay', 'x', '●', 'success', true, () => {}) as unknown as Node
  expect([kids(open)[2].props.children].flat()).toEqual(['▾'])
  expect(chipRow([closed as never, open as never]).props.flexDirection).toBe('row')
})

test('braille dots draw two samples per character, filled from the bottom', async () => {
  expect(dots([1, 2, 3, 4])).toEqual(['⣠⣾'])
  expect(dots([])).toEqual([''])
  expect(dots([], 2)).toEqual(['', ''])
  expect(dots([5])).toEqual(['⡄'])
  expect(dots([5, 5])).toEqual(['⣤'])
  expect(dots([1, NaN, 4])).toEqual(['⣸'])
  // two rows: the low sample fills only the bottom row, the high one both
  expect(dots([0, 8], 2)).toEqual(['⢸', '⣸'])
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


const runs = (...a: Parameters<typeof stackBar>) => stackBar(...a).map(r => [r.fg, r.bg, r.text])

test('a stacked bar draws whole █ cells per section and eighth blocks with two colours at each boundary', async () => {
  // Categories: 0 done, 1 in progress, 2 ready, 3 the remainder (track). A run is [fg, bg, text].
  expect(runs(16, 0, 0, 128, 16)).toEqual([[0, null, '██'], [3, null, '█'.repeat(14)]])
  expect(runs(0, 0, 0, 128, 4)).toEqual([[3, null, '████']])
  expect(runs(128, 0, 0, 128, 4)).toEqual([[0, null, '████']])
  // 3/8 of a cell done, then in progress: ▍ with the done colour left and the in-progress colour right.
  expect(runs(3, 5, 0, 16, 2)).toEqual([[0, 1, '▍'], [3, null, '█']])
  // in progress runs on in whole cells, ends in a partial cell whose background is the track.
  expect(runs(16, 20, 0, 128, 16)).toEqual([[0, null, '██'], [1, null, '██'], [1, 3, '▌'], [3, null, '█'.repeat(11)]])
  // ready follows in progress; each boundary cell shows its two neighbours.
  expect(runs(16, 20, 8, 128, 16)).toEqual([[0, null, '██'], [1, null, '██'], [1, 2, '▌'], [2, 3, '▌'], [3, null, '█'.repeat(10)]])
  // three sections in one cell: the left one is the foreground, the background is the track when the cell holds any.
  expect(runs(1, 1, 1, 16, 2)).toEqual([[0, 3, '▏'], [3, null, '█']])
  // 999 of 1000 never fills the bar; with one in progress the cell holds done, in progress and the track.
  expect(runs(999, 0, 0, 1000, 16)).toEqual([[0, null, '█'.repeat(15)], [0, 3, '▉']])
  expect(runs(999, 1, 0, 1000, 16)).toEqual([[0, null, '█'.repeat(15)], [0, 3, '▊']])
  // a cell of 6 done, 1 ready and 1 track shows the track as its background, never the ready colour.
  expect(runs(990, 0, 9, 1000, 16)).toEqual([[0, null, '█'.repeat(15)], [0, 3, '▊']])
  // zero total and NaN give an all-track bar.
  expect(runs(3, 2, 1, 0, 4)).toEqual([[3, null, '████']])
  expect(runs(NaN, NaN, NaN, NaN, 4)).toEqual([[3, null, '████']])
  // a non-zero section with a tiny share still gets one eighth, taken from the largest.
  expect(runs(0, 1, 0, 1000, 10)).toEqual([[1, 3, '▏'], [3, null, '█'.repeat(9)]])
})

test('stacked bar sections land on the rounded eighths for every done, in-progress and ready', async () => {
  const bad: number[][] = []
  const cellsOf = (n: number) => Math.ceil(n / 8)
  for (let d = 0; d <= 80; d++) {
    for (let i = 0; d + i <= 80; i++) {
      for (let r = 0; d + i + r <= 80; r++) {
        const sum = d + i + r
        const out = stackBar(d, i, r, 80, 10)
        const cells = out.flatMap(run => [...run.text].map(() => run))
        const count = (fg: number) => cells.filter(c => c.fg === fg).length
        // Work remaining never reads full, which moves the last unit; check the exact case apart from it.
        const capped = d < 80 && sum === 80
        const ok =
          cells.length === 10 &&
          (capped
            ? true // the cap takes a unit back; a cell holding three sections shows only two colours, so only the cell count is checked
            : count(0) === cellsOf(d) &&
              count(1) === cellsOf(d + i) - cellsOf(d) &&
              count(2) === cellsOf(sum) - cellsOf(d + i) &&
              count(3) === 10 - cellsOf(sum))
        if (!ok) bad.push([d, i, r])
      }
    }
  }
  expect(bad.slice(0, 5)).toEqual([])
})

test('the bar colour tokens are distinct', async () => {
  expect(new Set([ACCENT, DOING, READY, TRACK]).size).toBe(4)
})
