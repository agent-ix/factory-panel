#!/usr/bin/env node
// FR-027-AC-16: drives real `claude` sessions in tmux against stand-ins for every command and the
// metrics service, and logs each read the mod makes while the panel is open, on another tab, and
// closed (fullscreen), and while the popup is open, closed and the band collapsed (classic).
//
// The session has a temporary HOME holding only the Claude login (removed when the session ends),
// so no other plugin, hook or real relay is involved; `herdr`, `agent-msg`, `ix-board` and `ix` on its PATH are stand-ins that append
// their arguments to a log. Captures and the log are saved under tests/e2e/evidence/ (git-ignored).
//
// Needs: node, tmux, claude on PATH, and the repository folder already trusted by Claude Code.
// Run: node tests/e2e/onscreen.mjs [seconds-per-phase] [plugin-folder]
// A second argument measures another copy of the mod (an export of an earlier version) the same way;
// its "nothing while closed" checks are reported and expected to fail.

import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PHASE_SECS = Number(process.argv[2] ?? 150)
const PLUGIN = resolve(process.argv[3] ?? ROOT)
const LABEL = PLUGIN === resolve(ROOT) ? 'current' : basename(PLUGIN)
const EVIDENCE = join(ROOT, 'tests', 'e2e', 'evidence', `onscreen-${LABEL}`)
mkdirSync(EVIDENCE, { recursive: true })

const sleep = ms => new Promise(done => setTimeout(done, ms))
const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

// ---------------------------------------------------------------- the stand-ins

const PROJECT = '00000000-0000-4000-8000-000000000001'
const LEAD = 'draco:QSL:code'
const STATUS = {
  fetched_at: Math.floor(Date.now() / 1000),
  excluded_ready_count: 0,
  ready_queue: [],
  blocker_layers: [[]],
  work_milestones: [],
  projects: [{ id: PROJECT, identifier: PROJECT, name: 'Payments ledger', progress: { done: 5, total: 10, completed_percent: 50 }, in_progress: [], open_by_state: [], milestones: [], membership: 'full_project', target_date: null }],
}
const ANSWERS = {
  herdr: [['api snapshot', JSON.stringify({ result: { snapshot: { version: '0', agents: [], workspaces: [] } } })]],
  'agent-msg': [
    ['whoami', `${LEAD}  (location)  model unknown`],
    ['who', `${LEAD}  draco  claude  seen 11-24 16:26  pane p1  -  Herdr w1:w1:t1`],
    ['doctor', JSON.stringify({ ok: true, checks: [] })],
    ['work', JSON.stringify({ binding: { machine: 'draco', kind: 'claude', address: LEAD }, scope: { initiatives: [], projects: [PROJECT], tickets: [] }, focus: { summary: 'Stand-in focus' }, agents: [] })],
    ['escalations', 'e1  waiting  ENG-1  session/aa/bb  11-24 16:29'],
    ['escalation show', 'status: waiting\ncontext:\n  A stand-in escalation.'],
    ['log', '11-24 09:45 operator -> all: a stand-in broadcast'],
    ['focuses', JSON.stringify({ definitions: [] })],
  ],
  'ix-board': [
    ['--json agents', JSON.stringify({ agents: [{ team: 'QSL', agent: LEAD, herdr_status: 'working', machine: 'draco' }] })],
    ['--json focus status', JSON.stringify(STATUS)],
    ['--json roadmap', JSON.stringify({ result: { initiatives: [] } })],
    ['--json project-chunk', JSON.stringify({})],
  ],
}

/** Writes the stand-in commands into `bin`; each appends its arguments to `log`. */
function writeStubs(bin, log, prometheus) {
  const all = { ...ANSWERS, ix: [['config get observability.prometheusUrl', prometheus], ['config get observability.grafanaUrl', 'http://grafana.invalid']] }
  for (const [command, answers] of Object.entries(all)) {
    const file = join(bin, command)
    writeFileSync(
      file,
      `#!${process.execPath}
const { appendFileSync } = require('node:fs')
const line = process.argv.slice(2).join(' ')
appendFileSync(${JSON.stringify(log)}, Date.now() + ' ${command} ' + line + '\\n')
const answers = ${JSON.stringify(answers)}
// The longest matching start wins: \`escalation show\` before \`escalations\`, \`whoami\` before \`who\`.
const found = answers.filter(([start]) => line === start || line.startsWith(start + ' ')).sort((a, b) => b[0].length - a[0].length)[0]
if (found === undefined) { process.stderr.write('not stubbed: ' + line + '\\n'); process.exit(1) }
process.stdout.write(found[1] + '\\n')
`,
    )
    chmodSync(file, 0o755)
  }
}

function metrics(log) {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      appendFileSync(log(), `${Date.now()} prometheus ${request.url}\n`)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ status: 'success', data: { result: [] } }))
    })
  })
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)))
}

/** The source behind one logged line. */
const sourceOf = line => {
  const text = line.slice(line.indexOf(' ') + 1)
  if (text.startsWith('prometheus')) return text.endsWith('query_range') ? 'prometheus range' : 'prometheus query'
  const words = text.split(' ')
  if (words[0] === 'ix') return 'ix config'
  if (words[0] === 'herdr') return 'herdr snapshot'
  if (words[0] === 'ix-board') return `ix-board ${words[2]}`
  return `agent-msg ${words[1] === 'escalation' ? 'escalation show' : words[1]}`
}

// ---------------------------------------------------------------- the session

/** The reads of a phase's first seconds, those of the change of view itself, are left out of its rate. */
const SETTLING_SECS = 10
const sessions = new Set()
// An interrupted run leaves no session and no copy of the login behind.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => {
    for (const s of [...sessions]) s.kill()
    process.exit(130)
  })

class Session {
  constructor(layout, flicker, prometheus) {
    this.layout = layout
    this.name = `fp-onscreen-${layout}-${LABEL}-${process.pid}`.replace(/[^\w-]/g, '-')
    const home = mkdtempSync(join(tmpdir(), 'fp-onscreen-home-'))
    this.home = home
    sessions.add(this)
    mkdirSync(join(home, '.claude'))
    symlinkSync(join(homedir(), 'Library'), join(home, 'Library'))
    copyFileSync(join(homedir(), '.claude.json'), join(home, '.claude.json'))
    const bin = join(home, 'bin')
    mkdirSync(bin)
    this.log = join(EVIDENCE, `${layout}-calls.log`)
    writeFileSync(this.log, '')
    writeStubs(bin, this.log, prometheus)
    const env = [`HOME=${home}`, `PATH=${bin}:${process.env.PATH}`, 'TERM=xterm-256color', `USER=${process.env.USER}`, 'LANG=en_US.UTF-8', `CLAUDE_CODE_NO_FLICKER=${flicker}`]
    tmux('new-session', '-d', '-s', this.name, '-x', '200', '-y', '50', '-c', ROOT, `env -i ${env.map(e => `'${e}'`).join(' ')} claude --plugin-dir '${PLUGIN}'`)
    this.phases = []
  }
  screen() {
    return tmux('capture-pane', '-p', '-t', this.name).replace(/[ \t]+$/gm, '')
  }
  save(label) {
    writeFileSync(join(EVIDENCE, `${this.layout}-${label}.txt`), this.screen())
  }
  type(text) {
    tmux('send-keys', '-t', this.name, '-l', text)
  }
  key(name) {
    tmux('send-keys', '-t', this.name, name)
  }
  async command(text) {
    this.type(text)
    await sleep(500)
    this.key('Enter')
    await sleep(2000)
  }
  /** Clicks the first place `pattern` matches on screen (the fullscreen layout takes the mouse). */
  click(pattern) {
    const lines = this.screen().split('\n')
    for (let row = 0; row < lines.length; row++) {
      const found = pattern.exec(lines[row])
      if (found === null) continue
      const column = [...lines[row].slice(0, found.index + (found[1]?.length ?? 0))].length + 1
      this.type(`\u001b[<0;${column};${row + 1}M`)
      this.type(`\u001b[<0;${column};${row + 1}m`)
      return true
    }
    return false
  }
  async waitFor(test, ms = 30000) {
    const until = Date.now() + ms
    while (!test(this.screen())) {
      if (Date.now() > until) return false
      await sleep(500)
    }
    return true
  }
  /** Where a phase starts in the log. Taken before a change of view, so the read the change brings is counted. */
  mark(label) {
    const from = readFileSync(this.log, 'utf8').length
    appendFileSync(this.log, `# ${label}\n`)
    return { label, from }
  }
  /** Lets a phase run and returns the reads logged since its mark, counted by source. */
  async phase({ label, from }) {
    const started = Date.now()
    await sleep(PHASE_SECS * 1000)
    this.save(label.replace(/\W+/g, '-'))
    const lines = readFileSync(this.log, 'utf8').slice(from).split('\n').filter(l => l !== '' && !l.startsWith('#'))
    const tally = found => {
      const counts = {}
      for (const line of found) counts[sourceOf(line)] = (counts[sourceOf(line)] ?? 0) + 1
      return counts
    }
    const counts = tally(lines)
    const steady = tally(lines.filter(l => Number(l.split(' ')[0]) >= started + SETTLING_SECS * 1000))
    const minutes = (PHASE_SECS - SETTLING_SECS) / 60
    const perMinute = Object.fromEntries(Object.entries(steady).map(([source, n]) => [source, Math.round((n / minutes) * 10) / 10]))
    this.phases.push({ label, seconds: PHASE_SECS, total: lines.length, counts, perMinute })
    console.log(`${this.layout} ${label}: ${lines.length} reads in ${PHASE_SECS}s ${JSON.stringify(counts)}; per minute after ${SETTLING_SECS}s ${JSON.stringify(perMinute)}`)
    return counts
  }
  kill() {
    try {
      tmux('kill-session', '-t', this.name)
    } catch {}
    // The link first, so nothing under the real Library is ever reached by the removal.
    try {
      unlinkSync(join(this.home, 'Library'))
    } catch {}
    rmSync(this.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    sessions.delete(this)
  }
}

const only = (counts, allowed) => Object.keys(counts).every(source => allowed.includes(source))
const none = counts => Object.keys(counts).length === 0

async function fullscreen(prometheus) {
  const s = new Session('fullscreen', 1, prometheus)
  try {
    // The fourth tab is the relay pane, whatever its title.
    if (!(await s.waitFor(t => /Factory\s+Focus\s+Escalations\s+\S+\s+Team/.test(t), 60000))) throw new Error(`no docked panel:\n${s.screen()}`)
    await sleep(3000)
    // The Factory tab is put on view first; what the panes read while they opened is not counted.
    check('fullscreen: the Factory tab can be clicked', s.click(/(│ )Factory\s+Focus/))
    await sleep(2000)
    const open = await s.phase(s.mark('panel open on Factory'))
    check('fullscreen: the Factory tab reads its sources', ['prometheus query', 'herdr snapshot', 'agent-msg doctor'].every(source => (open[source] ?? 0) > 0), JSON.stringify(open))
    check('fullscreen: and nothing of the other tabs', only(open, ['prometheus query', 'herdr snapshot', 'agent-msg doctor', 'agent-msg whoami', 'ix-board agents']), Object.keys(open).join(', '))

    const switched = s.mark('switched to the relay tab')
    check('fullscreen: the relay tab can be clicked', s.click(/(Factory\s+Focus\s+Escalations\s+)\S+\s+Team/))
    const other = await s.phase(switched)
    check('fullscreen: the relay tab reads its own sources', (other['agent-msg log'] ?? 0) > 0, JSON.stringify(other))
    check('fullscreen: and no source of another tab', only(other, ['agent-msg log', 'agent-msg who']), Object.keys(other).join(', '))

    s.key('C-o')
    await sleep(5000)
    const covered = await s.phase(s.mark('detailed transcript over the panel'))
    check('fullscreen: nothing is read while the transcript view covers the panel', none(covered), JSON.stringify(covered))
    s.key('Escape')
    await sleep(3000)

    // Each close mark closes the tab on view; five close the panel.
    for (let i = 0; i < 5; i++) {
      if (!s.click(/()✕/)) break
      await sleep(1500)
    }
    check('fullscreen: the panel is closed', await s.waitFor(t => !/✕/.test(t), 5000))
    await sleep(5000)
    const closed = await s.phase(s.mark('panel closed'))
    check('fullscreen: nothing is read with the panel closed', none(closed), JSON.stringify(closed))
    return s.phases
  } finally {
    s.kill()
  }
}

async function classic(prometheus) {
  const s = new Session('classic', 0, prometheus)
  try {
    if (!(await s.waitFor(t => /^\s*1: /m.test(t), 60000))) throw new Error(`no band:\n${s.screen()}`)
    // Counted from the start of the session: what the band asks as it appears is part of it.
    const band = await s.phase({ label: 'band only', from: 0 })
    check('classic: the band reads what its cells draw', (band['prometheus query'] ?? 0) > 0, JSON.stringify(band))
    check('classic: and nothing else', only(band, ['ix config', 'prometheus query', 'agent-msg whoami', 'agent-msg who', 'agent-msg work', 'ix-board agents', 'ix-board focus', 'ix-board roadmap', 'ix-board project-chunk']), Object.keys(band).join(', '))
    const opened = s.mark('popup open on Escalations')
    await s.command('/factory escalations')
    const popup = await s.phase(opened)
    check('classic: the popup adds its own source', (popup['agent-msg escalations'] ?? 0) > 0, JSON.stringify(popup))
    s.key('Escape')
    await sleep(5000)
    const shut = await s.phase(s.mark('popup closed'))
    check('classic: the closed popup is read no more', (shut['agent-msg escalations'] ?? 0) === 0, JSON.stringify(shut))
    s.key('C-x')
    s.key('C-a')
    await sleep(5000)
    const collapsed = await s.phase(s.mark('band collapsed'))
    check('classic: nothing is read with the band collapsed and no pane', none(collapsed), JSON.stringify(collapsed))
    return s.phases
  } finally {
    s.kill()
  }
}

const logs = []
const server = await metrics(() => logs.at(-1))
const prometheus = `http://127.0.0.1:${server.address().port}`
const report = {}
try {
  // One session at a time, so the metrics queries belong to the session that is running.
  for (const [name, run] of [['fullscreen', fullscreen], ['classic', classic]]) {
    logs.push(join(EVIDENCE, `${name}-calls.log`))
    report[name] = await run(prometheus)
  }
} catch (error) {
  check('the check ran to the end', false, String(error?.message ?? error))
}
server.close()

writeFileSync(join(EVIDENCE, 'results.json'), `${JSON.stringify({ plugin: PLUGIN, phaseSeconds: PHASE_SECS, results, phases: report }, null, 2)}\n`)
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; log and captures in ${EVIDENCE}`)
process.exit(failed.length === 0 ? 0 : 1)
