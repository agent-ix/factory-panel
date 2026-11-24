---
id: US-003
title: Switch views and act
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-004"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-003"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-003"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-009"
    type: traces_to
---
# US-003: Switch views and act

## Story

**As a** leader looking at a detail view
**I want** the keys for switching views, refreshing and closing to be on screen
**So that** I can move around and act (for example resolve an escalation) without reading documentation.

## Context

In the classic layout the mouse is not captured, so every action needs a visible key. The arrow keys cannot be used, because at an empty prompt they open the engine's background-sessions list.

## Acceptance Examples (Illustrative)

### US-003-EX-1: Switch to another view

- **Given** a view is open in the classic layout and the band is visible below it
- **When** the leader presses the digit shown on another band cell
- **Then** that cell's view replaces the open one

### US-003-EX-2: Close

- **Given** a view is open
- **When** the leader presses Esc
- **Then** the view closes and the prompt has the keyboard again
