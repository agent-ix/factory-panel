import type { EngineInterface } from 'claude-code'

import type { FocusView } from '../types'
import { SourceFailure, WORK_SHAPE, compose, membershipsOf,projectKeyOfWarning, recordsOf, refreshProgress, selectorKey } from './board'
import type { Refresh, Selector } from './board'
import { gatedBoard } from './linear'
import { mergeInitiatives, mergeRecords, readFile, saveFile } from './progress'
import type { Records } from './progress'
import { ago, pausedText } from './shared'
import { sourceFailed, sourceOk } from './sources'
import type { BoardRead } from './work'

/** The key a focus's progress read is gated and held under. */
export const progressKeyOf = (selectors: readonly Selector[]): string => `progress:${selectors.map(selectorKey).join(' ')}`

/** The progress part of a focus: what the pane reads from `initiatives`, `loose`, `header`, `warnings`, `fetchedAt` and `notes`. */
export type Progress = Pick<FocusView, 'initiatives' | 'loose' | 'header' | 'warnings' | 'fetchedAt' | 'notes'>

/** A focus's progress with what the same read says of tickets and activity, which the Work tab reads. */
export type Loaded = { progress: Progress; board: BoardRead }

/**
 * What one focus shows of its progress, from ix-board and the records of earlier successes. `failed` collects the
 * warnings by record key for `/factory show`. Returns null when another session is reading and has left nothing yet.
 */
export async function loadProgress($: EngineInterface, selectors: Selector[], manual: boolean, endsAt: number, failed: Map<string, { name: string; error: string }>): Promise<Loaded | null> {
  const key = progressKeyOf(selectors)
  const disk = await readFile($)
  let ran = false
  let partial: Refresh | null = null
  // A refresh is kept for the gate's interval, whatever failed in it; one a source error cut short (or that still waits
  // for the roadmap) is held for 5 minutes only, and the next poll after them asks again. r asks now.
  const read = await gatedBoard(
    $,
    key,
    () => {
      ran = true
      return refreshProgress($, selectors, disk, endsAt, manual).catch((error: unknown) => {
        // A rate limit holds every call, but what was answered before it is still drawn and recorded.
        if (error instanceof SourceFailure) partial = error.partial
        throw error
      })
    },
    { manual, keep: (r: Refresh) => r.sourceError === null && r.pending !== true, repeats: (r: Refresh) => r.unproven === true, outdated: (r: Refresh) => r.work !== WORK_SHAPE },
  )
  const now = await $.clock.now()
  const sourceError = read.backoffUntil !== null ? pausedText(read.backoffUntil, now) : read.error
  if (read.data === null && sourceError === null) return null
  // After a failed read the cached result is an old one: only the records and the cached membership speak.
  const refresh = partial ?? (read.error !== null ? null : read.data)
  const success: Records = recordsOf(refresh, now, disk.records)
  const memberships = membershipsOf(selectors, refresh, disk.initiatives, now)
  // The file as it is now: another session may have written a record newer than this answer while it was awaited.
  const current = await readFile($)
  const merged = { records: mergeRecords(current.records, success), initiatives: mergeInitiatives(current.initiatives, memberships) }
  const composed = compose(selectors, refresh, sourceError, merged, now)
  // The records an old row was drawn from are seen in this refresh.
  const seen: Records = {}
  for (const k of composed.touched) if (merged.records[k] !== undefined) seen[k] = { ...merged.records[k]!, seen_ms: now }
  await saveFile($, now, { ...success, ...seen }, memberships)

  const source = refresh?.sourceError ?? sourceError
  if (source !== null) sourceFailed('ix-board', source)
  // Only a read that ran now is a success: an answer kept from earlier is not stamped as one.
  else if (ran && refresh !== null) sourceOk('ix-board', now)
  for (const w of composed.warnings) if (w.kind !== 'source' || w.name !== 'ix-board') failed.set(projectKeyOfWarning(w), { name: w.name, error: w.text })

  const when = read.holdMs === undefined ? 'after 5 minutes, r asks now' : `after ${Math.round(read.holdMs / 60_000)} minutes, r asks after 60 seconds`
  const held = read.held === true && refresh !== null ? [`earlier outcome from ${ago(refresh.at, now)}: ix-board is asked again ${when}`] : []
  // The Work tab reads the tickets and activity of the same answer: no further call is made for them.
  return { progress: { initiatives: composed.initiatives, loose: composed.loose, header: composed.header, warnings: composed.warnings, fetchedAt: composed.fetchedAt, notes: held }, board: { board: refresh?.board ?? null, at: refresh?.at ?? null, error: source } }
}
