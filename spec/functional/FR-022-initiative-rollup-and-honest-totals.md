---
id: FR-022
title: Initiative roll-up and honest totals
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
---
# FR-022: Initiative roll-up and honest totals

## Description

The mod SHALL compute an initiative as the roll-up of its counted projects and the header total from all counted projects.

The mod SHALL state wherever a part is missing or old.

## Behavior

- The mod SHALL sum `done` and `total` of an initiative's counted projects as the initiative's `done` and `total`.
- The mod SHALL count a project where it has a fresh result or an old record of at most 24 hours.
- The mod SHALL NOT use a record whose `at_ms` is older than 24 hours.
- The mod SHALL draw a project with no usable record and a failed call as failed.
- The mod SHALL print `X of Y projects` on an initiative row, where Y is its enumerated project count and X the count of counted projects.
- The mod SHALL mark an initiative partial only where X is below Y.
- Where a counted project is old, the mod SHALL print `includes old data (oldest <age>)` on the row, distinct from the partial mark.
- The mod SHALL sum the header total over each distinct project id once.
- The mod SHALL print the stage counts that `open_by_state` supplies, summed over the same projects, in the header.
- The mod SHALL print `X of Y projects` in the header over all enumerated projects.
- Where an initiative cannot be enumerated, the header SHALL state `N initiatives not expanded` and, for one, `1 initiative not expanded`.
- Where any project is missing or any initiative is not expanded, the header SHALL carry the partial mark.
- Where any counted project is old, the header SHALL print `includes old data (oldest <age>)`.
- The mod SHALL draw the header total as complete only where its done equals its total and no part is missing, old or not expanded.
- The mod SHALL take the projects a project belongs to from the roadmap `also_in` of each project and `projects_in_multiple_initiatives`, from the rule 3 answer, or from the cached membership.
- A project in several selected initiatives SHALL count once in the header and once in each initiative roll-up.
- A selected project in no selected initiative SHALL show under the row `not in a selected initiative`.
- Where no project is counted, the mod SHALL draw no total.
- Where no project is counted, the mod SHALL show the failed rows and the lead's summary.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-022-AC-1 | Given an initiative of 18 projects with 17 counted, the row reads `17 of 18 projects`, is marked partial, and its done and total are the sums of the 17. | Test |
| FR-022-AC-2 | Given all 18 projects answered fresh, the row reads `18 of 18 projects` with no partial mark and no old note. | Test |
| FR-022-AC-3 | Given 17 of 18 projects counted whose done equals their total, the header is not drawn as complete or done and reads partial with `17 of 18 projects`. | Test |
| FR-022-AC-4 | Given project P is listed under initiatives A and B by the roadmap `also_in`, A and B each include P and the header counts P once. | Test |
| FR-022-AC-5 | Given a selected project in no selected initiative, it shows under `not in a selected initiative`. | Test |
| FR-022-AC-6 | Given every project fails and no record exists, the card draws no total, shows each failed row, and still draws the lead's summary. | Test |
| FR-022-AC-7 | Given 17 projects fresh and one drawn from a record 5 minutes old, the row reads `18 of 18 projects`, is not partial, and says `includes old data (oldest 5m)`. | Test |
| FR-022-AC-8 | Given 17 distinct projects with done d1 to d17 and total t1 to t17, the header done is the sum of d and the total the sum of t and it reads `17 of 17 projects`. | Test |
| FR-022-AC-9 | Given initiative A whose 4 projects all fail with no record and initiative B whose projects succeed, A reads `0 of 4 projects` with no total, B is drawn, and the header sums B only and is partial. | Test |
| FR-022-AC-10 | Given a record whose `at_ms` is 24 hours 1 minute old and a failing call, the project is drawn failed and not counted. | Test |
| FR-022-AC-11 | Given an initiative that cannot be enumerated, its row is failed with `projects unknown` the header says `1 initiative not expanded` and is partial, and with two such initiatives it says `2 initiatives not expanded`. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-021](FR-021-initiative-expansion.md)
