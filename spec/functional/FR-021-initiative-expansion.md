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

The mod SHALL expand each initiative selector to its projects before the combined call of [FR-026](./FR-026-per-project-calls.md), without asking ix-board again while the membership is known.

A failing expansion SHALL NOT affect any other selector.

## Behavior

- The mod SHALL expand an initiative from the membership cached by [FR-025](./FR-025-per-project-last-good.md) for it, with no roadmap and no rule 3 call, where that membership was resolved less than 6 hours ago and the refresh is not manual.
- Otherwise the mod SHALL expand an initiative selector by the first rule below that resolves it, in this order.
- Rule 1: where `ix-board --json roadmap` lists `id` or `identifier` on its initiatives and projects, the mod SHALL match the selector to an initiative by id or identifier.
- Under rule 1 the mod SHALL ask for the projects by id.
- Rule 2: otherwise the mod SHALL match the selector to the `name` of a roadmap initiative exactly.
- Under rule 2 the mod SHALL ask for the projects by name.
- Rule 3: where the selector is a UUID or an identifier and the roadmap has no match, the mod SHALL make one `ix-board --json focus status --initiative <ref>` call.
- Under rule 3 the mod SHALL take the projects, with their progress, from `projects[]` of that answer.
- Rule 4: where the rule 3 call fails, the mod SHALL expand the initiative from the membership cached by [FR-025](./FR-025-per-project-last-good.md) for it.
- Rule 4c: where the rule 3 call fails with an error that names a project as `in project <project-uuid>` and no membership is cached, the mod SHALL ask `ix-board --json project-chunk <project-uuid>` for the name of that project.
- Under rule 4c the mod SHALL take the roadmap initiative that holds a project of exactly that name, by listing it or by `also_in`, as the identity of the initiative, only where exactly one roadmap initiative holds it.
- Under rule 4c the mod SHALL NOT take an initiative that is itself one of the selected initiatives.
- Under rule 4c the mod SHALL expand the initiative to the projects of that roadmap initiative and ask for each by name.
- Under rule 4c the mod SHALL NOT store the membership or the name in `progress.json`, the identity being a guess.
- Under rule 4c a project that fails SHALL fail alone and be drawn with its name and no counts.
- Rule 5: where the rule 3 call fails, rule 4c does not resolve the initiative and no membership is cached, the mod SHALL draw the initiative row as failed with `projects unknown`.
- Rule 4b: the mod SHALL ask for each project that the focus lists directly, whether or not any initiative can be expanded.
- The mod SHALL draw a directly listed project with its counts when its initiative is failed with `projects unknown`.
- The mod SHALL show `initiative not found` only where the roadmap has no match, the rule 3 call reports the initiative as not found, and no membership is cached.
- The mod SHALL read `ix-board --json roadmap` only where an initiative has to be resolved, at most once in a refresh.
- The mod SHALL read the roadmap at most once in 30 minutes across all sessions, through the shared gate of [FR-025](./FR-025-per-project-last-good.md), and again for a manual refresh made at least 60 seconds after the last read.
- Where another session is reading the roadmap and nothing of it is at hand, the mod SHALL hold the refresh for 5 minutes only.
- Where a rule 3 call fails with no source error and no timeout, the mod SHALL remember the initiative as [FR-026](./FR-026-per-project-calls.md) states for a known-bad selector, and for 60 minutes make no roadmap, rule 3 or `project-chunk` call for it, unless the refresh is manual.
- The mod SHALL keep the result of rule 4c with that known-bad entry, and draw the initiative from its cached membership, else from that result, else as failed, while it is held.
- Where the roadmap call fails, the mod SHALL draw each initiative from its cached membership, or as failed with `projects unknown` where none is cached.
- Where the roadmap call fails, the mod SHALL make no rule 3 call.

Note: a lead's scope holds initiative and project UUIDs while the roadmap lists names only. The upstream fixes are SWM-296 (the `ix-board` roadmap carrying ids, filed in the Linear Alpha Feedback project) and SWM-295 (the dangling-milestone failure of `focus status`). Rule 1 is written so that the mod needs no change when SWM-296 lands, and rule 3 keeps working after SWM-295 is fixed. With SWM-295 present and no cached membership, an initiative such as FSL Hardening cannot be expanded; it expands when the data is fixed or the roadmap carries ids.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-021-AC-1 | Given an initiative selected by name whose roadmap entry lists 18 projects and the roadmap has no ids, the mod calls roadmap once and one `focus status` call with `--project <name>` for each project, and makes no `--initiative` call. | Test |
| FR-021-AC-2 | Given a roadmap whose initiatives and projects carry `id`, an initiative selected by UUID is matched by id and its projects are asked by id. | Test |
| FR-021-AC-3 | Given an initiative selected by UUID with no roadmap match, the mod makes one `--initiative <uuid>` call, expands the initiative from its `projects[]` and makes no project call for them. | Test |
| FR-021-AC-4 | Given an initiative selected by identifier `I-10` that the roadmap does not list, the mod resolves it with the rule 3 call and expands it. | Test |
| FR-021-AC-5 | Given the rule 3 call for a UUID fails and a membership older than 6 hours is cached, the initiative is expanded from the cache, its projects are asked by id, and a project that fails is drawn from its old record marked old. | Test |
| FR-021-AC-6 | Given the rule 3 call for a UUID fails and no membership is cached, the card draws one failed initiative row `projects unknown`, never `initiative not found`, and the footer warning counts it once. | Test |
| FR-021-AC-7 | Given the roadmap has no match, the rule 3 call reports not found and no membership is cached, the row reads `initiative not found`. | Test |
| FR-021-AC-8 | Given the roadmap call fails, each initiative is drawn from its cached membership or as failed `projects unknown`, and with a source error no project call is made. | Test |
| FR-021-AC-9 | Given an initiative failed with `projects unknown` and two projects listed directly, both projects are asked for and drawn with their counts. | Test |
| FR-021-AC-10 | Given the rule 3 call for a UUID fails with `issue QSL-3236 references unavailable milestone m1 in project p1`, no membership is cached, `project-chunk p1` names the project `Stability` and exactly one roadmap initiative `Hardening` lists a project of that name, the card draws `Hardening` with all its projects asked by name, the project `Stability` fails alone with its name, and `progress.json` holds no entry for the initiative. | Test |
| FR-021-AC-11 | Given the same failure and two roadmap initiatives that hold a project of that name, or none, or the one holder is itself a selected initiative, the initiative is drawn failed with `projects unknown`. | Test |
| FR-021-AC-12 | Given an initiative resolved by the roadmap, a refresh 31 minutes later makes the combined call only, with its projects by id; a refresh more than 6 hours later, and a manual refresh, resolve it again. | Test |
| FR-021-AC-13 | Given the rule 4c case of AC-10, a refresh 31 minutes later makes no roadmap, rule 3 or `project-chunk` call and draws the same initiative, and a refresh 60 minutes after the try asks the initiative again. | Test |
| FR-021-AC-14 | Given two focuses that each need the roadmap, 5 minutes apart, the roadmap is read once. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-025](FR-025-per-project-last-good.md), [FR-026](FR-026-per-project-calls.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
