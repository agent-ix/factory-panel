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
- A project row SHALL show its name, its bar and `done/total` and no other text.
- An initiative row SHALL show its name, its bar and the sum of `done/total` over its counted projects and no other text.
- The mod SHALL give every top-level row a bar starting at one column and every child row a bar starting at a second column, the indent to the right of the first, both ending at the same right edge.
- The mod SHALL right-align the `done/total` counts in one column as wide as the widest count.
- The mod SHALL draw the overall bar over the whole card width on one row with its `done/total` at the right edge, and the legend on its own row below.
- The mod SHALL put Remaining, Ready and Blocked of each project and of each initiative in the footer warning expansion of [FR-024](./FR-024-warning-icon-in-footer.md) and in `/factory show`, not in the card body.
- The mod SHALL compute Remaining as `total - done`.
- The mod SHALL compute Ready of a project asked alone as the count of `ready_queue` entries of its answer, and of a project asked with others as the count of entries that name it as their `project`.
- Where two projects of one answer share a name, the mod SHALL show no Ready for either.
- Where a `ready_queue` entry of an answer for several projects names no project, the mod SHALL show no Ready for any project of that answer.
- The mod SHALL compute Blocked of a project asked alone as the count of entries not classified `Completed` in `blocker_layers` of its answer.
- The mod SHALL show no Blocked for a project asked with others, a blocker entry naming no project.
- The mod SHALL show `-` for a Ready or Blocked that is not shown by these rules or whose key is absent from the answer.
- The mod SHALL show `0` for Ready or Blocked where its key is present and empty.
- The mod SHALL compute an initiative's Remaining as the sum over its counted projects.
- The mod SHALL compute the Ready of an initiative and of the header, and an initiative's Blocked, as the sum over the counted projects only where every one of them has it, and show `-` otherwise, in the band's queue cell too.
- The record of a project whose Ready is unknown SHALL hold no `ready`.
- The mod SHALL compute the Blocked of the header as that of the one counted project where it has one, else as the number of distinct entries not classified `Completed` over the `blocker_layers` of every answer of the refresh.
- The mod SHALL show no Blocked in the header where a counted project is drawn from a record or an answer lacks `blocker_layers`.
- Where the header has a Blocked and a counted project asked with others has none, `/factory show` SHALL say that blocked is counted once over the focus because a combined answer does not say which project a blocker belongs to.
- The mod SHALL let the user collapse and expand an initiative, using the existing `focusCollapsed` state.
- The mod SHALL key `focusCollapsed` by initiative id where the id is known, and by initiative name otherwise.
- The mod SHALL show a collapsed initiative row with its roll-up and no child rows.
- The mod SHALL hide completed projects, those with `done` equal to `total`, unless the existing `focusShowDone` state is set.
- Where hiding completed projects leaves an initiative with no child row, the mod SHALL still draw the initiative row.
- A failed project row SHALL carry the project name, an empty dim bar and `—` in place of the counts, with no error text.
- The mod SHALL leave every error text out of the card body, the error being in the footer warning expansion and in `/factory show`.
- The mod SHALL list a project in several selected initiatives under each of them.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-023-AC-1 | For initiative A with projects P1 and P2, the card draws A, then P1 and P2 indented, and each row has a bar and `done/total`; top-level bars share one start column and child bars share a second, later one, and the overall bar and its total share one row. | Test |
| FR-023-AC-2 | A project asked alone with done 10, total 25, 3 `ready_queue` entries and blocker layers holding 4 entries of which 1 is `Completed` has no Remaining, Ready or Blocked text in the card body, and `/factory show` shows Remaining 15, Ready 3 and Blocked 3 for it. | Test |
| FR-023-AC-3 | A project whose answer has an empty `ready_queue` shows Ready `0`, and one whose answer lacks `ready_queue` shows `-`. | Test |
| FR-023-AC-4 | Collapsing A draws A's row and roll-up without P1 and P2, expanding restores them, and the collapsed state is held under A's id, or A's name where no id is known. | Test |
| FR-023-AC-5 | With P1 complete and `focusShowDone` unset, P1 is hidden, and with it set P1 is drawn. | Test |
| FR-023-AC-6 | With every project of A complete and hidden, A is drawn as its own row with no child row. | Test |
| FR-023-AC-7 | A failed project P2 shows its name, an empty bar and `—` and no error text, and its error is in the footer warning expansion and in `/factory show`. | Test |
| FR-023-AC-8 | A project under A and B is drawn under both. | Test |
| FR-023-AC-9 | Given two projects answered by one call, each shows its own Ready and `-` for Blocked, the header shows the distinct open blockers once, and `/factory show` says why no project has its own. | Test |
| FR-023-AC-10 | Given an initiative with two projects of one name in one answer and a third whose Ready is 1, the initiative and the header show no Ready, the two records hold no `ready`, and a project later drawn from such a record shows no Ready. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-022](FR-022-initiative-rollup-and-honest-totals.md)
