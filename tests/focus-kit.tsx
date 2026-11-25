import { expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Records } from '../hooks/progress'
import { FP, combine, out, projectRefs, report, startSession, statusJson } from './world'
import type { World } from './world'

// What the focus tests share: the pane drawn as lines of text, a stand-in for ix-board, and a lead
// whose work report scopes the selectors under test.

export const T0 = Date.UTC(2026, 10, 24, 12, 0)
export const MIN = 60_000
export const PROGRESS = `${FP}/progress.json`
export const LEAD = 'draco:QSL:code'

export const PANE = { plugin: 'factory-panel', component: 'Pane', requestId: 'focus', props: { title: 'Focus', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const

/** The labels of the buttons the Focus pane draws: each card's title is one. */
export async function paneButtons($: Parameters<TestBody>[0]): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const labels = (await ui.findAll({ type: 'Button' })).map(b => String((b.props as { label?: string }).label ?? ''))
  await ui.unmount()
  return labels
}

/** The text of every line the Focus pane draws, in order. */
export async function paneLines($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface } as never)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await ui.unmount()
  return lines
}
export const multi = (pattern: RegExp) => new RegExp(pattern.source, 'm')
export const shows = (lines: string[], pattern: RegExp) => expect(lines.join('\n')).toMatch(multi(pattern))
export const hides = (lines: string[], pattern: RegExp) => expect(lines.join('\n')).not.toMatch(multi(pattern))

/** The ix-board status calls the mod made, as the arguments after `focus status`. */
export const statusCalls = (w: World) => w.ran.filter(l => l.startsWith('ix-board --json focus status')).map(l => l.slice('ix-board --json focus status '.length))

export const record = (over: Partial<Records[string]> = {}): Records[string] => ({ at_ms: T0 - 5 * MIN, seen_ms: T0 - MIN, done: 10, total: 20, inProgress: 2, ready: 1, ...over })
export const seed = (w: World, records: Records) => void w.files.set(PROGRESS, JSON.stringify(records))
export const saved = (w: World): Records => JSON.parse(w.files.get(PROGRESS) ?? '{}') as Records

/** A lead whose work report scopes the given selectors and carries the summary the pane shows. */
export function lead(w: World, scope: { initiatives?: string[]; projects?: string[]; tickets?: string[] } | null, summary = 'QSL layer 4'): void {
  w.leads.set(LEAD, report(LEAD, summary, ['running'], scope))
}

/** One `ix-board` stub: `combined` answers a `focus status` call of one project, by its arguments after `focus status`; a call for several is made of those. */
export function board(w: World, answers: { combined: (args: string[], init?: { timeoutMs?: number } | undefined) => ReturnType<typeof out> | Promise<ReturnType<typeof out>> }) {
  const state = { inflight: 0, max: 0 }
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    if (argv[0] !== 'ix-board' || argv[2] !== 'focus') return prior?.(argv, init)
    const args = argv.slice(4)
    state.inflight++
    state.max = Math.max(state.max, state.inflight)
    const refs = projectRefs(args)
    const answer = refs.length < 2 ? Promise.resolve(answers.combined(args, init)) : Promise.all(refs.map(ref => answers.combined(['--project', ref], init))).then(combine)
    return answer.finally(() => void state.inflight--)
  }
  return state
}

/** A world with a clock, a started session, and the first refresh settled. */
export async function started($: Parameters<TestBody>[0], w: World): Promise<void> {
  await startSession($)
  await w.clock!.advance(1000)
}

/** Lets the 30 minutes the board gate holds a read pass, so the next poll asks ix-board again. */
export async function refresh(w: World): Promise<void> {
  await w.clock!.advance(31 * MIN)
}

export const pageOf = (name: string, done: number, total: number, inProgress = 0) => out(statusJson([{ name, done, total, inProgress }]))

/** The `agent-msg focuses` calls made so far, as the words after `focuses`. */
export const focusCalls = (w: World) => w.ran.filter(l => l.startsWith('agent-msg focuses ')).map(l => l.slice('agent-msg focuses '.length))

/**
 * Stands in for `agent-msg focuses`: `list` answers `list`, and `show <id>` answers `shows[id]`; a
 * function answers each call, so a test can fail it, hold it back or change it between refreshes.
 */
export function named(w: World, list: () => ReturnType<typeof out> | Promise<ReturnType<typeof out>>, shows: Record<string, () => ReturnType<typeof out> | Promise<ReturnType<typeof out>>> = {}): void {
  const prior = w.stub.value
  w.stub.value = (argv, init) => {
    const line = argv.join(' ')
    if (line === 'agent-msg focuses list --json') return list()
    const m = /^agent-msg focuses show (\S+) --json$/.exec(line)
    if (m) return (shows[m[1]!] ?? (() => out('', 1, `no such definition ${m[1]}`)))()
    return prior?.(argv, init)
  }
}

/** Sets the choice the session would hold: `/factory focus <name>` written to its choice file. */
export const choose = (w: World, focus: string, key = 'draco_QSL_code') => void w.files.set(`${FP}/choices/${key}.json`, JSON.stringify({ focus }))

/**
 * Every line the Focus view and its explanations give: the pane body, the footer warning expansion (opened when the
 * icon is drawn) and the lines of `/factory show`. The body alone is `paneLines`.
 */
export async function pageLines($: Parameters<TestBody>[0]): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  if ((await ui.find({ type: 'Button', key: 'warnings-toggle' })) !== undefined) await ui.press({ key: 'warnings-toggle' })
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await ui.unmount()
  const shown = ((await $.command.run({ command: 'factory', args: 'show' } as never)).text as string).split('\n').map(l => l.trim())
  return [...lines, ...shown]
}
