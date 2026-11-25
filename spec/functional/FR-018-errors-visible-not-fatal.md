---
id: FR-018
title: Source errors visible and not fatal
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-011"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-024"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
---
# FR-018: Source errors visible and not fatal

## Description

The mod SHALL show the error of each failing source in one place so that no failing source blocks another source or the first paint.

## Behavior

- The sources SHALL be ix-board (one per project, and the roadmap), `agent-msg work`, `agent-msg focuses`, and Prometheus.
- The mod SHALL show the errors of the Focus card as the footer warning icon of [FR-024](./FR-024-warning-icon-in-footer.md), and those of the other modules on their card error line, as [FR-006](./FR-006-honest-states.md) requires.
- `/factory show` SHALL list every failing source with its error text.
- `/factory show` SHALL give the age of the last success for ix-board selectors from the record of [FR-017](./FR-017-last-good-progress.md) and for the other sources from memory.
- The mod SHALL start the sources independently, so that the answer time of one source does not change the time at which another source's data is drawn.
- The mod SHALL paint the first view before any source answers.
- Where the failing source has a last good value, the mod SHALL show it as [FR-017](./FR-017-last-good-progress.md) says.
- The mod SHALL catch every source failure.
- The mod SHALL raise no source failure to the engine.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-018-AC-1 | Given ix-board fails and `agent-msg work` and Prometheus answer, the Focus card shows the ix-board error in the footer warning of FR-024 and the summary and metrics are drawn. | Test |
| FR-018-AC-2 | Given `agent-msg work` fails and ix-board answers, the progress is drawn and the work error is shown. | Test |
| FR-018-AC-3 | Given Prometheus does not answer, the Focus pane and lanes are drawn and the Factory view says the metrics are unavailable with the reason. | Test |
| FR-018-AC-4 | Given ix-board fails for one selector and Prometheus fails, `/factory show` lists both with their error text and the age of each last success where one exists. | Test |
| FR-018-AC-5 | Given one source that never returns and the others answering after 100 ms, the answering sources are drawn within 1 second of their answers and the first view is painted within the NFR-001 target. | Test |
| FR-018-AC-6 | Given every source fails, no exception reaches the engine and each module shows its source's error. | Test |
| FR-018-AC-7 | Given `agent-msg focuses list` fails, the error is listed under `agent-msg focuses` in `/factory show` and the Focus pane still draws. | Test |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-006](FR-006-honest-states.md), [NFR-001](../non-functional/NFR-001-first-paint.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
