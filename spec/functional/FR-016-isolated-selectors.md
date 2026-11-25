---
id: FR-016
title: Isolated selectors and partial progress
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-011"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-016: Isolated selectors and partial progress

## Description

The mod SHALL compute the progress of a focus per selector, so that one failing selector never removes the progress of the others, with a bounded number of calls.

## Behavior

- A selector SHALL be one initiative, one project, one milestone or one ticket of the shown focus.
- The selectors of a named focus SHALL be its `include` members.
- The selectors of a lead's focus SHALL be the initiatives, projects and tickets of its `agent-msg work` report scope.
- The mod SHALL map a selector to the argument of a single `ix-board --json focus status` call: `--initiative <ref>`, `--project <ref>`, `--milestone <ref>` alone, or `--issue <ref>`, where a ref is a UUID, an identifier or an exact name as `ix-board focus status --help` states.
- The mod SHALL first ask `ix-board --json focus status` once with every selector, with a timeout of 15 seconds.
- Where the combined call exited non-zero with stderr text that does not indicate an authentication or authorisation failure, the mod SHALL ask again once for each selector separately.
- The mod SHALL classify a spawn failure, a timeout, stderr text that indicates an authentication or authorisation failure, and stderr text that indicates a Linear rate limit as a source error.
- A Linear rate limit holds the whole workspace, so it is a source error and never a selector error.
- The mod SHALL classify any other non-zero exit with stderr text as a selector error.
- Where the combined call could not start, timed out, failed to authenticate, or was rate limited, the mod SHALL show one ix-board source error.
- Where the combined call could not start, timed out, failed to authenticate, or was rate limited, the mod SHALL make no single-selector call.
- The mod SHALL run at most 4 single-selector ix-board processes at once per session, counted across every focus shown.
- The mod SHALL give each single-selector call a timeout of 5 seconds.
- The mod SHALL start the 30 second budget of a progress refresh when its first ix-board call begins, after the lookups of leads and definitions.
- The mod SHALL end a progress refresh when that budget has passed.
- The mod SHALL count each selector still unanswered at the end of a refresh as failed with the error `timed out`.
- The mod SHALL make at most N+1 ix-board calls in one progress refresh for N selectors.
- The mod SHALL show the progress of every selector whose call succeeds.
- The mod SHALL name each selector whose call fails, with the error text of that call.
- Where the combined call failed and every single call succeeded, the mod SHALL sum the aggregate from the single results.
- Where the combined call failed and every single call succeeded, the mod SHALL leave the aggregate unmarked as partial.
- Where the combined call failed and every single call succeeded, the mod SHALL add the note `summed from parts; overlapping selectors may count twice`.
- The aggregate SHALL sum the selectors shown from fresh results and from old records.
- The aggregate SHALL exclude failed selectors.
- The mod SHALL print `F fresh, O old, X failed` on the same line as the aggregate number or bar.
- Where O or X is above zero, the mod SHALL mark the aggregate partial.
- Where O or X is above zero, the mod SHALL draw the aggregate as neither complete nor done.
- The mod SHALL NOT draw an empty Focus card because one selector failed.
- Where every selector fails and no record exists, the mod SHALL show each failing selector with its error and no aggregate.
- The mod SHALL run at most one progress refresh at a time.
- The mod SHALL coalesce a tick that arrives during a refresh into the next one.
- The mod SHALL ignore a refresh result that is older than the record it would replace.
- The mod SHALL NOT keep a refresh in the Linear gate cache when any selector failed or when it fell back to single-selector calls.
- Where the last refresh was not kept, the mod SHALL NOT run the combined call and the single-selector calls again for 5 minutes.
- Where the last refresh was not kept, the mod SHALL show its outcome during those 5 minutes, marked as an earlier outcome.
- Where the last refresh was not kept, the mod SHALL ask ix-board again at the first poll after those 5 minutes.
- A manual refresh SHALL ask ix-board at once, unless a Linear rate limit holds.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-016-AC-1 | Given a focus of initiatives A and B and projects C and D and a combined call that exits non-zero with an error, the mod makes four single-selector calls and shows the progress of each that succeeds. | Test |
| FR-016-AC-2 | Given the combined call fails with `issue QSL-3215 references unavailable milestone m1 in project p1` and only project D fails alone, the pane shows A, B and C and names D with its error text. | Test |
| FR-016-AC-3 | Given 2 fresh selectors with done 4 and 6, 1 old record with done 10, and 1 failed selector, the aggregate done is 20 and the line reads `2 fresh, 1 old, 1 failed` and is marked partial. | Test |
| FR-016-AC-4 | Given the combined call succeeds, the mod makes no single-selector call, shows no partial mark and prints `F fresh, 0 old, 0 failed`. | Test |
| FR-016-AC-5 | Given every selector fails and no record exists, the pane shows each selector with its error, draws no aggregate, and still draws the lead's summary. | Test |
| FR-016-AC-6 | Given a single-selector call that does not answer within the 5 second timeout of NFR-004, that selector is failed with a timeout error and the other selectors are drawn. | Test |
| FR-016-AC-7 | Given a combined call that fails and every single call succeeds, the aggregate is the sum of the singles, is not partial, and carries the note `summed from parts; overlapping selectors may count twice`. | Test |
| FR-016-AC-8 | Given ix-board is missing, or the combined call times out at 15 seconds, or exits with stderr `authentication failed`, the mod shows one ix-board error and makes no single-selector call. | Test |
| FR-016-AC-9 | Given 10 selectors and a failing combined call, the mod makes at most 11 calls, never more than 4 at once, and each selector unanswered at 30 seconds is failed with `timed out`. | Test |
| FR-016-AC-10 | Given a refresh in flight and two ticks, only one further refresh runs afterwards, and a result older than the stored record is ignored. | Test |
| FR-016-AC-11 | Given a milestone member with ref m1, the single call is `--milestone m1` with no project argument; an initiative, project and ticket map to `--initiative`, `--project` and `--issue`. | Test |
| FR-016-AC-12 | Given a lead focus whose work report scope has initiatives, projects and tickets, those become the selectors, and given a report with none, the pane says `no selectors` and ix-board is not called. | Test |
| FR-016-AC-13 | Given the combined call exits with stderr `Linear rate limited; retry in 60s`, the mod shows one ix-board error, makes no single-selector call, and the gate holds further calls until the retry time. | Test |
| FR-016-AC-14 | Given a refresh in which one selector failed, polls during the next 5 minutes make no ix-board call and the pane marks the outcome as earlier, the first poll after 5 minutes asks again, a manual refresh asks at once, and a refresh answered by the combined call is kept for 15 minutes. | Test |
| FR-016-AC-15 | Given two focuses each with selectors and failing combined calls, no more than 4 single-selector ix-board processes run at once across both. | Test |


## Superseded in 0.7.0

[FR-021](./FR-021-per-project-progress.md) supersedes the combined call, the per-selector retry and the summed-from-parts note of this requirement, and [FR-022](./FR-022-initiative-rollup-and-honest-totals.md) supersedes the `F fresh, O old, X failed` aggregate line with `X of Y projects`. A selector is now a project, and an initiative selector expands to its projects first. The source-error classification, the 4-at-once and 5 second bounds, the 30 second budget, the single refresh at a time, the 5 minute hold and the rule that a partial total is never drawn complete remain. Acceptance criteria FR-016-AC-1, AC-2, AC-3, AC-4, AC-5, AC-7 and AC-11 are replaced by those of FR-021 and FR-022.

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-017](FR-017-last-good-progress.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
