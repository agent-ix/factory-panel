import { expect, test } from 'claude-code/testing'

import { MODULE_IDS, buildCells, machineTone } from '../hooks/band/modules'
import { boardOf } from '../hooks/work'
import type { Snapshot } from '../hooks/band/modules'
import type { Machine, TeamView, WorkBoard, WorkLead } from '../types'
import { trace } from './trace'

const machine = (name: string, extra: Partial<Machine> = {}): Machine => ({
  name,
  lastSeenSecs: 5,
  leads: 1,
  panesWorking: 3,
  panesIdle: 2,
  panesDone: 1,
  cpuPct: 30,
  memPct: 40,
  tempC: 55,
  spend24hUsd: 12,
  ...extra,
})

const NOW = Date.UTC(2026, 10, 24, 12, 0)
const HOUR = 3_600_000

/** A lead whose agents report these tickets. */
const workLead = (address: string, ...tickets: string[]): WorkLead => ({ address, status: 'running', reportedAt: NOW, agents: tickets.map((ticket, i) => ({ name: `a${i}`, ticket, role: 'coder', status: 'running', reportedAt: NOW })) })
const openPr = (number: number, status = 'open') => ({ url: `https://github.com/agent-ix/x/pull/${number}`, repo: 'agent-ix/x', number, status, draft: status === 'draft' })
const merge = (ago: number, number: number) => ({ at: NOW - ago * HOUR, kind: 'merged' as const, identifier: `QSL-${number}`, title: 't', project: 'p', repo: 'agent-ix/x', number })
/** Two tickets with two open PRs between them (one shared, one draft), one merged PR, and merges 1, 23 and 25 hours old. */
const board = (): WorkBoard => ({
  issues: [
    { identifier: 'QSL-1', title: 'one', state: 'Coding', prs: [openPr(1), openPr(2, 'draft'), openPr(3, 'merged')] },
    { identifier: 'QSL-2', title: 'two', state: 'Coding', prs: [openPr(1)] },
    { identifier: 'QSL-9', title: 'nobody reports it', state: 'Coding', prs: [openPr(9)] },
  ],
  activity: [merge(1, 5), merge(23, 6), merge(25, 7)],
})
const workState = (over: Partial<Snapshot['work']> = {}): Snapshot['work'] => ({ leads: [workLead('hub:QSL:code', 'QSL-1', 'QSL-2')], at: NOW, relayError: null, listed: 1, unread: 0, boards: [board()], ...over })

const row = (name: string, done: number, total: number, inProgress: number) => ({ key: `project:${name}`, ref: name, id: name, name, failed: false, done, total, inProgress, ready: 0, blocked: 0, at: null, old: false, stages: null })
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  machines: [machine('draco'), machine('luna', { cpuPct: 74, lastSeenSecs: 600 }), machine('titan', { lastSeenSecs: null })],
  relay: { ok: true, redis: 'ok', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] },
  board: { teams: ['QSL'], agents: [{ team: 'QSL', agent: 'hub:QSL:code', status: 'working', machine: 'draco', paneId: 'p1', title: '', lastTurnAgeSecs: 3 }, { team: 'QSL', agent: 'x', status: 'idle', machine: 'draco', paneId: 'p2', title: '', lastTurnAgeSecs: 3 }], error: null },
  focuses: [
    {
      address: 'hub:QSL:code',
      machine: 'draco',
      kind: 'claude',
      summary: 'QSL layer 4',
      status: 'working',
      scope: { initiatives: 0, projects: 2, tickets: 0 },
      focusReportedAt: null,
      fetchedAt: null,
    initiatives: [],
    loose: [row('ledger', 5, 10, 2), row('export', 5, 10, 1)],
    header: { done: 10, total: 20, inProgress: 3, remaining: 10, ready: 4, blocked: 0, stages: [], counted: 2, enumerated: 2, notExpanded: 0, partial: false, oldestAt: null, complete: false },
    warnings: [],
    title: null,
    via: null,
    notes: [],
    },
  ],
  escalations: [],
  hiddenEscalations: [],
  localMachine: 'draco',
  scope: { hosts: 'all', focus: 'own', teams: ['QSL'], ownTeam: 'QSL', teamsSelected: false, identity: 'detected' },
  teamViews: [],
  focusesLoaded: true,
  boardLoaded: true,
  prometheusError: null,
  relayAt: 1,
  relayError: null,
  boardError: null,
  now: NOW,
  work: workState(),
  ...over,
})

const text = (cells: ReturnType<typeof buildCells>, id: string): string =>
  cells.find(c => c.id === id)?.parts.map(p => p.text).join('') ?? ''

test('a machine reads up, degraded, down or unknown from what its watcher last said', () => {
  trace("FR-006-AC-1", "FR-006-AC-2")
  expect(machineTone(machine('a'))).toBe('success')
  expect(machineTone(machine('a', { cpuPct: 95 }))).toBe('warning')
  expect(machineTone(machine('a', { lastSeenSecs: 600 }))).toBe('error')
  expect(machineTone(machine('a', { lastSeenSecs: null }))).toBe('inactive')
  expect(machineTone(machine('a', { lastSeenSecs: null }))).not.toBe('success')
  expect(machineTone(machine('a', { lastSeenSecs: 600 }))).toBe('error')
})

test('health lists every machine with a mark, and says which are not reporting', () => {
  trace("FR-006-AC-3", "FR-006-AC-8")
  const [cell] = buildCells(['health'], snapshot())
  expect(text([cell!], 'health')).toMatch(/● draco/)
  expect(text([cell!], 'health')).toMatch(/○ titan/)
  expect(cell?.alert).toBe('luna not reporting')
  // No data is grey and says so; it is never drawn as healthy.
  const [none] = buildCells(['health'], snapshot({ machines: [], prometheusError: 'prometheus: timed out' }))
  expect(none?.parts[0]?.tone).toBe('inactive')
  expect(none?.alert).toBe('prometheus: timed out')
  expect(none?.parts.map(p => p.text).join('')).toBe('hosts —')
})

test('local shows this machine only', () => {
  expect(text(buildCells(['local'], snapshot()), 'local')).toBe('CPU 30%  Mem 40%  55°')
  expect(text(buildCells(['local'], snapshot({ localMachine: 'nowhere' })), 'local')).toBe('local —')
})

test('focus draws one bar for the whole focus, and +N when there are more', () => {
  expect(text(buildCells(['focus'], snapshot()), 'focus')).toBe('QSL layer 4 ████░░░░ 50%'.replace('████░░░░', '████░░░░'))
  const two = snapshot()
  const more = snapshot({ focuses: [...two.focuses, { ...two.focuses[0]!, address: 'hub:ENG:arch', summary: 'Payments' }], scope: { hosts: 'all', focus: 'team', teams: ['QSL', 'ENG'], ownTeam: 'QSL', teamsSelected: false, identity: 'detected' } })
  expect(text(buildCells(['focus'], more), 'focus')).toMatch(/ \+1$/)
  expect(text(buildCells(['focus'], snapshot({ scope: { hosts: 'all', focus: 'layer 4', teams: ['QSL'], ownTeam: 'QSL', teamsSelected: false, identity: 'detected' } })), 'focus')).toMatch(/50%/)
})

test('modules with nothing to say drop out of the band', () => {
  const cells = buildCells(['attention', 'relay', 'queue'], snapshot())
  expect(cells.map(c => c.id)).toEqual(['queue'])
  expect(text(cells, 'queue')).toBe('4 ready · 3 doing')
})

test('attention counts open escalations only, and a broken relay is a warning with detail', () => {
  const esc = (id: string, status: 'waiting' | 'resolved') => ({ id, status, ticket: '', lead: '', filed: '', machine: '', kind: '', context: '', options: [], recommendation: '', decision: '', hasDetail: false })
  const s = snapshot({ escalations: [esc('a', 'waiting'), esc('b', 'waiting'), esc('c', 'resolved')], hiddenEscalations: ['b'] })
  expect(text(buildCells(['attention'], s), 'attention')).toBe('⚑ 1 escalation')
  const broken = snapshot({ relay: { ok: false, redis: 'down', watchers: [], warnings: 1, deadLetters: 0, inboxWaiting: 0, checks: [] } })
  expect(buildCells(['relay'], broken)[0]?.alert).toBe('relay: down')
})

test('lead and lanes come from the board', () => {
  expect(text(buildCells(['lead'], snapshot()), 'lead')).toBe('lead hub:QSL:code ◐')
  expect(text(buildCells(['lanes'], snapshot()), 'lanes')).toBe('1 working · 1 idle')
})

test('each press target is the pane that holds the full view', () => {
  const cells = buildCells(['health', 'focus', 'attention'], snapshot({ escalations: [{ id: 'a', status: 'waiting', ticket: '', lead: '', filed: '', machine: '', kind: '', context: '', options: [], recommendation: '', decision: '', hasDetail: false }] }))
  expect(cells.map(c => c.pane)).toEqual(['factory', 'focus', 'escalations'])
})

test('local does not draw old numbers as current, and relay is quiet until it has been asked', () => {
  trace("FR-006-AC-4", "FR-006-AC-5", "FR-006-AC-7")
  const stale = snapshot({ machines: [machine('draco', { lastSeenSecs: 900 })] })
  expect(text(buildCells(['local'], stale), 'local')).toBe('draco ▲ no data')
  expect(text(buildCells(['local'], stale), 'local')).not.toMatch(/%/)
  expect(buildCells(['local'], stale)[0]?.alert).toBe('draco is not reporting')
  expect(buildCells(['relay'], snapshot({ relayAt: null }))).toEqual([])
  const failed = snapshot({ relayError: 'redis down' })
  expect(buildCells(['relay'], failed)[0]?.alert).toBe('relay: redis down')
  expect(buildCells(['lanes'], snapshot({ boardError: 'timed out' }))[0]?.alert).toBe('ix-board: timed out')
})

const teamView = (team: string, value: number | null): TeamView =>
  ({ team, metrics: [{ key: 'closures', label: 'Verified closures · 24h', unit: 'count', better: 'up', value, history: [] }] }) as never

test('the team cell shows the first tile of the first team and is left out when no team has a reading', () => {
  trace("FR-009-AC-7")
  const cells = buildCells(['team'], snapshot({ teamViews: [teamView('ENG', 7), teamView('QSL', 3)] }))
  expect(text(cells, 'team')).toBe('ENG Verified closures · 24h 7')
  // A team with no reading is skipped; the next team's first tile shows.
  expect(text(buildCells(['team'], snapshot({ teamViews: [teamView('ENG', null), teamView('QSL', 3)] })), 'team')).toBe('QSL Verified closures · 24h 3')
  expect(buildCells(['team'], snapshot({ teamViews: [] }))).toEqual([])
  expect(buildCells(['team'], snapshot({ teamViews: [teamView('ENG', null)] }))).toEqual([])
})

test('every module opens the view the module-to-view map names', () => {
  trace("FR-009-AC-6")
  const esc = { id: 'a', status: 'waiting' as const, ticket: '', lead: '', filed: '', machine: '', kind: '', context: '', options: [], recommendation: '', decision: '', hasDetail: false }
  const s = snapshot({
    escalations: [esc],
    relay: { ok: true, redis: 'ok', watchers: [], warnings: 0, deadLetters: 1, inboxWaiting: 2, checks: [] },
    teamViews: [teamView('ENG', 7)],
  })
  const cells = buildCells(MODULE_IDS, s)
  // Every module has something to say here, so none is missing from the check.
  expect(cells.map(c => c.id)).toEqual([...MODULE_IDS])
  const pane = Object.fromEntries(cells.map(c => [c.id, c.pane]))
  expect(pane).toEqual({
    health: 'factory',
    local: 'factory',
    lanes: 'factory',
    agents: 'factory',
    spend: 'factory',
    focus: 'focus',
    queue: 'focus',
    lead: 'focus',
    attention: 'escalations',
    relay: 'relay',
    team: 'team',
    work: 'work',
  })
})

const workText = (over: Partial<Snapshot['work']>) => text(buildCells(['work'], snapshot({ work: workState(over) })), 'work')

test('the work cell counts the leads’ tickets, their open and draft PRs once each, and the merges of 24 hours', () => {
  trace("FR-009-AC-9")
  expect(workText({})).toBe('2 tickets · 2 PRs open · 2 merged 24h')
  // A ticket two leads report is one ticket.
  expect(workText({ leads: [workLead('hub:QSL:code', 'QSL-1', 'QSL-2'), workLead('hub:QSL:arch', 'QSL-2')] })).toBe('2 tickets · 2 PRs open · 2 merged 24h')
  expect(workText({ leads: [workLead('hub:QSL:code', 'QSL-2')], boards: [{ ...board(), activity: [merge(2, 5)] }] })).toBe('1 ticket · 1 PR open · 1 merged 24h')
  // One PR that closed two tickets is one merge.
  expect(workText({ boards: [{ ...board(), activity: [merge(1, 5), { ...merge(1, 5), identifier: 'QSL-50' }, { ...merge(2, 6), repo: null, number: null }] }] })).toBe('2 tickets · 2 PRs open · 2 merged 24h')
  // No ticket reported is a real zero.
  expect(workText({ leads: [], boards: [{ issues: [], activity: [] }] })).toBe('0 tickets · 0 PRs open · 0 merged 24h')
})

test('the work cell reads a dash for what ix-board has not said and marks a PR count that is a lower bound', () => {
  trace("FR-009-AC-10")
  // No focus status read yet.
  expect(workText({ boards: [] })).toBe('2 tickets · — PRs open · — merged 24h')
  expect(workText({ leads: [], boards: [] })).toBe('0 tickets · — PRs open · — merged 24h')
  // An ix-board older than 0.9.0 says neither PRs nor activity.
  expect(workText({ boards: [{ issues: [{ identifier: 'QSL-1', title: 't', state: 'Coding', prs: null }], activity: null }] })).toBe('2 tickets · — PRs open · — merged 24h')
  // A ticket the focus status does not name: its PRs are unknown, so the count is at least this.
  expect(workText({ leads: [workLead('hub:QSL:code', 'QSL-1', 'ENG-4')] })).toBe('2 tickets · ≥2 PRs open · 2 merged 24h')
  expect(workText({ leads: [workLead('hub:QSL:code', 'ENG-4')] })).toBe('1 ticket · — PRs open · 2 merged 24h')
})

test('where ix-board cut its activity inside the last day the merges are a lower bound', () => {
  trace("FR-009-AC-14")
  const answer = (count: number, spacingMinutes: number) =>
    boardOf({ projects: [], activity: Array.from({ length: count }, (_, i) => ({ at: new Date(NOW - (i + 1) * spacingMinutes * 60_000).toISOString(), kind: 'merged', identifier: `QSL-${i}`, title: 't', project: 'p', pr: { url: 'u', repo: 'r', number: i } })) })
  // 200 entries is ix-board's cap: the oldest of these is under 7 hours old, so older merges of the day are missing.
  expect(workText({ leads: [], boards: [answer(200, 2)] })).toBe('0 tickets · 0 PRs open · ≥200 merged 24h')
  // Cut, but further back than a day: the day is whole.
  expect(workText({ leads: [], boards: [answer(200, 10)] })).toBe('0 tickets · 0 PRs open · 144 merged 24h')
  // Under the cap nothing was left out.
  expect(workText({ leads: [], boards: [answer(199, 2)] })).toBe('0 tickets · 0 PRs open · 199 merged 24h')
  // One cut answer among several leaves the sum short.
  expect(workText({ leads: [], boards: [answer(3, 60), answer(200, 2)] })).toMatch(/≥\d+ merged 24h$/)
})

test('with a lead’s report unread the tickets and PRs are lower bounds and the band says how many leads are missing', () => {
  trace("FR-009-AC-13")
  expect(workText({ listed: 3, unread: 2 })).toBe('≥2 tickets · ≥2 PRs open · 2 merged 24h')
  expect(buildCells(['work'], snapshot({ work: workState({ listed: 3, unread: 2 }) }))[0]?.alert).toBe('agent-msg work: 2 of 3 leads not read')
  expect(workText({ leads: [], listed: 3, unread: 1, boards: [] })).toBe('≥0 tickets · — PRs open · — merged 24h')
})

test('the work cell is left out until the relay has answered or failed, and says why where it failed', () => {
  trace("FR-009-AC-11", "FR-009-AC-12")
  expect(buildCells(['work'], snapshot({ work: workState({ at: null, leads: [] }) }))).toEqual([])
  // The leads held from an earlier read are not drawn as of now.
  const failed = snapshot({ work: workState({ relayError: 'redis down' }) })
  expect(text(buildCells(['work'], failed), 'work')).toBe('— tickets · — PRs open · 2 merged 24h')
  expect(buildCells(['work'], failed)[0]?.alert).toBe('agent-msg work: redis down')
  const never = snapshot({ work: workState({ at: null, leads: [], boards: [], relayError: 'redis down' }) })
  expect(text(buildCells(['work'], never), 'work')).toBe('— tickets · — PRs open · — merged 24h')
  // ix-board's trouble is the focus's warning.
  const focuses = snapshot().focuses.map(f => ({ ...f, warnings: [{ kind: 'source' as const, name: 'ix-board', text: 'ix-board: rate limited', id: null }] }))
  expect(buildCells(['work'], snapshot({ focuses, work: workState({ boards: [] }) }))[0]?.alert).toBe('ix-board: rate limited')
  expect(buildCells(['work'], snapshot())[0]?.alert).toBeUndefined()
})
