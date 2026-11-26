import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface } from 'claude-code'

import type { CapacityView, HostRow, LaneNote } from '../types'
import { CARD_BG, errorText, failureText, promQuery } from './shared'
import type { Options, Sample } from './shared'
import { track } from './schedule'
import { sourceClear, sourceFailed, sourceOk } from './sources'
import { gauge } from './ui/glyphs'

// The Team view's Hosts table: each host's lanes by state, CPU, finished work per hour and shortfall of ready work.
// Lanes and CPU are the ix-relay watcher's series, finished work is the ix-board fleet ledger of this machine. Every
// read is read-only: `fleet saturation` and the `fleet capacity` commands are never run from here.

const capacity = atom({ plugin: 'factory-panel', key: 'capacity' } as const, null as CapacityView | null, { shape: 'capacity-3' })
/** The hosts whose stuck and waiting lanes are listed, and `?` where what is missing is. */
const hostsOpen = atom({ plugin: 'factory-panel', key: 'hostsOpen' } as const, [] as string[])

/** Twice the watcher's push interval, as ix-board judges the busy ratio. */
const BUSY_STALE_S = 60
/** The watcher pushes lane states with its busy ratio; Prometheus keeps a state a lane has left for five minutes. */
const LANE_STALE_S = 120
/** Twice the fleet tick that writes the host output samples. */
const OUTPUT_STALE_MS = 10 * 60 * 1000
/** The age past which the exporter publishes no deficit: twice the collection interval. */
const DEFICIT_STALE_MS = 10 * 60 * 1000
const LEDGER_TIMEOUT_MS = 10_000
const VIEW = 'host_output_share_of_recorded_level'
/**
 * The watcher's blocked reason for a pane that repeats a sleep or poll line three times, which an agent that is only
 * waiting on a build also does. Such a lane is waiting, not stuck.
 */
const WAIT_LOOP = 'wait_loop'

const STATE = 'ix_fleet_lane_state_ratio'
const BLOCKED = 'ix_fleet_lane_blocked_ratio'
const BUSY = 'ix_fleet_host_busy_ratio'
const DEFICIT = 'ix_fleet_ready_buffer_deficit'
const SHARE = 'ix_fleet_host_output_share_of_recorded_level'
const QUERIES = {
  // Each series' sample time: a lane that changed state still has its old series for a while, and the newest holds.
  states: `timestamp(${STATE})`,
  reasons: `timestamp(${BLOCKED})`,
  // The last value of the past hour, so a host whose samples stopped is still named.
  busy: `last_over_time(${BUSY}[1h])`,
  busyAge: `(time() - timestamp(${BUSY})) or (time() - max_over_time(timestamp(${BUSY})[1h:30s]))`,
  deficit: DEFICIT,
  deficitAt: `${DEFICIT}_timestamp_seconds`,
  // Whether anything was finished in the last two hours, and whether there were samples two hours ago to say so.
  most: `max_over_time(${SHARE}[2h])`,
  earlier: `${SHARE} offset 2h`,
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

/** The newest series of each lane of a `timestamp(...)` answer, where it is current, by host and lane. */
function newestByLane(samples: readonly Sample[], now: number): Map<string, { host: string; lane: string; labels: Record<string, string>; at: number }> {
  const lanes = new Map<string, { host: string; lane: string; labels: Record<string, string>; at: number }>()
  for (const s of samples) {
    const host = hostOf(s)
    const lane = text(s.metric.lane)
    const at = Number(s.value[1])
    if (host === null || lane === null || !(now / 1000 - at <= LANE_STALE_S)) continue
    const key = `${host}\u0000${lane}`
    if (at > (lanes.get(key)?.at ?? -Infinity)) lanes.set(key, { host, lane, labels: s.metric, at })
  }
  return lanes
}

/** The CPU of a host, 0 to 1: its one current sample; null where there is none, or more than one. */
function cpuOf(values: readonly Sample[], ages: ReadonlyMap<string, number>, host: string): number | null {
  const fresh = of(values, host).filter(s => (ages.get(seriesOf(s)) ?? Infinity) <= BUSY_STALE_S)
  const ratio = fresh.length === 1 ? Number(fresh[0]!.value[1]) : NaN
  return ratio >= 0 && ratio <= 1 ? ratio : null
}

/** The shortfall of ready work of a host, where its one sample is current and above 0. */
function needsOf(samples: readonly Sample[], times: readonly Sample[], host: string, now: number): number | null {
  const [first, ...more] = of(samples, host)
  const at = Math.max(0, ...of(times, host).map(s => Number(s.value[1]) * 1000).filter(Number.isFinite))
  if (first === undefined || more.length > 0 || !(now - at <= DEFICIT_STALE_MS)) return null
  const count = Number(first.value[1])
  return Number.isInteger(count) && count > 0 ? count : null
}

/** The finished work per hour and the best recorded, from the one current row of the ledger view, else why none. */
function doneOf(rows: readonly LedgerRow[], host: string, now: number): { done: number | null; best: number | null; why: string | null } {
  const none = (why: string) => ({ done: null, best: null, why })
  const own = rows.filter(r => r.host.toLowerCase() === host)
  const [row] = own
  if (row === undefined) return none('no best recorded in this machine’s ledger')
  if (own.some(r => r.output_per_hour !== row.output_per_hour || r.recorded_output_per_hour !== row.recorded_output_per_hour)) return none(`${own.length} differing ledger rows`)
  const done = number(row.output_per_hour)
  if (done === null) return none(text(row.unavailable_reason) ?? 'no output in its ledger row')
  const at = number(row.at_ms)
  if (at === null || now - at > OUTPUT_STALE_MS) return none('its ledger sample is old')
  return { done, best: number(row.recorded_output_per_hour), why: null }
}

/** Reads every host's lanes, CPU, finished work and shortfall; false when a source failed. */
export function pollCapacity($: EngineInterface, options: Options): Promise<boolean> {
  return track($, 'capacity', async () => {
    const ask = (promql: string) => query($, options.prometheusUrl, promql)
    const [states, reasons, values, ages, deficits, deficitTimes, most, earlier, ledger] = await Promise.all([
      ask(QUERIES.states), ask(QUERIES.reasons), ask(QUERIES.busy), ask(QUERIES.busyAge), ask(QUERIES.deficit), ask(QUERIES.deficitAt),
      ask(QUERIES.most), ask(QUERIES.earlier), readLedger($),
    ])
    const samples = (got: Got<Sample[]>): Sample[] => ('data' in got ? got.data : [])
    const now = await $.clock.now()
    const lanes = [...newestByLane(samples(states), now).values()]
    const blocked = newestByLane(samples(reasons), now)
    const ageOf = new Map(samples(ages).map(s => [seriesOf(s), Number(s.value[1])] as const))
    const rows = 'data' in ledger ? ledger.data : []
    const names = new Set([...samples(states), ...samples(values), ...samples(deficits)].flatMap(s => hostOf(s) ?? []).concat(rows.map(r => r.host.toLowerCase())))

    const why: string[] = []
    const lacks = (got: Got<Sample[]>, series: string) => {
      if ('missing' in got) why.push(`${series}: ${got.missing}`)
      else if (got.data.length === 0) why.push(`Prometheus has no ${series} sample`)
    }
    lacks(states, STATE)
    lacks(values, BUSY)
    if ('missing' in deficits) why.push(`${DEFICIT}: ${deficits.missing}`)
    if ('missing' in ledger) why.push(`done/h: ${ledger.missing}`)

    const hosts: HostRow[] = [...names].sort().map(host => {
      const own = lanes.filter(l => l.host === host && l.labels.state !== 'ended')
      const notes: LaneNote[] = own.flatMap((l): LaneNote[] => {
        const state = l.labels.state
        if (state !== 'blocked' && state !== 'stuck') return []
        const reason = blocked.get(`${host}\u0000${l.lane}`)?.labels.reason
        if (state === 'blocked' && reason === WAIT_LOOP) return [{ lane: l.lane, kind: 'waiting', reason: 'repeats a sleep or poll line' }]
        return [{ lane: l.lane, kind: 'stuck', reason: reason ?? (state === 'stuck' ? 'a tool call ran past its limit' : 'reason not published') }]
      })
      const known = lanes.some(l => l.host === host)
      const working = known ? own.filter(l => l.labels.state === 'working').length : null
      const output = 'data' in ledger ? doneOf(rows, host, now) : { done: null, best: null, why: null }
      const cpu = cpuOf(samples(values), ageOf, host)
      if (!known && samples(states).length > 0) why.push(`${host}: no current lane state`)
      if (cpu === null && samples(values).length > 0) why.push(`${host}: no current CPU sample`)
      if (output.why !== null) why.push(`${host} done/h: ${output.why}`)
      // Churning: lanes work now, and the share of the best output was 0 at every sample of two hours that were sampled.
      const peak = of(samples(most), host)
      const isChurning = (working ?? 0) > 0 && output.done === 0 && of(samples(earlier), host).length > 0 && peak.length > 0 && peak.every(s => Number(s.value[1]) === 0)
      return {
        host,
        working,
        stuck: known ? notes.filter(n => n.kind === 'stuck').length : null,
        idle: known ? own.filter(l => l.labels.state === 'idle').length : null,
        waiting: notes.filter(n => n.kind === 'waiting').length,
        lanes: notes.sort((a, b) => a.lane.localeCompare(b.lane)),
        cpu,
        done: output.done,
        best: output.best,
        needs: needsOf(samples(deficits), samples(deficitTimes), host, now),
        isChurning,
      }
    })
    await update($, capacity, () => ({ hosts, why, at: now }))

    if (!('missing' in ledger)) sourceOk('ix-board fleet ledger', now)
    else if (ledger.failed) sourceFailed('ix-board fleet ledger', ledger.missing)
    else sourceClear('ix-board fleet ledger')
    return [states, reasons, values, ages, deficits, deficitTimes, most, earlier, ledger].every(got => !('missing' in got) || !got.failed)
  })
}

// ---------------------------------------------------------------- drawing

const amount = (v: number): string => String(Math.round(v * 10) / 10)
const doneText = (at: HostRow): string => (at.done === null ? '—' : `${amount(at.done)}${at.best === null ? '' : ` (best ${amount(at.best)})`}`)
/** What follows a host's figures, only where there is something to say. */
const extras = (at: HostRow): string =>
  [at.needs === null ? null : `needs work ${at.needs}`, at.waiting === 0 ? null : `${at.waiting} waiting`, at.isChurning ? 'churning' : null].filter(x => x !== null).join(' · ')

/** The table: a row for each host; a host with stuck or waiting lanes opens to them, and `○` says what is missing. */
export async function drawCapacity($: EngineInterface, { Box, Text, Button }: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>) {
  const [view, open] = await Promise.all([read($, capacity), read($, hostsOpen)])
  const press = (key: string) => () => void update($, hostsOpen, l => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))
  const why = view === null ? [] : view.why
  const hosts = view?.hosts ?? []
  const hasLanes = hosts.some(at => at.working !== null)
  const hasCpu = hosts.some(at => at.cpu !== null)
  const nameCells = Math.max(6, ...hosts.map(at => at.host.length + 3))
  const cell = (key: string, width: number, words: string, color?: string) => (
    <Box key={key} width={width} flexShrink={0}>
      <Text tabular color={color}>{words}</Text>
    </Box>
  )
  const head = (key: string, width: number, words: string) => (
    <Box key={key} width={width} flexShrink={0}>
      <Text dimColor size="caption">{words}</Text>
    </Box>
  )
  const count = (n: number | null): string => (n === null ? '—' : String(n))

  return (
    <Box key="capacity" flexDirection="column" padding={1} backgroundColor={CARD_BG}>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text weight="semibold">Hosts</Text>
        {view === null && <Text dimColor size="caption">reading…</Text>}
        {(why.length > 0 || (view !== null && hosts.length === 0)) && <Button key="hosts-why" plain label="○" onPress={press('?')} />}
      </Box>
      {open.includes('?') && why.map(w => <Text key={w} dimColor size="caption">{w}</Text>)}
      {hosts.length > 0 && (
        <Box flexDirection="row">
          {head('h-host', nameCells, '  host')}
          {hasLanes && head('h-working', 9, 'working')}
          {hasLanes && head('h-stuck', 7, 'stuck')}
          {hasLanes && head('h-idle', 6, 'idle')}
          {hasCpu && head('h-cpu', 8, 'CPU')}
          {head('h-done', 14, 'done/h')}
        </Box>
      )}
      {hosts.map(at => {
        const isOpen = open.includes(at.host)
        return (
          <Box key={`capacity-${at.host}`} flexDirection="column">
            <Box flexDirection="row">
              <Box width={nameCells} flexShrink={0}>
                {at.lanes.length > 0 ? <Button key={`host-${at.host}`} plain label={`${isOpen ? '▾' : '▸'} ${at.host}`} onPress={press(at.host)} /> : <Text>{`  ${at.host}`}</Text>}
              </Box>
              {hasLanes && cell('working', 9, count(at.working))}
              {hasLanes && cell('stuck', 7, count(at.stuck), (at.stuck ?? 0) > 0 ? 'warning' : undefined)}
              {hasLanes && cell('idle', 6, count(at.idle))}
              {hasCpu && cell('cpu', 8, at.cpu === null ? '—' : `${gauge(at.cpu)} ${Math.floor(at.cpu * 100 + 1e-9)}%`)}
              {cell('done', 14, doneText(at))}
              {extras(at) !== '' && <Text color="warning" size="caption">{extras(at)}</Text>}
            </Box>
            {isOpen && at.lanes.map(l => <Text key={l.lane} dimColor size="caption">{`     ${l.lane}  ${l.kind}: ${l.reason}`}</Text>)}
          </Box>
        )
      })}
    </Box>
  )
}
