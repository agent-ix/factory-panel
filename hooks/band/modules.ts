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

export type Snapshot = {
  machines: readonly Machine[]
  relay: RelayView
  board: BoardView
  focuses: readonly FocusView[]
  escalations: readonly Escalation[]
  hiddenEscalations: readonly string[]
  /** Short name of the machine this session runs on, lower-case; '' when unknown. */
  localMachine: string
  teams: readonly string[]
  /** The Team view's tiles per team. */
  teamViews: readonly TeamView[]
  /** Which focus the bar follows: an address or part of a summary; '' for the first. */
  focusName: string
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

const pickFocus = (s: Snapshot): FocusView | undefined => {
  const want = s.focusName.trim().toLowerCase()
  if (want === '') return s.focuses[0]
  return s.focuses.find(f => f.address.toLowerCase() === want || f.summary.toLowerCase().includes(want)) ?? s.focuses[0]
}

const progressOf = (f: FocusView): { done: number; total: number; inProgress: number } =>
  f.projects.reduce(
    (a, p) => ({ done: a.done + p.done, total: a.total + p.total, inProgress: a.inProgress + p.inProgress }),
    { done: 0, total: 0, inProgress: 0 },
  )

const health = (s: Snapshot): Cell | null => {
  if (s.machines.length === 0) return { id: 'health', pane: 'factory', parts: [{ text: 'hosts —', tone: 'inactive' }], alert: s.prometheusError ?? undefined }
  const parts: Part[] = []
  const down: string[] = []
  for (const m of s.machines) {
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
  if (s.focuses.length > 1) parts.push({ text: ` +${s.focuses.length - 1}`, dim: true })
  return { id: 'focus', pane: 'focus', parts, alert: f.error ?? undefined }
}

const queue = (s: Snapshot): Cell | null => {
  const f = pickFocus(s)
  if (f === undefined) return null
  const { inProgress } = progressOf(f)
  return { id: 'queue', pane: 'focus', parts: [{ text: `${f.ready} ready`, tone: f.ready > 0 ? 'warning' : undefined }, { text: ` · ${inProgress} doing`, dim: true }] }
}

const lead = (s: Snapshot): Cell | null => {
  const f = pickFocus(s)
  if (f === undefined) return null
  const agent = s.board.agents.find(a => a.agent === f.address)
  const status = agent?.status ?? ''
  const tone: Tone = status === 'working' ? 'claude' : status === 'idle' ? 'warning' : 'inactive'
  const mark = status === 'working' ? '◐' : status === 'idle' ? '◌' : '○'
  return { id: 'lead', pane: 'focus', parts: [{ text: 'lead ', dim: true }, { text: `${f.address} ` }, { text: mark, tone }] }
}

const lanes = (s: Snapshot): Cell | null => {
  const mine = s.teams.length === 0 ? s.board.agents : s.board.agents.filter(a => s.teams.includes(a.team))
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
  if (s.machines.length === 0) return null
  const sum = (pick: (m: Machine) => number) => s.machines.reduce((a, m) => a + pick(m), 0)
  return { id: 'agents', pane: 'factory', parts: [{ text: `${sum(m => m.panesWorking)} working`, tone: 'claude' }, { text: ` · ${sum(m => m.panesIdle)} idle`, dim: true }] }
}

const spend = (s: Snapshot): Cell | null => {
  const known = s.machines.filter(m => m.spend24hUsd !== null)
  if (known.length === 0) return null
  return { id: 'spend', pane: 'factory', parts: [{ text: `${usd(known.reduce((a, m) => a + (m.spend24hUsd ?? 0), 0))} / 24h`, dim: true }] }
}

const BUILDERS: Record<ModuleId, (s: Snapshot) => Cell | null> = { health, local, focus, queue, lead, lanes, attention, relay, team, agents, spend }

/** Digits 1 to 9 go to the cells in the order drawn; a cell past the ninth has none. */
export const MAX_DIGITS = 9
export const digitFor = (index: number): string | undefined => (index < MAX_DIGITS ? String(index + 1) : undefined)

/** The cells for the listed modules, in order; a module with nothing to say is left out. */
export const buildCells = (ids: readonly ModuleId[], s: Snapshot): Cell[] =>
  ids.flatMap(id => {
    const cell = BUILDERS[id](s)
    return cell === null ? [] : [cell]
  })
