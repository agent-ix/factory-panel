import type { EngineInterface } from 'claude-code'

import { errorText, runJson, runText } from './shared'

// The leads' work reports, read once for the Focus and the Work view. A lead on another machine is reached through
// ssh and answers in several seconds, so the reads are few at a time and given the time they take; a report that
// cannot be read is answered with the one last read, and says so.

/** `agent-msg who` and `agent-msg work events` read the local relay: they are given up on after this long. */
export const RELAY_TIMEOUT_MS = 5_000
/** One lead's `agent-msg work show` is given up on after this long: remote leads have answered after 10 seconds. */
export const LEAD_TIMEOUT_MS = 20_000
/** At most this many lead reports are read at once, whatever asks. */
export const LEAD_CONCURRENCY = 8
/** A report read this lately is answered to the other view without a second read. */
export const LEAD_REUSE_MS = 30_000

/** A failure that a second try at once may not meet: the relay's Redis, herdr or ssh on another machine did not answer. */
const TRANSIENT = /Resource temporarily unavailable|herdr call timed out|ConnectionAborted|Connection closed by/i

export type WorkReport = {
  binding?: { machine?: string; kind?: string; address?: string }
  agents?: { name?: string; ticket?: string; role?: string; status?: string; reported_at_ms?: number }[]
  scope?: { initiatives?: string[]; projects?: string[]; tickets?: string[]; reported_at_ms?: number } | null
  focus?: { summary?: string; tickets?: string[]; reported_at_ms?: number } | null
}

export type LeadRead = {
  address: string
  /** the report last read: null where the lead has reported nothing, undefined where none was ever read */
  report: WorkReport | null | undefined
  /** when `report` was read */
  at: number | null
  /** why the latest read failed; null where it answered */
  error: string | null
}

/** What is held of a lead, and when it was last asked. */
type Held = LeadRead & { triedAt: number }

const held = new Map<string, Held>()
const underWay = new Map<string, Promise<LeadRead>>()
let listing: Promise<string[]> | null = null
let busy = 0
const waiting: (() => void)[] = []

/** Forgets every report; a new session has read none. */
export function resetLeads(): void {
  held.clear()
  underWay.clear()
  listing = null
  busy = 0
  waiting.length = 0
}

/** Runs a relay command, and once more where it failed in a way that passes. */
export async function twice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!TRANSIENT.test(errorText(error))) throw error
    return run()
  }
}

async function list($: EngineInterface): Promise<string[]> {
  const text = await twice(() => runText($, ['agent-msg', 'who'], RELAY_TIMEOUT_MS))
  const leads = text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(address => address.split(':').length === 3)
  // A lead no longer listed is forgotten, so that it does not come back with an old report.
  for (const address of held.keys()) if (!leads.includes(address)) held.delete(address)
  return leads
}

/** The verified lead addresses `agent-msg who` lists; unverified rows start with `-`. Askers at once share one call. */
export function listLeads($: EngineInterface): Promise<string[]> {
  listing ??= list($).finally(() => {
    listing = null
  })
  return listing
}

/** Runs `read` when one of the LEAD_CONCURRENCY places is free. */
async function inTurn<T>(read: () => Promise<T>): Promise<T> {
  if (busy < LEAD_CONCURRENCY) busy++
  else await new Promise<void>(resolve => waiting.push(resolve))
  try {
    return await read()
  } finally {
    // The place passes to the next in line.
    const next = waiting.shift()
    if (next === undefined) busy--
    else next()
  }
}

/** `agent-msg work show` prints `null` for a lead that has reported nothing: that is no report, not a failure. */
async function ask($: EngineInterface, address: string): Promise<LeadRead> {
  const triedAt = await $.clock.now()
  let next: Held
  try {
    const report = await twice(() => runJson<WorkReport | null>($, ['agent-msg', 'work', '--lead', address, 'show'], LEAD_TIMEOUT_MS))
    next = { address, report, at: await $.clock.now(), error: null, triedAt }
  } catch (error) {
    const prior = held.get(address)
    next = { address, report: prior?.report, at: prior?.at ?? null, error: errorText(error), triedAt }
  }
  held.set(address, next)
  return next
}

/**
 * One lead's report. A read under way is shared; one asked less than `reuseMs` ago is answered from what it left.
 * Never rejects.
 */
export async function readLead($: EngineInterface, address: string, reuseMs = LEAD_REUSE_MS): Promise<LeadRead> {
  const running = underWay.get(address)
  if (running !== undefined) return running
  const had = held.get(address)
  if (had !== undefined && (await $.clock.now()) - had.triedAt < reuseMs) return had
  // Another asker may have started the read while the clock was asked.
  let read = underWay.get(address)
  if (read === undefined) {
    read = inTurn(() => ask($, address)).finally(() => underWay.delete(address))
    underWay.set(address, read)
  }
  return read
}
