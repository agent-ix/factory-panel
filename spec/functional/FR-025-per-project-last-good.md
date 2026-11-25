---
id: FR-025
title: Last good progress per project
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-017"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-025: Last good progress per project

## Description

The mod SHALL key last-good records by project and hold failed refreshes for 5 minutes, so that a failing project keeps its old numbers and costs no repeated calls.

## Behavior

- The mod SHALL record each successful project call under the key `project:<project name>` in `progress.json`, with the fields [FR-017](./FR-017-last-good-progress.md) names.
- Where a project call fails and a record exists, the mod SHALL draw the project row from the record, marked old with its age.
- Where a project call fails and no record exists, the mod SHALL draw the project row as failed.
- The mod SHALL derive an initiative roll-up from its projects' fresh and old records.
- The mod SHALL NOT keep a record of an initiative.
- Where a refresh had a failed project or a failed roadmap call, the mod SHALL NOT call ix-board again for 5 minutes.
- Where ix-board is not called for 5 minutes after a failure, the mod SHALL mark the outcome as earlier.
- The mod SHALL ask ix-board again at the first poll after those 5 minutes.
- A manual refresh SHALL ask ix-board at once, unless a Linear rate limit holds.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-025-AC-1 | After a successful call for project P, `progress.json` holds `project:P` and a new session reads it. | Test |
| FR-025-AC-2 | Given a record for P from 5 minutes ago and a failing call for P, P is drawn from the record marked old with age 5 minutes, and the initiative counts P in `X of Y`. | Test |
| FR-025-AC-3 | Given a failing call for Q with no record, Q is drawn failed and not counted. | Test |
| FR-025-AC-4 | Given a refresh with one failed project, polls in the next 5 minutes make no call and show the earlier outcome, the first poll after asks again, and a manual refresh asks at once. | Test |
| FR-025-AC-5 | Given a legacy `focus:` or `initiative:` record in `progress.json`, the mod ignores it and the file stays valid. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-017](FR-017-last-good-progress.md), [FR-021](FR-021-per-project-progress.md)
