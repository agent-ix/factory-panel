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
- A project row SHALL show Remaining as `total - done`.
- A project row SHALL show Ready as the count of `ready_queue` entries of that project's own call.
- A project row SHALL show Blocked as the count of entries not classified `Completed` in `blocker_layers` of that call.
- The mod SHALL show `-` for Ready or Blocked only where its key is absent from the answer.
- The mod SHALL show `0` for Ready or Blocked where its key is present and empty.
- An initiative row SHALL show Remaining, Ready and Blocked as the sums over its counted projects.
- The mod SHALL let the user collapse and expand an initiative, using the existing `focusCollapsed` state.
- The mod SHALL key `focusCollapsed` by initiative id where the id is known, and by initiative name otherwise.
- The mod SHALL show a collapsed initiative row with its roll-up and no child rows.
- The mod SHALL hide completed projects, those with `done` equal to `total`, unless the existing `focusShowDone` state is set.
- Where hiding completed projects leaves an initiative with no child row, the mod SHALL still draw the initiative row with `all projects done`.
- A failed project row SHALL carry only a short mark and the project name, with no error text.
- The mod SHALL list a project in several selected initiatives under each of them.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-023-AC-1 | For initiative A with projects P1 and P2, the card draws A, then P1 and P2 indented, and each row has a bar and `done/total`. | Test |
| FR-023-AC-2 | A project with done 10, total 25, 3 `ready_queue` entries and blocker layers holding 4 entries of which 1 is `Completed` shows Remaining 15, Ready 3 and Blocked 3. | Test |
| FR-023-AC-3 | A project whose answer has an empty `ready_queue` shows Ready `0`, and one whose answer lacks `ready_queue` shows `-`. | Test |
| FR-023-AC-4 | Collapsing A draws A's row and roll-up without P1 and P2, expanding restores them, and the collapsed state is held under A's id, or A's name where no id is known. | Test |
| FR-023-AC-5 | With P1 complete and `focusShowDone` unset, P1 is hidden, and with it set P1 is drawn. | Test |
| FR-023-AC-6 | With every project of A complete and hidden, A is drawn with `all projects done`. | Test |
| FR-023-AC-7 | A failed project P2 shows a short mark and its name and no error text. | Test |
| FR-023-AC-8 | A project under A and B is drawn under both. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-022](FR-022-initiative-rollup-and-honest-totals.md)
