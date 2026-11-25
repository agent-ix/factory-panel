---
id: FR-012
title: Selection precedence
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-007"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-009"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-010"
    type: implements
---
# FR-012: Selection precedence

## Description

The mod SHALL decide each feature from the highest source that selects it.

## Behavior

- The order of sources SHALL be the user's choice ([FR-014](./FR-014-user-choice.md)), then the declaration file ([FR-011](./FR-011-feature-declaration.md)), then the automatic defaults.
- The mod SHALL decide each feature separately.
- The automatic defaults SHALL take identity, team, focus and status from `agent-msg whoami` and `agent-msg work`.
- In the default view the focus and lead modules SHALL draw the relay status of the shown focus.
- The mod SHALL NOT ask a question at session start or at a plain `/factory`.
- Where `agent-msg whoami` fails, the automatic defaults SHALL apply the unknown-session scope of [FR-013](./FR-013-scoping.md).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-012-AC-1 | Given a user choice of modules and a declaration naming other modules, the band shows the user's modules. | Test |
| FR-012-AC-2 | Given a user choice of modules and a declaration naming a focus scope, the band shows the user's modules at the declared scope. | Test |
| FR-012-AC-3 | Given a declaration with `teams` of ENG and the relay address `host1:QSL:code`, lanes shows team ENG. | Test |
| FR-012-AC-4 | Given nothing selected and the relay address `host1:QSL:code` with status from `agent-msg work`, the focus and lead cells show that status. | Test |
| FR-012-AC-6 | Given a user choice of `teams` or `hosts` and a declaration naming other values, the band uses the user's values. | Test |
| FR-012-AC-5 | A plain `/factory` in a session with nothing selected asks no question. | Test |

## Dependencies

- **Upstream**: [US-007](../usecase/US-007-own-focus.md), [US-009](../usecase/US-009-select-features.md), [US-010](../usecase/US-010-choose-display.md)
