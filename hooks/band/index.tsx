import { atom, read } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import type { BoardView, Escalation, Freshness, FocusMeta, FocusView, Machine, RelayView, TeamView, WorkBoard, WorkLead, WorkMeta } from '../../types'
import { getSelection, takeBandNote, modulesToDraw, scopeOf } from '../selection'
import { errorText } from '../shared'
import type { Options } from '../shared'
import { showView, isViewId } from '../views'
import { buildCells, digitFor, scopeNotes } from './modules'
import type { Cell, ModuleId, Part, Snapshot, Tone } from './modules'

// The band: one row above the prompt for sessions that are not in the fullscreen layout, where a
// pane can only sit over the chat. Each module is a Button with a digit hotkey, so a bare digit at
// an empty prompt presses it; a press opens that module's full pane, focused, and Esc closes it.

// The values the panes keep, read by their state keys. The scan wants the plugin and key written
// as literals in this file, so these repeat the panes' atoms; each shape tag must match the one
// the pane writes under (a value stored under another tag reads as the initial one).
const machines = atom({ plugin: 'factory-panel', key: 'machines' } as const, [] as Machine[], { shape: 'machines-1' })
const relay = atom({ plugin: 'factory-panel', key: 'relay' } as const, { ok: true, redis: '', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] } as RelayView, { shape: 'relay-1' })
const board = atom({ plugin: 'factory-panel', key: 'board' } as const, { teams: [], agents: [], error: null } as BoardView, { shape: 'board-1' })
const freshness = atom({ plugin: 'factory-panel', key: 'freshness' } as const, { prometheusAt: null, prometheusError: null, nodeMetricsSeen: false, herdrAt: null, herdrError: null, relayAt: null, relayError: null, boardAt: null, boardBusy: false } as Freshness, { shape: 'freshness-1' })
const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], { shape: 'focuses-5' })
const focusMeta = atom({ plugin: 'factory-panel', key: 'focusMeta' } as const, { at: null, busy: false, error: null, errors: [] } as FocusMeta, { shape: 'focusMeta-2' })
const escalations = atom({ plugin: 'factory-panel', key: 'escalations' } as const, [] as Escalation[], { shape: 'escalations-1' })
const escalationHidden = atom({ plugin: 'factory-panel', key: 'escalationHidden' } as const, [] as string[])
const teamViews = atom({ plugin: 'factory-panel', key: 'teams' } as const, [] as TeamView[], { shape: 'teams-3' })
const workLeads = atom({ plugin: 'factory-panel', key: 'workLeads' } as const, [] as WorkLead[], { shape: 'workLeads-2' })
const workMeta = atom({ plugin: 'factory-panel', key: 'workMeta' } as const, { at: null, busy: false, error: null, relayError: null, listed: 0 } as WorkMeta, { shape: 'workMeta-3' })
const workBoards = atom({ plugin: 'factory-panel', key: 'workBoards' } as const, {} as Record<string, WorkBoard>, { shape: 'workBoards-1' })

// Facts learned at session start: the machine this session runs on.
let localMachine = ''
let lastStatus: string | undefined

/** Reads the host name. Never throws. */
export async function startBand($: EngineInterface): Promise<void> {
  try {
    const host = await $.process.run(['hostname', '-s'], { timeoutMs: 3000 })
    localMachine = host.stdout.trim().toLowerCase()
  } catch (error) {
    $.ui.log(`factory-panel: hostname failed: ${errorText(error)}`, { to: 'debug' })
  }
}

type ModuleState = { off: boolean; ids: readonly ModuleId[] }

/** The modules the selection lists, with the host list first where the hosts scope is `all`. */
export const bandPlan = (options: Options): ModuleState => ({
  off: options.inlineView === 'off',
  ids: modulesToDraw(getSelection()),
})

// A state key the panes have not written yet reads as an empty value of the wrong kind, so each
// is coerced to what the modules expect; the band draws from whatever has arrived.
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
const EMPTY_RELAY = { ok: true, redis: '', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] }

async function snapshot($: EngineInterface, options: Options): Promise<Snapshot> {
  const [fresh, rel, brd, mach, foc, esc, hid, tms, fmeta, wleads, wmeta, wboards, now] = await Promise.all([
    read($, freshness) as Promise<Partial<Freshness>>,
    read($, relay) as Promise<Partial<Snapshot['relay']>>,
    read($, board) as Promise<Partial<Snapshot['board']>>,
    read($, machines),
    read($, focuses),
    read($, escalations),
    read($, escalationHidden),
    read($, teamViews),
    read($, focusMeta) as Promise<Partial<FocusMeta>>,
    read($, workLeads),
    read($, workMeta) as Promise<Partial<WorkMeta>>,
    read($, workBoards) as Promise<Record<string, WorkBoard> | undefined>,
    $.clock.now(),
  ])
  return {
    machines: list(mach),
    relay: { ...EMPTY_RELAY, ...(rel ?? {}) },
    board: { teams: [], error: null, ...(brd ?? {}), agents: list(brd?.agents) },
    focuses: list(foc),
    escalations: list(esc),
    hiddenEscalations: list(hid),
    localMachine,
    scope: scopeOf(getSelection()),
    teamViews: list(tms),
    focusesLoaded: fmeta?.at !== undefined && fmeta.at !== null,
    boardLoaded: fresh?.boardAt !== undefined && fresh.boardAt !== null,
    prometheusError: fresh?.prometheusError ?? null,
    relayAt: fresh?.relayAt ?? null,
    relayError: fresh?.relayError ?? null,
    boardError: brd?.error ?? null,
    now,
    work: { leads: list(wleads), at: wmeta?.at ?? null, relayError: wmeta?.relayError ?? null, listed: wmeta?.listed ?? 0, boards: Object.values(wboards ?? {}) },
  }
}

async function cellsFor($: EngineInterface, options: Options, drawing = false): Promise<{ cells: Cell[]; notes: string[] }> {
  const plan = bandPlan(options)
  if (plan.off) return { cells: [], notes: [] }
  const snap = await snapshot($, options)
  // The one-time note about an ignored file or value (taken only by a band that is drawn), then what the scope has to say.
  const note = drawing ? takeBandNote() : undefined
  return { cells: buildCells(plan.ids, snap), notes: [...(note === undefined ? [] : [note]), ...scopeNotes(snap)] }
}

/** The same cells as one line of plain text, for the status line. */
export const cellText = (cells: readonly Cell[]): string =>
  cells.map(c => c.parts.map(p => p.text).join('').trim()).join(' │ ')

/** Draws the band for a classic-layout session; null when it has nothing to show. */
export async function renderBand($: EngineInterface, e: RenderInput, options: Options): Promise<RenderElement | null> {
  const { cells, notes } = await cellsFor($, options, true)
  if (cells.length === 0 && notes.length === 0) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const part = (p: Part, i: number) => (
    <Text key={String(i)} color={p.tone as Tone | undefined} dimColor={p.dim} weight={p.bold ? 'semibold' : undefined}>
      {p.text}
    </Text>
  )
  // Two cells of one source say its trouble once.
  const alerts = [...new Set([...cells.flatMap(c => (c.alert === undefined ? [] : [c.alert])), ...notes])]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        {cells.map((c, i) => (
          <Button
            key={c.id}
            plain
            hotkey={digitFor(i)}
            onPress={() => {
              if (isViewId(c.pane)) void showView($, options, c.pane, false).catch(() => undefined)
            }}
          >
            {c.parts.map(part)}
          </Button>
        ))}
      </Box>
      {alerts.length > 0 && (
        <Text color="warning" wrap="truncate-end">
          {alerts.join(' · ')}
        </Text>
      )}
    </Box>
  )
}

/** Keeps the status line in step with the band while the person has chosen `inlineView: status`. */
export async function syncStatus($: EngineInterface, options: Options, isFullscreen: boolean | undefined): Promise<void> {
  if (options.inlineView !== 'status' || isFullscreen !== false) return
  const text = cellText((await cellsFor($, options)).cells)
  // Write only a change: the status line is shared with the waiting notice and the layout hint.
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text === '' ? undefined : text)
}
