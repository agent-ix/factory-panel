---
id: FR-025
title: Last good progress per project
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-017"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-025: Last good progress per project

## Description

The mod SHALL key last-good records by project id, remember which projects belong to an initiative, and hold failed refreshes for 5 minutes, so that a failing project keeps its old numbers and costs no repeated calls.

## Behavior

- The mod SHALL record each successful project call in `progress.json` under `project:<project id>`, with the fields of [FR-017](./FR-017-last-good-progress.md) and the `id`, `identifier` and `name` of the project as aliases.
- The mod SHALL find the record of a failed project by matching the selector ref to its key, identifier or name.
- Where a project call fails and a record exists, the mod SHALL draw the project row from the record, marked old with its age.
- Where a project call fails and no record exists, the mod SHALL draw the project row as failed.
- The mod SHALL use records written by 0.6.0 under `project:<uuid>`.
- The mod SHALL ignore records keyed by project name and records keyed `focus:` or `initiative:`.
- The mod SHALL prune those records by the 24 hour `seen_ms` rule of [FR-017](./FR-017-last-good-progress.md).
- The mod SHALL NOT keep a progress record of an initiative.
- Whenever an initiative is resolved, the mod SHALL store its project ids and names in the reserved top-level key `initiatives` of `progress.json`, under the initiative id where known and the name otherwise, with `at_ms` and `seen_ms`.
- The mod SHALL prune an `initiatives` entry whose `seen_ms` is older than 24 hours.
- Where a refresh had a failed project or a failed roadmap call, the mod SHALL NOT call ix-board again for 5 minutes.
- Where ix-board is not called during those 5 minutes, the mod SHALL mark the outcome as earlier.
- The mod SHALL ask ix-board again at the first poll after those 5 minutes.
- A manual refresh SHALL ask ix-board at once, unless a rate limit holds as [FR-021](./FR-021-per-project-progress.md) states.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-025-AC-1 | After a successful call for project P, `progress.json` holds `project:<P id>` with the aliases, and a new session reads it. | Test |
| FR-025-AC-2 | Given a record for P from 5 minutes ago and a failing call for P, P is drawn from the record marked old with age 5 minutes and counted in its initiative's `X of Y`. | Test |
| FR-025-AC-3 | Given a failing call for Q with no record, Q is drawn failed and not counted. | Test |
| FR-025-AC-4 | Given a refresh with one failed project, polls in the next 5 minutes make no call and show the earlier outcome, the first poll after asks again, and a manual refresh asks at once unless a rate limit holds. | Test |
| FR-025-AC-5 | Given `project:<uuid>` records from 0.6.0, they are used, and given records keyed by project name and `focus:` and `initiative:` records, they are ignored, the file stays valid, and they are pruned once `seen_ms` is older than 24 hours. | Test |
| FR-025-AC-6 | After a successful refresh over an initiative, `progress.json` holds no progress record of it. | Test |
| FR-025-AC-7 | After an initiative is resolved, the `initiatives` key holds its project ids and names with `at_ms` and `seen_ms`, and a new session reads them. | Test |
| FR-025-AC-8 | Given a failing rule 3 call and cached membership, the initiative is drawn from the cache with project rows from their records, and the row says `includes old data`. | Test |
| FR-025-AC-9 | Given an `initiatives` entry whose `seen_ms` is 24 hours 1 minute old, the next write removes it. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-017](FR-017-last-good-progress.md), [FR-021](FR-021-per-project-progress.md)
