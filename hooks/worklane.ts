import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { WorkLanes } from '../types'
import { BLOCKED, STATE, newestByLane } from './capacity'
import { originOf } from './endpoints'
import { errorText, promQuery } from './shared'
import type { Options, Sample } from './shared'
import { track } from './schedule'
import { sourceFailed, sourceOk } from './sources'

// The state of each lead's lane, from the ix-relay watcher's series, by which the Work tab says a lead is stuck or
// churning. A lane is a lead's address, `server:workspace:tab`.

export const workLanes = atom({ plugin: 'factory-panel', key: 'workLanes' } as const, null as WorkLanes | null, { shape: 'workLanes-1' })

/** The blocked reasons of a lane that cannot work: it waits on a person, or on its usage limit. `wait_loop` is none. */
const ASKS = new Set(['permission', 'dialog', 'question', 'queued_question', 'login', 'usage_limit'])

const QUERIES = {
  states: `timestamp(${STATE})`,
  reasons: `timestamp(${BLOCKED})`,
  // The last sample of the past day at which a lane was neither blocked nor stuck, and its first sample of that day.
  free: `max_over_time(timestamp(${STATE}{state!~"blocked|stuck"})[24h:1m])`,
  first: `min_over_time(timestamp(${STATE})[24h:1m])`,
}

/** The newest (`pick` max) or oldest sample time in ms each lane's series give; the answer's values are seconds. */
function timesByLane(samples: readonly Sample[], pick: (...n: number[]) => number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of samples) {
    const lane = typeof s.metric.lane === 'string' ? s.metric.lane : ''
    const at = Number(s.value[1]) * 1000
    if (lane === '' || !Number.isFinite(at)) continue
    out.set(lane, pick(at, ...(out.has(lane) ? [out.get(lane)!] : [])))
  }
  return out
}

/** Reads every lane's state, and since when a lane waiting on a person or a tool has; false when Prometheus failed. */
export function pollLanes($: EngineInterface, options: Options): Promise<boolean> {
  // Nothing is asked of an address that is not known, by the refresh key either.
  if (originOf(options.prometheusUrl) === undefined) return Promise.resolve(true)
  return track($, 'workLanes', async () => {
    try {
      const [states, reasons, free, first] = await Promise.all([QUERIES.states, QUERIES.reasons, QUERIES.free, QUERIES.first].map(q => promQuery($, options.prometheusUrl, q)))
      const now = await $.clock.now()
      const reasonOf = new Map([...newestByLane(reasons!, now).values()].map(l => [l.lane, l.labels.reason ?? null] as const))
      const lastFree = timesByLane(free!, Math.max)
      const firstSeen = timesByLane(first!, Math.min)
      const lanes: WorkLanes['lanes'] = {}
      for (const l of newestByLane(states!, now).values()) {
        const state = l.labels.state ?? ''
        const reason = state === 'blocked' ? (reasonOf.get(l.lane) ?? null) : null
        const isStuck = state === 'stuck' || (reason !== null && ASKS.has(reason))
        // Not before the last sample at which the lane was free; where there was none, not before its first sample.
        lanes[l.lane] = { state, reason, isStuck, since: isStuck ? (lastFree.get(l.lane) ?? firstSeen.get(l.lane) ?? null) : null }
      }
      await update($, workLanes, () => ({ at: now, lanes }))
      sourceOk('prometheus', now)
      return true
    } catch (error) {
      sourceFailed('prometheus', errorText(error))
      return false
    }
  })
}

/** The lanes as last read. */
export async function lanesHeld($: EngineInterface): Promise<WorkLanes | null> {
  return await read($, workLanes)
}
