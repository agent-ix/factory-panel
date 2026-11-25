---
id: FR-016
title: Isolated selectors and partial progress
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-011"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
---
# FR-016: Isolated selectors and partial progress

## Description

The mod SHALL compute the progress of a focus per selector, so that one failing selector never removes the progress of the others.

## Behavior

- A selector SHALL be one initiative, one project, one milestone or one ticket of the shown focus.
- The mod SHALL first ask `ix-board --json focus status` once with every selector of the focus.
- When that combined call fails, the mod SHALL ask again once for each selector separately.
- The mod SHALL show the progress of every selector whose call succeeds.
- The mod SHALL name each selector whose call fails, with the error text of that call.
- The mod SHALL draw aggregate progress from the succeeding selectors only.
- Where at least one selector failed, the mod SHALL say the aggregate is partial and give the count of selectors shown and the count that failed.
- The mod SHALL NOT draw an empty Focus card because one selector failed.
- Where every selector fails, the mod SHALL show each failing selector with its error and no aggregate.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-016-AC-1 | Given a focus of initiatives A and B and projects C and D, and a combined call that fails, the mod makes four single-selector calls and shows the progress of each that succeeds. | Test |
| FR-016-AC-2 | Given the combined call fails with `issue QSL-3215 references unavailable milestone m1 in project p1` and only project D fails when asked alone, the pane shows A, B and C, and names D with its error text. | Test |
| FR-016-AC-3 | Given one of four selectors failed, the aggregate counts only the three succeeding selectors and reads that it is partial, 3 shown and 1 failed. | Test |
| FR-016-AC-4 | Given the combined call succeeds, the mod makes no single-selector call and shows no partial mark. | Test |
| FR-016-AC-5 | Given every selector fails, the pane shows each selector with its error, draws no aggregate, and still draws the lead's summary. | Test |
| FR-016-AC-6 | Given a single-selector call that does not answer within 5 seconds, that selector is shown as failed with a timeout error and the other selectors are still drawn. | Test |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-006](FR-006-honest-states.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
