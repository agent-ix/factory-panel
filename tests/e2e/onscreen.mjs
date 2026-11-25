#!/usr/bin/env node
// FR-027-AC-16 and AC-28: drives real `claude` sessions against stand-ins for every command and the
// metrics service, and logs each read the mod makes while its views are on and off screen, checking
// that what was read is drawn (the Work tab with its role events and silent leads, the Team tab with
// its retro health, roles and capacity, and the band's work cell):
//   fullscreen  panel open, Work, Team, another tab, covered by the transcript view, closed
//   classic     band only, popup open, popup closed, band collapsed
//   tmux        a session nobody is attached to, attached, detached again
//   herdr       each layout on view, behind another tab, back on view (on a herdr server of its own)
//
// Each session has a temporary HOME (see home.mjs) holding the Claude login keys of ~/.claude.json,
// a link to the keychain and nothing else of the person's, removed when the check ends. Only slash
// commands and keys of the views are typed, never a prompt.
// `agent-msg`, `ix-board` and `ix` on its PATH are stand-ins that append their arguments to a log;
// `herdr` is one too, except in the herdr sessions, where it logs and runs the real herdr against the
// check's own server. `tmux` logs and runs the real tmux. The first two layouts run detached in tmux,
// so they switch the view check off (FACTORY_PANEL_VIEW_CHECK=off). Captures, logs and results are
// saved under tests/e2e/evidence/ (git-ignored).
//
// Needs: node, tmux, herdr, claude on PATH, and a folder Claude Code is already trusted in to run the
// sessions in: this repository, or the one FP_E2E_CWD names.
// Run: [FP_E2E_CWD=<folder>] node tests/e2e/onscreen.mjs [seconds-per-phase] [plugin-folder] [scenario,...]
// A second argument measures another copy of the mod (an export of an earlier version) the same way;
// its "nothing off screen" checks are reported and expected to fail.

import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assigned, atEnd, endSession, makeHome, removeHome, sessionEnv, sessionFolder } from './home.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CWD = sessionFolder(ROOT)
const PHASE_SECS = Number(process.argv[2] ?? 150)
const PLUGIN = resolve(process.argv[3] ?? ROOT)
const LABEL = PLUGIN === ROOT ? 'current' : basename(PLUGIN)
const EVIDENCE = join(ROOT, 'tests', 'e2e', 'evidence', `onscreen-${LABEL}`)
mkdirSync(EVIDENCE, { recursive: true })

/** The tmux sockets of the check's own: the sessions, and the clients that attach to them. */
const SESSIONS = `fp-onscreen-${process.pid}`
const VIEWERS = `fp-onscreen-viewer-${process.pid}`
/** The reads of a phase's first seconds, those of the change of view itself, are left out of its rate. */
const SETTLING_SECS = 20

const sleep = ms => new Promise(done => setTimeout(done, ms))
/** A command that has not ended after this long is killed and fails the check, rather than hanging it. */
const COMMAND_MS = 30000
const which = command => execFileSync('/usr/bin/which', [command], { encoding: 'utf8', timeout: COMMAND_MS }).trim()
const REAL = { tmux: which('tmux') }

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

// ---------------------------------------------------------------- the stand-ins

const PROJECT = '00000000-0000-4000-8000-000000000001'
const LEAD = 'draco:QSL:code'
/** A lead that has reported no work. */
const SILENT = 'draco:QSL:minder'
const NOW_MS = Date.now()
const STATUS = {
  fetched_at: Math.floor(Date.now() / 1000),
  excluded_ready_count: 0,
  ready_queue: [],
  blocker_layers: [[]],
  work_milestones: [],
  projects: [{ id: PROJECT, identifier: PROJECT, name: 'Payments ledger', progress: { done: 5, total: 10, completed_percent: 50 }, in_progress: [{ id: 'i1', identifier: 'QSL-1', title: 'Stand-in ticket', state: 'Coding', prs: [{ url: 'https://github.com/agent-ix/standin/pull/7', repo: 'agent-ix/standin', number: 7, status: 'open', draft: false, created_at: null, merged_at: null }] }], recently_closed: [], open_by_state: [], milestones: [], membership: 'full_project', target_date: null }],
  activity: [{ at: new Date().toISOString(), kind: 'merged', identifier: 'QSL-2', title: 'Stand-in merge', project: 'Payments ledger', pr: { url: 'https://github.com/agent-ix/standin/pull/6', repo: 'agent-ix/standin', number: 6 } }],
}
const agent = (name, ticket, role) => ({ agent_id: name, name, ticket, role, status: 'running', reported_at_ms: NOW_MS - 240000 })
const WORK = { binding: { machine: 'draco', kind: 'claude', address: LEAD }, scope: { initiatives: [], projects: [PROJECT], tickets: [] }, focus: { summary: 'Stand-in focus', reported_at_ms: NOW_MS - 240000 }, agents: [agent('coder-1', 'QSL-1', 'coder'), agent('coder-2', 'QSL-3', 'coder')] }
const EVENT = { id: '1-0', at_ms: NOW_MS - 60000, binding: { address: LEAD }, change: { kind: 'agent', agent: agent('reviewer-1', 'QSL-1', 'reviewer') } }
/** A ticket the focus status does not name. */
const SINGLE = { identifier: 'QSL-3', title: 'Stand-in single ticket', state: 'unstarted', state_name: 'Specced', attachments_complete: true, pull_requests: [] }
const DELTA = { latest: new Date(NOW_MS).toISOString(), metrics: [{ id: 'standin_metric', class: 'flow', status: 'ok', regressing: false }] }
const EVAL = { schema_version: 1, window: { start_ms: NOW_MS - 86400000, end_ms: NOW_MS }, roles: [{ role: 'standin-coder', score: { passed: 1, evaluated: 2, pass_rate: 0.5 }, trend: 0, trend_matched_rules: 2, rules: [{ id: 'STAND-R1', status: 'fail', query: 'standin.query', value: 3, comparator: '<=', target: 1 }], objective_metrics: [] }] }
const LEDGER = { view: 'host_output_share_of_recorded_level', since_ms: null, rows: [{ host: 'standin-host', share_percent: 80, output_per_hour: 4, recorded_output_per_hour: 5, output_basis: 'commits', at_ms: NOW_MS, unavailable_reason: null, source_basis: {} }] }
const ANSWERS = {
  herdr: [['api snapshot', JSON.stringify({ result: { snapshot: { version: '0', agents: [], workspaces: [] } } })]],
  'agent-msg': [
    ['whoami', `${LEAD}  (location)  model unknown`],
    ['who', [LEAD, SILENT].map(a => `${a}  draco  claude  seen 11-24 16:26  pane p1  -  Herdr w1:w1:t1`).join('\n')],
    ['doctor', JSON.stringify({ ok: true, checks: [] })],
    ['work', JSON.stringify(WORK)],
    [`work --lead ${SILENT} show`, 'null'],
    ['work events', JSON.stringify({ version: 1, truncated: false, has_more: false, next_cursor: '1-0', events: [EVENT] })],
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
    ['--json issues', JSON.stringify({ complete: true, missing: [], issues: [SINGLE] })],
    ['--json retro delta', JSON.stringify(DELTA)],
    ['--json retro eval', JSON.stringify(EVAL)],
    ['--json fleet ledger query', JSON.stringify(LEDGER)],
  ],
}

/** Writes a command that appends its arguments to `log`, then prints its stand-in answer or runs the real command. */
function writeStub(bin, log, command, answers, real) {
  const file = join(bin, command)
  const body =
    real !== undefined
      ? `const ran = require('node:child_process').spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: 'inherit' })
process.exit(ran.status ?? 1)
`
      : `const answers = ${JSON.stringify(answers)}
// The longest matching start wins: \`escalation show\` before \`escalations\`, \`whoami\` before \`who\`.
const found = answers.filter(([start]) => line === start || line.startsWith(start + ' ')).sort((a, b) => b[0].length - a[0].length)[0]
if (found === undefined) { process.stderr.write('not stubbed: ' + line + '\\n'); process.exit(1) }
process.stdout.write(found[1] + '\\n')
`
  writeFileSync(
    file,
    `#!${process.execPath}
const { appendFileSync } = require('node:fs')
const line = process.argv.slice(2).join(' ')
appendFileSync(${JSON.stringify(log)}, Date.now() + ' ${command} ' + line + '\\n')
${body}`,
  )
  chmodSync(file, 0o755)
}

/** What the stand-in metrics service says to a query: one machine, one team's ready issues and one host's busy ratio. */
function answerTo(url, query) {
  const now = Math.floor(Date.now() / 1000)
  const one = (metric, value) => [{ metric, value: [now, value] }]
  if (url.endsWith('query_range')) return query.includes('(ix_team_ready_issues)') ? [{ metric: { team_id: 'standin', team_key: 'QSL', scope_id: 's' }, values: [[now, '7']] }] : []
  if (query.includes('timestamp(ix_relay_registrations)')) return one({ machine: 'standin-host' }, '5')
  if (query.includes('last_over_time(ix_fleet_host_busy_ratio')) return one({ host: 'standin-host' }, '0.4')
  if (query.includes('timestamp(ix_fleet_host_busy_ratio)')) return one({ host: 'standin-host' }, '5')
  return []
}

/** A metrics service of one session's own, which answers as above and logs every query. */
function metrics(log) {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      appendFileSync(log, `${Date.now()} prometheus ${request.url}\n`)
      const result = answerTo(request.url, decodeURIComponent(body))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ status: 'success', data: { result } }))
    })
  })
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)))
}

/** Logged commands that are not the mod's reads: what Claude Code asks tmux, and herdr's integration reporting. */
const NOT_THE_MOD = new Set(['tmux by Claude Code', 'herdr integration'])

/** The source behind one logged line. */
const sourceOf = line => {
  const text = line.slice(line.indexOf(' ') + 1)
  if (text.startsWith('prometheus')) return text.endsWith('query_range') ? 'prometheus range' : 'prometheus query'
  const words = text.split(' ')
  if (words[0] === 'ix') return 'ix config'
  if (words[0] === 'herdr') return words[1] === 'api' ? 'herdr snapshot' : 'herdr integration'
  // The mod's tmux check is the command that names the viewing clients.
  if (words[0] === 'tmux') return text.includes('window_active_clients') ? 'tmux view check' : 'tmux by Claude Code'
  if (words[0] === 'ix-board') return words[2] === 'retro' ? `ix-board retro ${words[3]}` : `ix-board ${words[2]}`
  return `agent-msg ${words[1] === 'escalation' ? 'escalation show' : words[1]}`
}

// ---------------------------------------------------------------- a session

const quoted = text => `'${text}'`

class Session {
  /** `viewCheck` false switches the mod's own check off; `herdr` runs the session in a pane of a herdr server of its own. */
  static async start(name, { flicker, viewCheck, herdr = false }) {
    const s = new Session()
    s.name = name
    s.tmuxName = `${name}-${LABEL}`.replace(/[^\w-]/g, '-')
    // A socket lies under a herdr home, and its path must be short.
    s.home = makeHome(herdr ? 'fp-os-' : 'fp-onscreen-home-', CWD, herdr ? '/tmp' : undefined)
    const bin = join(s.home, 'bin')
    mkdirSync(bin)
    s.log = join(EVIDENCE, `${name}-calls.log`)
    writeFileSync(s.log, '')
    s.server = await metrics(s.log)
    const address = `http://127.0.0.1:${s.server.address().port}`
    const all = { ...ANSWERS, ix: [['config get observability.prometheusUrl', address], ['config get observability.grafanaUrl', 'http://grafana.invalid']] }
    if (herdr) delete all.herdr
    for (const [command, answers] of Object.entries(all)) writeStub(bin, s.log, command, answers)
    writeStub(bin, s.log, 'tmux', [], REAL.tmux)
    s.env = sessionEnv(s.home, { PATH: `${bin}:${process.env.PATH}`, CLAUDE_CODE_NO_FLICKER: String(flicker), ...(viewCheck ? {} : { FACTORY_PANEL_VIEW_CHECK: 'off' }) })
    s.phases = []
    s.forget = atEnd(() => {
      if (s.stop()) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
    })
    const claude = `claude --plugin-dir ${quoted(PLUGIN)}`
    if (herdr) await s.startHerdr(bin, claude)
    // tmux's own variables are passed on, as a person's session in tmux has them.
    else s.tmux('new-session', '-d', '-s', s.tmuxName, '-x', '200', '-y', '80', '-c', CWD, `env -i ${assigned(s.env)} TMUX="$TMUX" TMUX_PANE="$TMUX_PANE" ${claude}`)
    return s
  }
  tmux(...args) {
    return execFileSync(REAL.tmux, ['-L', SESSIONS, ...args], { encoding: 'utf8', timeout: COMMAND_MS })
  }
  /** Starts a herdr server in the session's home, a client of it in tmux, and `claude` in the first of two tabs. */
  async startHerdr(bin, claude) {
    const binary = which('herdr')
    writeStub(bin, this.log, 'herdr', [], binary)
    mkdirSync(join(this.home, '.config', 'herdr'), { recursive: true })
    writeFileSync(join(this.home, '.config', 'herdr', 'config.toml'), 'onboarding = false\n[update]\nversion_check = false\nmanifest_check = false\n')
    // Nothing of a herdr this check may itself be running in: its variables are not passed on.
    const env = { ...this.env, SHELL: '/bin/sh' }
    this.herdr = (...args) => execFileSync(binary, args, { encoding: 'utf8', env, timeout: COMMAND_MS })
    const out = openSync(join(this.home, 'herdr-server.out'), 'a')
    this.daemon = spawn(binary, ['server'], { env, stdio: ['ignore', out, out] })
    for (let i = 0; i < 40 && !/status: running/.test(this.herdr('status')); i++) await sleep(500)
    if (!this.herdr('status').includes(`socket: ${this.home}/`)) throw new Error('the herdr server of the check is not the one answering')
    this.herdr('integration', 'install', 'claude')
    const made = JSON.parse(this.herdr('workspace', 'create', '--label', 'check', '--cwd', CWD, '--focus')).result
    this.pane = made.root_pane.pane_id
    this.herdr('tab', 'create', '--workspace', made.root_pane.workspace_id, '--label', 'elsewhere', '--no-focus')
    this.tmux('new-session', '-d', '-s', this.tmuxName, '-x', '200', '-y', '50', '-c', CWD, `env -i ${assigned(env)} ${quoted(binary)}`)
    await sleep(3000)
    this.herdr('pane', 'send-text', this.pane, `cd ${quoted(CWD)} && env ${assigned(env)} ${claude}`)
    this.herdr('pane', 'send-keys', this.pane, 'Enter')
  }
  /** What herdr reports of the session in the pane `claude` was started in. */
  reported() {
    return JSON.parse(this.herdr('api', 'snapshot')).result.snapshot.panes.find(p => p.pane_id === this.pane)?.agent_session?.value
  }
  screen() {
    return this.tmux('capture-pane', '-p', '-t', this.tmuxName).replace(/[ \t]+$/gm, '')
  }
  save(label) {
    writeFileSync(join(EVIDENCE, `${this.name}-${label}.txt`), this.screen())
  }
  type(text) {
    this.tmux('send-keys', '-t', this.tmuxName, '-l', text)
  }
  key(name) {
    this.tmux('send-keys', '-t', this.tmuxName, name)
  }
  async command(text) {
    this.type(text)
    await sleep(500)
    this.key('Enter')
    await sleep(2000)
  }
  /** Clicks the first place `pattern` matches on screen, just after its first group. */
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
  /** Lets a phase run. Returns the reads logged since its mark by source, and those after its settling seconds. */
  async phase({ label, from }) {
    const started = Date.now()
    await sleep(PHASE_SECS * 1000)
    this.save(label.replace(/\W+/g, '-'))
    const lines = readFileSync(this.log, 'utf8').slice(from).split('\n').filter(l => l !== '' && !l.startsWith('#') && !NOT_THE_MOD.has(sourceOf(l)))
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
    console.log(`${this.name} ${label}: ${lines.length} reads in ${PHASE_SECS}s ${JSON.stringify(counts)}; per minute after ${SETTLING_SECS}s ${JSON.stringify(perMinute)}`)
    return { counts, steady }
  }
  stop() {
    endSession(SESSIONS, this.tmuxName)
    if (this.daemon === undefined) return false
    try {
      this.herdr('server', 'stop')
    } catch {}
    this.daemon.kill()
    this.daemon = undefined
    return true
  }
  async end() {
    // What ran in herdr's panes is given a moment to finish writing under the home.
    if (this.stop()) await sleep(5000)
    this.server?.close()
    removeHome(this.home)
    this.forget()
  }
}

const only = (counts, allowed) => Object.keys(counts).every(source => allowed.includes(source))
const none = counts => Object.keys(counts).length === 0
const has = (counts, sources) => sources.every(source => (counts[source] ?? 0) > 0)
const json = JSON.stringify

const TABS = /Factory\s+Focus\s+Work\s+Escalations\s+\S+\s+Team/
const BAND_SOURCES = ['prometheus query', 'agent-msg work', 'ix-board agents', 'ix-board focus']
const TEAM_SOURCES = ['prometheus range', 'prometheus query', 'ix-board retro delta', 'ix-board retro eval', 'ix-board fleet']
/** The band's work cell: the two tickets of the stand-in lead, of one lead of the two listed, and their one open PR. */
const WORK_CELL = /≥2 tickets \(1\/2 leads\) · ≥1 PR open/

// ---------------------------------------------------------------- the scenarios

async function fullscreen(s) {
  if (!(await s.waitFor(t => TABS.test(t), 60000))) throw new Error(`no docked panel:\n${s.screen()}`)
  await sleep(3000)
  // The Factory tab is put on view first; what the panes read while they opened is not counted.
  check('fullscreen: the Factory tab can be clicked', s.click(/(│ )Factory\s+Focus/))
  await sleep(2000)
  const open = (await s.phase(s.mark('panel open on Factory'))).counts
  check('fullscreen: the Factory tab reads its sources', has(open, ['prometheus query', 'herdr snapshot', 'agent-msg doctor']), json(open))
  check('fullscreen: and nothing of the other tabs', only(open, ['prometheus query', 'herdr snapshot', 'agent-msg doctor', 'agent-msg whoami', 'ix-board agents']), Object.keys(open).join(', '))
  check('fullscreen: the machine the metrics service answered is on screen', /standin-host/.test(s.screen()))

  const worked = s.mark('switched to the Work tab')
  check('fullscreen: the Work tab can be clicked', s.click(/(Factory\s+Focus\s+)Work/))
  await sleep(4000)
  const work = (await s.phase(worked)).counts
  check('fullscreen: the Work tab reads the leads’ work reports and events', has(work, ['agent-msg work']), json(work))
  check('fullscreen: the lead and its ticket are on screen', /draco:QSL:code/.test(s.screen()) && /QSL-1/.test(s.screen()), s.screen().slice(0, 600))
  check('fullscreen: the ticket no focus status names was read from ix-board issues and drawn with its title', has(work, ['ix-board issues']) && /QSL-3 Stand-in/.test(s.screen()), s.screen().slice(0, 900))
  check('fullscreen: the lead with no report is counted in one line', /▸ 1 lead reports no work/.test(s.screen()), s.screen().slice(0, 900))
  check('fullscreen: the Recent toggle can be clicked', s.click(/()a all/))
  check('fullscreen: Recent then lists the review that started', await s.waitFor(t => /review start\s+QSL-1/.test(t), 10000), s.screen())

  const teamed = s.mark('switched to the Team tab')
  check('fullscreen: the Team tab can be clicked', s.click(/(Factory\s+Focus\s+Work\s+Escalations\s+\S+\s+)Team/))
  await sleep(4000)
  const team = (await s.phase(teamed)).counts
  check('fullscreen: the Team tab reads its sources', has(team, ['prometheus range', 'prometheus query', 'ix-board fleet']), json(team))
  // The retro reads keep their answer for minutes: the one made while the panes opened may still stand.
  const everRead = new Set(readFileSync(s.log, 'utf8').split('\n').filter(l => l !== '' && !l.startsWith('#')).map(sourceOf))
  check('fullscreen: the retro health and the role evaluation were read', ['ix-board retro delta', 'ix-board retro eval'].every(source => everRead.has(source)), [...everRead].join(', '))
  check('fullscreen: and no source of another tab', only(team, ['ix config', 'agent-msg whoami', ...TEAM_SOURCES]), Object.keys(team).join(', '))
  const drawn = s.screen()
  s.save('team')
  check('fullscreen: the retro health, the role and the capacity are on screen', /Health · QSL/.test(drawn) && /Roles · QSL/.test(drawn) && /standin-coder/.test(drawn) && /Capacity/.test(drawn) && /standin-host/.test(drawn) && /80% of/.test(drawn), drawn)
  check('fullscreen: a deficit with no series says so', /Prometheus has no ix_fleet_ready_buffer_deficit/.test(drawn), drawn)

  const switched = s.mark('switched to the Message tab')
  check('fullscreen: the Message tab can be clicked', s.click(/(Factory\s+Focus\s+Work\s+Escalations\s+)\S+\s+Team/))
  const other = (await s.phase(switched)).counts
  check('fullscreen: the Message tab reads its own sources', has(other, ['agent-msg log', 'agent-msg who']), json(other))
  check('fullscreen: and no source of another tab', only(other, ['agent-msg log', 'agent-msg who']), Object.keys(other).join(', '))
  check('fullscreen: the broadcast that was read is on screen', /stand-in broadcast/.test(s.screen()))

  s.key('C-o')
  await sleep(5000)
  const covered = (await s.phase(s.mark('detailed transcript over the panel'))).counts
  check('fullscreen: the transcript view covers the panel', !TABS.test(s.screen()))
  check('fullscreen: nothing is read while it does', none(covered), json(covered))
  s.key('Escape')
  check('fullscreen: the panel is back after the transcript view', await s.waitFor(t => TABS.test(t), 10000), s.screen())

  // Each close mark closes the tab on view; six close the panel.
  let closes = 0
  for (let i = 0; i < 6; i++) {
    if (!s.click(/()✕/)) break
    closes++
    await sleep(1500)
  }
  check('fullscreen: a close mark was clicked', closes > 0, `${closes} clicks`)
  check('fullscreen: the panel is closed', await s.waitFor(t => !/✕/.test(t) && !TABS.test(t), 5000), s.screen())
  await sleep(5000)
  const closed = (await s.phase(s.mark('panel closed'))).counts
  check('fullscreen: nothing is read with the panel closed', none(closed), json(closed))
}

async function classic(s) {
  if (!(await s.waitFor(t => /^\s*1: /m.test(t), 60000))) throw new Error(`no band:\n${s.screen()}`)
  // Counted from the start of the session: what the band asks as it appears is part of it.
  const band = (await s.phase({ label: 'band only', from: 0 })).counts
  check('classic: the band reads for its local, focus, lead, lanes and work cells', has(band, [...BAND_SOURCES, 'ix-board issues']), json(band))
  check('classic: and nothing else', only(band, ['ix config', 'agent-msg whoami', 'agent-msg who', 'ix-board roadmap', 'ix-board project-chunk', 'ix-board issues', ...BAND_SOURCES]), Object.keys(band).join(', '))
  check('classic: the work cell is on screen', WORK_CELL.test(s.screen()), s.screen().split('\n').filter(l => /^\s*1: /.test(l)).join('\n'))
  // The focus cell names the one project of the stand-in focus; the lanes cell counts its one agent.
  check('classic: the focus and lanes that were read are on screen', /Payments ledger/.test(s.screen()) && /1 working/.test(s.screen()))
  const opened = s.mark('popup open on Escalations')
  await s.command('/factory escalations')
  const popup = (await s.phase(opened)).counts
  check('classic: the popup adds its own sources', has(popup, ['agent-msg escalations', 'agent-msg escalation show']), json(popup))
  check('classic: the escalation that was read is on screen', /ENG-1/.test(s.screen()))
  s.key('Escape')
  await sleep(5000)
  const shut = (await s.phase(s.mark('popup closed'))).counts
  check('classic: the closed popup is read no more', (shut['agent-msg escalations'] ?? 0) === 0 && (shut['agent-msg escalation show'] ?? 0) === 0, json(shut))
  check('classic: and the band keeps reading', has(shut, ['prometheus query', 'agent-msg work']), json(shut))
  s.key('C-x')
  s.key('C-a')
  await sleep(5000)
  const collapsed = (await s.phase(s.mark('band collapsed'))).counts
  check('classic: nothing is read with the band collapsed and no pane', none(collapsed), json(collapsed))
}

/** The band of a classic session in tmux, with the mod's view check on. */
async function tmuxViewed(s) {
  // Nothing has been read for it, so there may be no cell yet: the prompt says the session is up.
  if (!(await s.waitFor(t => /❯/.test(t), 60000))) throw new Error(`no prompt:\n${s.screen()}`)
  await sleep(5000)
  const detached = (await s.phase({ label: 'nobody attached', from: 0 })).steady
  check('tmux: with nobody attached only the view check runs', only(detached, ['tmux view check']), json(detached))
  const attach = s.mark('attached')
  execFileSync(REAL.tmux, ['-L', VIEWERS, 'new-session', '-d', '-s', 'viewer', '-x', '200', '-y', '50', `env -u TMUX ${quoted(REAL.tmux)} -L ${SESSIONS} attach -t ${s.tmuxName}`], { timeout: COMMAND_MS })
  const attached = (await s.phase(attach)).counts
  check('tmux: attached, the band reads', has(attached, BAND_SOURCES), json(attached))
  check('tmux: and shows what it read', /Payments ledger/.test(s.screen()) && /1 working/.test(s.screen()))
  const detach = s.mark('detached again')
  endSession(VIEWERS, 'viewer')
  const again = (await s.phase(detach)).steady
  check('tmux: detached again only the view check runs', only(again, ['tmux view check']), json(again))
}

/** A session in a herdr tab: on view, behind the other tab, back. `s.herdr snapshot` lines are the view check and the Factory read. */
async function herdrTab(s, layout) {
  const ready = layout === 'fullscreen' ? t => TABS.test(t) : t => /1: /.test(t)
  if (!(await s.waitFor(ready, 90000))) throw new Error(`no ${layout} view in the herdr pane:\n${s.screen()}`)
  for (let i = 0; i < 60 && s.reported() === undefined; i++) await sleep(500)
  check(`herdr ${layout}: herdr's Claude integration reported the session`, s.reported() !== undefined)
  if (layout === 'fullscreen') check(`herdr ${layout}: the Factory tab can be clicked`, s.click(/(│ )Factory\s+Focus/))
  await sleep(5000)
  const reads = layout === 'fullscreen' ? ['prometheus query', 'agent-msg doctor'] : BAND_SOURCES.filter(x => x !== 'agent-msg work' && !x.startsWith('ix-board'))
  const shown = (await s.phase(s.mark('tab on view'))).counts
  check(`herdr ${layout}: on view it reads`, has(shown, reads), json(shown))
  const away = s.mark('behind another tab')
  check(`herdr ${layout}: the other tab can be clicked`, s.click(/()elsewhere/))
  const hidden = (await s.phase(away)).steady
  check(`herdr ${layout}: behind another tab only the view check runs`, only(hidden, ['herdr snapshot']), json(hidden))
  check(`herdr ${layout}: at most once in 15 seconds`, (hidden['herdr snapshot'] ?? 0) <= Math.ceil((PHASE_SECS - SETTLING_SECS) / 15), json(hidden))
  const back = s.mark('back on view')
  // The tab of the session is the numbered one left of the other.
  check(`herdr ${layout}: its tab can be clicked`, s.click(/( )1\s+elsewhere/))
  const returned = (await s.phase(back)).counts
  check(`herdr ${layout}: back on view it reads again`, has(returned, reads), json(returned))
}

const SCENARIOS = {
  fullscreen: [{ flicker: 1, viewCheck: false }, fullscreen],
  classic: [{ flicker: 0, viewCheck: false }, classic],
  tmux: [{ flicker: 0, viewCheck: true }, tmuxViewed],
  'herdr-fullscreen': [{ flicker: 1, viewCheck: true, herdr: true }, s => herdrTab(s, 'fullscreen')],
  'herdr-classic': [{ flicker: 0, viewCheck: true, herdr: true }, s => herdrTab(s, 'classic')],
}

const wanted = process.argv[4]?.split(',') ?? Object.keys(SCENARIOS)
const report = {}
// The scenarios run side by side, each with its own home, stand-ins, log and metrics service.
await Promise.all(
  wanted.map(async (name, i) => {
    const [options, run] = SCENARIOS[name]
    let s
    try {
      await sleep(i * 2000)
      s = await Session.start(name, options)
      await run(s)
    } catch (error) {
      check(`${name}: ran to the end`, false, String(error?.message ?? error))
      try {
        s?.save('failed')
      } catch {}
    } finally {
      report[name] = s?.phases
      await s?.end()
    }
  }),
)

writeFileSync(join(EVIDENCE, 'results.json'), `${JSON.stringify({ plugin: PLUGIN, phaseSeconds: PHASE_SECS, results, phases: report }, null, 2)}\n`)
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; logs and captures in ${EVIDENCE}`)
process.exit(failed.length === 0 ? 0 : 1)
