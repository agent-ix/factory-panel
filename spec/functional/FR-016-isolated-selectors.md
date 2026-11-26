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
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-026"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-022"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
---
# FR-016: Isolated selectors and partial progress

## Description

The mod SHALL keep the progress of a focus per selector, so that one failing selector never removes the progress of the others, with a bounded number of calls.

## Behavior

- A selector SHALL be one initiative, one project, one milestone or one ticket of the shown focus.
- The selector of a chosen focus SHALL be its one initiative or project.
- The selectors of a lead's focus SHALL be the initiatives, projects and tickets of its `agent-msg work` report scope.
- The mod SHALL ask ix-board for the progress of a selector as [FR-026](./FR-026-per-project-calls.md) states, with an initiative expanded to its projects first as [FR-021](./FR-021-initiative-expansion.md) states.
- The mod SHALL classify a spawn failure as a source error.
- The mod SHALL classify the timeout of an ix-board call as a source error where no ix-board call of that refresh has answered yet.
- The mod SHALL classify the timeout of a call that asks more than one project as a source error.
- The mod SHALL classify the timeout of a call that asks one thing as the failure of that thing, with the error `timed out`, where another call of that refresh has answered.
- The mod SHALL NOT lay a source error on a selector.
- The mod SHALL classify stderr text that names an authentication, authorisation, token, credential or API key failure, or an unauthorised or forbidden answer, as a source error.
- The mod SHALL NOT classify a ticket identifier such as `QSL-403` in an error text as an authorisation failure.
- The mod SHALL classify a non-zero exit with no stderr text as the failure of that call, with its stdout text as the error where it has any.
- The mod SHALL classify stderr text that indicates a Linear rate limit as a source error.
- A Linear rate limit holds the whole workspace, so it is a source error and never a selector error.
- The mod SHALL classify any other non-zero exit with stderr text as a selector error, except as [FR-026](./FR-026-per-project-calls.md) makes it a source error where no status call of the refresh answers.
- Where a source error occurs, the mod SHALL make no further ix-board call in that refresh.
- The mod SHALL run at most 4 ix-board processes at once per session, counted across every focus shown.
- The mod SHALL give each ix-board call a timeout of 20 seconds.
- The mod SHALL start the 60 second budget of a progress refresh when its first ix-board call begins, after the lookups of leads and definitions.
- The mod SHALL end a progress refresh when that budget has passed.
- The mod SHALL count each project still unanswered at the end of a refresh as failed with the error `timed out`.
- The mod SHALL show the progress of every selector whose call succeeds.
- The mod SHALL name each selector whose call fails, with the error text of that call.
- The mod SHALL NOT draw an empty Focus card because one selector failed.
- The mod SHALL run at most one progress refresh at a time.
- The mod SHALL coalesce a tick that arrives during a refresh into the next one.
- The mod SHALL ignore a refresh result that is older than the record it would replace.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-016-AC-10 | Given a refresh in flight and two ticks, only one further refresh runs afterwards, and a result older than the stored record is ignored. | Test |
| FR-016-AC-12 | Given a lead focus whose work report scope has initiatives, projects and tickets, those become the selectors, and given a report with none, `/factory show` and the warning expansion say `no selectors` and ix-board is not called. | Test |
| FR-016-AC-16 | Given the first ix-board call of a refresh times out, the mod shows one ix-board error, and given a call for one ticket times out after another call answered, only that ticket fails with `timed out`. | Test |
| FR-016-AC-17 | Given an error `issue QSL-403 references unavailable milestone m1 in project p1` for one project of a combined call, that project fails and no source error is shown, and given a project whose call exits with no stderr text, it fails and the others are drawn. | Test |
| FR-016-AC-18 | Given a combined call that fails because of one project, every other project is drawn with its progress and the failing one is named with the error text. | Test |

## Superseded in 0.7.0

[FR-021](./FR-021-initiative-expansion.md), [FR-026](./FR-026-per-project-calls.md), [FR-022](./FR-022-initiative-rollup-and-honest-totals.md) and [FR-025](./FR-025-per-project-last-good.md) replace the combined `focus status` call, the per-selector retry, the summed-from-parts note, the `F fresh, O old, X failed` line and the 5 minute hold of this requirement. The bullets and criteria below were removed from it. The source-error classification, the bounds, the single refresh at a time and the empty-card rule remain.

| Removed | Replaced by |
|---------|-------------|
| FR-016-AC-1 (four single calls after a failing combined call) | FR-016-AC-18 and FR-021-AC-1 |
| FR-016-AC-2 (one failing project named, others shown) | FR-016-AC-18 |
| FR-016-AC-3 (`F fresh, O old, X failed` aggregate) | FR-022-AC-1 and FR-022-AC-7 |
| FR-016-AC-4 (successful combined call, no partial mark) | FR-022-AC-2 and FR-026-AC-16 |
| FR-016-AC-5 (every selector fails) | FR-022-AC-6 |
| FR-016-AC-6 (single-call timeout) | FR-026-AC-25 |
| FR-016-AC-7 (summed-from-parts note) | dropped; nothing is summed from overlapping calls |
| FR-016-AC-8 (source errors make no single call) | FR-026-AC-3, FR-026-AC-4 and FR-026-AC-5 |
| FR-016-AC-9 (N+1 calls, 4 at once, 30 s) | FR-026-AC-24, FR-026-AC-9 and FR-026-AC-25 |
| FR-016-AC-11 (selector to argument mapping) | FR-026-AC-15 |
| FR-016-AC-13 (rate limit) | FR-026-AC-6 |
| FR-016-AC-14 (5 minute hold, 15 minute kept refresh) | FR-025-AC-10 and FR-025-AC-11 |
| FR-016-AC-15 (4 processes across two focuses) | FR-026-AC-9 |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-017](FR-017-last-good-progress.md), [FR-021](FR-021-initiative-expansion.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
