---
id: FR-026
title: Per-project progress calls
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-026: Per-project progress calls

## Description

The mod SHALL request progress for one project per ix-board call, so that a project with bad data fails alone.

## Behavior

- The mod SHALL pass a project selector verbatim as `ix-board --json focus status --project <ref>`, where the ref is an id, an identifier or an exact name.
- A milestone selector SHALL map to `--milestone <ref>` alone and a ticket selector to `--issue <ref>`.
- The mod SHALL read `projects[].id`, `projects[].name`, `progress.done`, `progress.total`, `open_by_state`, `ready_queue` and `blocker_layers` from the answer of a project call.
- The mod SHALL identify a project by `projects[].id` of the answer.
- The mod SHALL use the project name only as a label.
- The mod SHALL call a project once per refresh, whichever selectors list it.
- The mod SHALL keep the results of every other project when one project call fails.
- Where an ix-board call fails with a source error of [FR-016](./FR-016-isolated-selectors.md), the mod SHALL make no further ix-board call in that refresh.
- Where a Linear rate limit names a retry time, the mod SHALL make no ix-board call before that time.
- The mod SHALL ask `ix-board --json project-chunk <ref>` once for a project whose call failed and that no record or cached membership has named, and keep the name in the record of the project.
- The mod SHALL make at most `R + U + P + C` ix-board calls in one refresh, where R is 1 with an initiative selector and 0 without, U is the count of rule 3 calls of [FR-021](./FR-021-initiative-expansion.md), P is the count of distinct project refs not answered by a rule 3 call, and C is the count of `project-chunk` calls of this requirement and of rule 4c of FR-021.
- The mod SHALL run at most 4 ix-board processes at once per session.
- The mod SHALL give each ix-board call a timeout of 20 seconds.
- The mod SHALL end the refresh at the 60 second budget of [FR-016](./FR-016-isolated-selectors.md).
- The mod SHALL count a project unanswered at the end of the budget as failed with `timed out`.

Note: measured against the live workspace, a project call took 3.5 to 5.7 seconds and the roadmap call 2 seconds, so the first draft's 5 second call timeout and 30 second budget failed live calls; they are 20 and 60 seconds.

Note: `ix-board focus status --help` states that `--project` accepts a UUID, an identifier or an exact name.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-026-AC-1 | Given project selectors by id, by identifier and by name, each is passed verbatim to `--project`, a milestone to `--milestone` alone and a ticket to `--issue`. | Test |
| FR-026-AC-2 | Given one of 18 project calls exits non-zero with `issue QSL-3236 references unavailable milestone m1 in project p1`, the other 17 are drawn with their counts and the failed project is named with that text. | Test |
| FR-026-AC-3 | Given ix-board is missing, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-4 | Given a call times out, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-5 | Given a call exits with stderr `authentication failed`, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-6 | Given a call exits with `Linear rate limited; retry in 60s`, the mod shows one ix-board error, makes no further call, and makes no call for 60 seconds. | Test |
| FR-026-AC-7 | Given 10 distinct project selectors and no initiative, at most 10 calls are made. | Test |
| FR-026-AC-8 | Given one initiative answered by the roadmap, two initiatives needing rule 3 calls and 3 listed projects, at most 1 + 2 + 3 calls are made, and each `project-chunk` call is one more. | Test |
| FR-026-AC-9 | Given two focuses with many projects, no more than 4 ix-board processes run at once across both. | Test |
| FR-026-AC-10 | Given a project unanswered at the 20 second call timeout or at the 60 second budget, that project is failed with `timed out` and the other projects are drawn. | Test |
| FR-026-AC-11 | Given a project renamed since its record was written, the answer's `projects[].id` matches the record, the record is replaced, and the row shows the new name. | Test |
| FR-026-AC-12 | Given two projects with the same name and ids supplied by the roadmap, both are called by id and counted separately; without ids, the ambiguous-name call fails that row with its error text and no two projects are merged. | Test |
| FR-026-AC-13 | Given ix-board tolerates the dangling milestone and every call succeeds, the same calls run, every project row has a bar and counts, the footer shows no warning line, and the header is drawn complete only when its done equals its total. | Test |
| FR-026-AC-14 | Given project P is listed under two selectors, `focus status --project P` runs once. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-021](FR-021-initiative-expansion.md), [FR-025](FR-025-per-project-last-good.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
