---
id: US-006
title: The same in both layouts
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-001"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-003"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-004"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-008"
    type: traces_to
---
# US-006: The same in both layouts

## Story

**As a** leader who sometimes works in the fullscreen layout and sometimes in the classic one
**I want** the same commands and the same views in both
**So that** I do not have to relearn the tool, and the help never describes something that is not on my screen.

## Context

Fullscreen docks panes and captures the mouse. Classic has neither. A command that only works in one of them, or help that describes the other, leaves people stuck.

## Acceptance Examples (Illustrative)

### US-006-EX-1: Same command, either layout

- **Given** a leader in either layout
- **When** they type `/factory`
- **Then** they get the detail view for their role, seated the way that layout allows

### US-006-EX-2: Help matches the screen

- **Given** a leader in either layout
- **When** they ask for help
- **Then** the help describes what is on their screen and names the key or command for each task
