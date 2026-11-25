import { expect, test } from 'claude-code/testing'

import { MODULE_IDS, buildCells, machineTone } from '../hooks/band/modules'
import type { Snapshot } from '../hooks/band/modules'
import type { Machine, TeamView } from '../types'
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
  prometheusError: null,
  relayAt: 1,
  relayError: null,
  boardError: null,
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
  })
})
