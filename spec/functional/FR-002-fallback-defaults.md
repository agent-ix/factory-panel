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

The mod SHALL show the fallback modules local, focus, lead and lanes when neither the user nor a declaration selects modules. This requirement supersedes the 0.4.0 role presets and is the one statement of the fallback set.

## Behavior

- The mod SHALL NOT choose modules from a role.
- The mod SHALL NOT ask a role question.
- The mod SHALL show the host list only where the hosts scope is `all`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-002-AC-1 | With nothing selected the band shows local, focus, lead and lanes. | Test |
| FR-002-AC-2 | With nothing selected the band shows no host list. | Test |
| FR-002-AC-3 | With hosts `all` selected the band names each machine. | Test |
| FR-002-AC-4 | No role question and no role preset table exist in `hooks/`: `grep -rn "PRESETS" hooks/` finds nothing and `/factory role` is not a command. | Inspection |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md)
- **See also**: [FR-010](FR-010-features.md), [FR-012](FR-012-selection-precedence.md)
