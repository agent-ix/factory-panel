---
id: FR-006
title: Honest states
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
---
# FR-006: Honest states

## Description

The mod SHALL show a missing, stale or failed source as missing, with its reason.

## Behavior

- A machine that has never reported SHALL be drawn with a grey no-data mark.
- The mod SHALL draw a machine whose watcher has not pushed for more than 120 seconds as not reporting.
- The mod SHALL say in the band which machines are not reporting.
- The mod SHALL leave out a source that has not been asked yet, rather than draw it as healthy.
- When this machine has not reported, the local module SHALL say there is no data instead of drawing old numbers.
- When a source reports an error, the band SHALL show the error text for that source.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-006-AC-1 | Given a machine that has never reported, the band draws a grey no-data mark for it, never a green one. | Test |
| FR-006-AC-2 | Given a machine last seen 600 seconds ago, the band draws it as not reporting and names it in the line below the cells. | Test |
| FR-006-AC-3 | Given this machine has not reported, the local module reads "no data" and shows no percentages. | Test |
| FR-006-AC-4 | Given the relay check has not yet been asked, the relay module is left out; given it failed, the band shows a warning with the error text. | Test |
| FR-006-AC-5 | Given an ix-board error, the lanes module shows that error. | Test |
| FR-006-AC-6 | Given no machines and a metrics error, the band shows "hosts —" and the metrics error. | Test |

## Dependencies

- **Upstream**: [US-005](../usecase/US-005-trust-what-i-see.md)
