---
type: master-requirements
name: factory-panel
org: agent-ix
component_type: claude-code-mod
implementation_language: typescript
tags:
  - claude-code-plugin
  - terminal-ui
  - factory-observability
depends_on: []
relationships: []
standards_alignment:
  - iso-iec-ieee-29148
security_critical: false
---
# Master Requirements Specification

## factory-panel

## 1. Purpose

factory-panel is a Claude Code mod that keeps the state of an Agent IX factory in view of the people who lead it, while they work in a Claude Code session. A person who coordinates the factory, a code lead or a planner sees what is wrong and how far their project has come without leaving the chat, and opens more detail with one command.

## 2. Scope

### 2.1 In Scope

- The ambient view: a one-row band above the prompt in the classic terminal layout and docked panes in the fullscreen layout.
- The detail views (Factory, Focus, Escalations, Relay, Team) and how a person opens, switches and closes them.
- Features and scopes the ambient view can show, how an agent or the user selects them, and the automatic defaults taken from the relay.
- The files under `~/.ix/factory-panel/` that hold an agent's declaration and a user's choices.
- How the mod finds the factory's metrics endpoints.
- The commands, help text and documentation a person uses to learn all of the above.
- The Focus card of 0.7.0: progress per project, initiatives with their projects nested beneath, honest roll-up totals, and source errors folded into one footer warning icon.
- The reads of 0.7.1: one combined progress call for the projects of a focus, a shared memory of selectors ix-board cannot answer, Linear-backed reads at most once in 30 minutes, and no read of what is not on screen.

### 2.2 Out of Scope

| Out of scope | Rationale |
| --- | --- |
| Collecting or storing metrics | Prometheus, ix-relay and ix-board own collection; the mod only reads. |
| Changing tickets or project state other than resolving or hiding escalations and sending relay announcements | Linear and ix-board own tracker writes. |
| Mouse interaction in the classic layout | The terminal does not capture the mouse there; every action has a keyboard path. |
| Per-user theming of the views | The shared style layer in `docs/STYLE.md` is deliberate and uniform. |
| A named-focus field in ix-board | A focus is named by its lead's summary; ix-board owns its data model. |
| Writing named focuses, fixing ix-board data or errors, per-ticket drill-down | ix-relay owns named focus writes, ix-board owns its own failures; the mod only reads named focuses and shows progress per selector. |
| A new relay protocol | The mod reads `agent-msg whoami` and `agent-msg work` as they are. |
| Roles in the mod, including roles as dynamic plugin configuration | Skills select features; the mod has no role concept. Dynamic role configuration is a possible later step. |
| Running in non-interactive (`-p`) sessions | There is no surface to draw on and nobody to ask. |

## 3. System Overview

### 3.1 Users

Users are described by what they look at, not by a role in the mod; a skill or the user selects the features that fit.

- **Someone who coordinates**: watches the whole factory (all hosts, the teams and their leads, escalations).
- **Someone who leads one project**: watches this machine, their own focus and their lanes.
- **Someone who plans**: watches progress, the ready queue and blockers of their own focus.

### 3.2 Layouts and how a person engages

Claude Code draws in one of two terminal layouts. The mod must work in both.

| | Classic layout | Fullscreen layout |
| --- | --- | --- |
| Ambient view | One-row band above the prompt, collapsible with the engine's `[-]` | Panes docked at the right of the chat |
| Open more | `/factory` opens a popup above the prompt | `/factory` focuses the docked panel |
| Switch views | Press the digit shown on a band cell | Click a tab, or `/factory <view>` |
| Close | Esc | Docked panes stay; the close mark hides them |
| Mouse | Not captured; keyboard only | Clicks work |

Two engine facts shape the design. The arrow keys at an empty prompt open the engine's background-sessions list, so no view uses arrows to switch. A digit at an empty prompt presses a band cell, so the band's digits are the view switcher in the classic layout.

## 4. Requirements Architecture

### 4.1 User Stories

| ID | Title | Artifact |
| --- | --- | --- |
| US-001 | Glance at the factory without typing | [US-001](usecase/US-001-glance.md) |
| US-002 | Open more with one command | [US-002](usecase/US-002-open-more.md) |
| US-003 | Switch views and act | [US-003](usecase/US-003-switch-and-act.md) |
| US-004 | Set up once | [US-004](usecase/US-004-set-up-once.md) |
| US-005 | Trust what I see | [US-005](usecase/US-005-trust-what-i-see.md) |
| US-006 | The same in both layouts | [US-006](usecase/US-006-both-layouts.md) |
| US-007 | See only my own focus | [US-007](usecase/US-007-own-focus.md) |
| US-008 | See the teams under me | [US-008](usecase/US-008-coordinator-teams.md) |
| US-009 | Let a skill select the features | [US-009](usecase/US-009-select-features.md) |
| US-010 | Choose what to display | [US-010](usecase/US-010-choose-display.md) |
| US-011 | Keep my focus progress when one source fails | [US-011](usecase/US-011-focus-survives-bad-data.md) |
| US-012 | Know why this focus is shown and name it | [US-012](usecase/US-012-know-why-and-name-a-focus.md) |
| US-013 | See initiatives with their projects and trust the numbers | [US-013](usecase/US-013-see-initiatives-with-their-projects.md) |

### 4.2 Functional Requirements

| ID | Title | Artifact |
| --- | --- | --- |
| FR-001 | Ambient view by layout | [FR-001](functional/FR-001-ambient-view.md) |
| FR-002 | Fallback defaults | [FR-002](functional/FR-002-fallback-defaults.md) |
| FR-003 | One command | [FR-003](functional/FR-003-one-command.md) |
| FR-004 | Detail view | [FR-004](functional/FR-004-detail-view.md) |
| FR-005 | Relay identity as an input | [FR-005](functional/FR-005-relay-identity.md) |
| FR-006 | Honest states | [FR-006](functional/FR-006-honest-states.md) |
| FR-007 | Metrics endpoint discovery | [FR-007](functional/FR-007-endpoint-discovery.md) |
| FR-008 | Help and documentation | [FR-008](functional/FR-008-help-and-docs.md) |
| FR-009 | Band cells and digits | [FR-009](functional/FR-009-band-cells.md) |
| FR-010 | Features | [FR-010](functional/FR-010-features.md) |
| FR-011 | Feature selection by an agent | [FR-011](functional/FR-011-feature-declaration.md) |
| FR-012 | Selection precedence | [FR-012](functional/FR-012-selection-precedence.md) |
| FR-013 | Scoping hosts, focus and teams | [FR-013](functional/FR-013-scoping.md) |
| FR-014 | User choice of display | [FR-014](functional/FR-014-user-choice.md) |
| FR-015 | Files kept under the ix home | [FR-015](functional/FR-015-own-files.md) |
| FR-016 | Isolated selectors and partial progress | [FR-016](functional/FR-016-isolated-selectors.md) |
| FR-017 | Last good progress | [FR-017](functional/FR-017-last-good-progress.md) |
| FR-018 | Source errors visible and not fatal | [FR-018](functional/FR-018-errors-visible-not-fatal.md) |
| FR-019 | Focus mode banner | [FR-019](functional/FR-019-focus-mode-banner.md) |
| FR-020 | Named focus resolution | [FR-020](functional/FR-020-named-focus-resolution.md) |
| FR-021 | Initiative expansion | [FR-021](functional/FR-021-initiative-expansion.md) |
| FR-022 | Initiative roll-up and honest totals | [FR-022](functional/FR-022-initiative-rollup-and-honest-totals.md) |
| FR-023 | Nested initiative display | [FR-023](functional/FR-023-nested-initiative-display.md) |
| FR-024 | Warnings as a footer icon | [FR-024](functional/FR-024-warning-icon-in-footer.md) |
| FR-025 | Last good progress per project | [FR-025](functional/FR-025-per-project-last-good.md) |
| FR-026 | Combined progress calls | [FR-026](functional/FR-026-per-project-calls.md) |
| FR-027 | Fetch only what is on screen | [FR-027](functional/FR-027-fetch-only-on-screen.md) |

### 4.3 Non-Functional Requirements

| ID | Title | Artifact |
| --- | --- | --- |
| NFR-001 | First paint | [NFR-001](non-functional/NFR-001-first-paint.md) |
| NFR-002 | No stalls at session start | [NFR-002](non-functional/NFR-002-no-stalls.md) |
| NFR-003 | Few steps | [NFR-003](non-functional/NFR-003-few-steps.md) |
| NFR-004 | Selection never blocks | [NFR-004](non-functional/NFR-004-selection-never-blocks.md) |

## 5. Verification

Every acceptance criterion is verified by an automated test (`claude plugin test`), by inspection of the plugin source where the criterion says so, or by a demonstration in a real session of each layout (`tests/e2e/layouts.mjs`, and `tests/e2e/onscreen.mjs` for what is read on and off screen, driven through `tmux`). Tests bind to a criterion by carrying its id as a trace tag.

## 6. References

| Standard | Description |
| --- | --- |
| ISO/IEC/IEEE 29148 | Requirements engineering |
