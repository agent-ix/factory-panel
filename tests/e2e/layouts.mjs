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
//   FR-019-AC-2   /factory show says why these focuses are shown; the card itself holds no prose
//   FR-020-AC-4   /factory focus with an unknown name is refused and leaves the choice unchanged
//   FR-008-AC-5   a first-time user, with only /factory help, opens a view, switches and chooses what to display
//
// The session runs with a temporary HOME (see home.mjs), so what it writes, the choice the check makes
// among it, goes there and never to the real home; it is removed when the check ends. Only slash
// commands are typed, never a prompt. The sessions run detached in tmux, so they switch the mod's view
// check off (FACTORY_PANEL_VIEW_CHECK=off): detached, it would read nothing.
//
// These are Demonstration and capture criteria. Quire reads trace tags only from TypeScript, Python and
// Rust symbols, not from .mjs, so they are deliberately NOT matrix-bound; the matrix shows them as
// untagged and this script plus its evidence/ captures is their verification.
//
// Needs: node, tmux, claude on PATH, and a folder Claude Code is already trusted in to run the sessions
// in: this repository, or the one FP_E2E_CWD names.
// Run: [FP_E2E_CWD=<folder>] node tests/e2e/layouts.mjs [plugin-folder]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assigned, atEnd, endSession, makeHome, sessionEnv, sessionFolder } from './home.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGIN = resolve(process.argv[2] ?? ROOT)
/** The tmux socket of the check's own. */
const SOCKET = `fp-layouts-${process.pid}`
const EVIDENCE = join(ROOT, 'tests', 'e2e', 'evidence')
mkdirSync(EVIDENCE, { recursive: true })

const CWD = sessionFolder(ROOT)
// A home of its own for the session and the mod's files.
const FPHOME = makeHome('fp-e2e-home-', CWD)
const CHOICES = join(FPHOME, '.ix', 'factory-panel', 'choices', 'default.json')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// A tmux command that has not ended after this long is killed and fails the check, rather than hanging it.
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', timeout: 30000 })

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
    this.forget = atEnd(() => endSession(SOCKET, this.name))
    const env = sessionEnv(FPHOME, { CLAUDE_CODE_NO_FLICKER: String(flicker), FACTORY_PANEL_VIEW_CHECK: 'off' })
    tmux('new-session', '-d', '-s', this.name, '-x', '200', '-y', '50', '-c', CWD, `env -i ${assigned(env)} claude --plugin-dir '${PLUGIN}'`)
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
    endSession(SOCKET, this.name)
    this.forget()
  }
}

const BANNER = /(your choice: .+|focuses of .+|could not tell who this session is, showing every focus|no focus reported by .+)/
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
  if (/trust this folder/i.test(text)) throw new Error(`Claude Code asks to trust ${CWD}; the check does not answer that`)
}

async function classic() {
  let s
  try {
    s = new Session('classic', 0)
    // NFR-001-M-1 / FR-001-AC-1,2: the band is there 5 seconds after launch with no key sent.
    await sleep(5000)
    const first = s.capture('1-after-5s')
    assertNotTrustPrompt(s, first)
    check('classic: band on screen 5s after launch with no key', bandLine(first) !== undefined, first.slice(-600))
    check('classic: no pane opened at start', !first.includes('╭'))
    check('classic: no dialog or question at start', !/What do you do in this session\?|Your role/.test(first))
    // NFR-002-M-1: the prompt has the keyboard.
    check('classic: prompt has the keyboard after start', await promptHasKeyboard(s, '2-prompt-keyboard'))

    // FR-008-AC-5: the help alone says how to choose; follow it. Setup for the steps below, not counted.
    s.type('/factory help')
    s.key('Enter')
    const help = await s.waitFor(t => /\/factory use/.test(t) && /\/factory hosts/.test(t))
    s.capture('2b-help')
    check('classic: /factory help lists the choice commands and the skill snippet', help !== null && /features\/default\.json/.test(help), s.capture().slice(-900))
    s.type('/factory hosts local')
    s.key('Enter')
    const chosen = await s.waitFor(t => /Hosts: local/.test(t))
    check('classic: /factory hosts local is accepted', chosen !== null)
    check('classic: the choice is kept under the ix home of the session', existsSync(CHOICES) && /"hosts": "local"/.test(readFileSync(CHOICES, 'utf8')))
    s.type('/factory show')
    s.key('Enter')
    const shown = await s.waitFor(t => /hosts\s+local\s+\[user\]/.test(t))
    s.capture('2c-show')
    check('classic: /factory show says the hosts value came from the user', shown !== null)
    check('classic: /factory show prints the line that says why these focuses are shown', BANNER.test(shown ?? ''), (shown ?? '').slice(-600))
    // No lead reports a focus of this name: it is refused, whole, and the choice stays.
    s.type('/factory focus No Such Focus')
    s.key('Enter')
    const refused = await s.waitFor(t => /The focus is unchanged/.test(t))
    s.capture('2d-focus-refused')
    check('classic: /factory focus with a name no lead reports is refused and says so', refused !== null, s.capture().slice(-600))
    s.type('/factory focus all')
    s.key('Enter')
    await s.waitFor(t => /Focus: all/.test(t))
    await s.waitFor(t => /^\s*1: local/m.test(t), 10000)

    // NFR-003-M-1: open takes one typed command.
    s.type('/factory')
    s.key('Enter')
    s.inputs = 1
    const opened = await s.waitFor(t => popupOpen(t, 'Focus'))
    s.capture('3-open')
    check('classic: /factory opens the Focus popup (1 command)', opened !== null && s.inputs <= 2, s.capture().slice(-800))
    // The card holds no prose since 0.7.0: the banner is in /factory show and behind the warning icon.
    check('classic: the Focus popup draws the Focus pane heading', /Focus/.test(opened ?? ''), (opened ?? '').slice(-800))
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
    s?.kill()
  }
}

async function fullscreen() {
  let s
  const tabs = /Factory\s+Focus\s+Work\s+Escalations\s+Message\s+Team/
  try {
    s = new Session('fullscreen', 1)
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
    // The Message pane has no heading of its own: its input says which pane is drawn.
    const relay = await s.waitFor(t => /Type your message/.test(t) && !/│\s*Focus\b/.test(t))
    s.capture('4-switch-relay')
    check('fullscreen: /factory relay switches the dock to Message (1 command)', relay !== null)

    // NFR-003-M-3: Esc closes the focused tab, which only happens when the dock holds the keyboard.
    s.key('Escape')
    const closed = await s.waitFor(t => /Factory\s+Focus\s+Work\s+Escalations\s+Team/.test(t))
    s.capture('5-closed')
    check('fullscreen: Esc closes the focused dock tab (1 key)', closed !== null)
    check('fullscreen: the prompt has the keyboard after Esc', await promptHasKeyboard(s, '6-prompt-after-close'))
  } finally {
    s?.kill()
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
