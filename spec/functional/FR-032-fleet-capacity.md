---
id: FR-032
title: Fleet capacity
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-027"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-029"
    type: traces_to
---
# FR-032: Fleet capacity

## Description

The Team view SHALL show, for each host of the fleet, its busy ratio, its ready-buffer deficit and its output against its recorded sustainable level, or why one of them is not known.

## Behavior

### Reading

- The mod SHALL read the capacity every 60 seconds while a Team pane is on screen, and on its `r` key. The one-line widget SHALL read none.
- The mod SHALL run only read-only commands for it: `ix-board --json fleet ledger query host_output_share_of_recorded_level`, given up after 10 seconds. It SHALL NOT run `ix-board fleet saturation`, `fleet saturation collect`, or a `fleet capacity` command.
- The busy ratio SHALL come from the Prometheus series `ix_fleet_host_busy_ratio` by its `host` label, its last value of the past hour with the age of that sample.
- The ready-buffer deficit SHALL come from `ix_fleet_ready_buffer_deficit`, the recorded level from `ix_fleet_capacity_recorded_level` and the discovery state from `ix_fleet_capacity_discovery_state`.
- The output SHALL come from the ledger view, which reads the fleet ledger of the machine the session runs on.
- A source that fails SHALL leave the others drawn.

### Hosts

- A host SHALL be listed where any of the sources names it, in name order, host names compared without case.
- No deficit SHALL be added across hosts.
- A busy ratio SHALL be a whole percentage rounded down.
- A busy sample older than 60 seconds, or of unknown age, SHALL be marked `stale` with what is known of its age. Of several series of one host, one fresh sample SHALL be preferred to stale ones, and more than one fresh sample SHALL read unavailable.
- The deficit SHALL be the host's count of ready issues short. The series says nothing of when it was sampled, so the section SHALL say, under any deficit it draws, that its sample age is not published.
- The output SHALL read the view's `share_percent` of the recorded level, rounded down, its `output_per_hour` of `recorded_output_per_hour`, the level where known, the output basis and the age of the sample.
- An output sample older than 10 minutes SHALL be marked `stale` with its age.

### Unavailable

- A value that is absent or null SHALL read `unavailable` with its reason and SHALL NOT read 0.
- An output with no share SHALL give the row's `unavailable_reason`, else the reason its `source_basis` gives, else say no reason was published; a row without the `share_percent` key SHALL say so.
- A host with no output row SHALL say whether a level is recorded for it, or what its discovery state is.
- Where the view answers differing rows for one host, the host SHALL read unavailable and say how many.
- Where a whole source gives nothing (Prometheus failing or having no such series, `ix-board` lacking the command or the view, or failing), the section SHALL say so once above the hosts, with the reason, in place of that line under every host.
- A failing command SHALL mark its source failed. A missing command or view SHALL NOT.
- Before the first read the section SHALL say it is reading.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-032-AC-1 | With every source answering, each host draws its busy ratio, deficit and output against its level with the sample's age, the note that the deficit's age is not published, and no summed deficit. | Test |
| FR-032-AC-2 | A busy sample older than 60 seconds is marked stale with its age, a fresh series is preferred to a stale one, and two fresh series or a ratio outside 0 to 1 read unavailable. | Test |
| FR-032-AC-3 | An output sample older than 10 minutes is marked stale with its age. | Test |
| FR-032-AC-4 | A null or absent share reads unavailable with the row's reason, the source basis's, or that none was published, or that the key is missing, and never 0. | Test |
| FR-032-AC-5 | A host with no deficit sample or no output row says why, with its level or discovery state, and differing rows read unavailable. | Test |
| FR-032-AC-6 | A source with nothing, failing or absent is named once with its reason while the others are drawn; a missing command or view marks no source failed and a failing command does. | Test |
| FR-032-AC-7 | The pane runs only the ledger query, once a minute and on `r`, and the widget reads nothing of the capacity. | Test |
| FR-032-AC-8 | In a real session the Team view shows the live busy ratios and says why the deficit and output are unavailable. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md)
