---
id: FR-010
title: Features
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-009"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-008"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-014"
    type: traces_to
---
# FR-010: Features

## Description

The mod SHALL expose what it can show as features that a skill, an agent or the user can select independently.

## Behavior

- The mod SHALL offer each module in the module-to-view table of [FR-009](./FR-009-band-cells.md) as a selectable feature.
- The mod SHALL offer the hosts scope (`all` or `local`), the focus (`all` or a Linear initiative or project) and the `teams` list as selectable features.
- The mod SHALL NOT use a role to decide what is displayed.
- Where no feature has been selected by the user or by a declaration, the mod SHALL show the fallback modules of [FR-002](./FR-002-fallback-defaults.md).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-010-AC-1 | Given each module of the FR-009 table selected in turn, the band draws that module's cell. | Test |
| FR-010-AC-2 | Given the relay address `host1:ENG:arch` and nothing selected, the band shows the fallback modules and no other. | Test |
| FR-010-AC-3 | Given nothing selected and `agent-msg whoami` failing, the hosts scope defaults to `all` ([FR-013](FR-013-scoping.md)), so the band is the host list followed by exactly the fallback modules. | Test |
| FR-010-AC-4 | The files `hooks/role.ts` and `hooks/band/roles.ts` do not exist, and `grep -rn "PRESETS" hooks/` finds nothing. | Inspection |

## Dependencies

- **Upstream**: [US-009](../usecase/US-009-select-features.md), [US-008](../usecase/US-008-coordinator-teams.md)
- **See also**: [FR-014](FR-014-user-choice.md)
