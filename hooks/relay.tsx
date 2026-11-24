import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Announcement, Escalation, EscalationStatus, RelayMeta } from '../types'
import { CARD_BG, CARD_BG_OPEN, ago, errorText, runJson, runText } from './shared'
import type { Options } from './shared'

// The Relay pane: the operator's escalation inbox and the broadcast channel, both through
// `agent-msg`. Anything that leaves the pane (a resolve, an investigate, a message) takes a
// second press to confirm, and reports what the relay answered.

const PANE = 'relay'
const TITLE = 'Relay'
export const PANE_SPEC = { id: PANE, title: TITLE }
const POLL_MS = 60 * 1000

const escalations = atom({ plugin: 'factory-panel', key: 'escalations' } as const, [] as Escalation[], {
  shape: 'escalations-1',
})
const announcements = atom({ plugin: 'factory-panel', key: 'announcements' } as const, [] as Announcement[], {
  shape: 'announcements-1',
})
const relayMeta = atom(
  { plugin: 'factory-panel', key: 'relayMeta' } as const,
  { at: null, error: null, human: 'operator' } as RelayMeta,
  { shape: 'relayMeta-1' },
)
const relayLeads = atom({ plugin: 'factory-panel', key: 'relayLeads' } as const, [] as string[])
const relayFilter = atom({ plugin: 'factory-panel', key: 'relayFilter' } as const, 'waiting' as RelayFilter)
/** Escalation ids cleared from the pane. ix-relay has no way to close one without a decision, so this is the pane's own. */
const relayCleared = atom({ plugin: 'factory-panel', key: 'relayCleared' } as const, [] as string[])
/** Each opened escalation's lead, as an address `send` takes; '' when its session has ended. */
const relayAddress = atom({ plugin: 'factory-panel', key: 'relayAddress' } as const, {} as Record<string, string>)
const CLEARED_KEY = 'clearedEscalations'
const relaySelected = atom({ plugin: 'factory-panel', key: 'relaySelected' } as const, '')
const relayDraft = atom({ plugin: 'factory-panel', key: 'relayDraft' } as const, '')
const relayAnnounce = atom({ plugin: 'factory-panel', key: 'relayAnnounce' } as const, '')
const relayTarget = atom({ plugin: 'factory-panel', key: 'relayTarget' } as const, 'all')
const relayConfirm = atom({ plugin: 'factory-panel', key: 'relayConfirm' } as const, '')
const relayNotice = atom({ plugin: 'factory-panel', key: 'relayNotice' } as const, '')

// ---------------------------------------------------------------- parsing

const STATUSES: readonly EscalationStatus[] = ['waiting', 'investigating', 'resolved']
type RelayFilter = EscalationStatus | 'cleared'

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

/** `11-21 09:41 from -> to: text`; only broadcasts (to `all`) are announcements. */
export function parseAnnouncements(text: string): Announcement[] {
  const out: Announcement[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d\d-\d\d \d\d:\d\d) (\S+) -> (\S+): (.*)$/)
    if (m && m[3] === 'all') out.push({ at: m[1] ?? '', from: m[2] ?? '', to: 'all', text: m[4] ?? '' })
  }
  return out.reverse()
}

// ---------------------------------------------------------------- polling

async function pollRelay($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  try {
    const [listText, logText, whoText] = await Promise.all([
      runText($, ['agent-msg', 'escalations'], 20_000),
      runText($, ['agent-msg', 'log', '--since', '14d', '--max', '2000'], 30_000).catch(() => ''),
      runText($, ['agent-msg', 'who'], 20_000).catch(() => ''),
    ])
    const listed = parseEscalationList(listText)
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
    await update($, announcements, () => parseAnnouncements(logText).slice(0, 30))
    const leads = whoText
      .split('\n')
      .map(line => line.trim().split(/\s+/)[0] ?? '')
      .filter(a => a.split(':').length === 3)
    await update($, relayLeads, () => [...new Set(leads)].sort())
    await update($, relayMeta, m => ({ ...m, at: now, error: null }))
  } catch (error) {
    await update($, relayMeta, m => ({ ...m, error: errorText(error) }))
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
  await update($, relayNotice, () => text)
  await update($, relayConfirm, () => '')
}

/** A first press arms the action; a second press on the same action runs it. */
async function armed($: EngineInterface, action: string): Promise<boolean> {
  const current = await read($, relayConfirm)
  if (current === action) return true
  await update($, relayConfirm, () => action)
  return false
}

async function selectEscalation($: EngineInterface, id: string): Promise<void> {
  const current = await read($, relaySelected)
  await update($, relaySelected, () => (current === id ? '' : id))
  await update($, relayDraft, () => '')
  await update($, relayConfirm, () => '')
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
  await update($, relayAddress, all => ({ ...all, [id]: address }))
}

async function replyEscalation($: EngineInterface, id: string): Promise<void> {
  const text = (await read($, relayDraft)).trim()
  const address = (await read($, relayAddress))[id]
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
    await update($, relayDraft, () => '')
    await notice($, `Replied to ${address}; ${id} stays open.`)
  } catch (error) {
    await notice($, `Reply to ${address} failed: ${errorText(error)}`)
  }
}

async function loadCleared($: EngineInterface): Promise<void> {
  const stored = await $.store.get(CLEARED_KEY)
  const ids = Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
  await update($, relayCleared, () => ids)
}

async function toggleCleared($: EngineInterface, id: string): Promise<void> {
  const before = await read($, relayCleared)
  const after = before.includes(id) ? before.filter(c => c !== id) : [...before, id]
  await update($, relayCleared, () => after)
  await $.store.set(CLEARED_KEY, after)
  await update($, relaySelected, () => '')
  await notice($, before.includes(id) ? `Restored ${id}.` : `Cleared ${id} from the pane.`)
}

async function setFilter($: EngineInterface, status: RelayFilter): Promise<void> {
  await update($, relayFilter, () => status)
  await update($, relaySelected, () => '')
  await update($, relayConfirm, () => '')
}

async function useText($: EngineInterface, text: string): Promise<void> {
  await update($, relayDraft, () => text)
  await update($, relayConfirm, () => '')
}

async function setDraft($: EngineInterface, text: string): Promise<void> {
  await update($, relayDraft, () => text)
}

async function resolveEscalation($: EngineInterface, id: string): Promise<void> {
  const decision = (await read($, relayDraft)).trim()
  if (!decision) {
    await notice($, `Write a decision for ${id} first, or pick an option.`)
    return
  }
  if (!(await armed($, `resolve:${id}`))) return
  try {
    const out = await runText($, ['agent-msg', 'resolve', id, decision], 60_000)
    await update($, relayDraft, () => '')
    await update($, relaySelected, () => '')
    await notice($, out.trim().split('\n').pop() || `Resolved ${id}.`)
  } catch (error) {
    await notice($, `Resolve ${id} failed: ${errorText(error)}`)
  }
  void pollRelay($)
}

async function investigateEscalation($: EngineInterface, id: string): Promise<void> {
  if (!(await armed($, `investigate:${id}`))) return
  try {
    const out = await runText($, ['agent-msg', 'investigate', id], 60_000)
    await notice($, out.trim().split('\n').pop() || `Opened an investigation session for ${id}.`)
  } catch (error) {
    await notice($, `Investigate ${id} failed: ${errorText(error)}`)
  }
  void pollRelay($)
}

async function setAnnounce($: EngineInterface, text: string): Promise<void> {
  await update($, relayAnnounce, () => text)
}

async function setTarget($: EngineInterface, target: string): Promise<void> {
  await update($, relayTarget, () => target)
  await update($, relayConfirm, () => '')
}

async function sendAnnouncement($: EngineInterface): Promise<void> {
  const text = (await read($, relayAnnounce)).trim()
  const target = await read($, relayTarget)
  if (!text) {
    await notice($, 'Write the message first.')
    return
  }
  if (!(await armed($, `send:${target}`))) return
  try {
    await runText($, ['agent-msg', 'send', target, text], 60_000)
    await update($, relayAnnounce, () => '')
    await notice($, target === 'all' ? 'Sent to every lead.' : `Sent to ${target}.`)
  } catch (error) {
    await notice($, `Send failed: ${errorText(error)}`)
  }
  void pollRelay($)
}

async function cancelArmed($: EngineInterface): Promise<void> {
  await update($, relayConfirm, () => '')
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
export async function startRelay($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'relay', description: 'Open the Relay pane: escalations and announcements' })
  await loadCleared($)
  void pollRelay($)
  $.clock.every(POLL_MS, () => pollRelay($))
}

export function registerRelay(on: On, _options: Options): void {
  on('command.run', { command: 'relay' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    void pollRelay($)
    return { text: opened.isPlaced ? 'Relay pane opened.' : `Relay pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const [all, posts, meta, leads, filter, selected, draft, announce, target, confirm, said, cleared, addresses] =
      await Promise.all([
        read($, escalations),
        read($, announcements),
        read($, relayMeta),
        read($, relayLeads),
        read($, relayFilter),
        read($, relaySelected),
        read($, relayDraft),
        read($, relayAnnounce),
        read($, relayTarget),
        read($, relayConfirm),
        read($, relayNotice),
        read($, relayCleared),
        read($, relayAddress),
      ])
    const list = all.filter(x => !cleared.includes(x.id))
    const now = await $.clock.now()
    const count = (s: EscalationStatus) => list.filter(x => x.status === s).length
    const waiting = count('waiting')

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

    const shown = filter === 'cleared' ? all.filter(x => cleared.includes(x.id)) : list.filter(x => x.status === filter)
    const clearedCount = all.filter(x => cleared.includes(x.id)).length
    const mark = (s: EscalationStatus) => (s === 'waiting' ? '▲' : s === 'investigating' ? '◐' : '✓')
    const markColor = (s: EscalationStatus) =>
      s === 'waiting' ? 'warning' : s === 'investigating' ? 'claude' : 'success'

    const detail = (x: Escalation) => (
      <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
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
            <Box flexDirection="row" justifyContent="flex-end">
              <Button
                key={`clear-${x.id}`}
                plain
                label={cleared.includes(x.id) ? 'Restore' : 'Clear'}
                onPress={() => void toggleCleared($, x.id)}
              />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
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
            <Box flexDirection="row" gap={1}>
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
              {confirm && <Button key="cancel" plain label="cancel" onPress={() => void cancelArmed($)} />}
              <Box flexGrow={1} />
              <Button key={`clear-${x.id}`} plain label={cleared.includes(x.id) ? 'Restore' : 'Clear'} onPress={() => void toggleCleared($, x.id)} />
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

    const targets = ['all', ...leads]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="semibold" size="heading">
            Relay
          </Text>
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollRelay($)} />
        </Box>

        <Box flexDirection="row" gap={1}>
          {STATUSES.map(s => (
            <Button
              key={`filter-${s}`}
              plain={filter === s ? undefined : true}
              variant={filter === s ? 'primary' : undefined}
              label={`${s} ${count(s)}`}
              onPress={() => void setFilter($, s)}
            />
          ))}
          {clearedCount > 0 && (
            <Button
              key="filter-cleared"
              plain={filter === 'cleared' ? undefined : true}
              variant={filter === 'cleared' ? 'primary' : undefined}
              label={`cleared ${clearedCount}`}
              onPress={() => void setFilter($, 'cleared')}
            />
          )}
        </Box>

        <Box flexDirection="column" gap={1}>
          {shown.length === 0 && <Text dimColor>No {filter} escalations.</Text>}
          {shown.slice(0, 40).map(x => (
            <Box
              key={x.id}
              flexDirection="column"
              padding={1}
              backgroundColor={selected === x.id ? CARD_BG_OPEN : CARD_BG}
            >
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text color={markColor(x.status)}>{mark(x.status)}</Text>
                <Button key={`sel-${x.id}`} plain label={x.ticket || x.id} onPress={() => void selectEscalation($, x.id)} />
                <Box flexGrow={1} />
                <Text dimColor size="caption">
                  {[x.machine, x.kind, filedAgo(x.filed, now)].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {selected !== x.id && x.context && (
                <Text dimColor size="footnote" wrap="truncate-end">
                  {x.context}
                </Text>
              )}
              {selected === x.id && detail(x)}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" gap={1} padding={1} backgroundColor={CARD_BG}>
          <Text weight="semibold">Announce</Text>
          <Select
            key="target"
            label="To"
            value={target}
            options={targets.map(t => ({ value: t, label: t === 'all' ? 'every lead' : t }))}
            onSelect={value => void setTarget($, value)}
          />
          <Input
            key="announce"
            placeholder="Message to send over the relay"
            value={announce}
            rows={2}
            submitLabel="Send"
            onInput={value => void setAnnounce($, value)}
            onSubmit={() => void sendAnnouncement($)}
          />
          <Box flexDirection="row" gap={1}>
            <Button
              key="send"
              variant="primary"
              label={confirm === `send:${target}` ? `Confirm send to ${target === 'all' ? 'every lead' : target}` : 'Send'}
              onPress={() => void sendAnnouncement($)}
            />
            {confirm.startsWith('send:') && <Button key="cancel-send" plain label="cancel" onPress={() => void cancelArmed($)} />}
          </Box>
          {posts.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor size="caption">
                Recent broadcasts
              </Text>
              {posts.slice(0, 8).map((p, i) => (
                <Box key={`post-${i}`} flexDirection="row" gap={1}>
                  <Text dimColor size="caption" tabular>
                    {p.at}
                  </Text>
                  <Text dimColor size="caption">
                    {p.from}
                  </Text>
                  <Text size="caption" wrap="truncate-end">
                    {p.text}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text size="caption">{said}</Text>
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
            {meta.error ?? `updated ${ago(meta.at, now)}`}
          </Text>
        </Box>
      </Box>
    )
  })
}
