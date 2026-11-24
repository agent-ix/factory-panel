---
id: FR-004
title: Detail view
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-003"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-006"
    type: implements
---
# FR-004: Detail view

## Description

In the classic layout the mod SHALL open the detail as a popup above the prompt that holds the keyboard and closes on Esc.

## Behavior

- The mod SHALL open the popup with the keyboard and with close-on-Esc.
- The mod SHALL leave the band visible while the popup is open.
- The mod SHALL NOT use the arrow keys to switch views.
- While the popup is open, a digit pressed at the prompt SHALL open the view of the band cell that carries it, replacing the open one.
- The popup SHALL show the keys on screen: the band digits to switch, `r` to refresh, Esc to close.
- In the fullscreen layout, `/factory` SHALL focus the docked panel on the role's tab.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-004-AC-1 | Given the classic layout, `/factory` opens the popup with the keyboard and close-on-Esc set. | Test |
| FR-004-AC-2 | Given the classic layout and an open popup, pressing the digit on another band cell opens that cell's view and the popup shows it. | Test |
| FR-004-AC-3 | Given the classic layout, the popup shows the keys to switch, refresh and close on screen. | Test |
| FR-004-AC-4 | Given a real classic session, Esc closes the popup and the prompt has the keyboard again. | Demonstration |
| FR-004-AC-5 | Given a real fullscreen session, `/factory focus` focuses the docked Focus tab. | Demonstration |
| FR-004-AC-6 | Given the source of the views, no handler switches views on an arrow key. | Inspection |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [US-006](../usecase/US-006-both-layouts.md)
