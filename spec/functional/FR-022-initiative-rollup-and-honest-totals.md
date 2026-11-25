---
id: FR-022
title: Initiative roll-up and honest totals
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
---
# FR-022: Initiative roll-up and honest totals

## Description

The mod SHALL compute an initiative as the roll-up of its counted projects and the header total from all counted projects.

## Behavior

- The mod SHALL sum `done` and `total` of an initiative's counted projects as the initiative's `done` and `total`.
- The mod SHALL print `X of Y projects` on an initiative row, where Y is its project count and X the count of projects with a fresh or old result.
- The mod SHALL mark an initiative partial only where X is below Y.
- The mod SHALL leave an initiative unmarked where X equals Y, including when every counted result is old.
- The mod SHALL sum the header total over each distinct counted project once.
- The mod SHALL print the stage counts that `open_by_state` supplies, summed over the same projects, in the header.
- Where a project is missing, the header SHALL read as partial with `X of Y projects`.
- The mod SHALL NOT draw a partial total as complete or done.
- Where no project is counted, the mod SHALL draw no total.
- Where no project is counted, the mod SHALL show the failed rows.
- A project listed under several selected initiatives SHALL count once in the header and once in each initiative roll-up.
- A project in no selected initiative SHALL show under the row `not in a selected initiative`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-022-AC-1 | Given an initiative of 18 projects with 17 counted, the row reads `17 of 18 projects`, is marked partial, and its done and total are the sums of the 17. | Test |
| FR-022-AC-2 | Given all 18 projects are counted, the row carries no partial mark and reads `18 of 18 projects`. | Test |
| FR-022-AC-3 | Given a partial total, the header never draws a complete bar or a done mark and states `X of Y projects`. | Test |
| FR-022-AC-4 | Given project P under initiatives A and B, A and B each include P and the header counts P once. | Test |
| FR-022-AC-5 | Given a selected project in no selected initiative, it shows under `not in a selected initiative`. | Test |
| FR-022-AC-6 | Given every project fails and no record exists, the card draws no total, shows each failed row, and still draws the lead's summary. | Test |
| FR-022-AC-7 | Given an initiative whose projects all answered but one from an old record, the row is unmarked and the old row carries its age. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-021](FR-021-per-project-progress.md)
