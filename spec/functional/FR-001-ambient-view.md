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

- The mod SHALL draw the band at the first redraw after session start, with no key pressed.
- While the terminal has not reported its layout, the mod SHALL draw the band.
- The mod SHALL NOT open a pane over the chat that the person did not ask for.
- When the layout is first reported as fullscreen, the mod SHALL open the panes once.
- The mod SHALL NOT reopen a pane the person has closed.
- In a non-interactive session the mod SHALL draw nothing and open nothing.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-001-AC-1 | Given the classic layout and a session that has just started, the band is drawn at the first redraw with no key pressed and no command typed. | Test |
| FR-001-AC-2 | Given the classic layout, no pane opens at session start or at any later redraw until the person asks for one. | Test |
| FR-001-AC-3 | Given the layout has not been reported, the band is drawn and no pane is opened. | Test |
| FR-001-AC-4 | Given the layout is first reported as fullscreen, the five panes open exactly once and no band is drawn. | Test |
| FR-001-AC-5 | Given the fullscreen layout, the panes are docked at the right at session start with no command typed. | Demonstration |
| FR-001-AC-6 | Given a pane the person closed, a later redraw or surface attach does not reopen it. | Test |
| FR-001-AC-7 | Given a non-interactive session, no band is drawn and no pane is opened. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-006](../usecase/US-006-both-layouts.md)
