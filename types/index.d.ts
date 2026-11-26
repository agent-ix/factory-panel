export type Machine = {
  name: string
  /** seconds since the machine's ix-relay watcher last pushed a sample; null when never seen */
  lastSeenSecs: number | null
  leads: number
  panesWorking: number
  panesIdle: number
  panesDone: number
  /** percent busy over the last 2 minutes; null until a node exporter is scraped */
  cpuPct: number | null
  /** percent of memory in use; null until a node exporter is scraped */
  memPct: number | null
  /** hottest sensor in Celsius; null until a node exporter is scraped */
  tempC: number | null
  /** Claude Code spend over the last 24 hours, USD */
  spend24hUsd: number | null
}

export type HerdrAgent = {
  agent: string
  status: string
  title: string
  workspace: string
  paneId: string
}

export type HerdrView = {
  running: boolean
  version: string
  agents: HerdrAgent[]
}

export type RelayCheck = { check: string; status: string; subject: string | null; message: string }

export type RelayView = {
  ok: boolean
  redis: string
  watchers: { machine: string; status: string; message: string }[]
  warnings: number
  deadLetters: number
  inboxWaiting: number
  checks: RelayCheck[]
}

export type BoardAgent = {
  team: string
  agent: string
  status: string
  machine: string
  paneId: string
  title: string
  lastTurnAgeSecs: number | null
}

export type BoardView = {
  teams: string[]
  agents: BoardAgent[]
  error: string | null
}

export type Freshness = {
  prometheusAt: number | null
  prometheusError: string | null
  nodeMetricsSeen: boolean
  herdrAt: number | null
  herdrError: string | null
  relayAt: number | null
  relayError: string | null
  boardAt: number | null
  boardBusy: boolean
}

// ---------------------------------------------------------------- Focus pane

export type FocusProject = {
  /** The record key or id this row is drawn under. */
  key: string
  /** The ref the project was called by. */
  ref: string
  /** The project id of the answer or record; null for a milestone, a ticket and a project never answered. */
  id: string | null
  name: string
  /** True when no answer and no record of at most 24 hours exists: the row carries a short mark and no counts. */
  failed: boolean
  done: number
  total: number
  inProgress: number
  /** null where the answer lacks the key: drawn as `-` */
  ready: number | null
  blocked: number | null
  /** ms since the epoch of the success this progress comes from; null for a failed row */
  at: number | null
  /** True when this is a recorded value of an earlier success, because the call of the project failed or was not made. */
  old: boolean
  /** Stage counts of the open work by state. */
  stages: Record<string, number> | null
}

/** An initiative drawn with its projects, and the roll-up of those counted. */
export type FocusInitiative = {
  /** The initiative id where the selector is one, else its name: the key of its collapsed state. */
  key: string
  name: string
  /** `projects unknown` or `initiative not found` where it could not be expanded. */
  failed: string | null
  projects: FocusProject[]
  counted: number
  enumerated: number
  done: number
  total: number
  inProgress: number
  remaining: number
  ready: number | null
  blocked: number | null
  partial: boolean
  /** The oldest success among counted old projects. */
  oldestAt: number | null
}

/** The header total over every distinct counted project. */
export type FocusHeader = {
  done: number
  total: number
  inProgress: number
  remaining: number
  ready: number | null
  blocked: number | null
  /** Stage counts by state, from `open_by_state`. */
  stages: [string, number][]
  counted: number
  enumerated: number
  notExpanded: number
  partial: boolean
  oldestAt: number | null
  complete: boolean
}

/** One entry of the footer warning: a failed project, an initiative that cannot be expanded, or a source error. */
export type FocusWarning = { kind: 'project' | 'initiative' | 'source'; name: string; text: string; id: string | null }

export type FocusView = {
  /** The coordinator's herdr address, e.g. hub:TEAM:arch; the focus's name until named focuses land. */
  address: string
  machine: string
  kind: string
  summary: string
  /** Derived from the agents of the lead's work report: failed, running, waiting, done or unknown. */
  status: string
  scope: { initiatives: number; projects: number; tickets: number }
  focusReportedAt: number | null
  /** ms since the epoch when ix-board was asked */
  fetchedAt: number | null
  initiatives: FocusInitiative[]
  /** Projects, milestones and tickets of the focus that no selected initiative holds. */
  loose: FocusProject[]
  header: FocusHeader | null
  warnings: FocusWarning[]
  /** The name shown in place of the address: the chosen focus's. */
  title: string | null
  /** `chosen` for the chosen initiative or project; null for a lead's own focus. */
  via: 'chosen' | null
  /** Lines the card adds: no selectors, earlier outcome. */
  notes: string[]
  /** What the focus is made of: the chosen initiative or project, or a lead's reported scope. */
  selectors: { kind: 'initiative' | 'project' | 'milestone' | 'ticket'; ref: string; project?: string; label?: string }[]
}

/** An initiative or project leads report, with its Linear name where one is known; `value` is what the choice stores. */
export type FocusOption = { value: string; kind: 'initiative' | 'project'; id: string; name: string | null }

/** The chosen focus: `known` where a lead reports it or Linear names it. */
export type ChosenFocus = { value: string; name: string | null; known: boolean }

/** A source's error, shown on the pane and in `/factory show`. */
export type SourceError = { source: string; text: string }

/** `scope` is the focus and teams the last finished read was made for, `heldFor` those the focuses held were found for. */
export type FocusMeta = { at: number | null; busy: boolean; error: string | null; errors: SourceError[]; scope?: string; heldFor?: string; chosen?: ChosenFocus; /** the focuses the leads report; absent until their names have been read */ options?: FocusOption[] }

// ---------------------------------------------------------------- Escalations and Relay panes

export type EscalationStatus = 'waiting' | 'investigating' | 'resolved'

export type Escalation = {
  id: string
  status: EscalationStatus
  ticket: string
  lead: string
  filed: string
  machine: string
  kind: string
  context: string
  options: string[]
  recommendation: string
  decision: string
  hasDetail: boolean
}

/** The Escalations pane's views: still open (waiting or investigating), resolved, or hidden by the person. */
export type EscalationFilter = 'open' | 'resolved' | 'hidden'

export type Announcement = { at: string; from: string; to: string; text: string }

export type RelayMeta = { at: number | null; error: string | null; human: string }

// ---------------------------------------------------------------- Team pane

export type TeamMetric = {
  key: string
  /** the row it is drawn in */
  group: 'velocity' | 'review' | 'flow'
  label: string
  /** the latest value, null when the series is absent */
  value: number | null
  /** whether `value` is a lower bound: the largest count of one of several scopes */
  atLeast: boolean
  unit: 'count' | 'rate' | 'seconds' | 'share'
  /** higher is better (velocity) or worse (queues), for the trend's colour */
  better: 'up' | 'down'
  history: number[]
  /** the share of its population the exporter measured, 0 to 1; null where it does not say */
  coverage: number | null
  /** why there is no `value`; null where there is one */
  reason: string | null
}

/** The counts of 7 UTC days, oldest first and today last; null for a day with no sample. `atLeast` marks lower bounds. */
export type DailyRow = { counts: (number | null)[]; atLeast: boolean; /** why a day has no count */ reason: string }

export type TeamView = {
  /** the Linear team key, else the exporter's team id */
  team: string
  /** whether `team` is a team key the series carry */
  keyed: boolean
  metrics: TeamMetric[]
  /** completed issues and merged PRs per day */
  days: { closures: DailyRow; merges: DailyRow }
}

export type TeamMeta = { at: number | null; error: string | null }

/** One metric class of a team's retro delta: its mark and the metrics that regress. */
export type RetroClass = { id: string; rating: 'red' | 'amber' | 'green' | 'unknown'; regressing: string[]; unavailable: number; total: number }

/** A team's retro health: its classes, or `null` classes with the reason there is no baseline. */
export type RetroView = { team: string; classes: RetroClass[] | null; latest: string | null; reason: string | null }

export type RetroMeta = { at: number | null; error: string | null }

/** One rule of a role evaluation; `reason` and `rubric` say why one is not scored. */
export type RoleRule = { id: string; status: string; query: string; value: number | null; comparator: string; target: number | null; reason: string | null; rubric: string | null }

/**
 * One role of an evaluation: the rules passed of those scored, and `trend`, the change from the window before over the
 * `matched` rules scored in both; `matched` is null where the answer does not say.
 */
export type RoleScore = { role: string; passed: number; evaluated: number; passRate: number | null; trend: number | null; matched: number | null; rules: RoleRule[]; objectives: RoleObjective[] }

/** One objective metric of a role; a null `value` has no measurement, and `reason` says why. */
export type RoleObjective = { id: string; query: string; value: number | null; unit: string; reason: string | null }

/** What the mod keeps of `ix-board retro eval --json`: the window (ms since the epoch) and its roles. */
export type RoleReport = { startMs: number; endMs: number; roles: RoleScore[] }

/** A team's Roles section: its latest evaluation, and what to say about it or its absence. */
export type RolesView = { team: string; report: RoleReport | null; note: string | null; isError: boolean }

export type CapacityMetric = 'busy' | 'deficit' | 'output'

/** One host's figure: its words, or why it is unavailable; `sampleAt` (ms since the epoch) where its sample says when. */
export type CapacityCell = { metric: CapacityMetric; state: 'ok' | 'stale' | 'unavailable'; text: string; sampleAt: number | null }

/** The fleet's capacity as read at `at`: each host's figures, and the metrics a whole source gives nothing of. */
export type CapacityView = { hosts: { host: string; cells: CapacityCell[] }[]; missing: { metric: CapacityMetric; reason: string }[]; at: number }

// ---------------------------------------------------------------- Work pane

/** A pull request of a ticket, as ix-board's focus status lists it. */
export type WorkPr = { url: string; repo: string; number: number | null; status: string; draft: boolean }

/** A ticket of the focus status: started, or closed lately. `prs` is null where ix-board is too old to say. */
export type WorkIssue = {
  identifier: string
  title: string
  state: string
  prs: WorkPr[] | null
  /** when the answer naming it was read */
  at?: number | null
  /** the ids of its project and milestone, of an `ix-board issues` answer: null in none, absent where not said */
  project?: string | null
  milestone?: string | null
}

/** One entry of ix-board's `activity[]`: `at` in ms since the epoch. */
export type WorkActivity = { at: number; kind: 'merged' | 'closed' | 'opened'; identifier: string; title: string; project: string; repo: string | null; number: number | null }

/**
 * What one answer of ix-board says of tickets; `activity` is null where ix-board has no such field. `cutAt` is set
 * where ix-board cut the activity at its cap: entries older than this time (ms since the epoch) are missing. Of an
 * answer held for the views, `at` is when it was read, null where none ever was, and `error` why the latest read
 * failed. `ticketsOnly` marks the read of single tickets, which says nothing of what was merged.
 */
export type WorkBoard = { issues: WorkIssue[]; activity: WorkActivity[] | null; cutAt?: number; at?: number | null; error?: string | null; ticketsOnly?: true; unknown?: string[]; /** the tickets that read asked for */ asked?: string[] }

/** The gated `ix-board issues` answer: the tickets asked for, those answered, and when. */
export type TicketsAnswer = { /** the TICKETS_SHAPE of the build that read it */ shape?: number; at: number; asked: string[]; issues: WorkIssue[]; /** those asked for that Linear has no record of */ unknown: string[] }

export type WorkAgent = { name: string; ticket: string; role: string; status: string; reportedAt: number | null }

/**
 * A lead of `agent-msg who` with the agents of its work report. `error` is why the latest read failed, and `readAt`
 * when the report drawn was read: null where none ever was, so that nothing is known of the lead.
 */
export type WorkLead = { address: string; status: string; reportedAt: number | null; agents: WorkAgent[]; focus: WorkLeadFocus | null; error: string | null; readAt: number | null }

/** What a lead last said it is doing: the summary, the tickets it named, and when. */
export type WorkLeadFocus = { summary: string; tickets: string[]; at: number | null }

/**
 * `relayError` is why the last read of the leads gave nothing new: no list of leads, or no report of any lead.
 * `listed` counts the leads that read asked, `silent` names those that answered with no report, and `pending` counts
 * those another session was reading.
 */
export type WorkMeta = { at: number | null; busy: boolean; error: string | null; relayError: string | null; listed: number; silent: string[]; pending: number; /** the teams of every lead `agent-msg who` lists */ teams: string[] }

/** The choice open under the Work tab's header, and why a choice failed. */
export type WorkPicker = { open: 'teams' | 'focus' | null; error: string | null }

/** A reviewer, spec or gate agent starting or finishing on a ticket, from `agent-msg work events`. */
export type WorkRoleEvent = { at: number; role: 'review' | 'spec' | 'gate'; step: 'start' | 'done'; ticket: string; address: string }

/**
 * What the event stream has said of those roles: the latest events, oldest first, and where each assignment
 * (lead, agent, ticket) stands, so that a repeated report adds no event. `error` is the last read's problem.
 */
export type WorkFeed = { events: WorkRoleEvent[]; phase: Record<string, 'running' | 'done'>; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    'factory-panel': {
      machines: Shaped<Machine[]>
      herdr: Shaped<HerdrView>
      relay: Shaped<RelayView>
      board: Shaped<BoardView>
      freshness: Shaped<Freshness>
      detail: 'none' | 'herdr' | 'relay' | 'board'
      focuses: Shaped<FocusView[]>
      focusMeta: Shaped<FocusMeta>
      focusCollapsed: string[]
      focusShowDone: boolean
      focusWarnings: boolean
      escalations: Shaped<Escalation[]>
      announcements: Shaped<Announcement[]>
      relayMeta: Shaped<RelayMeta>
      relayLeads: string[]
      escalationMeta: Shaped<RelayMeta>
      escalationFilter: EscalationFilter
      escalationHidden: string[]
      escalationAddress: Record<string, string>
      escalationBusy: string[]
      escalationSelected: string
      escalationDraft: string
      escalationConfirm: string
      escalationNotice: string
      relayAnnounce: string
      relayTarget: string
      relayConfirm: string
      relayNotice: string
      teams: Shaped<TeamView[]>
      teamMeta: Shaped<TeamMeta>
      retro: Shaped<RetroView[]>
      retroMeta: Shaped<RetroMeta>
      retroOpen: string[]
      teamOpen: string[]
      retroWarn: boolean
      roles: Shaped<RolesView[]>
      rolesOpen: string[]
      capacity: Shaped<CapacityView | null>
      workLeads: Shaped<WorkLead[]>
      workLast: Shaped<Record<string, number>>
      workMeta: Shaped<WorkMeta>
      workPicker: Shaped<WorkPicker>
      workFeed: Shaped<WorkFeed>
      workBoards: Shaped<Record<string, WorkBoard>>
      workTickets: Shaped<WorkBoard | null>
      workCollapsed: string[]
      workOpen: string[]
      workAll: boolean
      workWarnings: boolean
    }
  }
}
