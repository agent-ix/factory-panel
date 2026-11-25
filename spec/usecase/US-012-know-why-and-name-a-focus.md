---
id: US-012
title: Know why this focus is shown and name it
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-019"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-020"
    type: traces_to
---
# US-012: Know why this focus is shown and name it

## Story

**As a** user of the mod
**I want** the Focus pane to say why these focuses are shown, and `/factory focus <name>` to find a named focus
**So that** I am never unsure whether I am looking at my own focus, a team's, or everything, and I can follow a focus that was defined once and named.

## Context

The scope of the Focus pane comes from four possible causes: the user's choice, the session's own focus, the team list, or a fallback when the relay says too little. Which one applied was not visible. Separately, ix-relay now stores named focus definitions (`agent-msg focuses`, `crates/relay-core/src/named_focus/model.rs`) whose members are initiatives, projects, milestones and tickets. The mod reads them and never writes them. No named focus exists on the current system, so the lookup must also work, and fall through, when there are none.

## Acceptance Examples (Illustrative)

### US-012-EX-1: The reason in one line

- **Given** the user typed `/factory focus Release Train`
- **When** the Focus pane draws
- **Then** its first line reads `your choice: Release Train`

### US-012-EX-2: A named focus

- **Given** a named focus `Beta` exists for this team
- **When** the user types `/factory focus beta`
- **Then** the pane shows progress over that focus's initiatives, projects, milestones and tickets
