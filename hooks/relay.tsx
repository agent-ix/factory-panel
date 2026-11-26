import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Announcement, RelayMeta } from '../types'
import { ago, errorText, runText } from './shared'
import type { Options } from './shared'
import { track } from './schedule'
import { listLeads } from './leads'

// The Message pane (view id `relay`): a message to one lead or all of them, through `agent-msg`.
// Escalations have their own pane.
// A send takes a second press to confirm, and reports what the relay answered.

const PANE = 'relay'
const TITLE = 'Message'
/** The width of the To column. */
const FIELD = 9
export const PANE_SPEC = { id: PANE, title: TITLE }

const announcements = atom({ plugin: 'factory-panel', key: 'announcements' } as const, [] as Announcement[], {
  shape: 'announcements-1',
})
const relayMeta = atom(
  { plugin: 'factory-panel', key: 'relayMeta' } as const,
  { at: null, error: null, human: 'operator' } as RelayMeta,
  { shape: 'relayMeta-1' },
)
const relayLeads = atom({ plugin: 'factory-panel', key: 'relayLeads' } as const, [] as string[])
const relayAnnounce = atom({ plugin: 'factory-panel', key: 'relayAnnounce' } as const, '')
const relayTarget = atom({ plugin: 'factory-panel', key: 'relayTarget' } as const, 'all')
const relayConfirm = atom({ plugin: 'factory-panel', key: 'relayConfirm' } as const, '')
const relayNotice = atom({ plugin: 'factory-panel', key: 'relayNotice' } as const, '')

// ---------------------------------------------------------------- parsing

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

/** The pane draws this many broadcasts. */
const SHOWN = 30
/** The first read looks this far back, for at most FULL_MAX messages of any kind. */
const FULL_SINCE = '14d'
const FULL_MAX = 2000
/** A later read asks only for the minutes since the last read that answered, and a minute more, at most this many. */
const SINCE_MAX = 500

/** When the broadcasts were last read well; null before the first such read of the session. */
let logReadAt: number | null = null

/** Forgets the broadcasts' cursor; a new session reads them in full once. */
export function resetRelay(): void {
  logReadAt = null
}

/** The broadcasts newest first, each once: those just read, then those held. */
const joined = (fresh: readonly Announcement[], held: readonly Announcement[]): Announcement[] => {
  const keyOf = (a: Announcement) => `${a.at}\u0000${a.from}\u0000${a.text}`
  const seen = new Set<string>()
  return [...fresh, ...held].filter(a => !seen.has(keyOf(a)) && (seen.add(keyOf(a)), true)).slice(0, SHOWN)
}

/** Reads the broadcasts and the leads; false when either failed. */
export function pollRelay($: EngineInterface): Promise<boolean> {
  return track($, 'announcements', () => readRelay($))
}

async function readRelay($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  const failed: string[] = []
  // The whole log once, then only what came since: the pane keeps the newest SHOWN broadcasts.
  const minutes = logReadAt === null ? null : Math.ceil((now - logReadAt) / 60_000) + 1
  const logArgs = minutes === null || minutes >= 14 * 24 * 60 ? ['--since', FULL_SINCE, '--max', String(FULL_MAX)] : ['--since', `${minutes}m`, '--max', String(SINCE_MAX)]
  const [logText, leads] = await Promise.all([
    runText($, ['agent-msg', 'log', ...logArgs], 30_000, 'announcements').catch(error => {
      failed.push(`log: ${errorText(error)}`)
      return null
    }),
    // The lead list the Focus and Work views read too, shared for a minute.
    listLeads($).catch(error => {
      failed.push(`who: ${errorText(error)}`)
      return null
    }),
  ])
  // What was read is kept; what failed keeps its last value and the footer says why.
  if (logText !== null) {
    const isFull = minutes === null
    await update($, announcements, held => joined(parseAnnouncements(logText), isFull ? [] : held))
    logReadAt = now
  }
  if (leads !== null) await update($, relayLeads, () => [...new Set(leads)].sort())
  await update($, relayMeta, m => ({ ...m, at: failed.length === 0 ? now : m.at, error: failed[0] ?? null }))
  return failed.length === 0
}

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

/** Registers the command; called once at session start. register.tsx opens the pane, and hooks/visible.ts reads while it is drawn. */
export async function startRelay($: EngineInterface, _options: Options): Promise<void> {
  await $.command.register({ name: 'relay', description: 'Same as /factory relay' })
}

export function registerRelay(on: On, _options: Options): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const [posts, meta, leads, announce, target, confirm, said] = await Promise.all([
      read($, announcements),
      read($, relayMeta),
      read($, relayLeads),
      read($, relayAnnounce),
      read($, relayTarget),
      read($, relayConfirm),
      read($, relayNotice),
    ])
    const now = await $.clock.now()

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1}>
          <Text color={meta.error ? 'warning' : 'success'}>{meta.error ? '▲' : '●'}</Text>
          <Text weight="semibold">{meta.error ? 'relay read failed' : leads.length}</Text>
          {!meta.error && <Text dimColor>leads on the relay</Text>}
        </Box>
      )
    }

    const targets = ['all', ...leads]
    const width = Math.max(20, e.props.bodyColumns ?? 60)
    const rule = (key: string) => (
      <Text key={key} dimColor wrap="truncate-end">
        {'─'.repeat(width)}
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="refresh" plain label="↻" hotkey="r" onPress={() => void pollRelay($)} />
        </Box>

        {rule('rule-above-to')}
        <Box flexDirection="row">
          <Box width={FIELD}>
            <Text dimColor>To</Text>
          </Box>
          <Select
            key="target"
            value={target}
            options={targets.map(t => ({ value: t, label: t === 'all' ? 'every lead' : t }))}
            onSelect={value => void setTarget($, value)}
          />
        </Box>
        {rule('rule-below-to')}

        <Input
          key="announce"
          placeholder="Type your message…"
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
          <Box flexDirection="column" marginTop={1}>
            {rule('rule-history')}
            {posts.slice(0, 8).map((p, n) => (
              <Box key={`post-${n}`} flexDirection="row" gap={1}>
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

        <Box flexDirection="row" justifyContent="space-between">
          <Text size="caption">{said}</Text>
          <Text color={meta.error ? 'warning' : 'subtle'} size="caption">
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
