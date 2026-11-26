import type { EngineInterface } from 'claude-code'

import { home } from './selection'
import { errorText, runJson, runText, spawn, writeWhole } from './shared'

// The leads' work reports, read once for the Focus and the Work view. A lead on another machine is reached through
// ssh and answers in several seconds, so the reads are few at a time and given the time they take; a report that
// cannot be read is answered with the one last read, and says so. This mod loads in every session, so the reports of
// other machines are shared in a file every session on this machine reads: one session reads a lead and claims it
// there while it does, and no more than LEAD_CONCURRENCY claims stand at once.

/** `agent-msg who` and `agent-msg work events` read the local relay: they are given up on after this long. */
export const RELAY_TIMEOUT_MS = 5_000
/** One lead's `agent-msg work show` is given up on after this long: remote leads have answered after 10 seconds. */
export const LEAD_TIMEOUT_MS = 20_000
/** At most this many lead reports are read at once, whatever asks. */
export const LEAD_CONCURRENCY = 8
/** A report read this lately is answered to the other view without a second read. */
export const LEAD_REUSE_MS = 30_000
/**
 * What the Focus view draws of a lead, the focus it works on, changes when the lead takes up other work: a report read
 * this lately answers it without a read, unless the refresh key or a choice asks anew. The Work view, which draws the
 * lead's agents, keeps LEAD_REUSE_MS, and the Focus view takes the reports it read.
 */
export const FOCUS_REUSE_MS = 10 * 60 * 1000
/** The lead list `agent-msg who` gave is answered to every view, the Message pane among them, for this long. */
export const WHO_REUSE_MS = 60_000
/** A report whose latest read failed is asked again this soon, whatever the reuse asked for. */
export const FAILED_REUSE_MS = 30_000
/** A report of another machine that any session read this lately is not read again. */
export const SHARED_REUSE_MS = 50_000
/** A lead on another machine that reported nothing is asked again only after this long. */
export const SILENT_REMOTE_MS = 5 * 60 * 1000
/** A read another session claimed is left to it this long: both tries of it, and a little. */
const CLAIM_MS = 2 * LEAD_TIMEOUT_MS + 5_000
/** A shared report nobody has asked for in this long is dropped. */
const SHARED_UNUSED_MS = 24 * 60 * 60 * 1000

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
  /** true where another session is reading the lead and nothing of it is at hand */
  pending?: boolean
}

/** What is held of a lead, and when it was last asked. */
type Held = LeadRead & { triedAt: number }

const held = new Map<string, Held>()
const underWay = new Map<string, Promise<LeadRead>>()
let listing: Promise<string[]> | null = null
/** The last lead list read well, and when. */
let listed: { at: number; leads: string[] } | null = null
let busy = 0
const waiting: (() => void)[] = []

/** Forgets every report; a new session has read none. */
export function resetLeads(): void {
  held.clear()
  underWay.clear()
  here = null
  lock = Promise.resolve()
  listing = null
  listed = null
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
  const text = await twice(() => runText($, ['agent-msg', 'who'], RELAY_TIMEOUT_MS, 'who'))
  const leads = text
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(address => address.split(':').length === 3)
  // A lead no longer listed is forgotten, so that it does not come back with an old report.
  for (const address of held.keys()) if (!leads.includes(address)) held.delete(address)
  listed = { at: await $.clock.now(), leads }
  return leads
}

/**
 * The verified lead addresses `agent-msg who` lists; unverified rows start with `-`. Askers at once share one call, and
 * a list read less than `reuseMs` ago (0 for the refresh key) answers without one.
 */
export async function listLeads($: EngineInterface, reuseMs = WHO_REUSE_MS): Promise<string[]> {
  if (listing === null && listed !== null && reuseMs > 0 && (await $.clock.now()) - listed.at < reuseMs) return listed.leads
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

// ---------------------------------------------------------------- shared with the other sessions

/** What the shared file keeps of one lead of another machine. A lead never read has no `report` key. */
type Shared = { report?: WorkReport | null; at: number | null; error: string | null; triedAt: number | null; claimAt: number | null }
type SharedFile = Record<string, Shared>

const SHARED_FILE = 'lead-reports.json'

let here: Promise<string> | null = null
/** This machine's short name, lower-case; '' where it cannot be read, and then every lead is taken as another's. */
function hostName($: EngineInterface): Promise<string> {
  here ??= spawn($, ['hostname', '-s'], 3_000).then(
    ran => ran.stdout.trim().toLowerCase(),
    () => '',
  )
  return here
}

async function sharedPath($: EngineInterface): Promise<string> {
  return `${await home($)}/.ix/factory-panel/${SHARED_FILE}`
}

async function loadShared($: EngineInterface): Promise<SharedFile> {
  try {
    const parsed = JSON.parse(await $.fs.read(await sharedPath($))) as { leads?: SharedFile }
    return parsed.leads ?? {}
  } catch {
    return {}
  }
}

/** The file is read, changed and written by every lead read in this session; two at once would lose each other's. */
let lock: Promise<unknown> = Promise.resolve()
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = lock.then(run, run)
  lock = next.catch(() => undefined)
  return next
}

async function saveShared($: EngineInterface, address: string, entry: Shared, now: number): Promise<void> {
  // Re-read before writing, so that another session's leads written meanwhile survive.
  const file = await loadShared($)
  file[address] = entry
  const used = (e: Shared): number => Math.max(e.triedAt ?? 0, e.claimAt ?? 0)
  await writeWhole($, await sharedPath($), JSON.stringify({ leads: Object.fromEntries(Object.entries(file).filter(([, e]) => now - used(e) <= SHARED_UNUSED_MS)) }))
}

/** Either the lead is this session's to read, or it is answered from what the file holds. */
type Turn = { read: true; entry?: Shared } | { read: false; entry: Shared | undefined; isBusy: boolean }

/** Claims a lead for this session, unless it was read lately, is claimed, or enough reads are claimed already. */
function claim($: EngineInterface, address: string, reuseMs: number): Promise<Turn> {
  return exclusive(async (): Promise<Turn> => {
    const now = await $.clock.now()
    const file = await loadShared($)
    const entry = file[address]
    const isLive = (e: Shared | undefined): boolean => e !== undefined && e.claimAt !== null && now - e.claimAt < CLAIM_MS
    // `reuseMs` 0 is the refresh key: it reads anew, though never a lead being read.
    if (reuseMs > 0 && entry !== undefined && entry.triedAt !== null) {
      const fresh = entry.report === null && entry.error === null ? Math.max(reuseMs, SILENT_REMOTE_MS) : entry.error !== null ? SHARED_REUSE_MS : Math.max(reuseMs, SHARED_REUSE_MS)
      if (now - entry.triedAt < fresh) return { read: false, entry, isBusy: false }
    }
    if (isLive(entry) || Object.values(file).filter(isLive).length >= LEAD_CONCURRENCY) return { read: false, entry, isBusy: true }
    const mine = now + Math.random() / 10
    await saveShared($, address, { at: null, error: null, triedAt: null, ...entry, claimAt: mine }, now)
    const back = (await loadShared($))[address]
    return back?.claimAt === mine ? { read: true, entry } : { read: false, entry: back, isBusy: true }
    // With the file unwritable no claim can be made or checked; this session reads on its own.
  }).catch((): Turn => ({ read: true }))
}

// ---------------------------------------------------------------- reading

/** `agent-msg work show` prints `null` for a lead that has reported nothing: that is no report, not a failure. */
async function ask($: EngineInterface, address: string, reuseMs: number): Promise<LeadRead> {
  const isShared = (address.split(':')[0] ?? '').toLowerCase() !== (await hostName($))
  let shared: Shared | undefined
  if (isShared) {
    const turn = await claim($, address, reuseMs)
    if (!turn.read) return adopt(address, turn.entry, turn.isBusy)
    shared = turn.entry
  }
  const triedAt = await $.clock.now()
  let next: Held
  try {
    const report = await twice(() => runJson<WorkReport | null>($, ['agent-msg', 'work', '--lead', address, 'show'], LEAD_TIMEOUT_MS, 'leads'))
    next = { address, report, at: await $.clock.now(), error: null, triedAt }
  } catch (error) {
    // The report last read, by this session or by another.
    const own = held.get(address)
    const prior = own?.report === undefined ? shared : own
    next = { address, report: prior?.report, at: prior?.at ?? null, error: errorText(error), triedAt }
  }
  held.set(address, next)
  if (isShared) {
    const { report, at, error } = next
    // A failed save loses nothing here: the other sessions read the lead themselves once the claim is old.
    await exclusive(() => saveShared($, address, { report, at, error, triedAt, claimAt: null }, triedAt)).catch(() => undefined)
  }
  return next
}

/** A lead answered from what another read left: its entry, or what this session held where that is nothing. */
function adopt(address: string, entry: Shared | undefined, isBusy: boolean): LeadRead {
  const prior = held.get(address)
  // A lead being read is asked of the file again at the next poll.
  const triedAt = isBusy ? Number.NEGATIVE_INFINITY : (entry?.triedAt ?? Number.NEGATIVE_INFINITY)
  const next: Held =
    entry !== undefined && entry.triedAt !== null
      ? // A failed read keeps the report this session holds where the file has none.
        { address, report: entry.report === undefined ? prior?.report : entry.report, at: entry.at ?? prior?.at ?? null, error: entry.error, triedAt }
      : prior !== undefined
        ? { ...prior, triedAt }
        : { address, report: undefined, at: null, error: null, pending: true, triedAt }
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
  // A lead whose read failed is asked again soon; one that answered is answered from its report for `reuseMs`.
  const reuse = had?.error === null || had === undefined ? reuseMs : Math.min(reuseMs, FAILED_REUSE_MS)
  if (had !== undefined && (await $.clock.now()) - had.triedAt < reuse) return had
  // Another asker may have started the read while the clock was asked.
  let read = underWay.get(address)
  if (read === undefined) {
    read = inTurn(() => ask($, address, reuseMs)).finally(() => underWay.delete(address))
    underWay.set(address, read)
  }
  return read
}
