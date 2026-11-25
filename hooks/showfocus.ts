import type { FocusProject, FocusView } from '../types'
import { ago } from './shared'

// What `/factory show` prints of each focus: the notes of its card, its header, and every initiative and
// project with its numbers. The card itself draws no prose, so this is where the totals and the wording
// of FR-022 can be read in full.

const dash = (n: number | null): string => (n === null ? '-' : String(n))
const age = (at: number, now: number): string => ago(at, now).replace(/ ago$/, '')
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const projectLine = (p: FocusProject, now: number): string => {
  if (p.failed) return `${p.name}: failed, no counts`
  const old = p.old && p.at !== null ? ` · old ${age(p.at, now)}` : ''
  return `${p.name}: ${p.done}/${p.total} · remaining ${p.total - p.done} · ready ${dash(p.ready)} · blocked ${dash(p.blocked)}${old}`
}

/** The lines for the focuses given, in the order drawn. */
export function focusDetail(views: readonly FocusView[], now: number): string[] {
  const lines: string[] = []
  for (const f of views) {
    lines.push(`Focus ${f.title ?? f.address}:`)
    for (const n of f.notes) lines.push(`  ${n}`)
    const h = f.header
    if (h !== null) {
      const parts = [
        `${h.done}/${h.total} done`,
        `remaining ${h.remaining}`,
        `${h.inProgress} in progress`,
        `ready ${dash(h.ready)}`,
        `blocked ${dash(h.blocked)}`,
        `${h.counted} of ${h.enumerated} projects`,
      ]
      if (h.partial) parts.push('partial')
      if (h.oldestAt !== null) parts.push(`includes old data (oldest ${age(h.oldestAt, now)})`)
      if (h.notExpanded > 0) parts.push(`${plural(h.notExpanded, 'initiative', 'initiatives')} not expanded`)
      lines.push(`  total: ${parts.join(' · ')}`)
      if (h.stages.length > 0) lines.push(`  stages: ${h.stages.map(([s, c]) => `${s} ${c}`).join(' · ')}`)
    }
    for (const i of f.initiatives) {
      if (i.failed !== null) {
        lines.push(`  initiative ${i.name}: ${i.failed}`)
        continue
      }
      const parts = [`${i.counted} of ${i.enumerated} projects`, `${i.done}/${i.total} done`, `remaining ${i.remaining}`, `ready ${dash(i.ready)}`, `blocked ${dash(i.blocked)}`]
      if (i.partial) parts.push('partial')
      if (i.oldestAt !== null) parts.push(`includes old data (oldest ${age(i.oldestAt, now)})`)
      lines.push(`  initiative ${i.name}: ${parts.join(' · ')}`)
      for (const p of i.projects) lines.push(`    ${projectLine(p, now)}`)
    }
    if (f.loose.length > 0) {
      lines.push(f.initiatives.length > 0 ? '  not in a selected initiative:' : '  projects:')
      for (const p of f.loose) lines.push(`    ${projectLine(p, now)}`)
    }
  }
  return lines
}
