---
id: FR-001
title: Ambient view by layout
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-006"
    type: implements
---
# FR-001: Ambient view by layout

## Description

The mod SHALL show the ambient view without being asked: a one-row band above the prompt in the classic layout, and the panes docked beside the chat in the fullscreen layout.

## Behavior

- The band SHALL be one row of cells, plus one line naming the problems while a source is failing.
- The mod SHALL draw the band at the first redraw after session start, with no key pressed.
- While the terminal has not reported its layout, the mod SHALL draw the band.
- The mod SHALL NOT open a pane over the chat that the person did not ask for.
- When the layout is first reported as fullscreen, the mod SHALL open the five panes (Factory, Focus, Escalations, Relay, Team) once.
- The mod SHALL NOT reopen a pane the person has closed.
- In a non-interactive session the mod SHALL draw nothing and open nothing.

## Constraints

| ID | Constraint | Type | Validation |
|----|------------|------|------------|
| FR-001-CON-1 | The terminal fixes its layout for the whole session, so the mod does not handle a layout change after start. | Environment | Inspection |

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-001-AC-1 | In the classic layout the band is drawn at the first redraw after session start with no key pressed and no command typed. | Test |
| FR-001-AC-2 | In the classic layout no pane opens at session start or at any later redraw until the person asks for one. | Test |
| FR-001-AC-3 | While the layout has not been reported, the band is drawn and no pane is opened. | Test |
| FR-001-AC-4 | When the layout is first reported as fullscreen, the five panes open exactly once and no band is drawn. | Test |
| FR-001-AC-5 | In the fullscreen layout the panes are docked at the right at session start with no command typed. | Demonstration |
| FR-001-AC-6 | A pane the person closed is not reopened by a later redraw or surface attach. | Test |
| FR-001-AC-7 | In a non-interactive session no band is drawn and no pane is opened. | Test |
| FR-001-AC-8 | While a source is failing, the band shows one line naming the problems below its single row of cells; with no failing source it shows only the row of cells. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-006](../usecase/US-006-both-layouts.md)
