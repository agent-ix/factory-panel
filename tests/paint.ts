
type N = { type?: unknown; props?: Record<string, unknown>; children?: unknown[]; text?: string; key?: unknown }
/** The element tree laid out in character cells: rows join with their gap, boxes with a width are padded to it. */
export const paint = (n: unknown): string[] => {
  if (typeof n === 'string') return [n]
  const e = n as N
  const p = e.props ?? {}
  const kids = (e.children ?? []).map(paint).filter(l => l.length > 0)
  if (e.type === 'Text') return [(e.children ?? []).map(c => (typeof c === 'string' ? c : paint(c).join(''))).join('')]
  if (e.type === 'Button') return [String(p.label ?? '')]
  let lines: string[]
  if (p.flexDirection === 'column') lines = kids.flat()
  else lines = kids.length === 0 ? [] : [kids.map(k => k.join(' ')).join(' '.repeat(Number(p.gap ?? 0)))]
  const pad = ' '.repeat(Number(p.paddingLeft ?? p.padding ?? 0))
  lines = lines.map(l => pad + l)
  const width = Number(p.width ?? 0)
  if (width > 0) lines = lines.map(l => (p.justifyContent === 'flex-end' ? l.padStart(width) : l.padEnd(width)))
  return lines
}
