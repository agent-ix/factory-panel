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
}

export type FocusView = {
  /** The coordinator's herdr address, e.g. hub:TEAM:arch; the focus's name until named focuses land. */
  address: string
  machine: string
  kind: string
  /** The model, e.g. claude-opus-5-5, once ix-relay reports it in the work binding. */
  model: string | null
  summary: string
  scope: { initiatives: number; projects: number; tickets: number }
  focusReportedAt: number | null
  /** ms since the epoch when ix-board fetched the tracker data */
  fetchedAt: number | null
  projects: FocusProject[]
  ready: number
  error: string | null
}

export type FocusMeta = { at: number | null; busy: boolean; error: string | null }

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
