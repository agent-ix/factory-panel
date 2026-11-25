import { loadProgress } from '../hooks/progressview'
import type { Progress } from '../hooks/progressview'
import type { Selector } from '../hooks/board'
import type { Records } from '../hooks/progress'
import { FP, combine, fake$, out, projectRefs, roadmapJson, statusJson } from './world'
import type { ProjectSpec, RoadmapSpec, Run, World } from './world'

// What the data-layer tests share: a stand-in for ix-board that answers each call by its arguments, and
// one call to the function the Focus pane reads its progress from.

export const T0 = Date.UTC(2026, 10, 24, 12, 0)
export const MIN = 60_000
export const PROGRESS = `${FP}/progress.json`

type Init = { timeoutMs?: number } | undefined
type Answer = Run | Promise<Run>

export const project = (name: string, done: number, total: number, over: Partial<ProjectSpec> = {}): ProjectSpec => ({ name, done, total, ...over })

/** The `ix-board` calls made so far, as the arguments after `--json`, and how many ran at once. */
export type Ix = { calls: string[]; live: { now: number; max: number } }

export type Served = {
  roadmap?: RoadmapSpec[] | Answer | (() => Answer)
  /** `focus status --project <ref> ...`: for each ref a project, or the text that fails the whole call, or a function */
  projects?: Record<string, ProjectSpec | string | ((init: Init) => Answer)>
  /** `focus status --initiative <ref>`: its projects, or the text it fails with */
  initiatives?: Record<string, ProjectSpec[] | string | ((init: Init) => Answer)>
  /** any other call: `--milestone`, `--issue` */
  other?: (args: string[], init: Init) => Answer
  /** how long every answer takes, on the moving clock */
  delay?: number
}

const resolve = (v: ProjectSpec[] | ProjectSpec | string | ((init: Init) => Answer), init: Init): Answer =>
  typeof v === 'function' ? v(init) : typeof v === 'string' ? out('', 4, v) : out(statusJson(Array.isArray(v) ? v : [v]))

/** Stands in for ix-board: answers each call from `served`, and records the calls. */
export function ix(w: World, served: Served): Ix {
  const state: Ix = { calls: [], live: { now: 0, max: 0 } }
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv[0] !== 'ix-board') return prior?.(argv, init)
    const args = argv.slice(2)
    state.calls.push(args.join(' '))
    state.live.max = Math.max(state.live.max, ++state.live.now)
    const answer = (): Answer => {
      if (args[0] === 'roadmap') {
        const r = served.roadmap
        if (r === undefined) return out('', 1, 'roadmap is not stubbed')
        if (Array.isArray(r)) return out(roadmapJson(r))
        return typeof r === 'function' ? r() : r
      }
      if (args[0] === 'focus' && args[2] === '--project') {
        const one = (ref: string): Answer => {
          const p = served.projects?.[ref]
          return p === undefined ? out('', 4, `project ${ref} is not found`) : resolve(p, init)
        }
        const refs = projectRefs(args)
        return refs.length === 1 ? one(refs[0]!) : Promise.all(refs.map(one)).then(combine)
      }
      if (args[0] === 'focus' && args[2] === '--initiative') {
        const p = served.initiatives?.[args[3]!]
        return p === undefined ? out('', 4, `initiative ${args[3]} is not found`) : resolve(p, init)
      }
      return served.other?.(args, init) ?? out('', 1, 'not stubbed')
    }
    const run = async (): Promise<Run> => {
      if (served.delay !== undefined) await w.clock!.sleep(served.delay)
      return answer()
    }
    return run().finally(() => void state.live.now--)
  }
  return state
}

export const initiative = (ref: string, label?: string): Selector => ({ kind: 'initiative', ref, ...(label === undefined ? {} : { label }) })
export const proj = (ref: string): Selector => ({ kind: 'project', ref })

export type Shown = { progress: Progress | null; failed: Map<string, { name: string; error: string }> }

/** One progress refresh of a focus with these selectors, as the pane asks for it. */
export async function progress(w: World, selectors: Selector[], opts: { manual?: boolean; advance?: number } = {}): Promise<Shown> {
  const failed = new Map<string, { name: string; error: string }>()
  const endsAt = (await w.clock!.now()) + 60_000
  const run = loadProgress(fake$(w) as never, selectors, opts.manual ?? false, endsAt, failed)
  if (opts.advance !== undefined) await w.clock!.advance(opts.advance)
  return { progress: await run, failed }
}

export const seed = (w: World, records: Record<string, unknown>) => void w.files.set(PROGRESS, JSON.stringify(records))
export const saved = (w: World): Record<string, any> => JSON.parse(w.files.get(PROGRESS) ?? '{}') as Record<string, any>
export const savedRecords = (w: World): Records => saved(w) as Records
export const record = (over: Record<string, unknown> = {}) => ({ at_ms: T0 - 5 * MIN, seen_ms: T0 - MIN, done: 10, total: 20, inProgress: 2, ready: 1, ...over })

/** The names of the projects an initiative shows, in order. */
export const names = (shown: Shown, i = 0): string[] => shown.progress!.initiatives[i]!.projects.map(p => p.name)
