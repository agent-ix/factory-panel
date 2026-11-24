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
---
# FR-003: One command

## Description

The mod SHALL provide one command, `/factory`, to open more detail.

## Behavior

- When the person types `/factory`, the mod SHALL open the detail view that their role looks at first: Factory for a coordinator or worker, Focus for a code lead or planner.
- When the person types `/factory` followed by `factory`, `focus`, `escalations`, `relay` or `team`, the mod SHALL open that view.
- When the person types `/factory help`, the mod SHALL print the help.
- When the person types `/factory` with any other argument, the mod SHALL say the argument is not a command and print the help.
- The commands `/focuses`, `/escalations`, `/relay` and `/team` SHALL remain for one release as aliases for `/factory <view>`.
- The mod SHALL NOT register a command named `band`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-003-AC-1 | For a code lead `/factory` opens the Focus view, and for a coordinator it opens the Factory view. | Test |
| FR-003-AC-2 | For a planner `/factory` opens Focus, and for a worker it opens Factory. | Test |
| FR-003-AC-3 | For each of `factory`, `focus`, `escalations`, `relay` and `team`, `/factory <view>` opens exactly that view. | Test |
| FR-003-AC-4 | `/factory focus2` says `focus2` is not a command and prints the help. | Test |
| FR-003-AC-5 | `/focuses`, `/escalations`, `/relay` and `/team` each open the same view as `/factory <view>`. | Test |
| FR-003-AC-6 | No command named `band` is registered. | Test |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [US-006](../usecase/US-006-both-layouts.md)
