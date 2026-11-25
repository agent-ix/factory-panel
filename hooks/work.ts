import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { WorkActivity, WorkAgent, WorkBoard, WorkIssue, WorkLast, WorkLead, WorkPr } from '../types'

// The model of the Work tab: what each lead has in hand, from the relay's work reports, joined with what
// ix-board's focus status says of the tickets and of what was merged lately.

/** The ticket and activity facts of every focus status answer, by progress key; hooks/progressview.ts fills it. */
const workBoards = atom({ plugin: 'factory-panel', key: 'workBoards' } as const, {} as Record<string, WorkBoard>, { shape: 'workBoards-1' })

export async function readBoards($: EngineInterface): Promise<WorkBoard[]> {
  return Object.values(await read($, workBoards))
}

/** Holds the answer of one focus's progress read. */
export async function holdBoard($: EngineInterface, key: string, board: WorkBoard): Promise<void> {
  await update($, workBoards, held => ({ ...held, [key]: board }))
}

/** Drops the answers of focuses that are no longer shown. */
export async function keepBoards($: EngineInterface, keys: ReadonlySet<string>): Promise<void> {
  await update($, workBoards, held => Object.fromEntries(Object.entries(held).filter(([k]) => keys.has(k))))
}

// ---------------------------------------------------------------- reading ix-board's answer

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const KINDS = ['merged', 'closed', 'opened'] as const

/** Milliseconds since the epoch of a number or an ISO time; null for anything else. */
const timeOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

const prOf = (v: unknown): WorkPr | null => {
  const o = obj(v)
  if (o === null) return null
  return { url: str(o.url), repo: str(o.repo), number: typeof o.number === 'number' ? o.number : null, status: str(o.status) || 'unknown', draft: o.draft === true }
}

const issueOf = (v: unknown): WorkIssue | null => {
  const o = obj(v)
  const identifier = str(o?.identifier)
  if (o === null || identifier === '') return null
  return { identifier, title: str(o.title), state: str(o.state), prs: Array.isArray(o.prs) ? o.prs.flatMap(p => prOf(p) ?? []) : null }
}

const activityOf = (v: unknown): WorkActivity | null => {
  const o = obj(v)
  const at = timeOf(o?.at)
  const kind = KINDS.find(k => k === o?.kind)
  if (o === null || at === null || kind === undefined) return null
  const pr = obj(o.pr)
  return { at, kind, identifier: str(o.identifier), title: str(o.title), project: str(o.project), repo: pr === null ? null : str(pr.repo) || null, number: typeof pr?.number === 'number' ? pr.number : null }
}

/**
 * The tickets and activity of one `ix-board --json focus status` answer: the started and recently closed tickets of every
 * project, milestone and unmilestoned group, and the top-level `activity[]`. An answer wrapped in a stale `result` key is
 * read as the object inside. `activity` is null where the answer has no such key (an ix-board older than 0.9.0).
 */
export function boardOf(answer: unknown): WorkBoard {
  const top = obj(answer)
  const status = obj(top?.result) ?? top
  const issues = new Map<string, WorkIssue>()
  const take = (items: unknown): void => {
    for (const item of list(items)) {
      const issue = issueOf(item)
      if (issue === null) continue
      const had = issues.get(issue.identifier)
      issues.set(issue.identifier, had === undefined || (had.prs === null && issue.prs !== null) ? issue : had)
    }
  }
  for (const p of list(status?.projects)) {
    const project = obj(p)
    if (project === null) continue
    const groups = [project, obj(project.unmilestoned), ...list(project.milestones).map(obj)]
    for (const g of groups) {
      take(g?.in_progress)
      take(g?.recently_closed)
    }
  }
  const activity = Array.isArray(status?.activity) ? status.activity.flatMap(a => activityOf(a) ?? []).sort((a, b) => b.at - a.at) : null
  return { issues: [...issues.values()], activity }
}

/** The union of several answers: a ticket once (with its PRs where any answer has them), activity once, newest first. */
export function mergeBoards(boards: readonly WorkBoard[]): WorkBoard {
  const issues = new Map<string, WorkIssue>()
  for (const b of boards)
    for (const i of b.issues) {
      const had = issues.get(i.identifier)
      if (had === undefined || (had.prs === null && i.prs !== null)) issues.set(i.identifier, i)
    }
  const withActivity = boards.filter(b => b.activity !== null)
  const seen = new Set<string>()
  const activity = withActivity.length === 0 ? null : withActivity.flatMap(b => b.activity!).filter(a => {
    const key = `${a.kind} ${a.identifier} ${a.repo}#${a.number} ${a.at}`
    return seen.has(key) ? false : (seen.add(key), true)
  }).sort((a, b) => b.at - a.at)
  return { issues: [...issues.values()], activity }
}

// ---------------------------------------------------------------- composing the view

export type WorkTicket = {
  id: string
  title: string
  /** null where ix-board has not said (no focus status read, or the ticket is not in it) */
  state: string | null
  badges: string[]
  lastAction: { what: string; at: number } | null
}

export type WorkLeadView = { address: string; status: string; at: number | null; tickets: WorkTicket[] }

export type WorkView = {
  leads: WorkLeadView[]
  /** null where ix-board is too old to say; newest first */
  activity: WorkActivity[] | null
  /** whether any focus status answer has been read */
  hasBoard: boolean
}

const has = (role: string, word: string): boolean => role.toLowerCase().includes(word)

const badgesOf = (agents: readonly WorkAgent[], issue: WorkIssue | undefined): string[] => {
  const badges: string[] = []
  if (issue?.prs?.some(p => p.status === 'open' || p.status === 'draft')) badges.push('[pr]')
  const reviewers = agents.filter(a => has(a.role, 'review')).length
  if (reviewers > 0) badges.push(reviewers === 1 ? '[review]' : `[review×${reviewers}]`)
  if (agents.some(a => has(a.role, 'spec')) || ['Specify', 'Specced'].includes(issue?.state ?? '')) badges.push('[spec]')
  if (agents.some(a => has(a.role, 'gate'))) badges.push('[gate]')
  return badges
}

/**
 * Joins the leads' agents with the ticket facts. Only tickets a lead's agents report are listed under it; a started
 * ticket no lead reports is already on the Focus tab. The last action is the latest transition of an agent on the ticket,
 * else the latest report of one.
 */
export function composeWork(leads: readonly WorkLead[], last: Record<string, WorkLast>, boards: readonly WorkBoard[]): WorkView {
  const board = mergeBoards(boards)
  const byId = new Map(board.issues.map(i => [i.identifier, i]))
  const views = leads.map((lead): WorkLeadView => {
    const tickets = [...new Set(lead.agents.map(a => a.ticket).filter(t => t !== ''))].map((id): WorkTicket => {
      const agents = lead.agents.filter(a => a.ticket === id)
      const issue = byId.get(id)
      const event = last[`${lead.address}\u0000${id}`]
      const newest = agents.reduce<WorkAgent | null>((m, a) => (a.reportedAt !== null && (m === null || a.reportedAt > (m.reportedAt ?? 0)) ? a : m), null)
      const action = event !== undefined ? { what: `${event.role} ${event.status}`, at: event.at } : newest === null ? null : { what: `${newest.role} ${newest.status}`, at: newest.reportedAt! }
      return { id, title: issue?.title ?? '', state: issue === undefined || issue.state === '' ? null : issue.state, badges: badgesOf(agents, issue), lastAction: action }
    })
    tickets.sort((a, b) => (b.lastAction?.at ?? 0) - (a.lastAction?.at ?? 0) || a.id.localeCompare(b.id))
    return { address: lead.address, status: lead.status, at: lead.reportedAt, tickets }
  })
  views.sort((a, b) => a.address.localeCompare(b.address))
  return { leads: views, activity: board.activity, hasBoard: boards.length > 0 }
}

/** The latest agent transition per (lead, ticket) of an `agent-msg work events` page, merged into `into`. */
export function lastOfEvents(events: readonly unknown[], into: Record<string, WorkLast>): void {
  for (const e of events) {
    const event = obj(e)
    const at = typeof event?.at_ms === 'number' ? event.at_ms : null
    const address = str(obj(event?.binding)?.address)
    const agent = obj(obj(event?.change)?.agent)
    const ticket = str(agent?.ticket)
    if (at === null || address === '' || ticket === '') continue
    const key = `${address}\u0000${ticket}`
    const had = into[key]
    if (had === undefined || at >= had.at) into[key] = { role: str(agent?.role) || 'agent', status: str(agent?.status), at }
  }
}

/** Merges within the last `hours` and counts the merged activity. */
export const mergedSince = (activity: readonly WorkActivity[] | null, now: number, hours: number): number =>
  activity === null ? 0 : activity.filter(a => a.kind === 'merged' && now - a.at <= hours * 3_600_000).length
