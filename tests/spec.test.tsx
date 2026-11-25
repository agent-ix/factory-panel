import { expect, test } from 'claude-code/testing'
import { trace } from './trace'

import { digitFor } from '../hooks/band/modules'
import { runFactory, helpText } from '../hooks/router'
import { CLASSIC, FP, FULLSCREEN, bandCells, drawBand, fake$, options, settle, startSession, world } from './world'
import type { World } from './world'

/** Writes the declaration a skill's agent would write for the session draco:QSL:code. */
const declare = (w: World, picked: object, key = 'draco_QSL_code') => void w.files.set(`${FP}/features/${key}.json`, JSON.stringify(picked))

// Tests for the factory-panel spec (spec/). A trace call naming the criterion id inside a test binds
// it to that acceptance criterion (see ./trace.ts); the test must fail if the criterion is broken.
// The selection requirements (FR-005 and FR-010 to FR-015, NFR-004) are in selection.test.tsx.

test('starting a session never asks a question or takes the keyboard', async ($, on) => {
  trace("FR-005-AC-5", "NFR-002-M-1")
  const w = world(on)
  await startSession($)
  await settle()
  expect(w.asks).toEqual([])
  expect(w.opens.filter(o => o.focus === true)).toEqual([])
  const ui = await drawBand($, CLASSIC)
  expect(await bandCells(ui)).toContain('local')
  await ui.unmount()
  expect(w.asks).toEqual([])
})

// ---------------------------------------------------------------- FR-004 detail view

test('with a view open, opening another replaces it in the classic layout and keeps the dock in fullscreen', async ($, on) => {
  const w = world(on)
  const o = options()
  await runFactory(fake$(w) as never, o, 'focus', false)
  expect(w.closes).toEqual(expect.arrayContaining(['factory', 'escalations', 'relay', 'team']))
  expect(w.closes).not.toContain('focus')
  w.closes.length = 0
  w.opens.length = 0
  await runFactory(fake$(w) as never, o, 'team', true)
  expect(w.closes).toEqual([])
  expect(w.opens).toEqual([{ id: 'team', focus: true, closeOnEscape: true, rows: undefined }])
})

test('the popup is opened with the keyboard and close-on-Esc, and says which keys to use', async ($, on) => {
  trace("FR-004-AC-1", "FR-004-AC-3")
  const w = world(on)
  const text = await runFactory(fake$(w) as never, options(), 'focus', false)
  expect(w.opens.at(-1)).toEqual({ id: 'focus', focus: true, closeOnEscape: true, rows: 14 })
  expect(text).toMatch(/number to switch/)
  expect(text).toMatch(/r refreshes, Esc closes/)
})

test('the help says which keys to use, in the words of the layout', async ($, on) => {
  trace("FR-008-AC-2")
  world(on)
  expect(helpText(false)).toMatch(/line above the prompt/)
  expect(helpText(false)).toMatch(/number at an empty prompt/)
  expect(helpText(true)).toMatch(/panel at the right/)
  expect(helpText(true)).toMatch(/click a tab/)
  expect(helpText(true)).not.toMatch(/number at an empty prompt/)
})

test('the help answers see, open more, switch and choose what to display, each with the key or command to use', () => {
  trace("FR-008-AC-1")
  for (const full of [false, true]) {
    const text = helpText(full)
    expect(text).toMatch(/See it:/)
    expect(text).toMatch(/Open more:\s+\/factory/)
    expect(text).toMatch(/Switch:/)
    expect(text).toMatch(/Choose:/)
    expect(text).toMatch(/\/factory use /)
  }
})

// ---------------------------------------------------------------- FR-003 one command

test('a plain /factory opens Focus when the focus module is shown and Factory when it is not', async ($, on) => {
  trace("FR-003-AC-1")
  const w = world(on)
  await runFactory(fake$(w) as never, options(), '', false)
  expect(w.opens.at(-1)).toEqual({ id: 'focus', focus: true, closeOnEscape: true, rows: 14 })
  declare(w, { modules: ['local', 'lanes'] })
  await runFactory(fake$(w) as never, options(), '', false)
  expect(w.opens.at(-1)).toEqual({ id: 'factory', focus: true, closeOnEscape: true, rows: 14 })
})

test('/factory <view> opens exactly that view', async ($, on) => {
  trace("FR-003-AC-2")
  const w = world(on)
  for (const view of ['factory', 'focus', 'work', 'escalations', 'relay', 'team']) {
    w.opens.length = 0
    await runFactory(fake$(w) as never, options(), view, false)
    expect(w.opens.map(x => x.id)).toEqual([view])
  }
})

test('an unknown /factory argument says so and prints the help', async ($, on) => {
  trace("FR-003-AC-3")
  const w = world(on)
  const text = await runFactory(fake$(w) as never, options(), 'focus2', false)
  expect(text).toMatch(/"focus2" is not a \/factory command/)
  expect(text).toContain(helpText(false))
  expect(w.opens).toEqual([])
})

test('the old per-view commands are aliases, and /focuses team sets the focus scope', async ($, on) => {
  trace("FR-003-AC-4", "FR-003-AC-6")
  const w = world(on)
  await startSession($)
  expect(w.registered).toEqual(expect.arrayContaining(['factory', 'focuses', 'escalations', 'relay', 'team']))
  expect(w.registered).not.toContain('band')
  for (const [command, id] of [['focuses', 'focus'], ['escalations', 'escalations'], ['relay', 'relay'], ['team', 'team']] as const) {
    w.opens.length = 0
    await $.command.run({ command, args: '' })
    await settle()
    expect(w.opens.map(x => x.id)).toContain(id)
  }
  w.opens.length = 0
  await $.command.run({ command: 'focuses', args: 'Beta' })
  await settle()
  expect(w.opens).toEqual([])
  expect(JSON.parse(w.files.get(`${FP}/choices/draco_QSL_code.json`)!)).toEqual({ focus: 'Beta' })
})

test('/factory focus with no argument opens the Focus view, and /factory focus <name> sets the scope and opens no view', async ($, on) => {
  trace("FR-003-AC-5")
  const w = world(on)
  await runFactory(fake$(w) as never, options(), 'focus', false)
  expect(w.opens.map(x => x.id)).toEqual(['focus'])
  w.opens.length = 0
  await runFactory(fake$(w) as never, options(), 'focus Beta', false)
  expect(w.opens).toEqual([])
  expect(JSON.parse(w.files.get(`${FP}/choices/draco_QSL_code.json`)!)).toEqual({ focus: 'Beta' })
})

// ---------------------------------------------------------------- FR-001 ambient view

test('in the classic layout the band is drawn at the first redraw with no key pressed', async ($, on) => {
  trace("FR-001-AC-1")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'local' })).toBeDefined()
  await ui.unmount()
})

test('in the classic layout no pane opens at session start, at a redraw or at a surface attach', async ($, on) => {
  trace("FR-001-AC-2")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  await drawBand($, CLASSIC)
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: CLASSIC })
  await settle()
  expect(w.opens).toEqual([])
  await ui.unmount()
})

test('while the layout has not been reported the band is drawn and no pane is opened', async ($, on) => {
  trace("FR-001-AC-3")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, undefined)
  expect(await ui.find({ key: 'local' })).toBeDefined()
  await settle()
  expect(w.opens).toEqual([])
  await ui.unmount()
})

test('when the layout is first reported as fullscreen the six panes open once and no band is drawn', async ($, on) => {
  trace("FR-001-AC-4")
  const w = world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, FULLSCREEN)
  await drawBand($, FULLSCREEN)
  await settle()
  expect(w.opens.map(o => o.id)).toEqual(['factory', 'focus', 'work', 'escalations', 'relay', 'team'])
  expect(await ui.find({ key: 'local' })).toBeUndefined()
  await ui.unmount()
})

test('a pane the person closed is not reopened by a later attach', async ($, on) => {
  trace("FR-001-AC-6")
  const w = world(on)
  await startSession($)
  await drawBand($, FULLSCREEN)
  await settle()
  const before = w.opens.length
  w.listed.value = ['factory', 'focus', 'work', 'escalations', 'relay'].map(id => ({ id, title: id, isPlaced: true }))
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  await settle()
  expect(w.opens.length).toBe(before)
})

test('a non-interactive session opens no pane at start or at an attach', async ($, on) => {
  trace("FR-001-AC-7")
  const w = world(on)
  await startSession($, false)
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default', viewport: FULLSCREEN })
  await settle()
  expect(w.opens).toEqual([])
})

test('while a source fails the band adds one line naming the problem under its row of cells', async ($, on) => {
  trace("FR-001-AC-8", "FR-006-AC-6")
  const w = world(on)
  declare(w, { modules: ['health', 'relay'] })
  w.relayFails.value = true
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  const alerts = await ui.findAll({ type: 'Text', text: /^relay: / })
  expect(alerts.map(a => a.text)).toEqual(['relay: redis down'])
  expect((alerts[0]?.props as { color?: string }).color).toBe('warning')
  // It is the only warning line: one line, not one per source.
  const lines = (await ui.findAll({ type: 'Text' })).filter(t => (t.props as { wrap?: string }).wrap === 'truncate-end')
  expect(lines.map(t => t.text)).toEqual(['relay: redis down'])
  // The row of cells is still there above the line.
  expect(await ui.find({ key: 'health' })).toBeDefined()
  await ui.unmount()
})

test('with no failing source the band is only its row of cells', async ($, on) => {
  trace("FR-001-AC-8")
  const w = world(on)
  declare(w, { modules: ['health', 'relay'] })
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'health' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^relay: / })).toEqual([])
  expect((await ui.findAll({ type: 'Text' })).filter(t => (t.props as { wrap?: string }).wrap === 'truncate-end')).toEqual([])
  await ui.unmount()
})

// ---------------------------------------------------------------- FR-009 band cells

test('each cell drawn shows its digit, so a person can read which key opens it', async ($, on) => {
  trace("FR-009-AC-1")
  world(on)
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  const local = await ui.find({ key: 'local' })
  expect((local?.props as { hotkey?: string }).hotkey).toBe('1')
  // The host draws the hotkey as the number before the button's text; the text itself does not repeat it.
  expect(local?.text).not.toMatch(/^1/)
  expect(local?.text.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('the digits follow the cells drawn: a module left out moves the others up', async ($, on) => {
  trace("FR-009-AC-2")
  const w = world(on)
  declare(w, { modules: ['attention', 'health', 'local'] })
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  expect(await ui.find({ key: 'attention' })).toBeUndefined()
  expect(((await ui.find({ key: 'health' }))?.props as { hotkey?: string }).hotkey).toBe('1')
  expect(((await ui.find({ key: 'local' }))?.props as { hotkey?: string }).hotkey).toBe('2')
  await ui.unmount()
})

test('digits 1 to 9 go to the first nine cells and a tenth has none', () => {
  trace("FR-009-AC-3")
  expect(Array.from({ length: 10 }, (_, i) => digitFor(i))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined])
})

test('a mounted band numbers its buttons 1, 2, ... in the order drawn, and no button carries a digit beyond them', async ($, on) => {
  trace("FR-009-AC-5")
  const w = world(on)
  declare(w, { modules: ['health', 'local'] })
  await startSession($)
  await settle()
  const ui = await drawBand($, CLASSIC)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.key)).toEqual(['health', 'local'])
  expect(buttons.map(b => (b.props as { hotkey?: string }).hotkey)).toEqual(['1', '2'])
  // No button answers to 3, so that digit has nothing to open; drawing opened nothing either.
  expect(buttons.some(b => (b.props as { hotkey?: string }).hotkey === '3')).toBe(false)
  expect(w.opens).toEqual([])
  await ui.unmount()
})

test('pressing the band button that carries a digit opens that cell\'s view and replaces the open one', async ($, on) => {
  trace("FR-004-AC-2")
  const w = world(on)
  declare(w, { modules: ['health', 'local'] })
  await startSession($)
  await settle()
  await $.command.run({ command: 'factory', args: 'focus' })
  await settle()
  w.opens.length = 0
  w.closes.length = 0
  const ui = await drawBand($, CLASSIC)
  const first = (await ui.findAll({ type: 'Button' })).find(b => (b.props as { hotkey?: string }).hotkey === '1')
  await ui.press({ key: first!.key! })
  await settle()
  expect(w.opens.map(o => o.id)).toEqual(['factory'])
  expect(w.opens[0]?.focus).toBe(true)
  expect(w.closes).toContain('focus')
  await ui.unmount()
})


