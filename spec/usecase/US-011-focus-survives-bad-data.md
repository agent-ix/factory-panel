---
id: US-011
title: Keep my focus progress when one source fails
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-017"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-018"
    type: traces_to
---
# US-011: Keep my focus progress when one source fails

## Story

**As a** lead who watches my focus progress in the Focus pane
**I want** one failing source or one bad ticket to take away only its own part of the view
**So that** I still see the progress that is known, and I can see which part failed and why.

## Context

A focus is shown over several initiatives and projects. The Focus pane asked ix-board for all of them in one call. One ticket in Linear referenced a milestone that was not available, ix-board failed the whole call with `issue QSL-3215 references unavailable milestone <id> in project <id>`, and the pane showed the lead's summary and an error but no progress bars at all. The owner's ruling: bad data in Linear is to be met by failing more gracefully. The model for the degradation is the relay terminal monitor, where each source keeps its last good value beside its current error (`crates/relay-tui/src/monitor.rs`, `Source<T>`) and the project scope draws a placeholder per failing project and states the counts (`crates/relay-tui/src/monitor_scope.rs`).

## Acceptance Examples (Illustrative)

### US-011-EX-1: One bad project

- **Given** the focus has two initiatives and two projects and one project has bad data
- **When** the combined progress call fails
- **Then** the pane shows the three selectors that succeed, names the failing project with its error, and says the progress is partial

### US-011-EX-2: Linear is unreachable for a while

- **Given** progress was shown a few minutes ago
- **When** a refresh fails
- **Then** the pane shows that progress marked old with its age, and the error beside it
