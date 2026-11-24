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

- When the person types `/factory`, the mod SHALL open the detail view on the tab their role looks at first: Factory for a coordinator, Focus for a code lead or planner, local resources for a worker.
- When the person types `/factory` followed by `factory`, `focus`, `escalations`, `relay` or `team`, the mod SHALL open that view.
- When the person types `/factory help`, the mod SHALL print the help.
- When the person types `/factory` with any other argument, the mod SHALL say the argument is not a command and print the help.
- The mod SHALL NOT register a command named `band`.
- The commands `/focuses`, `/escalations`, `/relay` and `/team` SHALL remain for one release as aliases for `/factory <view>`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-003-AC-1 | Given the code-lead role, `/factory` opens the Focus view; given the coordinator role it opens the Factory view; in both the view holds the keyboard. | Test |
| FR-003-AC-2 | Given any of `factory`, `focus`, `escalations`, `relay`, `team`, `/factory <view>` opens exactly that view. | Test |
| FR-003-AC-3 | Given the argument `focus2`, `/factory focus2` says `focus2` is not a command and prints the help. | Test |
| FR-003-AC-4 | Given `/focuses`, `/escalations`, `/relay` or `/team`, each opens the same view as `/factory <view>`. | Test |
| FR-003-AC-5 | Given the plugin is loaded, no command named `band` is registered. | Test |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [US-006](../usecase/US-006-both-layouts.md)
