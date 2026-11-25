---
id: FR-010
title: Features
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-009"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-008"
    type: implements
---
# FR-010: Features

## Description

The mod SHALL expose the things it can show as features that can be selected independently.

## Behavior

- The mod SHALL offer the modules health, local, focus, queue, lead, lanes, attention, relay, team, agents and spend as selectable features.
- The mod SHALL offer the scope choices hosts (all or this machine), focus (own, own and team, or a named focus) and teams (a list) as selectable features.
- The mod SHALL NOT use a role to decide what is displayed.
- When no feature has been selected by anyone, the mod SHALL show the fallback modules local, focus, lead and lanes.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-010-AC-1 | Given each of the eleven module names selected, the band draws that module. | Test |
| FR-010-AC-2 | Given a relay address that names a coordinator and nothing selected, the band shows the fallback modules, not a coordinator set. | Test |
| FR-010-AC-3 | Given nothing selected and no relay answer, the band shows local, focus, lead and lanes. | Test |
| FR-010-AC-4 | The source of the mod contains no role-to-module table that decides the display. | Inspection |

## Dependencies

- **Upstream**: [US-009](../usecase/US-009-select-features.md), [US-008](../usecase/US-008-coordinator-teams.md)
