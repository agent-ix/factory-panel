// The sources the mod reads and what each last said. A source that fails is recorded here,
// in memory, with the time of its last success; `/factory show` lists the failing ones and the panes
// draw each one's error on the card of the module that uses it. The ix-board progress records live in
// progress.json instead, so only their errors are held here.

export type SourceName = 'ix-board' | 'agent-msg work' | 'agent-msg focuses' | 'prometheus' | 'ix-board retro' | 'ix-board retro eval' | 'ix-board fleet ledger'

export const SOURCE_NAMES: readonly SourceName[] = ['ix-board', 'agent-msg work', 'agent-msg focuses', 'prometheus', 'ix-board retro', 'ix-board retro eval', 'ix-board fleet ledger']

type State = { error: string | null; okAt: number | null }

const states = new Map<SourceName, State>()
/** What ix-board last said for each selector it failed on, by progress key. */
let selectorErrors = new Map<string, { name: string; error: string }>()

const stateOf = (source: SourceName): State => {
  let s = states.get(source)
  if (s === undefined) {
    s = { error: null, okAt: null }
    states.set(source, s)
  }
  return s
}

export const sourceOk = (source: SourceName, now: number): void => {
  const s = stateOf(source)
  s.error = null
  s.okAt = now
}

/** Forgets what a source said: nothing asks it any more. */
export const sourceClear = (source: SourceName): void => void states.delete(source)

export const sourceFailed = (source: SourceName, error: string): void => {
  stateOf(source).error = error
}

/** The selectors ix-board failed on in the latest refresh; an empty map when every one answered. */
export const setSelectorErrors = (errors: Map<string, { name: string; error: string }>): void => {
  selectorErrors = errors
}

export const selectorErrorList = (): { key: string; name: string; error: string }[] => [...selectorErrors].map(([key, v]) => ({ key, ...v }))

export const sourceState = (source: SourceName): State => ({ ...stateOf(source) })

/** Forgets everything: a new session starts with no source asked. */
export function resetSources(): void {
  states.clear()
  selectorErrors = new Map()
}
