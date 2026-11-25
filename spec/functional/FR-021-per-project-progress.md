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

The mod SHALL expand each initiative selector to its projects before the project calls.

## Behavior

- The mod SHALL pass a project selector verbatim as `ix-board --json focus status --project <ref>`, where the ref is an id, an identifier or an exact name.
- The mod SHALL read `projects[].id`, `projects[].name`, `progress.done`, `progress.total`, `open_by_state`, `ready_queue` and `blocker_layers` from the answer of a project call.
- The mod SHALL identify a project by `projects[].id` of the answer.
- The mod SHALL use the project name only as a label.
- The mod SHALL call a project once per refresh, whichever selectors list it.
- A milestone selector SHALL map to `--milestone <ref>` alone and a ticket selector to `--issue <ref>`.
- The mod SHALL expand an initiative selector by the first rule below that resolves it, in this order.
- Rule 1: where `ix-board --json roadmap` lists `id` or `identifier` on its initiatives and projects, the mod SHALL match the selector to an initiative by id or identifier.
- Under rule 1 the mod SHALL call the projects by id.
- Rule 2: otherwise the mod SHALL match the selector to the `name` of a roadmap initiative exactly.
- Under rule 2 the mod SHALL call the projects by name.
- Rule 3: where the selector is a UUID or an identifier and the roadmap has no match, the mod SHALL make one `ix-board --json focus status --initiative <ref>` call.
- Under rule 3 the mod SHALL take the projects, with their progress, from `projects[]` of that answer.
- Rule 4: where that call fails, the mod SHALL expand the initiative from the membership cached by [FR-025](./FR-025-per-project-last-good.md) for it.
- Rule 5: where that call fails and no membership is cached, the mod SHALL draw the initiative row as failed with `projects unknown`.
- The mod SHALL show `initiative not found` only where the roadmap has no match, the rule 3 call reports the initiative as not found, and no membership is cached.
- The mod SHALL make one `ix-board --json roadmap` call per refresh when a selector is an initiative, and none otherwise.
- Where the roadmap call fails, the mod SHALL draw each initiative from its cached membership, or as failed with `projects unknown` where none is cached.
- Where the roadmap call fails, the mod SHALL make no rule 3 call.
- The mod SHALL keep the results of every other project when one project call fails.
- Where an ix-board call fails with a source error of [FR-016](./FR-016-isolated-selectors.md), the mod SHALL make no further ix-board call in that refresh.
- Where a Linear rate limit names a retry time, the mod SHALL make no ix-board call before that time.
- The mod SHALL make at most `R + U + P` ix-board calls in one refresh, where R is 1 with an initiative selector and 0 without, U is the count of rule 3 calls, and P is the count of distinct project refs not answered by a rule 3 call.
- The mod SHALL run at most 4 ix-board processes at once per session.
- The mod SHALL give each ix-board call a timeout of 5 seconds.
- The mod SHALL end the refresh at the 30 second budget of [FR-016](./FR-016-isolated-selectors.md).
- The mod SHALL count a project unanswered at the end of the budget as failed with `timed out`.

Note: `ix-board focus status --help` states that `--project` accepts a UUID, an identifier or an exact name. The `ix-board` change that gives the roadmap ids is requested separately and rule 1 is written so that the mod needs no change when it lands. With the ix-board defect of a dangling milestone present and no cached membership, an initiative such as FSL Hardening cannot be expanded; it expands when the data is fixed or the roadmap carries ids.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-021-AC-1 | Given an initiative selected by name whose roadmap entry lists 18 projects and the roadmap has no ids, the mod calls roadmap once and `focus status --project <name>` once per project, and makes no `--initiative` call. | Test |
| FR-021-AC-2 | Given one of 18 project calls exits non-zero with `issue QSL-3236 references unavailable milestone m1 in project p1`, the other 17 are drawn with their counts and the failed project is named with that text. | Test |
| FR-021-AC-3 | Given a roadmap whose initiatives and projects carry `id`, an initiative selected by UUID is matched by id and its projects are called by id. | Test |
| FR-021-AC-4 | Given an initiative selected by UUID with no roadmap match, the mod makes one `--initiative <uuid>` call, expands the initiative from its `projects[]` and makes no project call for them. | Test |
| FR-021-AC-5 | Given an initiative selected by identifier `I-10` that the roadmap does not list, the mod resolves it with the rule 3 call and expands it. | Test |
| FR-021-AC-6 | Given the rule 3 call for a UUID fails and a membership is cached, the initiative is expanded from the cache, each project is called by id, and a project whose call fails is drawn from its old record marked old. | Test |
| FR-021-AC-7 | Given the rule 3 call for a UUID fails and no membership is cached, the card draws one failed initiative row `projects unknown`, never `initiative not found`, and the footer warning counts it once. | Test |
| FR-021-AC-8 | Given the roadmap has no match, the rule 3 call reports not found and no membership is cached, the row reads `initiative not found`. | Test |
| FR-021-AC-9 | Given ix-board is missing, or a call times out, or exits with stderr `authentication failed`, or exits with `Linear rate limited; retry in 60s`, the mod shows one ix-board error, makes no further call in that refresh, and for the rate limit makes no call for 60 seconds. | Test |
| FR-021-AC-10 | Given 10 distinct project selectors and no initiative, at most 10 calls are made, and with one initiative selector answered by roadmap and projects, at most 1 + P calls. | Test |
| FR-021-AC-11 | Given two focuses with many projects, no more than 4 ix-board processes run at once across both. | Test |
| FR-021-AC-12 | Given a project unanswered at the 5 second call timeout or at the 30 second budget, that project is failed with `timed out` and the other projects are drawn. | Test |
| FR-021-AC-13 | Given project selectors by id, by identifier and by name, each is passed verbatim to `--project`, a milestone to `--milestone` alone and a ticket to `--issue`. | Test |
| FR-021-AC-14 | Given a project renamed since its record was written, the answer's `projects[].id` matches the record, the record is replaced, and the row shows the new name. | Test |
| FR-021-AC-15 | Given two projects with the same name and ids supplied by the roadmap, both are called by id and counted separately; without ids, the ambiguous-name call fails that row with its error text and no two projects are merged. | Test |
| FR-021-AC-16 | Given ix-board tolerates the dangling milestone and every call succeeds, the same calls run, every project row has a bar and counts, the footer shows no warning line, and the header is drawn complete only when its done equals its total. | Test |
| FR-021-AC-17 | Given the roadmap call fails, each initiative is drawn from its cached membership or as failed `projects unknown`, and with a source error no project call is made. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-025](FR-025-per-project-last-good.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
