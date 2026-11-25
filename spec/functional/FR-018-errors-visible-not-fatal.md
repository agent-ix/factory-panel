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
---
# FR-018: Source errors visible and not fatal

## Description

The mod SHALL show the error of each failing source in one place so that no failing source blocks another source or the first paint.

## Behavior

- The sources SHALL be ix-board (one per selector), `agent-msg work`, and Prometheus.
- The mod SHALL show each failing source's own error text on the card error line of the module that uses it, as [FR-006](./FR-006-honest-states.md) requires.
- `/factory show` SHALL list every failing source with its error text and the age of its last success.
- The mod SHALL ask the sources independently, so that a failure or a wait on one source does not delay or remove another source's data.
- The mod SHALL paint the first view before any source answers.
- Where the failing source has a last good value, the view SHALL show it as [FR-017](./FR-017-last-good-progress.md) says.
- The mod SHALL NOT throw an error to the engine because a source failed.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-018-AC-1 | Given ix-board fails and `agent-msg work` and Prometheus answer, the Focus card shows the ix-board error on its error line and the summary and metrics are drawn. | Test |
| FR-018-AC-2 | Given `agent-msg work` fails and ix-board answers, the progress is drawn and the work error is shown. | Test |
| FR-018-AC-3 | Given Prometheus does not answer, the Focus pane and lanes are drawn and the Factory view says the metrics are unavailable with the reason. | Test |
| FR-018-AC-4 | Given ix-board fails for one selector and Prometheus fails, `/factory show` lists both with their error text and age of last success. | Test |
| FR-018-AC-5 | Given a source that never returns, the first view is painted within the NFR-001 target and the other sources are drawn when they answer. | Test |
| FR-018-AC-6 | Given every source fails, the mod raises no error to the engine and each module shows its source's error. | Test |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-006](FR-006-honest-states.md), [NFR-001](../non-functional/NFR-001-first-paint.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
