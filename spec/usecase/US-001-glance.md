---
id: US-001
title: Glance at the factory without typing
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-001"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-002"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-001"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-002"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-009"
    type: traces_to
---
# US-001: Glance at the factory without typing

## Story

**As a** person who leads part of the factory, working in a Claude Code session
**I want** the state of what I am responsible for to be in view the moment I start, without typing anything
**So that** I notice trouble and see progress while I work, and I never have to remember a command to find out.

## Context

Leaders keep a Claude Code pane open all day while the factory runs elsewhere. Today they have to open a panel to learn anything, and the panel only exists in one layout. What each person needs differs: someone who coordinates watches every host; a lead of one project cares about this machine and that project.

## Acceptance Examples (Illustrative)

### US-001-EX-1: A lead starts a session

- **Given** a lead of one project starts Claude Code in the classic layout
- **When** the session opens
- **Then** a line above the prompt already shows this machine's load, the project's progress and their orchestrator, with no command typed

### US-001-EX-2: Hosts after a skill selects them

- **Given** a skill has selected hosts `all` and the user starts Claude Code in the fullscreen layout
- **When** the session opens
- **Then** the panel is already docked at the right and shows the hosts

## Constraints (Contextual)

Sessions are also started by automation. The view must appear without a dialog or a key press, and must not take the keyboard.
