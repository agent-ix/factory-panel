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
- The mod SHALL leave the band visible while the popup is open, so the digits of [FR-009](./FR-009-band-cells.md) switch views.
- The popup SHALL show the keys on screen: the band digits to switch, `r` to refresh and Esc to close.
- In the fullscreen layout `/factory` SHALL focus the docked panel on the role's tab.
- The mod SHALL NOT bind an arrow key to any action.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-004-AC-1 | In the classic layout `/factory` opens the popup with the keyboard and close-on-Esc set. | Test |
| FR-004-AC-2 | With the popup open, pressing the digit of another band cell shows that cell's view in the popup. | Test |
| FR-004-AC-3 | The popup shows the keys to switch, refresh and close on screen. | Test |
| FR-004-AC-4 | No hotkey in the band or in any view is an arrow key. | Test |
| FR-004-AC-5 | In a real classic session Esc closes the popup and the prompt has the keyboard again. | Demonstration |
| FR-004-AC-6 | In a real fullscreen session `/factory focus` focuses the docked Focus tab. | Demonstration |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [US-006](../usecase/US-006-both-layouts.md)
