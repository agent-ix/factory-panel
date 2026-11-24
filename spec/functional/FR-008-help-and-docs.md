---
id: FR-008
title: Help and documentation
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-006"
    type: implements
---
# FR-008: Help and documentation

## Description

The mod SHALL answer four questions in its help text and its README, in the words of the task: what do I see, how do I open more, how do I switch views, and how do I set my role.

## Behavior

- The `/factory help` text SHALL be organised by task, not by command or module name.
- In the fullscreen layout the help SHALL describe the docked panel.
- In the classic layout the help SHALL describe the band and its digits.
- The README SHALL have the sections What you see, How to use it, Roles, Advanced settings, Install and Developing, in that order.
- Every command and setting the README names SHALL exist in the plugin.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-008-AC-1 | `/factory help` answers see, open more, switch and role, each with the key or command to use. | Test |
| FR-008-AC-2 | In the classic layout the help names the band digits, and in the fullscreen layout it names the docked panel and its tabs. | Test |
| FR-008-AC-3 | The README has the six sections in that order. | Inspection |
| FR-008-AC-4 | Every `/command` and every setting the README names is registered by the plugin. | Test |
| FR-008-AC-5 | Given only the README and `/factory help`, a first-time user completes US-002, US-003 and US-004 in a real session. | Demonstration |

## Dependencies

- **Upstream**: [US-002](../usecase/US-002-open-more.md), [US-006](../usecase/US-006-both-layouts.md)
