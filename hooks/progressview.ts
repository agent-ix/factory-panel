import type { EngineInterface } from 'claude-code'

import type { FocusView } from '../types'
import { compose, hasFailure, membershipsOf, projectKeyOfWarning, recordsOf, refreshProgress, selectorKey } from './board'
import type { Refresh, Selector } from './board'
import { gatedBoard } from './linear'
import { mergeInitiatives, mergeRecords, readFile, saveFile } from './progress'
import type { Records } from './progress'
import { ago, pausedText } from './shared'
import { sourceFailed, sourceOk } from './sources'

/** The progress part of a focus: what the pane reads from `initiatives`, `loose`, `header`, `warnings`, `fetchedAt` and `notes`. */
export type Progress = Pick<FocusView, 'initiatives' | 'loose' | 'header' | 'warnings' | 'fetchedAt' | 'notes'>

/**
 * What one focus shows of its progress, from ix-board and the records of earlier successes. `failed` collects the
 * warnings by record key for `/factory show`. Returns null when another session is reading and has left nothing yet.
 */
export async function loadProgress($: EngineInterface, selectors: Selector[], manual: boolean, endsAt: number, failed: Map<string, { name: string; error: string }>): Promise<Progress | null> {
  const key = `focus:${selectors.map(selectorKey).join(' ')}`
  const disk = await readFile($)
  let ran = false
  // A refresh with a failure in it is shown and held for 5 minutes: the next poll after them asks again, r asks now.
  const read = await gatedBoard(
    $,
    key,
    () => {
      ran = true
      return refreshProgress($, selectors, disk, endsAt)
    },
    { manual, keep: (r: Refresh) => !hasFailure(r) },
  )
  const now = await $.clock.now()
  const sourceError = read.backoffUntil !== null ? pausedText(read.backoffUntil, now) : read.error
  if (read.data === null && sourceError === null) return null
  // After a failed read the cached result is an old one: only the records and the cached membership speak.
  const refresh = read.error !== null ? null : read.data
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

  const held = read.held === true && refresh !== null ? [`earlier outcome from ${ago(refresh.at, now)}: ix-board is asked again after 5 minutes, r asks now`] : []
  return { initiatives: composed.initiatives, loose: composed.loose, header: composed.header, warnings: composed.warnings, fetchedAt: composed.fetchedAt, notes: held }
}
