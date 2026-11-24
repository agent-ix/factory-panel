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

factory-panel is a Claude Code mod that keeps the state of an Agent IX factory in view of the people who lead it, while they work in a Claude Code session. A program coordinator, a code lead or a planner sees what is wrong and how far their project has come without leaving the chat, and opens more detail with one command.

## 2. Scope

### 2.1 In Scope

- The ambient view: a one-row band above the prompt in the classic terminal layout and docked panes in the fullscreen layout.
- The detail views (Factory, Focus, Escalations, Relay, Team) and how a person opens, switches and closes them.
- Role-based defaults for what the ambient view shows, and how the role is learned.
- How the mod finds the factory's metrics endpoints.
- The commands, help text and documentation a person uses to learn all of the above.

### 2.2 Out of Scope

| Out of scope | Rationale |
| --- | --- |
| Collecting or storing metrics | Prometheus, ix-relay and ix-board own collection; the mod only reads. |
| Changing tickets or project state other than resolving or hiding escalations and sending relay announcements | Linear and ix-board own tracker writes. |
| Mouse interaction in the classic layout | The terminal does not capture the mouse there; every action has a keyboard path. |
| Per-user theming of the views | The shared style layer in `docs/STYLE.md` is deliberate and uniform. |
| Running in non-interactive (`-p`) sessions | There is no surface to draw on and nobody to ask. |

## 3. System Overview

### 3.1 Users

- **Program coordinator**: watches the whole factory (hosts, programs, escalations).
- **Code lead**: owns one project or a few; cares about this machine's load, the project's progress, their orchestrator and their coders.
- **Planner**: shapes and orders work; cares about progress, the ready queue and blockers.

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

### 4.2 Functional Requirements

| ID | Title | Artifact |
| --- | --- | --- |
| FR-001 | Ambient view by layout | [FR-001](functional/FR-001-ambient-view.md) |
| FR-002 | Role presets | [FR-002](functional/FR-002-role-presets.md) |
| FR-003 | One command | [FR-003](functional/FR-003-one-command.md) |
| FR-004 | Detail view | [FR-004](functional/FR-004-detail-view.md) |
| FR-005 | Role resolution | [FR-005](functional/FR-005-role-resolution.md) |
| FR-006 | Honest states | [FR-006](functional/FR-006-honest-states.md) |
| FR-007 | Metrics endpoint discovery | [FR-007](functional/FR-007-endpoint-discovery.md) |
| FR-008 | Help and documentation | [FR-008](functional/FR-008-help-and-docs.md) |

### 4.3 Non-Functional Requirements

| ID | Title | Artifact |
| --- | --- | --- |
| NFR-001 | First paint | [NFR-001](non-functional/NFR-001-first-paint.md) |
| NFR-002 | No stalls at session start | [NFR-002](non-functional/NFR-002-no-stalls.md) |
| NFR-003 | Few steps | [NFR-003](non-functional/NFR-003-few-steps.md) |

## 5. Verification

Every acceptance criterion is verified by an automated test (`claude plugin test`) or by a demonstration in a real session of each layout (`tests/e2e/layouts.mjs`, driven through `tmux`). Tests bind to a criterion by carrying its id as a trace tag.

## 6. References

| Standard | Description |
| --- | --- |
| ISO/IEC/IEEE 29148 | Requirements engineering |
