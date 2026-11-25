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
  name: string
  done: number
  total: number
  inProgress: number
  ready: number
  /** ms since the epoch of the success this progress comes from; null when it was just read in a combined call */
  at: number | null
  /** True when this is a recorded value of an earlier success, because the refresh of the selector failed. */
  old: boolean
  /** The error of the failed refresh an old row sits beside. */
  error: string | null
}

/** A selector whose refresh failed and for which no record exists. */
export type FocusFailure = { name: string; error: string }

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
  /** ms since the epoch when ix-board fetched the tracker data */
  fetchedAt: number | null
  projects: FocusProject[]
  ready: number
  error: string | null
  /** The name shown in place of the address: a named focus definition's name. */
  title: string | null
  /** How the focus was found when the choice is a name: a definition, a lead address or a lead summary. */
  via: 'definition' | 'lead' | 'summary' | null
  /** Selectors that failed with no record. */
  failures: FocusFailure[]
  /** `F fresh, O old, X failed`; null when there was nothing to count. */
  counts: { fresh: number; old: number; failed: number } | null
  partial: boolean
  /** Lines the card adds: exclusions not applied, selects nothing, selection unavailable, no selectors, summed from parts. */
  notes: string[]
}

/** A source's error, shown on the pane and in `/factory show`. */
export type SourceError = { source: string; text: string }

export type FocusMeta = { at: number | null; busy: boolean; error: string | null; errors: SourceError[] }

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
  label: string
  /** the latest value, null when the series is absent */
  value: number | null
  unit: 'count' | 'rate' | 'seconds'
  /** higher is better (velocity) or worse (queues), for the trend's colour */
  better: 'up' | 'down'
  history: number[]
}

export type TeamView = { team: string; metrics: TeamMetric[] }

export type TeamMeta = { at: number | null; error: string | null }

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
    }
  }
}
