---
id: FR-002
title: Fallback defaults
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
---
# FR-002: Fallback defaults

## Description

The mod SHALL show a fixed fallback set of modules when no user choice and no agent declaration selects modules. This requirement supersedes the 0.4.0 role presets.

## Behavior

- The fallback modules SHALL be local, focus, lead and lanes.
- The mod SHALL NOT choose modules from a role.
- The mod SHALL NOT ask a role question.
- The mod SHALL show the host list only when the hosts scope is `all`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-002-AC-1 | With nothing selected the band shows local, focus, lead and lanes. | Test |
| FR-002-AC-2 | With nothing selected the band shows no host list. | Test |
| FR-002-AC-3 | With hosts `all` selected the band names each machine. | Test |
| FR-002-AC-4 | The coordinator, planner and worker presets and the role question of 0.4.0 are absent. | Inspection |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md)
- **Superseded by**: [FR-010](FR-010-features.md), [FR-012](FR-012-selection-precedence.md)
