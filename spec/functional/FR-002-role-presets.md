---
id: FR-002
title: Role presets
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
---
# FR-002: Role presets

## Description

The mod SHALL choose the modules of the band from the person's role.

## Behavior

- The coordinator preset SHALL be health, focus, attention, relay and team.
- The code-lead preset SHALL be local, focus, lead and lanes.
- The planner preset SHALL be focus, queue and lead.
- The worker preset SHALL be local.
- The choice "Other" in the role question SHALL select the worker role.
- The mod SHALL show the host list only to a program coordinator.
- When no role is known, the mod SHALL use the code-lead preset.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-002-AC-1 | The coordinator band shows health, focus, attention, relay and team, and names each machine. | Test |
| FR-002-AC-2 | The code-lead band shows local, focus, lead and lanes. | Test |
| FR-002-AC-3 | The code-lead band shows no host list. | Test |
| FR-002-AC-4 | The planner band shows focus, queue and lead. | Test |
| FR-002-AC-5 | The worker band shows local only, and answering "Other" to the role question selects the worker role. | Test |
| FR-002-AC-6 | With no known role the band shows the code-lead modules. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md)
