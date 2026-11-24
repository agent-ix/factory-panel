import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import type { BandOverride, BoardView, Escalation, Freshness, FocusView, Machine, RelayView } from '../../types'
import { PANE_SPEC as ESCALATIONS_PANE } from '../escalations'
import { PANE_SPEC as FACTORY_PANE } from '../factory'
import { PANE_SPEC as FOCUS_PANE } from '../focus'
import { PANE_SPEC as RELAY_PANE } from '../relay'
import { PANE_SPEC as TEAM_PANE } from '../team'
import { errorText } from '../shared'
import type { Options } from '../shared'
import { buildCells, MODULE_IDS } from './modules'
import type { Cell, Part, Snapshot, Tone } from './modules'
import { isRole, modulesFor, parseModules, roleFromAddress } from './roles'
import type { Role } from './roles'

// The band: one row above the prompt for sessions that are not in the fullscreen layout, where a
// pane can only sit over the chat. Each module is a Button with a digit hotkey, so a bare digit at
// an empty prompt presses it; a press opens that module's full pane, focused, and Esc closes it.

export const bandOverride = atom({ plugin: 'factory-panel', key: 'bandOverride' } as const, { off: false, modules: '' } as BandOverride, {
  shape: 'band-override-1',
})

const TITLES: Record<string, string> = Object.fromEntries(
  [FACTORY_PANE, FOCUS_PANE, ESCALATIONS_PANE, RELAY_PANE, TEAM_PANE].map(p => [p.id, p.title]),
)

// The values the panes keep, read by their state keys. The scan wants the plugin and key written
// as literals in this file, so these repeat the panes' atoms; each shape tag must match the one
// the pane writes under (a value stored under another tag reads as the initial one).
const machines = atom({ plugin: 'factory-panel', key: 'machines' } as const, [] as Machine[], { shape: 'machines-1' })
const relay = atom({ plugin: 'factory-panel', key: 'relay' } as const, { ok: true, redis: '', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] } as RelayView, { shape: 'relay-1' })
const board = atom({ plugin: 'factory-panel', key: 'board' } as const, { teams: [], agents: [], error: null } as BoardView, { shape: 'board-1' })
const freshness = atom({ plugin: 'factory-panel', key: 'freshness' } as const, { prometheusAt: null, prometheusError: null, nodeMetricsSeen: false, herdrAt: null, herdrError: null, relayAt: null, relayError: null, boardAt: null, boardBusy: false } as Freshness, { shape: 'freshness-1' })
const focuses = atom({ plugin: 'factory-panel', key: 'focuses' } as const, [] as FocusView[], { shape: 'focuses-2' })
const escalations = atom({ plugin: 'factory-panel', key: 'escalations' } as const, [] as Escalation[], { shape: 'escalations-1' })
const escalationHidden = atom({ plugin: 'factory-panel', key: 'escalationHidden' } as const, [] as string[])

// Facts learned at session start: the machine this session runs on and the role its relay address names.
let localMachine = ''
let detectedRole: Role | undefined
let lastStatus: string | undefined

/** Reads the host name and, best effort, this session's role from its relay address. Never throws. */
export async function startBand($: EngineInterface, options: Options): Promise<void> {
  await $.command.register({
    name: 'band',
    description: 'The compact band above the prompt: /band on | off | modules a,b,c | reset',
  })
  try {
    const host = await $.process.run(['hostname', '-s'], { timeoutMs: 3000 })
    localMachine = host.stdout.trim().toLowerCase()
  } catch (error) {
    $.ui.log(`factory-panel: hostname failed: ${errorText(error)}`, { to: 'debug' })
  }
  if (options.role === 'auto') {
    try {
      const who = await $.process.run(['agent-msg', 'whoami'], { timeoutMs: 5000 })
      detectedRole = roleFromAddress(`${who.stdout} ${who.stderr}`)
    } catch {
      detectedRole = undefined
    }
  }
}

/** The role in force: the setting when it names one, else what the relay address said. */
export const roleOf = (options: Options): Role | undefined =>
  isRole(options.role) ? options.role : options.role === 'auto' ? detectedRole : undefined

type ModuleState = { off: boolean; ids: readonly string[] }

/** What /band said, falling back to the settings and the role preset. */
export const bandPlan = (options: Options, override: BandOverride): ModuleState => ({
  off: (override.off ?? false) || options.inlineView === 'off',
  ids: modulesFor(roleOf(options), (override.modules ?? '') !== '' ? (override.modules ?? '') : options.bandModules),
})

// A state key the panes have not written yet reads as an empty value of the wrong kind, so each
// is coerced to what the modules expect; the band draws from whatever has arrived.
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
const EMPTY_RELAY = { ok: true, redis: '', watchers: [], warnings: 0, deadLetters: 0, inboxWaiting: 0, checks: [] }

async function snapshot($: EngineInterface, options: Options): Promise<Snapshot> {
  const [fresh, rel, brd, mach, foc, esc, hid] = await Promise.all([
    read($, freshness) as Promise<Partial<Freshness>>,
    read($, relay) as Promise<Partial<Snapshot['relay']>>,
    read($, board) as Promise<Partial<Snapshot['board']>>,
    read($, machines),
    read($, focuses),
    read($, escalations),
    read($, escalationHidden),
  ])
  return {
    machines: list(mach),
    relay: { ...EMPTY_RELAY, ...(rel ?? {}) },
    board: { teams: [], error: null, ...(brd ?? {}), agents: list(brd?.agents) },
    focuses: list(foc),
    escalations: list(esc),
    hiddenEscalations: list(hid),
    localMachine,
    teams: options.teams,
    focusName: options.bandFocus,
    prometheusError: fresh?.prometheusError ?? null,
    relayAt: fresh?.relayAt ?? null,
    relayError: fresh?.relayError ?? null,
    boardError: brd?.error ?? null,
  }
}

async function cellsFor($: EngineInterface, options: Options): Promise<Cell[]> {
  const plan = bandPlan(options, await read($, bandOverride))
  if (plan.off) return []
  return buildCells(plan.ids as Parameters<typeof buildCells>[0], await snapshot($, options))
}

/** The same cells as one line of plain text, for the status line. */
export const cellText = (cells: readonly Cell[]): string =>
  cells.map(c => c.parts.map(p => p.text).join('').trim()).join(' │ ')

/** Draws the band for a classic-layout session; null when it has nothing to show. */
export async function renderBand($: EngineInterface, e: RenderInput, options: Options): Promise<RenderElement | null> {
  const cells = await cellsFor($, options)
  if (cells.length === 0) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const part = (p: Part, i: number) => (
    <Text key={String(i)} color={p.tone as Tone | undefined} dimColor={p.dim} weight={p.bold ? 'semibold' : undefined}>
      {p.text}
    </Text>
  )
  const alerts = cells.flatMap(c => (c.alert === undefined ? [] : [c.alert]))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        {cells.map((c, i) => (
          <Button
            key={c.id}
            plain
            hotkey={i < 9 ? String(i + 1) : undefined}
            onPress={() =>
              void $.ui
                .open({ id: c.pane, title: TITLES[c.pane] ?? c.pane, focus: true, closeOnEscape: true, rows: 14 })
                .catch(() => undefined)
            }
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
  const text = cellText(await cellsFor($, options))
  // Write only a change: the status line is shared with the waiting notice and the layout hint.
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text === '' ? undefined : text)
}

export function registerBand(on: On, options: Options): void {
  on('command.run', { command: 'band' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const list = rest.join(' ')
    if (word === 'off') await update($, bandOverride, o => ({ ...o, off: true }))
    else if (word === 'on') await update($, bandOverride, o => ({ ...o, off: false }))
    else if (word === 'reset') await update($, bandOverride, () => ({ off: false, modules: '' }))
    else if (word === 'modules') {
      const ids = parseModules(list)
      if (ids.length === 0) return { text: `No known module in "${list}". Known: ${MODULE_IDS.join(', ')}.` }
      await update($, bandOverride, () => ({ off: false, modules: ids.join(',') }))
    } else if (word !== '' && word !== 'show') {
      return { text: '/band on | off | modules a,b,c | reset' }
    }
    const plan = bandPlan(options, await read($, bandOverride))
    const role = roleOf(options) ?? 'code-lead (role not known)'
    return { text: plan.off ? 'Band is off.' : `Band shows (${role}): ${plan.ids.join(', ')}. Keys 1-${Math.min(9, plan.ids.length)} open a module.` }
  })
}
