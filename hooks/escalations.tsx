import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Escalation, EscalationFilter, EscalationStatus, RelayMeta } from '../types'
import { CARD_BG, CARD_BG_OPEN, ago, errorText, runJson, runText } from './shared'
import type { Options } from './shared'
import { ACCENT, DOING, READY } from './ui/glyphs'

// The Escalations pane: the operator's inbox of escalations from the leads, through `agent-msg`.
// A row resolves in one press with its recommendation, or hides. The header hides or resolves
// every open row at once; resolving all takes a confirm that names the count. Anything else
// that leaves the pane (a typed decision, a reply, an investigate) takes a second press.

const PANE = 'escalations'
const TITLE = 'Escalations'
export const PANE_SPEC = { id: PANE, title: TITLE }
const POLL_MS = 60 * 1000

const escalations = atom({ plugin: 'factory-panel', key: 'escalations' } as const, [] as Escalation[], {
  shape: 'escalations-1',
})
const escalationMeta = atom(
  { plugin: 'factory-panel', key: 'escalationMeta' } as const,
  { at: null, error: null, human: 'operator' } as RelayMeta,
  { shape: 'escalationMeta-1' },
)
const escalationFilter = atom({ plugin: 'factory-panel', key: 'escalationFilter' } as const, 'open' as EscalationFilter)
/** Hidden rows, as `id|status`: a row whose status moves is no longer hidden. ix-relay cannot close one without a decision, so hiding is the pane's own. */
const escalationHidden = atom({ plugin: 'factory-panel', key: 'escalationHidden' } as const, [] as string[])
/** Each opened escalation's lead, as an address `send` takes; '' when its session has ended. */
const escalationAddress = atom({ plugin: 'factory-panel', key: 'escalationAddress' } as const, {} as Record<string, string>)
const escalationSelected = atom({ plugin: 'factory-panel', key: 'escalationSelected' } as const, '')
const escalationDraft = atom({ plugin: 'factory-panel', key: 'escalationDraft' } as const, '')
const escalationConfirm = atom({ plugin: 'factory-panel', key: 'escalationConfirm' } as const, '')
const escalationNotice = atom({ plugin: 'factory-panel', key: 'escalationNotice' } as const, '')

const HIDDEN_KEY = 'hiddenEscalations'
/** What the Relay pane called hiding: bare ids, which hide a row whatever its status. */
const LEGACY_KEY = 'clearedEscalations'

// ---------------------------------------------------------------- parsing

const STATUSES: readonly EscalationStatus[] = ['waiting', 'investigating', 'resolved']

/** `e30  waiting  ENG-101  session/…  11-20 16:29`, one per line. */
export function parseEscalationList(text: string): Escalation[] {
  const out: Escalation[] = []
  for (const line of text.split('\n')) {
    const [id, status, ticket, lead, date, time] = line.trim().split(/\s+/)
    if (!id || !/^e\d+$/.test(id) || !STATUSES.includes(status as EscalationStatus)) continue
    out.push({
      id,
      status: status as EscalationStatus,
      ticket: ticket ?? '',
      lead: lead ?? '',
      filed: `${date ?? ''} ${time ?? ''}`.trim(),
      machine: '',
      kind: '',
      context: '',
      options: [],
      recommendation: '',
      decision: '',
      hasDetail: false,
    })
  }
  return out
}

/** `agent-msg escalation show`: `key: value` lines, and indented blocks under a bare `key:`. */
export function parseEscalationDetail(text: string): Partial<Escalation> {
  const fields: Record<string, string> = {}
  const blocks: Record<string, string[]> = {}
  let current: string | null = null
  for (const line of text.split('\n')) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/)
    if (field) {
      current = field[1] ?? null
      if (current) {
        fields[current] = (field[2] ?? '').trim()
        blocks[current] = []
      }
      continue
    }
    if (current && /^\s+\S/.test(line)) blocks[current]?.push(line.trim())
  }
  const block = (key: string) => (blocks[key] ?? []).join(' ').trim()
  return {
    machine: fields.machine ?? '',
    kind: fields.kind ?? '',
    context: block('context'),
    options: (blocks.options ?? []).map(o => o.replace(/^-\s*/, '')).filter(Boolean),
    recommendation: block('recommendation'),
    decision: block('decision'),
    hasDetail: true,
  }
}

// ---------------------------------------------------------------- state helpers

const isOpen = (x: Escalation) => x.status !== 'resolved'
const hideKey = (x: Escalation) => `${x.id}|${x.status}`
const isHidden = (hidden: readonly string[], x: Escalation) => hidden.includes(hideKey(x)) || hidden.includes(x.id)

/** The rows of one view, newest first (the poll keeps them sorted). */
function viewOf(all: readonly Escalation[], hidden: readonly string[], filter: EscalationFilter): Escalation[] {
  if (filter === 'hidden') return all.filter(x => isHidden(hidden, x))
  const visible = all.filter(x => !isHidden(hidden, x))
  return filter === 'open' ? visible.filter(isOpen) : visible.filter(x => !isOpen(x))
}

// ---------------------------------------------------------------- polling

async function pollEscalations($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  try {
    const listed = parseEscalationList(await runText($, ['agent-msg', 'escalations'], 20_000))
    const known = new Map((await read($, escalations)).map(x => [x.id, x]))
    // Detail is read once per escalation, and again when its status moves.
    const merged = await Promise.all(
      listed.map(async x => {
        const had = known.get(x.id)
        if (had?.hasDetail && had.status === x.status) return { ...had, ...x, ...pick(had) }
        try {
          const detail = parseEscalationDetail(await runText($, ['agent-msg', 'escalation', 'show', x.id], 20_000))
          return { ...x, ...detail }
        } catch {
          return had ? { ...had, ...x } : x
        }
      }),
    )
    // Newest first: ids count up as escalations are filed.
    merged.sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)))
    await update($, escalations, () => merged)
    await update($, escalationMeta, m => ({ ...m, at: now, error: null }))
  } catch (error) {
    await update($, escalationMeta, m => ({ ...m, error: errorText(error) }))
  }
}

const pick = (x: Escalation): Partial<Escalation> => ({
  machine: x.machine,
  kind: x.kind,
  context: x.context,
  options: x.options,
  recommendation: x.recommendation,
  decision: x.decision,
  hasDetail: x.hasDetail,
})

// ---------------------------------------------------------------- actions

async function notice($: EngineInterface, text: string): Promise<void> {
  await update($, escalationNotice, () => text)
  await update($, escalationConfirm, () => '')
}

/** A first press arms the action; a second press on the same action runs it. */
async function armed($: EngineInterface, action: string): Promise<boolean> {
  const current = await read($, escalationConfirm)
  if (current === action) return true
  await update($, escalationConfirm, () => action)
  return false
}

async function selectEscalation($: EngineInterface, id: string): Promise<void> {
  const current = await read($, escalationSelected)
  await update($, escalationSelected, () => (current === id ? '' : id))
  await update($, escalationDraft, () => '')
  await update($, escalationConfirm, () => '')
  if (current !== id) void lookupAddress($, id)
}

/**
 * The lead's address now. An escalation names its lead as `session/<machine>/<session>`, both
 * hex: herdr maps the session to its pane, and `agent-msg find` maps the pane to an address.
 */
async function leadAddress($: EngineInterface, lead: string): Promise<string> {
  if (lead.split(':').length === 3) return lead
  const m = /^session\/([0-9a-f]+)\/([0-9a-f]+)$/.exec(lead)
  if (!m) return ''
  const machine = hexText(m[1] ?? '')
  const session = hexText(m[2] ?? '')
  type Agents = { result?: { agents?: { pane_id?: string; agent_session?: { value?: string } }[] } }
  const list = await runJson<Agents>($, ['herdr', '--machine', machine, 'agent', 'list'], 20_000).catch(() =>
    runJson<Agents>($, ['herdr', 'agent', 'list'], 20_000),
  )
  const pane = list.result?.agents?.find(a => a.agent_session?.value === session)?.pane_id
  if (!pane) return ''
  const rows = (await runText($, ['agent-msg', 'find', '--json', pane], 20_000))
    .split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as { address?: string; machine?: string })
  return rows.find(r => r.machine === machine)?.address ?? rows[0]?.address ?? ''
}

const hexText = (hex: string): string =>
  (hex.match(/../g) ?? []).map(b => String.fromCharCode(parseInt(b, 16))).join('')

async function lookupAddress($: EngineInterface, id: string): Promise<void> {
  const x = (await read($, escalations)).find(e => e.id === id)
  if (!x) return
  let address = ''
  try {
    address = await leadAddress($, x.lead)
  } catch {
    address = ''
  }
  await update($, escalationAddress, all => ({ ...all, [id]: address }))
}

async function replyEscalation($: EngineInterface, id: string): Promise<void> {
  const text = (await read($, escalationDraft)).trim()
  const address = (await read($, escalationAddress))[id]
  if (!text) {
    await notice($, `Write a reply to ${id} first.`)
    return
  }
  if (!address) {
    await notice($, `${id}'s lead is no longer running, so there is no one to reply to.`)
    return
  }
  if (!(await armed($, `reply:${id}`))) return
  const x = (await read($, escalations)).find(e => e.id === id)
  const about = x?.ticket ? `${id} (${x.ticket})` : id
  try {
    await runText($, ['agent-msg', 'send', address, `Operator, on escalation ${about}: ${text}`], 60_000)
    await update($, escalationDraft, () => '')
    await notice($, `Replied to ${address}; ${id} stays open.`)
  } catch (error) {
    await notice($, `Reply to ${address} failed: ${errorText(error)}`)
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const ids = [...strings(await $.store.get(HIDDEN_KEY)), ...strings(await $.store.get(LEGACY_KEY))]
  await update($, escalationHidden, () => [...new Set(ids)])
}

async function saveHidden($: EngineInterface, after: string[]): Promise<void> {
  await update($, escalationHidden, () => after)
  await $.store.set(HIDDEN_KEY, after)
}

async function hideOne($: EngineInterface, id: string): Promise<void> {
  const x = (await read($, escalations)).find(e => e.id === id)
  if (!x) return
  const before = await read($, escalationHidden)
  await saveHidden($, [...before.filter(h => h !== x.id), hideKey(x)])
  await update($, escalationSelected, () => '')
  await notice($, `Hid ${id}.`)
}

async function restoreOne($: EngineInterface, id: string): Promise<void> {
  const before = await read($, escalationHidden)
  await saveHidden($, before.filter(h => h !== id && !h.startsWith(`${id}|`)))
  await update($, escalationSelected, () => '')
  await notice($, `Restored ${id}.`)
}

/** Hides every row of the current view. Local only: nothing is sent to the relay. */
async function hideAll($: EngineInterface): Promise<void> {
  const [all, hidden, filter] = await Promise.all([read($, escalations), read($, escalationHidden), read($, escalationFilter)])
  const rows = viewOf(all, hidden, filter)
  if (rows.length === 0 || filter === 'hidden') return
  const ids = new Set(rows.map(x => x.id))
  await saveHidden($, [...hidden.filter(h => !ids.has(h)), ...rows.map(hideKey)])
  await update($, escalationSelected, () => '')
  await notice($, `Hid ${rows.length}. Nothing was sent.`)
}

async function setFilter($: EngineInterface, filter: EscalationFilter): Promise<void> {
  await update($, escalationFilter, () => filter)
  await update($, escalationSelected, () => '')
  await update($, escalationConfirm, () => '')
}

async function useText($: EngineInterface, text: string): Promise<void> {
  await update($, escalationDraft, () => text)
  await update($, escalationConfirm, () => '')
}

async function setDraft($: EngineInterface, text: string): Promise<void> {
  await update($, escalationDraft, () => text)
}

/** `agent-msg resolve <id> <decision>`: the relay's one way to close an escalation. */
const resolveCommand = ($: EngineInterface, id: string, decision: string) =>
  runText($, ['agent-msg', 'resolve', id, decision], 60_000)

async function resolveEscalation($: EngineInterface, id: string): Promise<void> {
  const decision = (await read($, escalationDraft)).trim()
  if (!decision) {
    await notice($, `Write a decision for ${id} first, or pick an option.`)
    return
  }
  if (!(await armed($, `resolve:${id}`))) return
  try {
    const out = await resolveCommand($, id, decision)
    await update($, escalationDraft, () => '')
    await update($, escalationSelected, () => '')
    await notice($, out.trim().split('\n').pop() || `Resolved ${id}.`)
  } catch (error) {
    await notice($, `Resolve ${id} failed: ${errorText(error)}`)
  }
  void pollEscalations($)
}

/** One press: resolves with the escalation's own recommendation. */
async function resolveRecommended($: EngineInterface, id: string): Promise<void> {
  const x = (await read($, escalations)).find(e => e.id === id)
  if (!x?.recommendation) {
    await notice($, `${id} has no recommendation; open it to write a decision.`)
    return
  }
  try {
    const out = await resolveCommand($, id, x.recommendation)
    await update($, escalationSelected, () => '')
    await notice($, out.trim().split('\n').pop() || `Resolved ${id}.`)
  } catch (error) {
    await notice($, `Resolve ${id} failed: ${errorText(error)}`)
  }
  void pollEscalations($)
}

/**
 * Resolves every open row of the view with its own recommendation; rows without one are
 * skipped and counted. The first press arms it with the count, the second sends. A failed
 * item is reported and the rest carry on.
 */
async function resolveAll($: EngineInterface): Promise<void> {
  const [all, hidden, filter] = await Promise.all([read($, escalations), read($, escalationHidden), read($, escalationFilter)])
  const open = filter === 'open' ? viewOf(all, hidden, 'open') : []
  const rows = open.filter(x => x.recommendation)
  const skipped = open.length - rows.length
  if (rows.length === 0) {
    await notice($, open.length === 0 ? 'Nothing is open.' : `Nothing to resolve: none of the ${open.length} open has a recommendation.`)
    return
  }
  if (!(await armed($, `resolve-all:${rows.length}:${skipped}`))) return
  const failed: string[] = []
  for (const x of rows) {
    try {
      await resolveCommand($, x.id, x.recommendation)
    } catch (error) {
      failed.push(`${x.id} failed: ${errorText(error)}`)
    }
  }
  const done = rows.length - failed.length
  const head = `Resolved ${done} of ${rows.length}${skipped > 0 ? `; skipped ${skipped} with no recommendation` : ''}.`
  await update($, escalationSelected, () => '')
  await notice($, [head, ...failed].join('\n'))
  void pollEscalations($)
}

async function investigateEscalation($: EngineInterface, id: string): Promise<void> {
  if (!(await armed($, `investigate:${id}`))) return
  try {
    const out = await runText($, ['agent-msg', 'investigate', id], 60_000)
    await notice($, out.trim().split('\n').pop() || `Opened an investigation session for ${id}.`)
  } catch (error) {
    await notice($, `Investigate ${id} failed: ${errorText(error)}`)
  }
  void pollEscalations($)
}

async function cancelArmed($: EngineInterface): Promise<void> {
  await update($, escalationConfirm, () => '')
}

// ---------------------------------------------------------------- pane

/** `11-20 16:29` (this year, local time) to a short age. */
function filedAgo(filed: string, now: number): string {
  const m = filed.match(/^(\d\d)-(\d\d) (\d\d):(\d\d)$/)
  if (!m) return filed
  const at = new Date(new Date(now).getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]))
  return ago(at.getTime(), now)
}

/** Registers the command and starts polling; called once at session start. register.tsx opens the pane. */
export async function startEscalations($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'escalations', description: 'Open the Escalations pane: resolve or hide what the leads escalated' })
  await loadHidden($)
  void pollEscalations($)
  $.clock.every(POLL_MS, () => pollEscalations($))
}

export function registerEscalations(on: On, _options: Options): void {
  on('command.run', { command: 'escalations' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    void pollEscalations($)
    return { text: opened.isPlaced ? 'Escalations pane opened.' : `Escalations pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const isTerminal = e.surface === 'terminal'
    const [all, meta, filter, selected, draft, confirm, said, hidden, addresses] = await Promise.all([
      read($, escalations),
      read($, escalationMeta),
      read($, escalationFilter),
      read($, escalationSelected),
      read($, escalationDraft),
      read($, escalationConfirm),
      read($, escalationNotice),
      read($, escalationHidden),
      read($, escalationAddress),
    ])
    const now = await $.clock.now()
    const openRows = viewOf(all, hidden, 'open')
    const counts = {
      open: openRows.length,
      resolved: viewOf(all, hidden, 'resolved').length,
      hidden: viewOf(all, hidden, 'hidden').length,
    }
    const waiting = openRows.filter(x => x.status === 'waiting').length

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={waiting > 0 ? 'warning' : 'success'} weight="semibold">
            {waiting} waiting
          </Text>
          <Text dimColor>escalations</Text>
        </Box>
      )
    }

    const shown = viewOf(all, hidden, filter)
    const withRec = openRows.filter(x => x.recommendation).length
    const skipped = openRows.length - withRec
    const mark = (s: EscalationStatus) => (s === 'waiting' ? '▲' : s === 'investigating' ? '◐' : '✓')
    const markColor = (s: EscalationStatus) => (s === 'waiting' ? 'warning' : s === 'investigating' ? DOING : READY)

    const detail = (x: Escalation) => (
      <Box flexDirection="column" gap={isTerminal ? 0 : 1} paddingLeft={2} paddingTop={isTerminal ? 0 : 1}>
        <Text>{x.context || 'No context was recorded.'}</Text>

        {x.options.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor size="caption">
              Options
            </Text>
            {x.options.map((o, i) => (
              <Box key={`opt-${x.id}-${i}`} flexDirection="row" gap={1}>
                <Text dimColor>{i + 1}.</Text>
                <Box flexGrow={1}>
                  <Text>{o}</Text>
                </Box>
                {x.status !== 'resolved' && (
                  <Button key={`use-${x.id}-${i}`} plain label="use" onPress={() => void useText($, o)} />
                )}
              </Box>
            ))}
          </Box>
        )}

        {x.recommendation && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text dimColor size="caption">
                Recommended
              </Text>
              {x.status !== 'resolved' && (
                <Button key={`rec-${x.id}`} plain label="use" onPress={() => void useText($, x.recommendation)} />
              )}
            </Box>
            <Text>{x.recommendation}</Text>
          </Box>
        )}

        {x.status === 'resolved' ? (
          <Box flexDirection="column">
            <Text dimColor size="caption">
              Decision
            </Text>
            <Text>{x.decision || 'Recorded without text.'}</Text>
          </Box>
        ) : (
          <Box flexDirection="column" gap={isTerminal ? 0 : 1}>
            <Input
              key={`decision-${x.id}`}
              label="Decision"
              placeholder="A decision closes it and posts to the ticket; a reply only goes to the lead"
              value={draft}
              rows={3}
              submitLabel="Resolve"
              onInput={value => void setDraft($, value)}
              onSubmit={() => void resolveEscalation($, x.id)}
            />
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button
                key={`resolve-${x.id}`}
                variant="primary"
                label={confirm === `resolve:${x.id}` ? 'Confirm resolve' : 'Resolve'}
                onPress={() => void resolveEscalation($, x.id)}
              />
              <Button
                key={`reply-${x.id}`}
                label={
                  addresses[x.id] === ''
                    ? 'Lead ended'
                    : confirm === `reply:${x.id}`
                      ? `Confirm reply`
                      : 'Reply'
                }
                onPress={() => void replyEscalation($, x.id)}
              />
              <Button
                key={`investigate-${x.id}`}
                label={confirm === `investigate:${x.id}` ? 'Confirm investigate' : 'Investigate'}
                onPress={() => void investigateEscalation($, x.id)}
              />
              {confirm && !confirm.startsWith('resolve-all') && (
                <Button key="cancel" plain label="cancel" onPress={() => void cancelArmed($)} />
              )}
            </Box>
            {confirm === `reply:${x.id}` && (
              <Text dimColor size="caption">
                Sends to {addresses[x.id]}; the escalation stays open.
              </Text>
            )}
            {confirm === `investigate:${x.id}` && (
              <Text dimColor size="caption">
                Opens a Claude Code session on {x.machine || 'the lead’s machine'} in the lead’s folder.
              </Text>
            )}
          </Box>
        )}
      </Box>
    )

    // One row's actions: resolve with the recommendation (open rows that have one) and hide, or restore.
    const actions = (x: Escalation) => (
      <Box flexDirection="row" gap={isTerminal ? 2 : 1}>
        {filter === 'hidden' ? (
          <Button key={`restore-${x.id}`} plain={isTerminal ? true : undefined} label="Restore" onPress={() => void restoreOne($, x.id)} />
        ) : (
          <>
            {isOpen(x) && x.recommendation && (
              <Button
                key={`quick-${x.id}`}
                plain={isTerminal ? true : undefined}
                variant={isTerminal ? undefined : 'primary'}
                label={isTerminal ? '✓ resolve' : 'Resolve'}
                onPress={() => void resolveRecommended($, x.id)}
              />
            )}
            <Button key={`hide-${x.id}`} plain={isTerminal ? true : undefined} label="Hide" onPress={() => void hideOne($, x.id)} />
          </>
        )}
      </Box>
    )

    const row = (x: Escalation) => (
      <Box
        key={x.id}
        flexDirection="column"
        padding={isTerminal ? 0 : 1}
        backgroundColor={isTerminal ? undefined : selected === x.id ? CARD_BG_OPEN : CARD_BG}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={markColor(x.status)}>{mark(x.status)}</Text>
          <Button key={`sel-${x.id}`} plain label={x.ticket || x.id} onPress={() => void selectEscalation($, x.id)} />
          <Box flexGrow={1} />
          <Text dimColor size="caption" wrap="truncate-end">
            {[isTerminal ? '' : x.machine, isTerminal ? '' : x.kind, filedAgo(x.filed, now)].filter(Boolean).join(' · ')}
          </Text>
        </Box>
        {selected !== x.id && x.context && (
          <Text dimColor size="footnote" wrap="truncate-end">
            {x.context}
          </Text>
        )}
        {selected === x.id && detail(x)}
        {actions(x)}
      </Box>
    )

    const filterButton = (f: EscalationFilter) => (
      <Button
        key={`filter-${f}`}
        plain={filter === f ? undefined : true}
        variant={filter === f ? 'primary' : undefined}
        label={`${f} ${counts[f]}`}
        onPress={() => void setFilter($, f)}
      />
    )

    const bulkArmed = confirm.startsWith('resolve-all:')
    const noticeLines = said.split('\n').filter(Boolean)

    return (
      <Box flexDirection="column" gap={isTerminal ? 0 : 1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text weight="semibold" size="heading" color={isTerminal ? ACCENT : undefined}>
              Escalations
            </Text>
            <Text color={waiting > 0 ? 'warning' : 'subtle'} size="caption">
              {waiting} waiting
            </Text>
          </Box>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollEscalations($)} />
        </Box>

        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {filterButton('open')}
          {filterButton('resolved')}
          {filterButton('hidden')}
        </Box>

        {filter !== 'hidden' && shown.length > 0 && (
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Button key="hide-all" plain={isTerminal ? true : undefined} label={`Hide all ${shown.length}`} onPress={() => void hideAll($)} />
            {filter === 'open' && (
              <Button
                key="resolve-all"
                plain={isTerminal ? true : undefined}
                label={bulkArmed ? `Confirm resolve ${withRec}` : 'Resolve all'}
                onPress={() => void resolveAll($)}
              />
            )}
            {bulkArmed && <Button key="cancel-bulk" plain label="cancel" onPress={() => void cancelArmed($)} />}
          </Box>
        )}
        {bulkArmed && (
          <Text color="warning" size="caption">
            Resolve {withRec} {withRec === 1 ? 'escalation' : 'escalations'} with {withRec === 1 ? 'its' : 'each one’s'} recommendation
            {skipped > 0 ? `; ${skipped} with none will be skipped` : ''}. Press again to send.
          </Text>
        )}

        <Box flexDirection="column" gap={isTerminal ? 0 : 1}>
          {shown.length === 0 && <Text dimColor>No {filter} escalations.</Text>}
          {shown.slice(0, 40).map(row)}
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column">
            {noticeLines.map((line, i) => (
              <Text key={`said-${i}`} size="caption">
                {line}
              </Text>
            ))}
          </Box>
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption" wrap="truncate-end">
            {meta.error ?? `updated ${ago(meta.at, now)}`}
          </Text>
        </Box>
      </Box>
    )
  })
}
