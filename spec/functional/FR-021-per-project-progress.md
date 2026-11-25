---
id: FR-021
title: Per-project progress calls
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-021: Per-project progress calls

## Description

The mod SHALL request progress for one project per ix-board call, so that a project with bad data fails alone.

## Behavior

- A selector SHALL be one project, one initiative, one milestone or one ticket of the shown focus.
- The mod SHALL resolve an initiative selector to its projects with one `ix-board --json roadmap` call per refresh, reading `result.initiatives[].projects[].name` of the initiative whose `name` equals the selector.
- The mod SHALL request the progress of a project with `ix-board --json focus status --project <exact project name>`, where the project name is accepted as a ref by `ix-board focus status --help`.
- The mod SHALL NOT call `ix-board focus status --initiative`.
- The mod SHALL read `progress.done`, `progress.total` and `open_by_state` from the `projects` entry of the answer, and `ready_queue` and `blocker_layers` for the Ready and Blocked counts.
- Where the roadmap call fails, the mod SHALL classify the failure as a source error under [FR-016](./FR-016-isolated-selectors.md) and make no project call for initiative selectors.
- Where an initiative selector names no initiative in the roadmap, the mod SHALL show that selector as failed with `initiative not found`.
- Where a project call exits non-zero, the mod SHALL fail that project alone with the stderr text.
- The mod SHALL keep the results of every other project when one project fails.
- The mod SHALL run at most 4 project calls at once per session, each with a timeout of 5 seconds.
- The mod SHALL make at most N+1 ix-board calls in one progress refresh for N distinct projects.
- The mod SHALL call a project shown under several selectors once.
- The mod SHALL count a project still unanswered at the 30 second budget of [FR-016](./FR-016-isolated-selectors.md) as failed with `timed out`.
- The mod SHALL keep a milestone selector as `--milestone <ref>` and a ticket selector as `--issue <ref>`, each a selector of its own.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-021-AC-1 | Given an initiative whose roadmap entry lists 18 projects, the mod calls roadmap once and `focus status --project <name>` once per project, and never `--initiative`. | Test |
| FR-021-AC-2 | Given one of 18 project calls exits non-zero with `issue QSL-3236 references unavailable milestone m1 in project p1`, the other 17 are drawn with their counts and the failed project is named with that text. | Test |
| FR-021-AC-3 | Given the roadmap call times out or exits non-zero, the mod shows one ix-board source error, makes no project call for the initiative, and still draws project and ticket selectors. | Test |
| FR-021-AC-4 | Given an initiative selector absent from the roadmap, that selector is shown failed with `initiative not found` and the other selectors are drawn. | Test |
| FR-021-AC-5 | Given 10 projects, at most 11 calls are made, never more than 4 at once, and a project unanswered at 30 seconds is failed with `timed out`. | Test |
| FR-021-AC-6 | Given project P is under two selected initiatives, `focus status --project P` runs once. | Test |
| FR-021-AC-7 | Given ix-board later tolerates the dangling milestone and every call succeeds, the same calls run and no project is marked failed. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
