import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface } from 'claude-code'

import type { CapacityCell, CapacityMetric, CapacityView } from '../types'
import { CARD_BG, ago, errorText, failureText, promQuery } from './shared'
import type { Options, Sample } from './shared'
import { track } from './schedule'
import { sourceClear, sourceFailed, sourceOk } from './sources'

// The Team view's Capacity section: each host's busy ratio and ready-buffer deficit from the ix_fleet_* series, and
// its output against its recorded sustainable level from this machine's fleet ledger, or for a host with no row there
// from the series the exporter publishes of it. Every read is read-only: `fleet saturation` and the `fleet capacity`
// commands are never run from here.

const capacity = atom({ plugin: 'factory-panel', key: 'capacity' } as const, null as CapacityView | null, { shape: 'capacity-2' })

/** Twice the watcher's push interval, as ix-board judges the busy ratio. */
const BUSY_STALE_S = 60
/** Twice the fleet tick that writes the host output samples. */
const OUTPUT_STALE_MS = 10 * 60 * 1000
/** The age past which the exporter publishes no deficit: twice the collection interval. */
const DEFICIT_STALE_MS = 10 * 60 * 1000
const LEDGER_TIMEOUT_MS = 10_000
const VIEW = 'host_output_share_of_recorded_level'

const BUSY = 'ix_fleet_host_busy_ratio'
const DEFICIT = 'ix_fleet_ready_buffer_deficit'
const SHARE = 'ix_fleet_host_output_share_of_recorded_level'
const QUERIES = {
  // The last value of the past hour, so a host whose samples stopped is still named, with its age.
  busy: `last_over_time(${BUSY}[1h])`,
  busyAge: `(time() - timestamp(${BUSY})) or (time() - max_over_time(timestamp(${BUSY})[1h:30s]))`,
  deficit: DEFICIT,
  deficitAt: `${DEFICIT}_timestamp_seconds`,
  deficitWhy: `${DEFICIT}_unavailable == 1`,
  level: 'ix_fleet_capacity_recorded_level',
  discovery: 'ix_fleet_capacity_discovery_state == 1',
  share: SHARE,
  shareAt: `${SHARE}_timestamp_seconds`,
}

/** What a source gave: its data, or why it gives nothing; `failed` where that is an error and not an absence. */
type Got<T> = { data: T } | { missing: string; failed: boolean }

type Raw = Record<string, unknown>
const record = (v: unknown): Raw | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null)
const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

async function query($: EngineInterface, url: string, promql: string): Promise<Got<Sample[]>> {
  try {
    return { data: await promQuery($, url, promql) }
  } catch (error) {
    return { missing: errorText(error), failed: true }
  }
}

type LedgerRow = Raw & { host: string }

async function readLedger($: EngineInterface): Promise<Got<LedgerRow[]>> {
  const failed = (why: string): Got<LedgerRow[]> => ({ missing: why, failed: true })
  try {
    const ran = await $.process.run(['ix-board', '--json', 'fleet', 'ledger', 'query', VIEW], { timeoutMs: LEDGER_TIMEOUT_MS })
    if (ran.exitCode !== 0) {
      // An ix-board from before the view, or before the command, has read nothing.
      if (ran.stderr.includes('unknown ledger view')) return { missing: `this ix-board has no ${VIEW} view`, failed: false }
      if (ran.stderr.includes('unrecognized subcommand')) return { missing: 'this ix-board has no `fleet ledger query`', failed: false }
      return failed(failureText(ran.stderr, ran.exitCode))
    }
    if (ran.isStdoutTruncated) return failed('the answer was cut at 4 MiB')
    const rows = record(JSON.parse(ran.stdout))?.rows
    if (!Array.isArray(rows) || rows.some(r => text(record(r)?.host) === null)) return failed('the answer is not rows of hosts')
    return { data: rows as LedgerRow[] }
  } catch (error) {
    return failed(error instanceof SyntaxError ? 'the answer is not JSON' : errorText(error))
  }
}

const hostOf = (s: Sample): string | null => text(s.metric.host)?.toLowerCase() ?? null
const of = (samples: readonly Sample[], host: string): Sample[] => samples.filter(s => hostOf(s) === host)
/** The labels that tell one series from another, whichever query named it. */
const seriesOf = (s: Sample): string => JSON.stringify(Object.entries(s.metric).filter(([k]) => k !== '__name__').sort(([a], [b]) => a.localeCompare(b)))

const unavailable = (metric: CapacityMetric, why: string): CapacityCell => ({ metric, state: 'unavailable', text: why, sampleAt: null })

function busyCell(values: readonly Sample[], ages: ReadonlyMap<string, number>, host: string, now: number): CapacityCell {
  const series = of(values, host).map(s => ({ text: s.value[1], age: ages.get(seriesOf(s)) ?? null }))
  const fresh = series.filter(s => s.age !== null && s.age <= BUSY_STALE_S)
  if (fresh.length > 1) return unavailable('busy', `${fresh.length} fresh samples for one host`)
  // The youngest, which is the fresh one where there is one.
  const picked = [...series].sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity))[0]
  if (picked === undefined) return unavailable('busy', 'no sample in the last hour')
  const ratio = Number(picked.text)
  if (!(ratio >= 0 && ratio <= 1)) return unavailable('busy', `sample ${picked.text} is not between 0 and 1`)
  return { metric: 'busy', state: fresh.length === 1 ? 'ok' : 'stale', text: `${Math.floor(ratio * 100 + 1e-9)}%`, sampleAt: picked.age === null ? null : now - picked.age * 1000 }
}

/** When a host's sample was taken, ms since the epoch, from a series whose value is that time in seconds; the newest. */
function timeOf(samples: readonly Sample[], host: string): number | null {
  const times = of(samples, host).map(s => Number(s.value[1]) * 1000).filter(t => Number.isFinite(t) && t > 0)
  return times.length === 0 ? null : Math.max(...times)
}

const isCurrent = (at: number | null, limit: number, now: number): boolean => at !== null && now - at <= limit

function deficitCell(samples: readonly Sample[], times: readonly Sample[], reasons: readonly Sample[], host: string, now: number): CapacityCell {
  const at = timeOf(times, host)
  const [first, ...more] = of(samples, host)
  if (first === undefined) {
    // The exporter says why it publishes no deficit, in a bounded set of words.
    const why = [...new Set(of(reasons, host).flatMap(s => s.metric.reason ?? []))].join(', ')
    return { ...unavailable('deficit', why === '' ? 'no sample exported for this host' : why), sampleAt: at }
  }
  if (more.length > 0) return unavailable('deficit', `${more.length + 1} samples for one host`)
  const count = Number(first.value[1])
  if (!Number.isInteger(count) || count < 0) return unavailable('deficit', `sample ${first.value[1]} is not a count`)
  return { metric: 'deficit', state: isCurrent(at, DEFICIT_STALE_MS, now) ? 'ok' : 'stale', text: String(count), sampleAt: at }
}

/** Why a row has no share: its own reason, else the reason of the fields its basis is counted from. */
function rowReason(row: LedgerRow): string {
  let basis = row.source_basis
  if (typeof basis === 'string') {
    try {
      basis = JSON.parse(basis)
    } catch {
      basis = null
    }
  }
  const counted = row.output_basis === 'commits' ? ['commits_pushed'] : ['tickets_closed', 'prs_merged']
  const reasons = ['host_output_per_hour', ...counted].map(field => text(record(record(basis)?.[field])?.reason))
  return text(row.unavailable_reason) ?? reasons.find(r => r !== null) ?? 'no reason published'
}

const BASIS: Record<string, string> = { tickets_prs: 'tickets+PRs', commits: 'commits' }
const amount = (v: number): string => String(Math.round(v * 10) / 10)

const levelWords = (level: string | undefined): string => (level === undefined ? 'the recorded level' : `level ${level}`)

/** The share the exporter publishes of the ledger it reads, a fraction, for a host this machine's ledger has no row of. */
function exportedCell(samples: readonly Sample[], times: readonly Sample[], host: string, level: string | undefined, now: number): CapacityCell | null {
  const at = timeOf(times, host)
  const [first, ...more] = of(samples, host)
  if (first === undefined) return null
  if (more.length > 0) return unavailable('output', `${more.length + 1} shares exported for one host`)
  const share = Number(first.value[1])
  if (!Number.isFinite(share) || share < 0) return unavailable('output', `exported share ${first.value[1]} is not a share`)
  const words = `${Math.floor(share * 100 + 1e-9)}% of ${levelWords(level)} · from Prometheus`
  return { metric: 'output', state: isCurrent(at, OUTPUT_STALE_MS, now) ? 'ok' : 'stale', text: words, sampleAt: at }
}

/** `rows` is null where this machine's ledger gives nothing. */
function outputCell(rows: readonly LedgerRow[] | null, exported: CapacityCell | null, host: string, level: string | undefined, discovery: string | undefined, now: number): CapacityCell {
  const own = (rows ?? []).filter(r => r.host.toLowerCase() === host)
  const [row] = own
  if (row === undefined) {
    if (exported !== null) return exported
    const where = rows === null ? 'no share exported for this host' : 'no row in this machine’s ledger'
    if (level !== undefined) return unavailable('output', `level ${level} recorded, ${where}`)
    return unavailable('output', discovery === undefined ? where : `no recorded level, discovery ${discovery}`)
  }
  const facts = (r: LedgerRow) => JSON.stringify([r.share_percent, r.output_per_hour, r.recorded_output_per_hour, r.output_basis, r.at_ms])
  // The view has one row for each host; where it answers several that differ, nothing says which is the level's.
  if (own.some(r => facts(r) !== facts(row))) return unavailable('output', `the view answers ${own.length} differing rows`)
  if (!('share_percent' in row)) return unavailable('output', 'the row has no share_percent')
  const share = number(row.share_percent)
  if (share === null) return unavailable('output', rowReason(row))
  const [out, recorded] = [number(row.output_per_hour), number(row.recorded_output_per_hour)]
  const basis = text(row.output_basis)
  const rate = out === null || recorded === null ? null : `${amount(out)}/h of ${amount(recorded)}/h${basis === null ? '' : ` ${BASIS[basis] ?? basis}`}`
  const at = number(row.at_ms)
  const words = [`${Math.floor(share + 1e-9)}% of ${levelWords(level)}`, rate].filter(w => w !== null).join(' · ')
  return { metric: 'output', state: isCurrent(at, OUTPUT_STALE_MS, now) ? 'ok' : 'stale', text: words, sampleAt: at }
}

/** Reads every host's capacity; false when a source failed. */
export function pollCapacity($: EngineInterface, options: Options): Promise<boolean> {
  return track($, 'capacity', async () => {
    const ask = (promql: string) => query($, options.prometheusUrl, promql)
    const [values, ages, deficits, deficitTimes, deficitReasons, levels, states, shares, shareTimes, ledger] = await Promise.all([
      ask(QUERIES.busy), ask(QUERIES.busyAge), ask(QUERIES.deficit), ask(QUERIES.deficitAt), ask(QUERIES.deficitWhy),
      ask(QUERIES.level), ask(QUERIES.discovery), ask(QUERIES.share), ask(QUERIES.shareAt), readLedger($),
    ])
    const samples = (got: Got<Sample[]>): Sample[] => ('data' in got ? got.data : [])
    const now = await $.clock.now()
    const missing: CapacityView['missing'] = []
    const lacks = (metric: CapacityMetric, reason: string) => void missing.push({ metric, reason })

    const busyFailure = 'missing' in values ? values.missing : 'missing' in ages ? ages.missing : null
    const busy = 'data' in values && 'data' in ages && values.data.length > 0 ? values.data : null
    if (busy === null) lacks('busy', busyFailure ?? `Prometheus has no ${BUSY} sample in the last hour`)
    const ageOf = new Map('data' in ages ? ages.data.map(s => [seriesOf(s), Number(s.value[1])] as const) : [])
    // The exporter publishes a deficit or, for a host it has none of, why.
    const hasDeficit = 'data' in deficits && (deficits.data.length > 0 || samples(deficitReasons).length > 0)
    if (!hasDeficit) lacks('deficit', 'missing' in deficits ? deficits.missing : `Prometheus has no ${DEFICIT} sample`)
    const rows = 'data' in ledger ? ledger.data : null
    const exported = samples(shares)
    // Nothing of the output is said only where neither this machine's ledger nor Prometheus gives anything.
    if ('missing' in ledger && exported.length === 0) lacks('output', ledger.missing)

    // The level and discovery series only explain an output, so their absence needs no note of its own.
    const level = new Map<string, string>()
    for (const s of samples(levels)) if (hostOf(s) !== null) level.set(hostOf(s)!, s.value[1])
    const discovery = new Map<string, string>()
    for (const s of samples(states)) if (hostOf(s) !== null && s.metric.state) discovery.set(hostOf(s)!, s.metric.state)

    const named = [...(busy ?? []), ...[deficits, deficitTimes, deficitReasons, shares, shareTimes].flatMap(samples)]
    const names = new Set([...named.flatMap(s => hostOf(s) ?? []), ...level.keys(), ...discovery.keys(), ...(rows ?? []).map(r => r.host.toLowerCase())])
    const hasOutput = rows !== null || exported.length > 0
    const hosts = [...names].sort().map(host => ({
      host,
      cells: [
        ...(busy === null ? [] : [busyCell(busy, ageOf, host, now)]),
        ...(hasDeficit ? [deficitCell(samples(deficits), samples(deficitTimes), samples(deficitReasons), host, now)] : []),
        ...(hasOutput ? [outputCell(rows, exportedCell(exported, samples(shareTimes), host, level.get(host), now), host, level.get(host), discovery.get(host), now)] : []),
      ],
    }))
    if (rows !== null && hosts.length === 0) lacks('output', 'the ledger view has no row')
    await update($, capacity, () => ({ hosts, missing, at: now }))

    if (!('missing' in ledger)) sourceOk('ix-board fleet ledger', now)
    else if (ledger.failed) sourceFailed('ix-board fleet ledger', ledger.missing)
    else sourceClear('ix-board fleet ledger')
    return [values, ages, deficits, deficitTimes, deficitReasons, levels, states, shares, shareTimes, ledger].every(got => !('missing' in got) || !got.failed)
  })
}

// ---------------------------------------------------------------- drawing

const LABEL: Record<CapacityMetric, string> = { busy: 'Busy', deficit: 'Ready deficit', output: 'Output / level' }

/** The section: once each source that gives nothing, then each host's lines. */
export async function drawCapacity($: EngineInterface, { Box, Text }: Pick<Elements['terminal'], 'Box' | 'Text'>) {
  const view = await read($, capacity)
  const now = await $.clock.now()

  const old = (at: number) => `${ago(at, now).replace(' ago', '')} old`
  const wordsOf = (c: CapacityCell): string => {
    if (c.state === 'unavailable') return `unavailable · ${c.text}${c.sampleAt === null ? '' : ` · sample ${old(c.sampleAt)}`}`
    if (c.state === 'stale') return `${c.text} · stale, ${c.sampleAt === null ? 'age unknown' : old(c.sampleAt)}`
    return c.metric === 'busy' ? c.text : `${c.text} · ${ago(c.sampleAt, now)}`
  }
  // A host's lines are indented under its name; a line that holds for every host is not.
  const line = (key: string, c: CapacityCell, indent = 2) => (
    <Box key={key} flexDirection="row" gap={1} paddingLeft={indent}>
      <Box width={15} flexShrink={0}>
        <Text dimColor>{LABEL[c.metric]}</Text>
      </Box>
      {c.state === 'unavailable' && <Text color="inactive">○</Text>}
      {c.state === 'stale' && <Text color="warning">▲</Text>}
      <Box flexShrink={1}>
        <Text dimColor={c.state !== 'ok'} tabular>
          {wordsOf(c)}
        </Text>
      </Box>
    </Box>
  )

  return (
    <Box key="capacity" flexDirection="column" padding={1} backgroundColor={CARD_BG}>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text weight="semibold">Capacity</Text>
        <Text dimColor size="caption">{view === null ? 'reading capacity…' : `read ${ago(view.at, now)}`}</Text>
      </Box>
      {view?.missing.map(m => line(`capacity-missing-${m.metric}`, unavailable(m.metric, m.reason), 0))}
      {view?.hosts.map(({ host, cells }) => (
        <Box key={`capacity-${host}`} flexDirection="column">
          <Text weight="semibold">{host}</Text>
          {cells.map(c => line(`capacity-${host}-${c.metric}`, c))}
        </Box>
      ))}
    </Box>
  )
}
