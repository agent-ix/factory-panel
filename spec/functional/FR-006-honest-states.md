---
id: FR-006
title: Honest states
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-018"
    type: traces_to
---
# FR-006: Honest states

## Description

The mod SHALL show a missing, failed or old source as missing, or as old with its age, with its reason, in the band and in the detail views.

## Behavior

- The mod SHALL draw a machine that has never reported with a grey no-data mark.
- The mod SHALL draw a machine whose watcher has not pushed for more than 120 seconds as not reporting.
- The mod SHALL say in the band which machines are not reporting.
- The mod SHALL leave out a source that has not been asked yet, rather than draw it as healthy.
- When a source reports an error, the mod SHALL show the error text for that source.
- Where a source fails for only part of its data, the mod SHALL show the parts that succeeded, as [FR-016](./FR-016-isolated-selectors.md) and [FR-018](./FR-018-errors-visible-not-fatal.md) say.
- When the metrics service does not answer, each detail view SHALL say the metrics are unavailable, give the reason, and mark any last-known value as old.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-006-AC-1 | A machine that has never reported is drawn with a grey no-data mark, never a green one. | Test |
| FR-006-AC-2 | A machine last seen 600 seconds ago is drawn as not reporting. | Test |
| FR-006-AC-3 | The band names the machine that is not reporting. | Test |
| FR-006-AC-4 | When this machine has not reported, the local cell reads "no data" and shows no percentages. | Test |
| FR-006-AC-5 | A relay check that has not yet been asked leaves the relay cell out. | Test |
| FR-006-AC-6 | A relay check that failed shows a warning with the error text. | Test |
| FR-006-AC-7 | An ix-board error is shown by the lanes cell. | Test |
| FR-006-AC-8 | With no machines and a metrics error, the band shows "hosts —" and the metrics error. | Test |
| FR-006-AC-9 | When the metrics service does not answer, the Factory view says the metrics are unavailable, gives the reason, and shows any earlier value marked as old. | Test |
| FR-006-AC-10 | A failed ix-board selector with an earlier record is shown old with its age, as FR-016-AC-2 and FR-017-AC-2 assert. | Test |

## Dependencies

- **Upstream**: [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-016](FR-016-isolated-selectors.md), [FR-018](FR-018-errors-visible-not-fatal.md)
