---
id: FR-026
title: Combined progress calls
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
# FR-026: Combined progress calls

## Description

The mod SHALL request the progress of all healthy projects of a focus in one ix-board call, and remember a selector that ix-board cannot answer, so that a large focus costs one call per refresh and a project with bad data costs the others nothing.

## Behavior

### The combined call

- The mod SHALL ask for the healthy projects of a focus with one `ix-board --json focus status` call that holds `--project <ref>` once for each of them, the ref passed verbatim as an id, an identifier or an exact name.
- A project is healthy where no rule 3 call of [FR-021](./FR-021-initiative-expansion.md) answered it and the known-bad memory does not hold it.
- The mod SHALL name a project once in a refresh, whichever selectors list it.
- Where a project is listed by name and by id and the id of that name is known, the mod SHALL ask for it by id only.
- A milestone selector SHALL be asked on its own with `--milestone <ref>` alone, and a ticket selector with `--issue <ref>`.
- The mod SHALL read `projects[].id`, `projects[].identifier`, `projects[].name`, `progress.done`, `progress.total`, `in_progress`, `open_by_state`, `ready_queue` and `blocker_layers` from an answer.
- The mod SHALL give a project of an answer to the ref that equals its id or identifier, else to the ref that equals its name.
- Where exactly one ref and one project of an answer are left unmatched, the mod SHALL give that project to that ref.
- The mod SHALL count a ref with no project in the answer as failed.
- The mod SHALL identify a project by `projects[].id` of the answer and use its name only as a label.
- The mod SHALL derive the Ready and Blocked counts of [FR-023](./FR-023-nested-initiative-display.md) as that requirement states, `ready_queue` and `blocker_layers` being counted over the whole call.

### Finding the project that fails a call

- Where a call for several projects fails and the error is no source error of [FR-016](./FR-016-isolated-selectors.md), the mod SHALL search that call for the failing projects.
- Where the error names a project as `in project <project-uuid>` and exactly one ref of the call is that project, by id or by the name `project-chunk` or a record gives the uuid, the mod SHALL take that ref as failing and ask for the other refs together.
- Otherwise the mod SHALL ask for the two halves of the refs, each in one call, and search each half that fails.
- The mod SHALL search level by level, splitting every failed part of one level before it splits any part of the next, and SHALL record the answers of a level before it judges its failures.
- Where no `focus status` call of the refresh has succeeded and every call of a second or later level fails with the same error text, naming no uuid, the mod SHALL treat that error as a source error and end the search.
- Where the one call for all healthy projects fails and no `focus status` call of the refresh succeeds, the mod SHALL treat its error as a source error, unless for each of those projects an error names it, by its id, by a ref of at least 8 characters, or as the project the error of a combined call names.
- Where that source error is declared, the mod SHALL remember no selector of the refresh and ask for no project name.
- The mod SHALL make at most 12 further ix-board calls for such searches in one refresh, halves, retries without a named project and the `project-chunk` call that names it counted together.
- Where that allowance is used up, the mod SHALL count each ref not yet asked alone as failed with `not isolated: <error>`.
- The mod SHALL end every search within the 60 second budget of [FR-016](./FR-016-isolated-selectors.md).
- The mod SHALL draw every project that a call of the search answers.
- The mod SHALL ask `ix-board --json project-chunk <ref>` once for a project that failed on its own and that no record or cached membership has named, and keep the name in the record of the project.

### Known-bad selectors

- The mod SHALL keep the selectors that failed in `~/.ix/factory-panel/known-bad.json`, shared by every session, with the time of the last try, the error, and for a project its id and name where known.
- The mod SHALL remember a selector that failed on its own where the error names it, where another `focus status` call of the same refresh succeeded, or where it is remembered already.
- The mod SHALL NOT remember a selector because of a source error or a timeout, nor a project of a search that was not asked alone and not named by an error.
- The mod SHALL leave a remembered project out of the combined call, and draw it from its record or as failed, with the remembered error.
- The mod SHALL ask for a remembered selector again, on its own, at the first refresh at least 60 minutes after the last try, and at every manual refresh.
- The mod SHALL write the time of a try before making it, so that no other session tries the same selector in the same 60 minutes.
- Where a source error cuts a try off, the mod SHALL restore the time of the earlier try.
- The mod SHALL match a remembered project to a ref by id, and by name where the ref has no known id.
- The mod SHALL forget a selector that answers.
- The mod SHALL drop an entry that no refresh has read for 24 hours.

### Bounds

- Where an ix-board call fails with a source error of [FR-016](./FR-016-isolated-selectors.md), the mod SHALL make no further ix-board call in that refresh.
- Where a Linear rate limit names a retry time, the mod SHALL make no ix-board call before that time.
- The mod SHALL make at most `R + U + 1 + K + S + C` ix-board calls in one refresh, where R is 1 where the roadmap is read and 0 otherwise, U is the count of rule 3 calls of [FR-021](./FR-021-initiative-expansion.md), K is the count of milestones, tickets and remembered projects asked on their own, S is at most 12 calls of a search, and C is the count of `project-chunk` calls that name a failed project, those of rule 4c of FR-021 included.
- The mod SHALL run at most 4 ix-board processes at once per session.
- The mod SHALL give each ix-board call a timeout of 20 seconds.
- The mod SHALL end the refresh at the 60 second budget of [FR-016](./FR-016-isolated-selectors.md).
- The mod SHALL count a project, milestone or ticket unanswered at the end of the budget as failed with `timed out`.

Note: measured against the live workspace on 2026-11-24, one call for 19 projects took 3.6 seconds and single calls 4.5 to 7 seconds. Its `projects[]` entries were identical to those of single calls, and its `ready_queue` entries, which name their project, split into the same per-project lists. Its `blocker_layers` entries name no project and cannot be split. A call that names a project with a dangling milestone fails whole, and its error names that project.

Note: `ix-board focus status --help` states that `--project` accepts a UUID, an identifier or an exact name, and may be repeated.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-026-AC-3 | Given ix-board is missing, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-4 | Given the first call of a refresh times out, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-5 | Given a call exits with stderr `authentication failed`, the mod shows one ix-board error and makes no further call in that refresh. | Test |
| FR-026-AC-6 | Given a call exits with `Linear rate limited; retry in 60s`, the mod shows one ix-board error, makes no further call, and makes no call for 60 seconds, and what was answered before it is drawn and recorded. | Test |
| FR-026-AC-9 | Given two focuses with many calls, no more than 4 ix-board processes run at once across both. | Test |
| FR-026-AC-11 | Given a project renamed since its record was written, the answer's `projects[].id` matches the record, the record is replaced, and the row shows the new name. | Test |
| FR-026-AC-12 | Given two projects with the same name and ids supplied by the roadmap, both are asked by id and counted separately; without ids, the ambiguous-name call fails that row with its error text and no two projects are merged. | Test |
| FR-026-AC-15 | Given project selectors by id, by identifier and by name, one of them listed twice, and a milestone and a ticket, one `focus status` call holds `--project` once for each of the three projects verbatim, and the milestone is asked with `--milestone` alone and the ticket with `--issue`. | Test |
| FR-026-AC-16 | Given 19 healthy projects and no initiative, one ix-board call is made, and each row shows the done, total and ready that its own answer would give. | Test |
| FR-026-AC-17 | Given one call for two projects, no row has a blocked count, the header blocked is the number of distinct open blockers of the answer, and two projects of one name show no ready count. | Test |
| FR-026-AC-18 | Given one of 18 projects makes the combined call fail with an error that names its id, at most one further `focus status` call is made, the other 17 are drawn, the failed one is named with the error, and `known-bad.json` holds it with its id and name. | Test |
| FR-026-AC-19 | Given one of 19 projects fails with an error that names no project id, it is found with at most 12 further calls, the others are drawn, and it alone is remembered. | Test |
| FR-026-AC-20 | Given more failing projects than 12 further calls can isolate while other calls answer, no more calls are made, the projects not isolated fail with `not isolated: <error>`, and only failing projects asked alone are remembered. | Test |
| FR-026-AC-21 | Given a remembered project, a refresh 31 minutes later leaves it out of the combined call and draws it failed with the remembered error; a refresh 60 minutes after the last try asks it alone; a manual refresh asks it alone at once; and when it answers it is forgotten and the next combined call names it again. | Test |
| FR-026-AC-22 | Given another session reads a `known-bad.json` that holds a project, its first refresh leaves that project out of the combined call and asks it not at all. | Test |
| FR-026-AC-23 | Given an authentication failure, a rate limit, a timeout of a call for several projects, or 8 projects whose every call is refused with the same words that name no project, one source error is shown and nothing is remembered, the last after 7 calls; and a try of a remembered project cut off by a source error stays due. | Test |
| FR-026-AC-24 | Given one initiative answered by the roadmap, two initiatives needing rule 3 calls and 3 listed projects, one roadmap call, two rule 3 calls and one combined call are made. | Test |
| FR-026-AC-25 | Given a ticket unanswered at the 20 second call timeout or at the 60 second budget, it fails with `timed out`, the projects are drawn and nothing is remembered. | Test |
| FR-026-AC-26 | Given the only project of a focus fails with an error that does not name it and no other call succeeds, one source error is shown, it is not remembered, no call is made for 5 minutes and the first refresh after them asks it again. | Test |
| FR-026-AC-27 | Given 8 projects of which 2 fail with the same words that name no project, whether both are in one half or one is in each, the other 6 are drawn, the 2 are found within 12 further calls and remembered, and the next refresh is one call for the 6, 30 minutes later. | Test |
| FR-026-AC-28 | Given 4 projects whose every call is refused, each in its own words that name no project, one source error is shown, nothing is remembered, no project name is asked for, and the first call after 5 minutes asks again. | Test |

## Superseded in 0.7.1

One combined call replaces the one call per project of 0.7.0.

| Removed | Replaced by |
|---------|-------------|
| FR-026-AC-1 (one `--project` call per selector) | FR-026-AC-15 |
| FR-026-AC-2 (one of 18 project calls exits non-zero) | FR-026-AC-18 and FR-026-AC-19 |
| FR-026-AC-7 (10 calls for 10 projects) | FR-026-AC-16 |
| FR-026-AC-8 (1 + 2 + 3 calls) | FR-026-AC-24 |
| FR-026-AC-10 (timeout of one project call) | FR-026-AC-23 and FR-026-AC-25 |
| FR-026-AC-13 (the same calls run when ix-board tolerates the milestone) | FR-026-AC-16 |
| FR-026-AC-14 (a project under two selectors is called once) | FR-026-AC-15 |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-021](FR-021-initiative-expansion.md), [FR-025](FR-025-per-project-last-good.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
