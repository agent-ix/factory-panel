---
id: FR-003
title: One command
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-003"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-006"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-010"
    type: implements
---
# FR-003: One command

## Description

The mod SHALL provide one command, `/factory`, to open more detail.

## Behavior

- When the person types `/factory`, the mod SHALL open the Focus view when the focus module is shown, and the Factory view otherwise.
- When the person types `/factory` followed by `factory`, `focus`, `escalations`, `relay` or `team` and nothing more, the mod SHALL open that view.
- When the person types `/factory help`, the mod SHALL print the help.
- When the person types `/factory` followed by `use`, `focus` with an argument, `teams`, `hosts`, `show` or `reset`, the mod SHALL run that command of [FR-014](./FR-014-user-choice.md).
- When the person types `/factory` with any other argument, the mod SHALL say the argument is not a command and print the help.
- The commands `/focuses`, `/escalations`, `/relay` and `/team` SHALL remain for one release as aliases that take the same arguments as `/factory focus`, `/factory escalations`, `/factory relay` and `/factory team`.
- The mod SHALL NOT register a command named `band`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-003-AC-1 | With the focus module shown `/factory` opens the Focus view, and without it opens the Factory view. | Test |
| FR-003-AC-2 | For each of `factory`, `focus`, `escalations`, `relay` and `team`, `/factory <view>` opens exactly that view. | Test |
| FR-003-AC-3 | `/factory focus2` says `focus2` is not a command and prints the help. | Test |
| FR-003-AC-4 | `/focuses`, `/escalations`, `/relay` and `/team` each behave as `/factory <view>`, and `/focuses team` sets the focus scope as `/factory focus team` does. | Test |
| FR-003-AC-5 | `/factory focus` with no argument opens the Focus view and `/factory focus team` sets the scope and opens no view. | Test |
| FR-003-AC-6 | No command named `band` is registered. | Test |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [US-006](../usecase/US-006-both-layouts.md)
