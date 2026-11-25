---
id: FR-021
title: Initiative expansion
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-026"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-021: Initiative expansion

## Description

The mod SHALL expand each initiative selector to its projects before the project calls of [FR-026](./FR-026-per-project-calls.md).

A failing expansion SHALL NOT affect any other selector.

## Behavior

- The mod SHALL expand an initiative selector by the first rule below that resolves it, in this order.
- Rule 1: where `ix-board --json roadmap` lists `id` or `identifier` on its initiatives and projects, the mod SHALL match the selector to an initiative by id or identifier.
- Under rule 1 the mod SHALL call the projects by id.
- Rule 2: otherwise the mod SHALL match the selector to the `name` of a roadmap initiative exactly.
- Under rule 2 the mod SHALL call the projects by name.
- Rule 3: where the selector is a UUID or an identifier and the roadmap has no match, the mod SHALL make one `ix-board --json focus status --initiative <ref>` call.
- Under rule 3 the mod SHALL take the projects, with their progress, from `projects[]` of that answer.
- Rule 4: where the rule 3 call fails, the mod SHALL expand the initiative from the membership cached by [FR-025](./FR-025-per-project-last-good.md) for it.
- Rule 4c: where the rule 3 call fails with an error that names a project as `in project <project-uuid>` and no membership is cached, the mod SHALL ask `ix-board --json project-chunk <project-uuid>` for the name of that project.
- Under rule 4c the mod SHALL take the roadmap initiative that lists a project of exactly that name as the identity of the initiative, only where exactly one roadmap initiative does.
- Under rule 4c the mod SHALL expand the initiative to the projects of that roadmap initiative, call each by name, and store its name and project list in the `initiatives` key of `progress.json` under the selector.
- Under rule 4c a project whose call fails SHALL fail alone and be drawn with its name and no counts.
- Rule 5: where the rule 3 call fails, rule 4c does not resolve the initiative and no membership is cached, the mod SHALL draw the initiative row as failed with `projects unknown`.
- Rule 4b: the mod SHALL call each project that the focus lists directly, individually and whether or not any initiative can be expanded.
- The mod SHALL draw a directly listed project with its counts when its initiative is failed with `projects unknown`.
- The mod SHALL show `initiative not found` only where the roadmap has no match, the rule 3 call reports the initiative as not found, and no membership is cached.
- The mod SHALL make one `ix-board --json roadmap` call per refresh when a selector is an initiative, and none otherwise.
- Where the roadmap call fails, the mod SHALL draw each initiative from its cached membership, or as failed with `projects unknown` where none is cached.
- Where the roadmap call fails, the mod SHALL make no rule 3 call.

Note: a lead's scope holds initiative and project UUIDs while the roadmap lists names only. The upstream fixes are SWM-296 (the `ix-board` roadmap carrying ids, filed in the Linear Alpha Feedback project) and SWM-295 (the dangling-milestone failure of `focus status`). Rule 1 is written so that the mod needs no change when SWM-296 lands, and rule 3 keeps working after SWM-295 is fixed. With SWM-295 present and no cached membership, an initiative such as FSL Hardening cannot be expanded; it expands when the data is fixed or the roadmap carries ids.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-021-AC-1 | Given an initiative selected by name whose roadmap entry lists 18 projects and the roadmap has no ids, the mod calls roadmap once and `focus status --project <name>` once per project, and makes no `--initiative` call. | Test |
| FR-021-AC-2 | Given a roadmap whose initiatives and projects carry `id`, an initiative selected by UUID is matched by id and its projects are called by id. | Test |
| FR-021-AC-3 | Given an initiative selected by UUID with no roadmap match, the mod makes one `--initiative <uuid>` call, expands the initiative from its `projects[]` and makes no project call for them. | Test |
| FR-021-AC-4 | Given an initiative selected by identifier `I-10` that the roadmap does not list, the mod resolves it with the rule 3 call and expands it. | Test |
| FR-021-AC-5 | Given the rule 3 call for a UUID fails and a membership is cached, the initiative is expanded from the cache, each project is called by id, and a project whose call fails is drawn from its old record marked old. | Test |
| FR-021-AC-6 | Given the rule 3 call for a UUID fails and no membership is cached, the card draws one failed initiative row `projects unknown`, never `initiative not found`, and the footer warning counts it once. | Test |
| FR-021-AC-7 | Given the roadmap has no match, the rule 3 call reports not found and no membership is cached, the row reads `initiative not found`. | Test |
| FR-021-AC-8 | Given the roadmap call fails, each initiative is drawn from its cached membership or as failed `projects unknown`, and with a source error no project call is made. | Test |
| FR-021-AC-9 | Given an initiative failed with `projects unknown` and two projects listed directly, both projects are called individually and drawn with their counts. | Test |
| FR-021-AC-10 | Given the rule 3 call for a UUID fails with `issue QSL-3236 references unavailable milestone m1 in project p1`, no membership is cached, `project-chunk p1` names the project `Stability` and exactly one roadmap initiative `Hardening` lists a project of that name, the card draws `Hardening` with all its projects called by name, the project `Stability` fails alone with its name, and `progress.json` holds `Hardening` as the name of the initiative. | Test |
| FR-021-AC-11 | Given the same failure and two roadmap initiatives that list a project of that name, or none, the initiative is drawn failed with `projects unknown`. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-025](FR-025-per-project-last-good.md), [FR-026](FR-026-per-project-calls.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
