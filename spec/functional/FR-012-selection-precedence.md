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

- The order of sources SHALL be the user's choice (a `/factory` choice or a plugin setting), then the agent's declaration file, then the automatic defaults.
- The mod SHALL decide each feature separately, so that a user's choice of modules leaves the declaration's focus scope in effect.
- The automatic defaults SHALL use the relay's `agent-msg whoami` and `agent-msg work` for identity, team, focus and status, and show relay status without any selection.
- The mod SHALL NOT ask any question at session start or at a plain `/factory`.
- When the relay cannot be read, the automatic defaults SHALL use the fallback modules and the scope rules of FR-013 for an unknown session.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-012-AC-1 | Given a user's choice of modules and a declaration naming other modules, the band shows the user's modules. | Test |
| FR-012-AC-2 | Given a user's choice of modules and a declaration naming a focus scope, the band shows the user's modules at the declared scope. | Test |
| FR-012-AC-3 | Given a declaration and the relay naming a different team, the declaration decides the teams. | Test |
| FR-012-AC-4 | Given no choice and no declaration, the band shows relay status for this session without a prompt. | Test |
| FR-012-AC-5 | A plain `/factory` in a directory with nothing selected asks no question. | Test |

## Dependencies

- **Upstream**: [US-007](../usecase/US-007-own-focus.md), [US-009](../usecase/US-009-select-features.md), [US-010](../usecase/US-010-choose-display.md)
