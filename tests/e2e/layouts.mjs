#!/usr/bin/env node
// Layout check: drives real `claude --plugin-dir <this repo>` sessions in tmux, once in the classic
// layout (CLAUDE_CODE_NO_FLICKER=0) and once in the fullscreen layout (=1), and asserts what a
// person sees. Captures of every step are saved under tests/e2e/evidence/ (git-ignored).
//
// Covers the Demonstration and capture criteria of the spec:
//   NFR-001-M-1   the ambient view is on screen 5 seconds after launch with no key sent
//   NFR-002-M-1   the prompt has the keyboard after start (no dialog, no focus grab)
//   NFR-003-M-1..3 open, switch and close each take at most two inputs (counted below)
//   FR-001-AC-5   fullscreen: panes docked at the right at start with no command
//   FR-004-AC-5   classic: Esc closes the popup and the prompt has the keyboard again
//   FR-004-AC-6   fullscreen: `/factory focus` focuses the docked Focus tab
//   FR-009-AC-8   classic: a digit typed while the prompt holds text goes into the prompt
//
// Needs: node, tmux, claude on PATH, and the repository folder already trusted by Claude Code.
// Run: node tests/e2e/layouts.mjs

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EVIDENCE = join(ROOT, 'tests', 'e2e', 'evidence')
mkdirSync(EVIDENCE, { recursive: true })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail === '' ? '' : `\n      ${detail}`}`)
}

class Session {
  constructor(layout, flicker) {
    this.layout = layout
    this.name = `fp-e2e-${layout}-${process.pid}`
    this.inputs = 0
    tmux('new-session', '-d', '-s', this.name, '-x', '200', '-y', '50', '-c', ROOT, `env CLAUDE_CODE_NO_FLICKER=${flicker} claude --plugin-dir ${ROOT}`)
  }
  capture(label) {
    const text = tmux('capture-pane', '-p', '-t', this.name).replace(/[ \t]+$/gm, '')
    if (label !== undefined) writeFileSync(join(EVIDENCE, `${this.layout}-${label}.txt`), text)
    return text
  }
  /** Sends one typed command (text then Enter) or key press; counts as inputs for the step. */
  type(text) {
    tmux('send-keys', '-t', this.name, '-l', text)
  }
  key(name) {
    tmux('send-keys', '-t', this.name, name)
  }
  async waitFor(test, ms = 20000) {
    const until = Date.now() + ms
    for (;;) {
      const text = this.capture()
      if (test(text)) return text
      if (Date.now() > until) return null
      await sleep(400)
    }
  }
  kill() {
    try {
      tmux('kill-session', '-t', this.name)
    } catch {}
  }
}

const bandLine = text => text.split('\n').find(l => /^\s*1: \S/.test(l))
const promptLine = text => text.split('\n').find(l => /^❯/.test(l))
const popupOpen = (text, view) => new RegExp(`^│ ${view}\\b`, 'm').test(text) && text.includes('╭')

/** Types a character at the prompt and checks it lands there, then removes it. */
async function promptHasKeyboard(s, label) {
  s.type('x')
  const seen = await s.waitFor(t => /^❯\s+x/m.test(t), 5000)
  s.capture(label)
  s.key('BSpace')
  await sleep(300)
  return seen !== null
}

function assertNotTrustPrompt(s, text) {
  if (/trust this folder/i.test(text)) throw new Error(`Claude Code asks to trust ${ROOT}; accept it once by hand, then rerun`)
}

async function classic() {
  const s = new Session('classic', 0)
  try {
    // NFR-001-M-1 / FR-001-AC-1,2: the band is there 5 seconds after launch with no key sent.
    await sleep(5000)
    const first = s.capture('1-after-5s')
    assertNotTrustPrompt(s, first)
    check('classic: band on screen 5s after launch with no key', bandLine(first) !== undefined, first.slice(-600))
    check('classic: no pane opened at start', !first.includes('╭'))
    check('classic: no dialog or question at start', !/What do you do in this session\?|Your role/.test(first))
    // NFR-002-M-1: the prompt has the keyboard.
    check('classic: prompt has the keyboard after start', await promptHasKeyboard(s, '2-prompt-keyboard'))

    // Setup, not counted: pick the code-lead role so the band has several cells.
    s.type('/factory role')
    s.key('Enter')
    const asked = await s.waitFor(t => t.includes('What do you do in this session?'))
    check('classic: /factory role asks the role question', asked !== null)
    s.key('2')
    const answered = await s.waitFor(t => /Your role here is code-lead/.test(t))
    check('classic: the role is set to code-lead', answered !== null)
    await s.waitFor(t => /^\s*1: local/m.test(t), 10000)

    // NFR-003-M-1: open takes one typed command.
    s.type('/factory')
    s.key('Enter')
    s.inputs = 1
    const opened = await s.waitFor(t => popupOpen(t, 'Focus'))
    s.capture('3-open')
    check('classic: /factory opens the Focus popup (1 command)', opened !== null && s.inputs <= 2, s.capture().slice(-800))
    check('classic: the band stays visible with the popup open', bandLine(s.capture()) !== undefined)

    // NFR-003-M-2: switch takes one key.
    s.key('1')
    const switched = await s.waitFor(t => popupOpen(t, 'Factory') && !popupOpen(t, 'Focus'))
    s.capture('4-switch')
    check('classic: digit 1 switches to the Factory view (1 key)', switched !== null)

    // FR-009-AC-8: a digit typed while the prompt holds text goes into the prompt and opens nothing.
    s.type('ab')
    s.key('2')
    await sleep(1200)
    const typed = s.capture('5-digit-in-text')
    check('classic: a digit typed after text goes into the prompt', /^❯\s+ab2/m.test(typed), promptLine(typed) ?? '(no prompt line)')
    check('classic: and the open view does not change', popupOpen(typed, 'Factory') && !popupOpen(typed, 'Focus'))
    for (let i = 0; i < 3; i++) s.key('BSpace')
    await sleep(300)

    // NFR-003-M-3 / FR-004-AC-5: Esc closes the popup and the prompt has the keyboard again.
    s.key('Escape')
    const closed = await s.waitFor(t => !t.includes('╭'))
    s.capture('6-closed')
    check('classic: Esc closes the popup (1 key)', closed !== null)
    check('classic: the prompt has the keyboard after Esc', await promptHasKeyboard(s, '7-prompt-after-close'))
  } finally {
    s.kill()
  }
}

async function fullscreen() {
  const s = new Session('fullscreen', 1)
  const tabs = /Factory\s+Focus\s+Escalations\s+Relay\s+Team/
  try {
    // NFR-001-M-1 / FR-001-AC-5: the docked panel is there 5 seconds after launch with no key sent.
    await sleep(5000)
    const first = s.capture('1-after-5s')
    assertNotTrustPrompt(s, first)
    check('fullscreen: docked panel on screen 5s after launch with no key', tabs.test(first), first.slice(0, 600))
    check('fullscreen: no band above the prompt', bandLine(first) === undefined)
    check('fullscreen: no dialog or question at start', !/What do you do in this session\?|Your role/.test(first))
    check('fullscreen: prompt has the keyboard after start', await promptHasKeyboard(s, '2-prompt-keyboard'))

    // NFR-003-M-1 / FR-004-AC-6: /factory focus focuses the docked Focus tab.
    s.type('/factory focus')
    s.key('Enter')
    const focused = await s.waitFor(t => /│\s*Focus\b/.test(t))
    s.capture('3-open-focus')
    check('fullscreen: /factory focus shows the Focus tab (1 command)', focused !== null, s.capture().slice(0, 600))

    // NFR-003-M-2: switching is one command.
    s.type('/factory relay')
    s.key('Enter')
    const relay = await s.waitFor(t => /│\s*Relay\s/.test(t) && !/│\s*Focus\b/.test(t))
    s.capture('4-switch-relay')
    check('fullscreen: /factory relay switches the dock to Relay (1 command)', relay !== null)

    // NFR-003-M-3: Esc closes the focused tab, which only happens when the dock holds the keyboard.
    s.key('Escape')
    const closed = await s.waitFor(t => /Factory\s+Focus\s+Escalations\s+Team/.test(t))
    s.capture('5-closed')
    check('fullscreen: Esc closes the focused dock tab (1 key)', closed !== null)
    check('fullscreen: the prompt has the keyboard after Esc', await promptHasKeyboard(s, '6-prompt-after-close'))
  } finally {
    s.kill()
  }
}

try {
  await classic()
  await fullscreen()
} catch (error) {
  check('layout check ran to the end', false, String(error?.message ?? error))
}

writeFileSync(join(EVIDENCE, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; captures in ${EVIDENCE}`)
process.exit(failed.length === 0 ? 0 : 1)
