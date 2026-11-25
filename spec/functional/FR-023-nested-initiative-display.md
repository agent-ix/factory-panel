---
id: FR-023
title: Nested initiative display
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-022"
    type: traces_to
---
# FR-023: Nested initiative display

## Description

The mod SHALL draw each initiative with its projects indented beneath it, each with its own bar and counts, as the relay terminal monitor's Scope view does.

## Behavior

- The mod SHALL draw an initiative row followed by one indented row per child project.
- A project row SHALL show its bar and `done/total`.
- A project row SHALL show Remaining as `total - done`, Ready and Blocked where `ready_queue` and `blocker_layers` supply them, and `-` where they do not.
- An initiative row SHALL show the same columns from its roll-up.
- The mod SHALL let the user collapse and expand an initiative, using the existing `focusCollapsed` state.
- The mod SHALL show a collapsed initiative row with its roll-up and no child rows.
- The mod SHALL hide completed projects, those with `done` equal to `total`, unless the existing `focusShowDone` state is set.
- Where hiding completed projects leaves an initiative with no child row, the mod SHALL still draw the initiative row with `all projects done`.
- A failed project row SHALL carry only a short mark and the project name, with no error text.
- The mod SHALL list a project in several selected initiatives under each of them.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-023-AC-1 | For initiative A with projects P1 and P2, the card draws A, then P1 and P2 indented, and each row has a bar and `done/total`. | Test |
| FR-023-AC-2 | Given P1 has done 10 and total 25, its Remaining reads 15, and where no ready or blocker data exists those columns read `-`. | Test |
| FR-023-AC-3 | Given A is collapsed, A's row and roll-up are drawn, P1 and P2 are not, and expanding restores them. | Test |
| FR-023-AC-4 | Given P1 is complete and `focusShowDone` is unset, P1 is hidden, and with it set P1 is drawn. | Test |
| FR-023-AC-5 | Given every project of A is complete and hidden, A is drawn with `all projects done`. | Test |
| FR-023-AC-6 | Given P2 failed, its row shows a short mark and its name and no error text. | Test |
| FR-023-AC-7 | Given P under A and B, P is drawn under both. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-022](FR-022-initiative-rollup-and-honest-totals.md)
