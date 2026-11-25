import type { BoardView, Escalation, FocusView, Machine, RelayView, TeamView } from '../../types'
import { cellBar, loadColor, tempColor, usd } from '../ui/glyphs'

// The band's modules. Each is a pure function of a snapshot of what the panes already collected,
// so a test seeds a snapshot and reads the cell back. A module with nothing to say returns null
// and drops out of the band.

export type ModuleId = 'health' | 'local' | 'focus' | 'queue' | 'lead' | 'lanes' | 'attention' | 'relay' | 'team' | 'agents' | 'spend'

export const MODULE_IDS: readonly ModuleId[] = ['health', 'local', 'focus', 'queue', 'lead', 'lanes', 'attention', 'relay', 'team', 'agents', 'spend']

export type Tone = 'success' | 'warning' | 'error' | 'inactive' | 'claude'

export type Part = { text: string; tone?: Tone; dim?: boolean; bold?: boolean }

/** One module's cell: its text parts, the pane whose full view a press opens, and a detail line when it is not well. */
export type Cell = { id: ModuleId; pane: string; parts: Part[]; alert?: string }

/** What the selection narrows the band to; see FR-013. `teams` empty means every team. */
export type Scope = {
  hosts: 'all' | 'local'
  /** `own`, `team` or a focus name. */
  focus: string
  teams: readonly string[]
  /** The session's own team; null when the relay did not say. */
  ownTeam: string | null
  /** True when the user or a declaration named the teams, so one that matches nothing is worth saying. */
  teamsSelected: boolean
  identity: 'pending' | 'detected' | 'unknown'
}

export type Snapshot = {
  machines: readonly Machine[]
  relay: RelayView
  board: BoardView
  focuses: readonly FocusView[]
  escalations: readonly Escalation[]
  hiddenEscalations: readonly string[]
  /** Short name of the machine this session runs on, lower-case; '' when unknown. */
  localMachine: string
  scope: Scope
  /** The Team view's tiles per team. */
  teamViews: readonly TeamView[]
  /** True once the focus reports have been read, so a team that matches nothing can be said so. */
  focusesLoaded: boolean
  prometheusError: string | null
  /** When the relay check last answered (null: never) and what it last said when it failed. */
  relayAt: number | null
  relayError: string | null
  boardError: string | null
}

// A machine whose relay watcher has not pushed for this long reads as down.
const DOWN_AFTER_SECS = 120

export const machineTone = (m: Machine): Tone => {
  if (m.lastSeenSecs === null) return 'inactive'
  if (m.lastSeenSecs > DOWN_AFTER_SECS) return 'error'
  const worst = [loadColor(m.cpuPct), tempColor(m.tempC), loadColor(m.memPct)]
  return worst.includes('error') ? 'warning' : worst.includes('warning') ? 'warning' : 'success'
}

const pct = (n: number | null): string => (n === null ? '—' : `${Math.round(n)}%`)

const fit = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const teamOf = (address: string): string => address.split(':')[1] ?? ''

/** The teams whose lead entries may be read for this scope; null reads every lead (a focus name searches all). */
export const focusTeams = (scope: Scope): string[] | null => {
  const want = scope.focus.trim().toLowerCase()
  if (scope.identity === 'detected' && scope.ownTeam !== null) {
    if (want === 'own') return [scope.ownTeam]
    if (want === 'team') return [scope.ownTeam, ...scope.teams.filter(t => !same(t, scope.ownTeam!))]
    return null
  }
  return scope.teams.length > 0 ? [...scope.teams] : null
}

/** The focus entries this scope shows, in order, and a note when a name matched none or several. */
export const scopeFocuses = (all: readonly FocusView[], scope: Scope): { shown: FocusView[]; note: string | null } => {
  const want = scope.focus.trim()
  const lower = want.toLowerCase()
  const teams = focusTeams(scope)
  const inTeams = (f: FocusView) => teams === null || teams.some(t => same(t, teamOf(f.address)))
  if (lower === 'own' || lower === 'team') {
    // Grouped under each team, in the order the teams are listed.
    const shown = all.filter(inTeams)
    if (teams !== null) shown.sort((a, b) => teams.findIndex(t => same(t, teamOf(a.address))) - teams.findIndex(t => same(t, teamOf(b.address))))
    return { shown, note: null }
  }
  // A focus name: a session that could not be identified is first held to the teams it was given.
  const pool = scope.identity === 'detected' ? [...all] : all.filter(inTeams)
  const exact = pool.filter(f => same(f.summary, want))
  const shown = exact.length > 0 ? exact : pool.filter(f => f.summary.toLowerCase().includes(lower))
  const note = shown.length === 0 ? `no focus matches "${want}"` : shown.length > 1 ? `${shown.length} focuses matched "${want}"` : null
  return { shown, note }
}

const scoped = (s: Snapshot): FocusView[] => scopeFocuses(s.focuses, s.scope).shown
const pickFocus = (s: Snapshot): FocusView | undefined => scoped(s)[0]

/** Machines the hosts scope covers: every machine, or this one. */
const hostsOf = (s: Snapshot): readonly Machine[] =>
  s.scope.hosts === 'all' ? s.machines : s.machines.filter(m => m.name.toLowerCase() === s.localMachine)

/** What the scope has to say: who the session is, a focus name that matched none or several, a team nothing answers for. */
export const scopeNotes = (s: Snapshot): string[] => {
  const notes: string[] = []
  if (s.scope.identity === 'unknown') notes.push('could not tell who this session is')
  const { note } = scopeFocuses(s.focuses, s.scope)
  if (note !== null && s.focusesLoaded) notes.push(note)
  const known = new Set([...s.focuses.map(f => teamOf(f.address).toLowerCase()), ...s.board.agents.map(a => a.team.toLowerCase())])
  if (s.focusesLoaded || s.board.agents.length > 0)
    for (const t of s.scope.teams) if (s.scope.teamsSelected && !known.has(t.toLowerCase())) notes.push(`team ${t} matched nothing`)
  return notes
}

const progressOf = (f: FocusView): { done: number; total: number; inProgress: number } =>
  f.projects.reduce(
    (a, p) => ({ done: a.done + p.done, total: a.total + p.total, inProgress: a.inProgress + p.inProgress }),
    { done: 0, total: 0, inProgress: 0 },
  )

const health = (s: Snapshot): Cell | null => {
  const machines = hostsOf(s)
  if (machines.length === 0) return { id: 'health', pane: 'factory', parts: [{ text: 'hosts —', tone: 'inactive' }], alert: s.prometheusError ?? undefined }
  const parts: Part[] = []
  const down: string[] = []
  for (const m of machines) {
    const tone = machineTone(m)
    if (tone === 'error') down.push(m.name)
    parts.push({ text: tone === 'inactive' ? '○' : tone === 'warning' ? '▲' : '●', tone }, { text: ` ${m.name}  ` })
  }
  return { id: 'health', pane: 'factory', parts, alert: down.length > 0 ? `${down.join(', ')} not reporting` : undefined }
}

const local = (s: Snapshot): Cell | null => {
  const m = s.machines.find(x => x.name.toLowerCase() === s.localMachine)
  if (m === undefined) return { id: 'local', pane: 'factory', parts: [{ text: 'local —', tone: 'inactive' }] }
  // Numbers from a watcher that has gone quiet are old: say so instead of drawing them as current.
  if (m.lastSeenSecs === null || m.lastSeenSecs > DOWN_AFTER_SECS)
    return { id: 'local', pane: 'factory', parts: [{ text: `${m.name} ▲ no data`, tone: 'error' }], alert: `${m.name} is not reporting` }
  const parts: Part[] = [
    { text: 'CPU ', dim: true },
    { text: pct(m.cpuPct), tone: loadColor(m.cpuPct) },
    { text: '  Mem ', dim: true },
    { text: pct(m.memPct), tone: loadColor(m.memPct) },
  ]
  if (m.tempC !== null) parts.push({ text: `  ${Math.round(m.tempC)}°`, tone: tempColor(m.tempC) })
  const hot = loadColor(m.cpuPct) === 'error' || loadColor(m.memPct) === 'error' || tempColor(m.tempC) === 'error'
  return { id: 'local', pane: 'factory', parts, alert: hot ? `${m.name} is running hot` : undefined }
}

const focus = (s: Snapshot): Cell | null => {
  const f = pickFocus(s)
  if (f === undefined) return null
  const { done, total } = progressOf(f)
  const share = total > 0 ? done / total : null
  const label = f.projects.length === 1 ? (f.projects[0]?.name ?? f.address) : f.summary || f.address
  const parts: Part[] = [
    { text: `${fit(label, 18)} `, bold: true },
    { text: cellBar(share, 8), tone: 'claude' },
    { text: share === null ? ' —' : ` ${Math.round(share * 100)}%` },
  ]
  const count = scoped(s).length
  if (count > 1) parts.push({ text: ` +${count - 1}`, dim: true })
  return { id: 'focus', pane: 'focus', parts, alert: f.error ?? undefined }
}

const queue = (s: Snapshot): Cell | null => {
  const f = pickFocus(s)
  if (f === undefined) return null
  const { inProgress } = progressOf(f)
  return { id: 'queue', pane: 'focus', parts: [{ text: `${f.ready} ready`, tone: f.ready > 0 ? 'warning' : undefined }, { text: ` · ${inProgress} doing`, dim: true }] }
}

/** A lead's status from the agents of its work report: failed, else running, else waiting, else done, else unknown. */
export const statusOf = (agents: readonly { status?: string }[] | undefined): string => {
  const has = (status: string) => (agents ?? []).some(a => a.status === status)
  return has('failed') ? 'failed' : has('running') ? 'running' : has('waiting') ? 'waiting' : has('done') ? 'done' : 'unknown'
}

const MARKS: Record<string, { mark: string; tone: Tone }> = {
  working: { mark: '◐', tone: 'claude' },
  running: { mark: '◐', tone: 'claude' },
  idle: { mark: '◌', tone: 'warning' },
  waiting: { mark: '◌', tone: 'warning' },
  failed: { mark: '✕', tone: 'error' },
  done: { mark: '✓', tone: 'success' },
}

const lead = (s: Snapshot): Cell | null => {
  const f = pickFocus(s)
  if (f === undefined) return null
  const agent = s.board.agents.find(a => a.agent === f.address)
  const status = agent?.status ?? f.status
  const { mark, tone } = MARKS[status] ?? { mark: '○', tone: 'inactive' as Tone }
  return { id: 'lead', pane: 'focus', parts: [{ text: 'lead ', dim: true }, { text: `${f.address} ` }, { text: mark, tone }] }
}

const lanes = (s: Snapshot): Cell | null => {
  const teams = s.scope.teams
  const mine = teams.length === 0 ? s.board.agents : s.board.agents.filter(a => teams.some(t => same(t, a.team)))
  if (mine.length === 0) return null
  const count = (status: string) => mine.filter(a => a.status === status).length
  return {
    id: 'lanes',
    pane: 'factory',
    parts: [{ text: `${count('working')} working`, tone: 'claude' }, { text: ` · ${count('idle')} idle`, tone: count('idle') > 0 ? 'warning' : undefined }],
    alert: s.boardError === null ? undefined : `ix-board: ${s.boardError}`,
  }
}

const attention = (s: Snapshot): Cell | null => {
  const open = s.escalations.filter(e => e.status !== 'resolved' && !s.hiddenEscalations.includes(e.id)).length
  if (open === 0) return null
  return { id: 'attention', pane: 'escalations', parts: [{ text: `⚑ ${open} ${open === 1 ? 'escalation' : 'escalations'}`, tone: 'error', bold: true }] }
}

const relay = (s: Snapshot): Cell | null => {
  const r = s.relay
  if (s.relayAt === null && s.relayError === null) return null // not asked yet
  if (s.relayError !== null) return { id: 'relay', pane: 'relay', parts: [{ text: 'relay ▲', tone: 'warning' }], alert: `relay: ${s.relayError}` }
  if (!r.ok) return { id: 'relay', pane: 'relay', parts: [{ text: 'relay ▲', tone: 'warning' }], alert: `relay: ${r.redis || 'not ok'}` }
  const waiting = r.inboxWaiting + r.deadLetters
  if (waiting === 0) return null
  return { id: 'relay', pane: 'relay', parts: [{ text: `relay ${r.inboxWaiting} waiting`, tone: 'warning' }, { text: r.deadLetters > 0 ? ` · ${r.deadLetters} dead` : '', dim: true }] }
}

/** The first tile of the first team that has a reading: the one the Team view shows first. */
const team = (s: Snapshot): Cell | null => {
  for (const t of s.teamViews) {
    const tile = t.metrics.find(m => m.value !== null)
    if (tile !== undefined && tile.value !== null) {
      const value = tile.unit === 'seconds' ? `${Math.round(tile.value)}s` : Number.isInteger(tile.value) ? String(tile.value) : tile.value.toFixed(1)
      return { id: 'team', pane: 'team', parts: [{ text: `${t.team} ${tile.label} `, dim: true }, { text: value }] }
    }
  }
  return null
}

const agents = (s: Snapshot): Cell | null => {
  const machines = hostsOf(s)
  if (machines.length === 0) return null
  const sum = (pick: (m: Machine) => number) => machines.reduce((a, m) => a + pick(m), 0)
  return { id: 'agents', pane: 'factory', parts: [{ text: `${sum(m => m.panesWorking)} working`, tone: 'claude' }, { text: ` · ${sum(m => m.panesIdle)} idle`, dim: true }] }
}

const spend = (s: Snapshot): Cell | null => {
  const known = hostsOf(s).filter(m => m.spend24hUsd !== null)
  if (known.length === 0) return null
  return { id: 'spend', pane: 'factory', parts: [{ text: `${usd(known.reduce((a, m) => a + (m.spend24hUsd ?? 0), 0))} / 24h`, dim: true }] }
}

const BUILDERS: Record<ModuleId, (s: Snapshot) => Cell | null> = { health, local, focus, queue, lead, lanes, attention, relay, team, agents, spend }

/** Digits 1 to 9 go to the cells in the order drawn; a cell past the ninth has none. */
export const MAX_DIGITS = 9
export const digitFor = (index: number): string | undefined => (index < MAX_DIGITS ? String(index + 1) : undefined)

/** The cells for the listed modules, in order; a module with nothing to say is left out. */
export const buildCells = (ids: readonly string[], s: Snapshot): Cell[] =>
  ids
    .filter((id, i): id is ModuleId => (MODULE_IDS as readonly string[]).includes(id) && ids.indexOf(id) === i)
    .flatMap(id => {
      const cell = BUILDERS[id](s)
      return cell === null ? [] : [cell]
    })
