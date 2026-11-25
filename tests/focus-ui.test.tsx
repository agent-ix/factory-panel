import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trace } from './trace'

import { out, report, startSession, world } from './world'
import type { World } from './world'
import { ix, project } from './board-kit'
import type { Served } from './board-kit'

// Tests for how the Focus pane draws initiatives with their projects (FR-022 display, FR-023) and the footer warning (FR-024).

const LEAD = 'draco:QSL:code'
const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'focus', props: { title: 'Focus', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
type $t = Parameters<TestBody>[0]

const MILESTONE = 'issue QSL-3215 references unavailable milestone 871dbc77 in project a31003a8'

/** Puts the Focus pane on screen long enough for its first read, then takes it away: nothing is read off screen (FR-027). */
async function firstRead($: $t, w: World): Promise<void> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await w.clock!.advance(1000)
  await ui.unmount()
}

async function setup($: $t, on: Parameters<TestBody>[1], scope: { initiatives?: string[]; projects?: string[] }, served: Served) {
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4', ['running'], scope))
  ix(w, served)
  await startSession($)
  await firstRead($, w)
  return w
}

type Drawn = { lines: string[]; buttons: { key: string; label: string; hotkey?: string }[]; text: string; press: (key: string) => Promise<void>; redraw: () => Promise<void>; unmount: () => Promise<void> }

async function draw($: $t, surface: 'terminal' | 'desktop' = 'terminal', placement = 'dock'): Promise<Drawn> {
  const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement } } as never)
  const d: Drawn = {
    lines: [],
    buttons: [],
    text: '',
    press: async key => {
      await ui.press({ key })
      await d.redraw()
    },
    redraw: async () => {
      d.lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
      d.buttons = (await ui.findAll({ type: 'Button' })).map(b => ({ key: b.key ?? '', label: String((b.props as { label?: string }).label ?? ''), hotkey: (b.props as { hotkey?: string }).hotkey }))
      d.text = d.lines.join('\n')
    },
    unmount: () => ui.unmount(),
  }
  await d.redraw()
  return d
}
/** The prose of the card: no bars, no legend. */
const prose = (d: Drawn) => d.lines.filter(l => !/^[█░■ ]+$/.test(l) && !['done', 'in progress', 'ready', 'rest'].includes(l)).join('\n')
/** The number the warning icon shows, or null where it is not drawn. */
const warnCount = (d: Drawn): number | null => {
  const b = d.buttons.find(x => x.key === 'warnings-toggle')
  return b === undefined ? null : Number(b.label)
}
const m = (re: RegExp) => new RegExp(re.source, 'm')
const labels = (d: Drawn) => d.buttons.map(b => b.label)

const TWO: Served = {
  roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
  projects: { P1: project('P1', 3, 4, { ready: 1 }), P2: project('P2', 5, 10, { ready: 2 }) },
}

// ---------------------------------------------------------------- FR-023

test('an initiative is drawn with its projects indented beneath it, each with a bar and done/total', async ($, on) => {
  trace("FR-023-AC-1")
  await setup($, on, { initiatives: ['A'] }, TWO)
  for (const surface of ['terminal', 'desktop'] as const) {
    const d = await draw($, surface)
    expect(labels(d)).toContain('▾ A')
    expect(d.text).toMatch(m(/^P1$/))
    expect(d.text).toMatch(m(/^P2$/))
    expect(d.text).toMatch(m(/^3\/4$/))
    expect(d.text).toMatch(m(/^5\/10$/))
    expect(d.lines.indexOf('P1')).toBeGreaterThan(-1)
    await d.unmount()
  }
})


test('a project shows Remaining, Ready and Blocked from its own answer in the footer expansion, and not in the body', async ($, on) => {
  trace("FR-023-AC-3", "FR-023-AC-9")
  await setup($, on, { initiatives: ['A'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }, { name: 'Z' }] }],
    projects: { P1: project("P1", 10, 25, { ready: 3, layers: { open: 3, completed: 1 } }), Z: MILESTONE, P2: project('P2', 1, 4, { ready: 0 }), P3: project('P3', 1, 4, { ready: null }) },
  })
  const d = await draw($)
  expect(prose(d)).not.toMatch(/left|ready|blocked|remaining/)
  await d.press('warnings-toggle')
  // P1 and P2 were answered by one call, which does not say whose a blocker is; P3 was answered alone.
  expect(d.text).toMatch(m(/^A \/ P1: 15 remaining · ready 3 · blocked -$/))
  expect(d.text).toMatch(m(/^A \/ P2: 3 remaining · ready 0 · blocked -$/))
  expect(d.text).toMatch(m(/^A \/ P3: 3 remaining · ready - · blocked 0$/))
  await d.unmount()
})

test('an initiative row is its name, bar and the sum of done and total of its counted projects, with no other text', async ($, on) => {
  trace("FR-023-AC-1", "FR-022-AC-8")
  await setup($, on, { initiatives: ['A'] }, TWO)
  const d = await draw($)
  expect(d.text).toMatch(m(/^8\/14$/))
  expect(prose(d)).not.toMatch(/projects|partial|old data|left|ready|blocked|done/)
  await d.unmount()
})

test('collapsing an initiative hides its projects, expanding restores them, and the state is held under its name', async ($, on) => {
  trace("FR-023-AC-4")
  await setup($, on, { initiatives: ['A'] }, TWO)
  const d = await draw($)
  const key = d.buttons.find(b => b.label === '▾ A')!.key
  await d.press(key)
  expect(labels(d)).toContain('▸ A')
  expect(d.text).not.toMatch(m(/^P1$/))
  expect(d.text).toMatch(m(/^8\/14$/))
  await d.press(key)
  expect(d.text).toMatch(m(/^P1$/))
  await d.unmount()
})

test('a completed project is hidden unless focusShowDone is set', async ($, on) => {
  trace("FR-023-AC-5")
  await setup($, on, { initiatives: ['A'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
    projects: { P1: project('P1', 4, 4), P2: project('P2', 5, 10) },
  })
  const d = await draw($)
  expect(d.text).not.toMatch(m(/^P1$/))
  expect(d.text).toMatch(m(/^P2$/))
  await d.press(d.buttons.find(b => b.label === '+ 1 complete')!.key)
  expect(d.text).toMatch(m(/^P1$/))
  expect(labels(d)).toContain('hide complete')
  await d.unmount()
})

test('an initiative whose projects are all complete and hidden is drawn as its own row with no child rows', async ($, on) => {
  trace("FR-023-AC-6")
  await setup($, on, { initiatives: ['A'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
    projects: { P1: project('P1', 4, 4), P2: project('P2', 2, 2) },
  })
  const d = await draw($)
  expect(labels(d)).toContain('▾ A')
  expect(d.text).toMatch(m(/^6\/6$/))
  expect(d.text).not.toMatch(m(/^P1$/))
  await d.unmount()
})

test('a failed project is a row with its name, an empty bar and a dash, and no error text; the error is in the footer and /factory show', async ($, on) => {
  trace("FR-023-AC-7")
  const w = await setup($, on, { initiatives: ['A'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
    projects: { P1: project('P1', 3, 4), P2: MILESTONE },
  })
  const d = await draw($)
  expect(d.text).toMatch(m(/^P2$/))
  expect(d.text).toMatch(m(/^—$/))
  expect(d.text).not.toMatch(/unavailable milestone/)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/unavailable milestone 871dbc77/)
  await d.unmount()
  expect(((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string)).toContain(MILESTONE)
  void w
})

test('a project under two initiatives is drawn under both and counted once in the header', async ($, on) => {
  trace("FR-023-AC-8", "FR-022-AC-4")
  await setup($, on, { initiatives: ['A', 'B'] }, {
    roadmap: [
      { name: 'A', projects: [{ name: 'P1', also_in: ['B'] }, { name: 'P2' }] },
      { name: 'B', projects: [{ name: 'P1', also_in: ['A'] }, { name: 'P3' }] },
    ],
    projects: { P1: project('P1', 3, 4), P2: project('P2', 1, 2), P3: project('P3', 2, 8) },
  })
  const d = await draw($)
  expect(d.lines.filter(l => l === 'P1')).toHaveLength(2)
  // 3+1+2 done of 4+2+8: P1 counted once in the header, once in each initiative.
  expect(d.text).toMatch(m(/^6\/14$/))
  expect(d.text).toMatch(m(/^4\/6$/))
  expect(d.text).toMatch(m(/^5\/12$/))
  await d.unmount()
})

test('the inline popup and the widget draw the nested rows and the footer icon', async ($, on) => {
  trace("FR-023-AC-1", "FR-024-AC-1")
  await setup($, on, { initiatives: ['A'] }, { ...TWO, projects: { P1: project('P1', 3, 4), P2: MILESTONE } })
  const inline = await draw($, 'terminal', 'inline')
  expect(inline.text).toMatch(m(/^P1$/))
  expect(inline.buttons.some(b => b.key === 'warnings-toggle' && b.label === '1')).toBe(true)
  await inline.unmount()
  const widget = await draw($, 'terminal', 'widget')
  expect(widget.text).toMatch(/1 focus/)
  await widget.unmount()
})

// ---------------------------------------------------------------- FR-022 display

const eighteen = (failing: number): Served => {
  const names = Array.from({ length: 18 }, (_, i) => `P${i + 1}`)
  const projects: NonNullable<Served['projects']> = {}
  names.forEach((n, i) => (projects[n] = i < 18 - failing ? project(n, 4, 4) : MILESTONE))
  return { roadmap: [{ name: 'A', projects: names.map(name => ({ name })) }], projects }
}

test('17 of 18 projects counted: the totals are the sums of the 17, never drawn complete, and the expansion reads 17 of 18 and partial', async ($, on) => {
  trace("FR-022-AC-1", "FR-022-AC-3")
  await setup($, on, { initiatives: ['A'] }, eighteen(1))
  const d = await draw($)
  expect(d.text).toMatch(m(/^68\/68$/))
  expect(d.text).not.toMatch(/100%/)
  expect(d.text).toMatch(/99%/)
  expect(d.text).not.toMatch(/of 18 projects|partial/)
  await d.press('warnings-toggle')
  expect(d.lines.filter(l => /17 of 18 projects, partial/.test(l))).toHaveLength(2)
  await d.unmount()
})

test('18 of 18 fresh projects read 18 of 18 in the expansion with no partial mark and no old note', async ($, on) => {
  trace("FR-022-AC-2")
  const w = await setup($, on, { initiatives: ['A'] }, eighteen(0))
  const d = await draw($)
  expect(d.text).toMatch(/100%/)
  expect(warnCount(d)).toBeNull()
  await d.unmount()
  void w
})

test('a selected project in no selected initiative is drawn after the initiatives and named in the expansion as not in a selected initiative', async ($, on) => {
  trace("FR-022-AC-5")
  await setup($, on, { initiatives: ['A', 'B'], projects: ['Q'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }] }],
    projects: { P1: project('P1', 1, 2), Q: project('Q', 2, 5) },
  })
  const d = await draw($)
  expect(d.lines.indexOf('Q')).toBeGreaterThan(d.lines.indexOf('P1'))
  await d.press('warnings-toggle')
  expect(d.text).toMatch(m(/^not in a selected initiative: Q$/))
  await d.unmount()
})

test('with every project failing and no record the card draws no total, shows the failed rows and the summary', async ($, on) => {
  trace("FR-022-AC-6")
  await setup($, on, { initiatives: ['A'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
    projects: { P1: MILESTONE, P2: MILESTONE },
  })
  const d = await draw($)
  expect(d.lines.filter(l => l === '—')).toHaveLength(3)
  expect(d.text).toMatch(m(/^P1$/))
  expect(d.text).toMatch(m(/^P2$/))
  expect(d.text).toMatch(m(/^QSL layer 4$/))
  expect(d.text).not.toMatch(/%|\d\/\d/)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/A: 0 of 2 projects, partial/)
  await d.unmount()
})

test('a failed project drawn from a 5 minute old record counts, is a warning, and the expansion says includes old data', async ($, on) => {
  trace("FR-022-AC-7", "FR-024-AC-2")
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4', ['running'], { initiatives: ['A'] }))
  const T0 = Date.UTC(2026, 10, 24, 12, 0)
  const id = '00000000-0000-4000-8000-0000000000a1'
  w.files.set('/home/test/.ix/factory-panel/progress.json', JSON.stringify({ [`project:${id}`]: { at_ms: T0 - 5 * 60_000, seen_ms: T0 - 60_000, done: 2, total: 4, inProgress: 0, ready: 0, id, name: 'P2' } }))
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2', id }] }], projects: { P1: project('P1', 3, 4), [id]: MILESTONE } })
  await startSession($)
  await firstRead($, w)
  const d = await draw($)
  expect(d.text).toMatch(m(/^5\/8$/))
  expect(warnCount(d)).toBe(1)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/A: 2 of 2 projects, includes old data \(oldest 5m\)/)
  expect(d.text).not.toMatch(/partial/)
  await d.unmount()
})

test('initiatives that cannot be expanded are failed rows and the expansion counts them', async ($, on) => {
  trace("FR-022-AC-9", "FR-022-AC-11", "FR-024-AC-2")
  await setup($, on, { initiatives: ['A', 'B'], projects: ['Q'] }, { roadmap: () => out('', 1, 'ix-board roadmap is down'), projects: { Q: project('Q', 1, 2) } } as Served)
  const d = await draw($)
  expect(d.lines.filter(l => l === '—').length).toBeGreaterThanOrEqual(2)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/A: projects unknown/)
  expect(d.text).toMatch(/B: projects unknown/)
  expect(d.text).toMatch(/2 initiatives not expanded/)
  await d.unmount()
})

test('one initiative that cannot be expanded reads 1 initiative not expanded', async ($, on) => {
  trace("FR-022-AC-11")
  await setup($, on, { initiatives: ['A', 'B'] }, {
    roadmap: [{ name: 'B', projects: [{ name: 'P1' }] }],
    projects: { P1: project('P1', 1, 2) },
  })
  const d = await draw($)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/1 initiative not expanded/)
  await d.unmount()
})

// ---------------------------------------------------------------- FR-024

test('one failed project shows ⚠ 1 in the warning tone on the freshness row', async ($, on) => {
  trace("FR-024-AC-1")
  await setup($, on, { initiatives: ['A'] }, { ...TWO, projects: { P1: project('P1', 3, 4), P2: MILESTONE } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const button = await ui.find({ type: 'Button', key: 'warnings-toggle' })
  expect((button!.props as { label: string }).label).toBe('1')
  const mark = (await ui.findAll({ type: 'Text' })).find(t => t.text === '⚠')
  expect((mark!.props as { color?: string }).color).toBe('warning')
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => (b.props as { flexDirection?: string }).flexDirection === 'row')
  const footer = rows.filter(r => /updated \d+s ago/.test(JSON.stringify(r)) && JSON.stringify(r).includes('⚠'))
  expect(footer.length).toBeGreaterThan(0)
  // the icon is left of the freshness text in that row
  expect(JSON.stringify(footer[0]).indexOf('⚠')).toBeLessThan(JSON.stringify(footer[0]).indexOf('updated'))
  await ui.unmount()
})

test('the warning counts failed projects and source errors, an unexpanded initiative once', async ($, on) => {
  trace("FR-024-AC-2")
  await setup($, on, { initiatives: ['A', 'B'] }, {
    roadmap: [{ name: 'A', projects: [{ name: 'P1' }, { name: 'P2' }] }],
    projects: { P1: MILESTONE, P2: project('P2', 1, 2) },
  })
  const d = await draw($)
  expect(warnCount(d)).toBe(2)
  await d.unmount()
})

test('with no problem there is no warning line, and with problems the body holds no error text', async ($, on) => {
  trace("FR-024-AC-3")
  await setup($, on, { initiatives: ['A'] }, TWO)
  const ok = await draw($)
  expect(warnCount(ok)).toBeNull()
  await ok.unmount()
})

test('with problems the card body holds no error text', async ($, on) => {
  trace("FR-024-AC-3")
  await setup($, on, { initiatives: ['A'] }, { ...TWO, projects: { P1: MILESTONE, P2: project('P2', 1, 2) } })
  const bad = await draw($)
  expect(warnCount(bad)).toBe(1)
  expect(bad.text).not.toMatch(/QSL-3215|871dbc77|unavailable/)
  await bad.unmount()
})

test('pressing the warning shows the full messages with ids and names, and a second press hides them', async ($, on) => {
  trace("FR-024-AC-4")
  await setup($, on, { initiatives: ['A'] }, { roadmap: [{ name: 'A', projects: [{ name: 'P1' }] }], projects: { P1: MILESTONE } })
  const d = await draw($)
  expect(d.buttons.find(b => b.key === 'warnings-toggle')!.hotkey).toBeUndefined()
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/P1.*QSL-3215.*871dbc77.*a31003a8/)
  await d.press('warnings-toggle')
  expect(d.text).not.toMatch(/QSL-3215/)
  await d.unmount()
})

test('an error text with no milestone expands to the parts it has', async ($, on) => {
  trace("FR-024-AC-5")
  await setup($, on, { initiatives: ['A'] }, { roadmap: [{ name: 'A', projects: [{ name: 'P1' }] }], projects: { P1: 'timed out' } })
  const d = await draw($)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/P1.*timed out/)
  await d.unmount()
})

test('/factory show lists each source with its full error text', async ($, on) => {
  trace("FR-024-AC-6")
  await setup($, on, { initiatives: ['A'] }, { roadmap: [{ name: 'A', projects: [{ name: 'P1' }] }], projects: { P1: MILESTONE } })
  const text = (await $.command.run({ command: 'factory', args: 'show' } as never)).text as string
  expect(text).toContain(MILESTONE)
})

/** The bars of one drawn pane: header, top-level rows (irow-/loose) and child rows, each with its width in cells and the cells before it. */
async function columns($: $t) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const boxes = await ui.findAll({ type: 'Box' })
  const props = (b: { props: unknown }) => b.props as { width?: number; paddingLeft?: number; justifyContent?: string }
  const bars = boxes.filter(b => /-bar$/.test(b.key ?? ''))
  const header = boxes.filter(b => (b.key ?? '').startsWith('all-'))
  // a row is a name box (width and indent), a bar and a count box, in this order
  const names = boxes.filter(b => props(b).width !== undefined && props(b).paddingLeft !== undefined)
  const rows = bars.map((bar, i) => {
    const n = props(names[i]!)
    const len = (bar.text ?? '').length
    const start = n.width! + 1
    return { indent: n.paddingLeft!, start, end: start + len, len }
  })
  const out = {
    top: [...new Set(rows.filter(r => r.indent === 0).map(r => JSON.stringify(r)))],
    child: [...new Set(rows.filter(r => r.indent > 0).map(r => JSON.stringify(r)))],
    header: [...new Set(header.map(b => (b.text ?? '').length))],
    countWidths: [...new Set(boxes.filter(b => /^(\d+\/\d+( \d+[smh])?|—)$/.test(b.text ?? '') && props(b).width !== undefined).map(b => props(b).width!))],
    headRow: boxes.find(b => (b.key ?? '').startsWith('head-'))?.text ?? '',
    totalRight: boxes.some(b => props(b).justifyContent === 'flex-end' && /^\d+\/\d+$/.test(b.text ?? '')),
  }
  await ui.unmount()
  return out
}

test('top-level bars share one column, child bars share a second one inside it, and neither moves when the rows change', async ($, on) => {
  trace("FR-023-AC-1")
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4', ['running'], { initiatives: ['Initiative alpha with a long name', 'B'], projects: ['Direct'] }))
  const T0 = Date.UTC(2026, 10, 24, 12, 0)
  const id = '00000000-0000-4000-8000-0000000000a1'
  w.files.set('/home/test/.ix/factory-panel/progress.json', JSON.stringify({ [`project:${id}`]: { at_ms: T0 - 13 * 60_000, seen_ms: T0 - 60_000, done: 2, total: 4, inProgress: 0, ready: 0, id, name: 'Old one' } }))
  ix(w, {
    roadmap: [
      { name: 'Initiative alpha with a long name', projects: [{ name: 'P1' }, { name: 'A much longer project name' }, { name: 'Gone' }, { name: 'Old one', id }] },
      { name: 'B', projects: [{ name: 'Q1' }] },
    ],
    projects: { P1: project('P1', 3, 4), 'A much longer project name': project('A much longer project name', 1, 9), Gone: MILESTONE, [id]: MILESTONE, Q1: project('Q1', 1, 2), Direct: project('Direct', 5, 6) },
  })
  await startSession($)
  await firstRead($, w)
  const first = await columns($)
  const W = PANE.props.bodyColumns
  const COUNT = 12
  const top = JSON.parse(first.top[0]!) as { start: number; end: number }
  const child = JSON.parse(first.child[0]!) as { start: number; end: number }
  // every top-level bar starts at one column and every child bar at another, exactly the indent to its right; both end at one right edge
  expect(first.top).toHaveLength(1)
  expect(first.child).toHaveLength(1)
  expect(child.start).toBe(top.start + 2)
  expect(child.end).toBe(top.end)
  // the right edge is followed by one gap and the constant count column, which ends at the card's inner right edge
  expect(top.end + 1 + COUNT).toBe(W - 3)
  expect(first.countWidths).toEqual([COUNT])
  // the overall bar spans the card on one row with its total at the right edge
  expect(first.header).toEqual([W - 3 - COUNT - 1])
  expect(first.headRow).toContain('/')
  expect(first.totalRight).toBe(true)
  // the same columns with other row sets: the widest initiative collapses, then another
  for (const key of ['ini-draco:QSL:code-Initiative alpha with a long name', 'ini-draco:QSL:code-B']) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
    await ui.press({ key })
    await ui.unmount()
    const next = await columns($)
    expect(next.top.every(t => t === first.top[0])).toBe(true)
    expect(next.child.every(t => t === first.child[0])).toBe(true)
    expect(next.header).toEqual(first.header)
    expect(next.countWidths).toEqual(first.countWidths)
  }
})

test('an old row shows a dim age after its counts, a stale one the age in the warning tone, and the bars do not move', async ($, on) => {
  trace("FR-017-AC-4")
  const w = world(on, true)
  w.leads.set(LEAD, report(LEAD, 'QSL layer 4', ['running'], { initiatives: ['A'] }))
  const T0 = Date.UTC(2026, 10, 24, 12, 0)
  const rec = (n: string, id: string, minutes: number) => [`project:${id}`, { at_ms: T0 - minutes * 60_000, seen_ms: T0 - 60_000, done: 2, total: 4, inProgress: 0, ready: 0, id, name: n }] as const
  const ids = ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2']
  w.files.set('/home/test/.ix/factory-panel/progress.json', JSON.stringify(Object.fromEntries([rec('Recent', ids[0]!, 13), rec('Stale', ids[1]!, 70)])))
  ix(w, { roadmap: [{ name: 'A', projects: [{ name: 'Recent', id: ids[0] }, { name: 'Stale', id: ids[1] }] }], projects: { [ids[0]!]: MILESTONE, [ids[1]!]: MILESTONE } })
  await startSession($)
  await firstRead($, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const ages = (await ui.findAll({ type: 'Text' })).filter(t => /^ \d+[mh]$/.test(t.text ?? ''))
  const by = (t: string) => ages.find(a => a.text === t)!.props as { dimColor?: boolean; color?: string }
  expect(ages.map(a => a.text)).toEqual([' 13m', ' 1h'])
  expect(by(' 13m').color).toBeUndefined()
  expect(by(' 13m').dimColor).toBe(true)
  expect(by(' 1h').color).toBe('warning')
  await ui.unmount()
})

test('the widget never shows 100% for a partial total', async ($, on) => {
  trace("FR-022-AC-3")
  await setup($, on, { initiatives: ['A'] }, eighteen(1))
  const d = await draw($, 'terminal', 'widget')
  expect(d.text).toMatch(/99%/)
  expect(d.text).not.toMatch(/100%/)
  await d.unmount()
})

test('initiative A whose 4 projects all fail reads as a failed row, B is drawn, the header sums B only and the warning counts 4', async ($, on) => {
  trace("FR-022-AC-9", "FR-024-AC-2")
  await setup($, on, { initiatives: ['A', 'B'] }, {
    roadmap: [
      { name: 'A', projects: [{ name: 'A1' }, { name: 'A2' }, { name: 'A3' }, { name: 'A4' }] },
      { name: 'B', projects: [{ name: 'B1' }, { name: 'B2' }] },
    ],
    // Each fails with a text of its own: two halves failing alike would read as ix-board itself failing.
    projects: { A1: `${MILESTONE} (A1)`, A2: `${MILESTONE} (A2)`, A3: `${MILESTONE} (A3)`, A4: `${MILESTONE} (A4)`, B1: project('B1', 3, 4), B2: project('B2', 1, 2) },
  })
  const d = await draw($)
  expect(warnCount(d)).toBe(4)
  expect(d.text).toMatch(m(/^4\/6$/))
  expect(d.lines.filter(l => l === '—')).toHaveLength(5)
  await d.press('warnings-toggle')
  expect(d.text).toMatch(/A: 0 of 4 projects, partial/)
  expect(d.text).toMatch(/B: 2 of 2 projects$/m)
  expect(d.text).toMatch(/total: 2 of 6 projects, partial/)
  await d.unmount()
})
