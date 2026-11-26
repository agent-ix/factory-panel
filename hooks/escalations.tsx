import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Escalation, EscalationFilter, EscalationStatus, RelayMeta } from '../types'
import { CARD_BG, CARD_BG_OPEN, ago, errorText, limiter, runJson, runText } from './shared'
import type { Options } from './shared'
import { markStale, track } from './schedule'
import { ACCENT, DOING } from './ui/glyphs'

// The Escalations pane: the operator's inbox of escalations from the leads, through `agent-msg`.
// A row resolves in one press with its recommendation, or hides. The header hides or resolves
// every open row at once; resolving all takes a confirm that names the count. Anything else
// that leaves the pane (a typed decision, a reply, an investigate) takes a second press.

const PANE = 'escalations'
const TITLE = 'Escalations'
export const PANE_SPEC = { id: PANE, title: TITLE }
/** The use button: a light blue arrow on a muted blue that stays quiet against the pane. */
const USE_BG = '#26384c'
const USE_FG = '#7fb2e0'
/** Rows drawn at once; bulk actions still cover the rest. */
const MAX_ROWS = 50

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
/** Ids with a send in flight ('all' while Resolve all runs), mirrored from `inFlight` so the rows can draw as busy. */
const escalationBusy = atom({ plugin: 'factory-panel', key: 'escalationBusy' } as const, [] as string[])
const escalationSelected = atom({ plugin: 'factory-panel', key: 'escalationSelected' } as const, '')
const escalationDraft = atom({ plugin: 'factory-panel', key: 'escalationDraft' } as const, '')
const escalationConfirm = atom({ plugin: 'factory-panel', key: 'escalationConfirm' } as const, '')
const escalationNotice = atom({ plugin: 'factory-panel', key: 'escalationNotice' } as const, '')

/**
 * Which sends are running: an id, or 'all' while Resolve all runs. `enter` checks and marks in one
 * synchronous step, so a second press cannot slip in between. One id blocks only itself; 'all'
 * blocks everything and cannot start while anything runs.
 */
export function makeGate() {
  const held = new Set<string>()
  return {
    enter(key: string): boolean {
      if (held.has(key) || held.has('all') || (key === 'all' && held.size > 0)) return false
      held.add(key)
      return true
    },
    leave: (key: string) => void held.delete(key),
    keys: () => [...held],
    busy: () => held.size > 0,
  }
}
/** The sends running now; exported so a test can hold one. */
export const inFlight = makeGate()
/** Hidden-list writes run one after another, each storing the list as it is then, so two quick changes cannot land out of order. */
let storeChain: Promise<unknown> = Promise.resolve()
/** When each row was marked resolved locally, on the same counter polls take their start from: a poll that began earlier must not undo the mark. */
let tick = 0
const markedAt = new Map<string, number>()
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
      // The listing writes `-` where there is no ticket.
      ticket: ticket && ticket !== '-' ? ticket : '',
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
const idOf = (entry: string) => entry.split('|')[0] ?? entry
const isHidden = (hidden: readonly string[], x: Escalation) => hidden.includes(hideKey(x)) || hidden.includes(x.id)

/** The rows of one view, newest first (the poll keeps them sorted). */
function viewOf(all: readonly Escalation[], hidden: readonly string[], filter: EscalationFilter): Escalation[] {
  if (filter === 'hidden') return all.filter(x => isHidden(hidden, x))
  const visible = all.filter(x => !isHidden(hidden, x))
  return filter === 'open' ? visible.filter(isOpen) : visible.filter(x => !isOpen(x))
}

// ---------------------------------------------------------------- polling

/** At most this many `escalation show` run at once, however many rows lack their detail. */
export const DETAIL_CONCURRENCY = 4
const detailTurn = limiter(DETAIL_CONCURRENCY)
/** The read of the list under way, which a read of the detail waits for. */
let listing: Promise<boolean> | null = null

/** Reads the list of escalations; false when it could not be read. The detail of the rows is a source of its own. */
export function pollEscalations($: EngineInterface): Promise<boolean> {
  const read = track($, 'escalations', () => readEscalations($))
  listing = read
  return read.finally(() => {
    if (listing === read) listing = null
  })
}

/** The list, then the detail of the rows the pane draws: what its refresh key and its actions read. */
async function refreshEscalations($: EngineInterface): Promise<void> {
  await pollEscalations($)
  markStale('escalationDetail')
  await pollEscalationDetail($)
}

async function readEscalations($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  const started = ++tick
  try {
    const listed = parseEscalationList(await runText($, ['agent-msg', 'escalations'], 20_000, 'escalations'))
    const known = new Map((await read($, escalations)).map(x => [x.id, x]))
    // Detail is read once per escalation, and again when its status moves; a row whose detail is due keeps what was
    // read of it until then.
    const merged = listed.map(x => {
      const had = known.get(x.id)
      // A row marked resolved here has its decision read from the relay once the relay lists it resolved.
      const confirming = x.status === 'resolved' && markedAt.has(x.id)
      if (had?.hasDetail && had.status === x.status && !confirming) return { ...had, ...x, ...pick(had) }
      return had ? { ...had, ...x, ...pick(had), hasDetail: false } : x
    })
    // Newest first: ids count up as escalations are filed.
    merged.sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)))
    // A row marked resolved after this poll began keeps its local mark over this poll's older listing.
    await update($, escalations, current =>
      merged.map(x => ((markedAt.get(x.id) ?? 0) > started ? (current.find(c => c.id === x.id) ?? x) : x)),
    )
    for (const [id, at] of markedAt) if (at < started && merged.some(x => x.id === id && x.status === 'resolved')) markedAt.delete(id)
    await settleHidden($, merged)
    await update($, escalationMeta, m => ({ ...m, at: now, error: null }))
    // A row whose detail is missing is read at the next drawing of the pane.
    if (merged.some(x => !x.hasDetail)) markStale('escalationDetail')
    return true
  } catch (error) {
    await update($, escalationMeta, m => ({ ...m, error: errorText(error) }))
    return false
  }
}

/**
 * The rows whose detail the pane draws or acts on: those of the shown view, the open rows (the header counts the
 * recommendations Resolve all sends) and the selected row. A resolved or hidden row in another view is not read.
 */
function detailWanted(all: readonly Escalation[], hidden: readonly string[], filter: EscalationFilter, selected: string): Escalation[] {
  const ids = new Set([...viewOf(all, hidden, filter), ...viewOf(all, hidden, 'open')].map(x => x.id))
  if (selected !== '') ids.add(selected)
  return all.filter(x => ids.has(x.id))
}

/** Reads the detail of the rows the Escalations pane draws that lack it, DETAIL_CONCURRENCY at a time. */
export function pollEscalationDetail($: EngineInterface): Promise<boolean> {
  return track($, 'escalationDetail', async () => {
    // The list under way decides which rows there are.
    if (listing !== null) await listing.catch(() => undefined)
    const [all, hidden, filter, selected] = await Promise.all([read($, escalations), read($, escalationHidden), read($, escalationFilter), read($, escalationSelected)])
    const missing = detailWanted(all, hidden, filter, selected).filter(x => !x.hasDetail)
    let ok = true
    const details = await Promise.all(
      missing.map(x =>
        detailTurn(async () => {
          try {
            return { id: x.id, status: x.status, detail: parseEscalationDetail(await runText($, ['agent-msg', 'escalation', 'show', x.id], 20_000, 'escalationDetail')) }
          } catch {
            ok = false
            return null
          }
        }),
      ),
    )
    const got = new Map(details.flatMap(d => (d === null ? [] : [[d.id, d] as const])))
    // Merged into the rows as they are now: a list read or a local mark meanwhile is kept, and a detail read for a
    // status that has moved since is left for the next read.
    if (got.size > 0) await update($, escalations, current => current.map(x => (got.get(x.id)?.status === x.status ? { ...x, ...got.get(x.id)!.detail } : x)))
    return ok
  })
}

/**
 * Brings the hidden list in line with what is listed: a bare id from the old Relay list becomes
 * `id|status` at the status it has now, and an entry for a row that is gone or whose status has
 * moved is dropped, so the list cannot grow without bound. An empty listing changes nothing.
 */
async function settleHidden($: EngineInterface, listed: readonly Escalation[]): Promise<void> {
  if (listed.length === 0) return
  const byId = new Map(listed.map(x => [x.id, x]))
  // A list that is cut short only drops the hides of the rows it lost; those rows reappear.
  await changeHidden($, before => {
    const after = [
      ...new Set(
        before.flatMap(h => {
          const x = byId.get(idOf(h))
          return x ? (hideKey(x) === h || h === x.id ? [hideKey(x)] : []) : []
        }),
      ),
    ]
    return after.length === before.length && after.every((h, i) => h === before[i]) ? before : after
  })
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
  if (current === action) {
    // The confirm is spent before anything is sent, so a press while it runs arms again instead of sending again.
    await update($, escalationConfirm, () => '')
    return true
  }
  await update($, escalationConfirm, () => action)
  return false
}

/** Runs one send unless one for `key` (or Resolve all) is already running. Returns whether it ran. */
async function exclusive($: EngineInterface, key: string, run: () => Promise<void>): Promise<boolean> {
  if (!inFlight.enter(key)) return false
  await update($, escalationBusy, () => inFlight.keys())
  try {
    await run()
  } finally {
    inFlight.leave(key)
    await update($, escalationBusy, () => inFlight.keys())
  }
  return true
}

async function selectEscalation($: EngineInterface, id: string): Promise<void> {
  const current = await read($, escalationSelected)
  await update($, escalationSelected, () => (current === id ? '' : id))
  await update($, escalationDraft, () => '')
  await update($, escalationConfirm, () => '')
  // A row opened from a view whose detail was not read is read at the next drawing.
  markStale('escalationDetail')
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
  await exclusive($, id, async () => {
    try {
      await runText($, ['agent-msg', 'send', address, `Operator, on escalation ${about}: ${text}`], 60_000)
      await update($, escalationDraft, () => '')
      await notice($, `Replied to ${address}; ${id} stays open.`)
    } catch (error) {
      await notice($, `Reply to ${address} failed: ${errorText(error)}`)
    }
  })
}

/**
 * Reads the hidden list, folding in what the Relay pane called hiding, and writes the merged list
 * back once with the old key emptied, so a restore is not undone by the next start. A store that
 * cannot be read leaves the list empty; polling starts regardless.
 */
async function loadHidden($: EngineInterface): Promise<void> {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  try {
    const legacy = strings(await $.store.get(LEGACY_KEY))
    const ids = [...new Set([...strings(await $.store.get(HIDDEN_KEY)), ...legacy])]
    await update($, escalationHidden, () => ids)
    if (legacy.length > 0) {
      await $.store.set(HIDDEN_KEY, ids)
      await $.store.set(LEGACY_KEY, [])
    }
  } catch {
    await update($, escalationHidden, () => [])
  }
}

/**
 * Changes the hidden list in one step from the list as it is when the change lands (no await
 * between read and write, so a hide that lands meanwhile is not overwritten), then stores it.
 * Returns false, with a notice saying so, when the store refused the write.
 */
async function changeHidden($: EngineInterface, change: (before: string[]) => string[]): Promise<boolean> {
  let after: string[] = []
  let before: string[] = []
  await update($, escalationHidden, b => {
    before = b
    after = change(b)
    return after
  })
  if (after === before) return true
  try {
    const write = storeChain.then(async () => $.store.set(HIDDEN_KEY, await read($, escalationHidden)))
    storeChain = write.catch(() => undefined)
    await write
    return true
  } catch (error) {
    await update($, escalationNotice, () => `Could not save the hidden list: ${errorText(error)}`)
    return false
  }
}

async function hideOne($: EngineInterface, id: string): Promise<void> {
  const x = (await read($, escalations)).find(e => e.id === id)
  if (!x) return
  const ok = await changeHidden($, b => [...b.filter(h => idOf(h) !== x.id), hideKey(x)])
  await update($, escalationSelected, () => '')
  if (ok) await notice($, `Hid ${id}.`)
}

async function restoreOne($: EngineInterface, id: string): Promise<void> {
  markStale('escalationDetail')
  const ok = await changeHidden($, b => b.filter(h => idOf(h) !== id))
  await update($, escalationSelected, () => '')
  if (ok) await notice($, `Restored ${id}.`)
}

/** Hides every row of the current view. Local only: nothing is sent to the relay. */
async function hideAll($: EngineInterface): Promise<void> {
  const [all, filter] = await Promise.all([read($, escalations), read($, escalationFilter)])
  if (filter === 'hidden') return
  let count = 0
  const ok = await changeHidden($, b => {
    const rows = viewOf(all, b, filter)
    count = rows.length
    if (rows.length === 0) return b
    const ids = new Set(rows.map(x => x.id))
    return [...b.filter(h => !ids.has(idOf(h))), ...rows.map(hideKey)]
  })
  if (count === 0) return
  await update($, escalationSelected, () => '')
  if (ok) await notice($, `Hid ${count}. Nothing was sent.`)
}

async function setFilter($: EngineInterface, filter: EscalationFilter): Promise<void> {
  // The rows of another view are read at the next drawing where their detail was not.
  markStale('escalationDetail')
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

/** After a send succeeds, the row shows resolved at once, so its quick button does not come back before the next poll. */
async function markResolved($: EngineInterface, id: string, decision: string): Promise<void> {
  markedAt.set(id, ++tick)
  await update($, escalations, all => all.map(x => (x.id === id ? { ...x, status: 'resolved' as const, decision } : x)))
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
  await exclusive($, id, async () => {
    try {
      const out = await resolveCommand($, id, decision)
      await markResolved($, id, decision)
      await update($, escalationDraft, () => '')
      await update($, escalationSelected, () => '')
      await notice($, out.trim().split('\n').pop() || `Resolved ${id}.`)
    } catch (error) {
      await notice($, `Resolve ${id} failed: ${errorText(error)}`)
    }
  })
  void refreshEscalations($)
}

/** One press: resolves with the escalation's own recommendation. */
async function resolveRecommended($: EngineInterface, id: string): Promise<void> {
  const x = (await read($, escalations)).find(e => e.id === id)
  // A row listed before its detail is read has no recommendation yet: nothing is sent, and the detail is read.
  if (x !== undefined && !x.hasDetail) {
    markStale('escalationDetail')
    await notice($, `${id}: its detail is still being read.`)
    return
  }
  if (!x?.recommendation) {
    await notice($, `${id} has no recommendation; open it to write a decision.`)
    return
  }
  const recommendation = x.recommendation
  const ran = await exclusive($, id, async () => {
    try {
      const out = await resolveCommand($, id, recommendation)
      await markResolved($, id, recommendation)
      await update($, escalationSelected, () => '')
      await notice($, out.trim().split('\n').pop() || `Resolved ${id}.`)
    } catch (error) {
      await notice($, `Resolve ${id} failed: ${errorText(error)}`)
    }
  })
  if (ran) void refreshEscalations($)
}

/** What a Resolve all press does: wait while a send runs (the confirm is kept), send when the confirm is this exact set's, else arm it. */
export const bulkStep = (busy: boolean, confirm: string, key: string): 'wait' | 'arm' | 'send' =>
  busy ? 'wait' : confirm === key ? 'send' : 'arm'

/** The rows Resolve all would send: every open row of the open view that has a recommendation, and how many it leaves out. */
function bulkSet(all: readonly Escalation[], hidden: readonly string[], filter: EscalationFilter) {
  const open = filter === 'open' ? viewOf(all, hidden, 'open') : []
  const rows = open.filter(x => x.recommendation)
  // A row whose detail is still being read may have a recommendation: it is neither sent nor counted as without one.
  const loading = open.filter(x => !x.hasDetail).length
  // The arm key lists the exact ids, so a changed set is a new first press, not a confirm.
  const key = `resolve-all:${rows.map(x => x.id).sort().join(',')}`
  return { open, rows, loading, skipped: open.length - rows.length - loading, key }
}

/**
 * Resolves every open row of the view with its own recommendation; rows without one are
 * skipped and counted. The first press arms it with the exact ids, the second sends exactly
 * those, skipping any no longer open. A failed item is reported and the rest carry on; a press
 * while it runs does nothing.
 */
async function resolveAll($: EngineInterface): Promise<void> {
  const [all, hidden, filter] = await Promise.all([read($, escalations), read($, escalationHidden), read($, escalationFilter)])
  const { open, rows, loading, skipped, key } = bulkSet(all, hidden, filter)
  if (loading > 0) {
    markStale('escalationDetail')
    await notice($, `Wait: the detail of ${loading} open ${loading === 1 ? 'escalation is' : 'escalations are'} still being read.`)
    return
  }
  if (rows.length === 0) {
    await notice($, open.length === 0 ? 'Nothing is open.' : `Nothing to resolve: none of the ${open.length} open has a recommendation.`)
    return
  }
  const step = bulkStep(inFlight.busy(), await read($, escalationConfirm), key)
  if (step === 'wait') {
    // The armed confirm is left as it is.
    await update($, escalationNotice, () => 'Wait for the current send to finish.')
    return
  }
  if (step === 'arm') {
    await update($, escalationConfirm, () => key)
    return
  }
  await update($, escalationConfirm, () => '')
  const ran = await exclusive($, 'all', async () => {
    const failed: string[] = []
    let gone = 0
    for (const x of rows) {
      const now = await read($, escalations)
      const current = now.find(e => e.id === x.id)
      if (!current || !isOpen(current)) {
        gone++
        continue
      }
      try {
        await resolveCommand($, x.id, x.recommendation)
        await markResolved($, x.id, x.recommendation)
      } catch (error) {
        failed.push(`${x.id} failed: ${errorText(error)}`)
      }
    }
    const done = rows.length - failed.length - gone
    const head =
      `Resolved ${done} of ${rows.length}` +
      (skipped > 0 ? `; skipped ${skipped} with no recommendation` : '') +
      (gone > 0 ? `; ${gone} no longer open` : '') +
      '.'
    await update($, escalationSelected, () => '')
    await notice($, [head, ...failed].join('\n'))
  })
  if (!ran) {
    // Another send started first: nothing went out, so the confirm is kept.
    await update($, escalationConfirm, () => key)
    await update($, escalationNotice, () => 'Wait for the current send to finish.')
    return
  }
  void refreshEscalations($)
}

async function investigateEscalation($: EngineInterface, id: string): Promise<void> {
  if (!(await armed($, `investigate:${id}`))) return
  await exclusive($, id, async () => {
    try {
      const out = await runText($, ['agent-msg', 'investigate', id], 60_000)
      await notice($, out.trim().split('\n').pop() || `Opened an investigation session for ${id}.`)
    } catch (error) {
      await notice($, `Investigate ${id} failed: ${errorText(error)}`)
    }
  })
  void refreshEscalations($)
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

const ORDER = /^Order \S+ from (\S+) to (\S+) reached its ack deadline without an Acted receipt \(last receipt: ([^)]+)\)\.(?: It expects ticket (\S+?)\.(?:\s|$))?/

/** A row's title and the text under it. An order nobody acted on is named for what it is: it has no ticket of its own. */
function headline(x: Escalation): { title: string; summary: string } {
  const order = x.kind === 'order' ? ORDER.exec(x.context) : null
  if (!order) return { title: x.ticket || x.id, summary: x.context }
  const [, from, to, receipt, ticket] = order
  return { title: ['Unacked order', ticket ?? x.ticket].filter(Boolean).join(' · '), summary: `${from} → ${to} (${receipt})` }
}

/** Wraps text to `width` columns and keeps `max` lines, ending the last with an ellipsis when text is left over. */
export function clampLines(text: string, width: number, max: number): string[] {
  const lines: string[] = []
  let rest = text.replace(/\s+/g, ' ').trim()
  while (rest && lines.length < max) {
    if (rest.length <= width) return [...lines, rest]
    const space = rest.lastIndexOf(' ', width)
    const cut = space > 0 ? space : width
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  const last = lines.pop()
  if (last !== undefined) lines.push(rest ? `${last.slice(0, width - 1).trimEnd()}…` : last)
  return lines
}

/** Registers the command; called once at session start. register.tsx opens the pane, and hooks/visible.ts reads while it is drawn. */
export async function startEscalations($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'escalations', description: 'Same as /factory escalations' })
  await loadHidden($)
}

export function registerEscalations(on: On, _options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const isTerminal = e.surface === 'terminal'
    const [all, meta, filter, selected, draft, confirm, said, hidden, addresses, busy] = await Promise.all([
      read($, escalations),
      read($, escalationMeta),
      read($, escalationFilter),
      read($, escalationSelected),
      read($, escalationDraft),
      read($, escalationConfirm),
      read($, escalationNotice),
      read($, escalationHidden),
      read($, escalationAddress),
      read($, escalationBusy),
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
          <Text color={waiting > 0 ? 'warning' : 'success'}>{waiting > 0 ? '▲' : '●'}</Text>
          <Text weight="semibold">{waiting} waiting</Text>
          <Text dimColor>escalations</Text>
        </Box>
      )
    }

    const shown = viewOf(all, hidden, filter)
    const { rows: bulkRows, skipped, key: bulkKey } = bulkSet(all, hidden, filter)
    const withRec = bulkRows.length
    const isBusy = (id: string) => busy.includes(id) || busy.includes('all')
    const mark = (s: EscalationStatus) => (s === 'waiting' ? '▲' : s === 'investigating' ? '◐' : '✓')
    const markColor = (s: EscalationStatus) => (s === 'waiting' ? 'warning' : s === 'investigating' ? DOING : ACCENT)

    const width = Math.max(20, e.props.bodyColumns ?? 60)
    const rule = (key: string) =>
      isTerminal ? (
        <Text key={key} dimColor wrap="truncate-end">
          {'─'.repeat(width)}
        </Text>
      ) : null
    const heading = (text: string) => (
      <Text weight="semibold" size="caption">
        {text}
      </Text>
    )

    // Copies a text into the decision field. The label names the control; a blue arrow on a muted blue block is what is drawn.
    const useButton = (key: string, text: string) => (
      <Button key={key} plain label="use" onPress={() => void useText($, text)}>
        <Text backgroundColor={USE_BG} color={USE_FG} weight="bold">
          {' ➜ '}
        </Text>
      </Button>
    )

    const detail = (x: Escalation) => (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1} paddingBottom={isTerminal ? 1 : 0}>
        <Text>{x.context || 'No context was recorded.'}</Text>

        {x.options.length > 0 && (
          <Box flexDirection="column">
            {heading('Options')}
            {x.options.map((o, i) => (
              <Box key={`opt-${x.id}-${i}`} flexDirection="row" gap={1}>
                <Text dimColor>{i + 1}.</Text>
                <Box flexGrow={1}>
                  <Text>{o}</Text>
                </Box>
                {x.status !== 'resolved' && (
                  useButton(`use-${x.id}-${i}`, o)
                )}
              </Box>
            ))}
          </Box>
        )}

        {x.recommendation && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              {heading('Recommended')}
              {x.status !== 'resolved' && (
                useButton(`rec-${x.id}`, x.recommendation)
              )}
            </Box>
            <Text>{x.recommendation}</Text>
          </Box>
        )}

        {x.status === 'resolved' ? (
          <Box flexDirection="column">
            {heading('Decision')}
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
    // Each is a direct child of the row: a fragment around them draws them one under the other.
    const actions = (x: Escalation) => {
      const canResolve = filter !== 'hidden' && isOpen(x) && Boolean(x.recommendation)
      return (
        <Box key={`actions-${x.id}`} flexDirection="row" flexShrink={0} gap={isTerminal ? 2 : 1}>
          {filter === 'hidden' && (
            <Button key={`restore-${x.id}`} plain={isTerminal ? true : undefined} label={isTerminal ? 'restore' : 'Restore'} onPress={() => void restoreOne($, x.id)} />
          )}
          {canResolve && isBusy(x.id) && <Text dimColor>resolving…</Text>}
          {canResolve && !isBusy(x.id) && (
            <Button
              key={`quick-${x.id}`}
              plain={isTerminal ? true : undefined}
              variant={isTerminal ? undefined : 'primary'}
              label={isTerminal ? '✓ resolve' : 'Resolve'}
              onPress={() => void resolveRecommended($, x.id)}
            />
          )}
          {filter !== 'hidden' && (
            <Button key={`hide-${x.id}`} plain={isTerminal ? true : undefined} label={isTerminal ? 'hide' : 'Hide'} onPress={() => void hideOne($, x.id)} />
          )}
        </Box>
      )
    }

    // A closed row: what is asked in two lines, and what a one-press resolve would send (or what was decided).
    const preview = (x: Escalation, summary: string) => {
      const answer = isOpen(x) ? x.recommendation : x.decision
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {clampLines(summary, width - 4, 2).map((line, i) => (
            <Text key={`sum-${x.id}-${i}`} dimColor size="footnote" wrap="truncate-end">
              {line}
            </Text>
          ))}
          {!x.hasDetail && (
            <Text key={`loading-${x.id}`} dimColor size="footnote">
              reading its detail…
            </Text>
          )}
          {answer && (
            <Text key={`answer-${x.id}`} size="footnote" wrap="truncate-end">
              {clampLines(`${isOpen(x) ? '→' : '✓'} ${answer}`, width - 4, 1)[0]}
            </Text>
          )}
        </Box>
      )
    }

    const row = (x: Escalation) => {
      const { title, summary } = headline(x)
      return (
        <Box
          key={x.id}
          flexDirection="column"
          padding={isTerminal ? 0 : 1}
          backgroundColor={isTerminal ? undefined : selected === x.id ? CARD_BG_OPEN : CARD_BG}
        >
          {rule(`rule-${x.id}`)}
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={markColor(x.status)}>{mark(x.status)}</Text>
            <Button key={`sel-${x.id}`} plain label={title} onPress={() => void selectEscalation($, x.id)} />
            <Text dimColor size="caption" wrap="truncate-end">
              {['', x.machine, isTerminal ? '' : x.kind, filedAgo(x.filed, now)].filter((part, i) => i === 0 || part).join(' · ').trim()}
            </Text>
            <Box flexGrow={1} />
            {actions(x)}
          </Box>
          {selected === x.id ? detail(x) : preview(x, summary)}
        </Box>
      )
    }

    const filterButton = (f: EscalationFilter) => (
      <Button
        key={`filter-${f}`}
        plain={filter === f ? undefined : true}
        variant={filter === f ? 'primary' : undefined}
        label={`${f} ${counts[f]}`}
        onPress={() => void setFilter($, f)}
      />
    )

    // Armed only while the open set is the one that was confirmed; a changed set drops the confirm.
    const bulkArmed = confirm === bulkKey
    const noticeLines = said.split('\n').filter(Boolean)

    return (
      <Box flexDirection="column" gap={isTerminal ? 0 : 1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color={waiting > 0 ? 'warning' : 'subtle'} weight="semibold">
            {waiting} waiting
          </Text>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void refreshEscalations($)} />
        </Box>

        <Box flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
          <Box flexDirection="row" gap={1}>
            {filterButton('open')}
            {filterButton('resolved')}
            {filterButton('hidden')}
          </Box>

        {filter !== 'hidden' && shown.length > 0 && (
          <Box flexDirection="row" gap={2}>
            <Button key="hide-all" plain={isTerminal ? true : undefined} label={`Hide all ${shown.length}`} onPress={() => void hideAll($)} />
            {filter === 'open' && busy.includes('all') && <Text dimColor>resolving…</Text>}
            {filter === 'open' && !busy.includes('all') && (
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
        </Box>
        {bulkArmed && (
          <Text color="warning" size="caption">
            Resolve {withRec} {withRec === 1 ? 'escalation' : 'escalations'} with {withRec === 1 ? 'its' : 'each one’s'} recommendation
            {skipped > 0 ? `; ${skipped} with none will be skipped` : ''}. Press again to send.
          </Text>
        )}

        <Box flexDirection="column" gap={isTerminal ? 0 : 1}>
          {shown.length === 0 && <Text dimColor>No {filter} escalations.</Text>}
          {shown.slice(0, MAX_ROWS).map(row)}
          {shown.length > MAX_ROWS && (
            <Text dimColor size="caption">
              +{shown.length - MAX_ROWS} more not shown; Hide all and Resolve all include them
            </Text>
          )}
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
        {e.props.placement === 'inline' && (
          <Text dimColor size="caption">
            Type a band number to switch views · r refresh · Esc close
          </Text>
        )}
      </Box>
    )
  })
}
