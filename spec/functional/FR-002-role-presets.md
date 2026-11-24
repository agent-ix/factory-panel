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
- The mod SHALL show the host list only to a program coordinator.
- The mod SHALL leave out a module that has nothing to report.
- Where the `bandModules` setting is set, the mod SHALL use that list in its order and ignore names it does not know.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-002-AC-1 | Given the coordinator role, the band shows health, focus, attention, relay and team, and shows each machine by name. | Test |
| FR-002-AC-2 | Given the code-lead role, the band shows local, focus, lead and lanes, and shows no host list. | Test |
| FR-002-AC-3 | Given the planner role, the band shows focus, queue and lead; given the worker role, it shows local only. | Test |
| FR-002-AC-4 | Given a module with nothing to report (for example no open escalations), the band omits that module. | Test |
| FR-002-AC-5 | With `bandModules` set to `local,nope,focus`, the band shows local then focus and ignores the unknown name. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md)
