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
- The ready-buffer deficit SHALL come from `ix_fleet_ready_buffer_deficit`, its sample time from `ix_fleet_ready_buffer_deficit_timestamp_seconds`, and why a host has none from `ix_fleet_ready_buffer_deficit_unavailable`.
- The recorded level SHALL come from `ix_fleet_capacity_recorded_level` and the discovery state from `ix_fleet_capacity_discovery_state`.
- The output of a host SHALL come from the ledger view, which reads the fleet ledger of the machine the session runs on, and for a host the view has no row of, from `ix_fleet_host_output_share_of_recorded_level` (a fraction) with `ix_fleet_host_output_share_of_recorded_level_timestamp_seconds`.
- A source that fails SHALL leave the others drawn.

### Hosts

- A host SHALL be listed where any of the sources names it, in name order, host names compared without case.
- No deficit SHALL be added across hosts.
- A busy ratio SHALL be a whole percentage rounded down.
- A busy sample older than 60 seconds, or of unknown age, SHALL be marked `stale` with what is known of its age. Of several series of one host, one fresh sample SHALL be preferred to stale ones, and more than one fresh sample SHALL read unavailable.
- The deficit SHALL be the host's count of ready issues short, with the age of its sample.
- A deficit whose sample is more than 10 minutes old, or whose sample time is not published or cannot be read, SHALL be marked `stale` with its age or `age unknown`, and SHALL NOT be drawn as current.
- The output SHALL read the view's `share_percent` of the recorded level, rounded down, its `output_per_hour` of `recorded_output_per_hour`, the level where known, the output basis and the age of the sample.
- A share from Prometheus SHALL read as a whole percentage rounded down, the level where known, `from Prometheus` and the age of its sample. A ledger row SHALL win over it.
- An output sample older than 10 minutes, or of unknown age, SHALL be marked `stale`.

### Unavailable

- A value that is absent or null SHALL read `unavailable` with its reason and SHALL NOT read 0.
- A host with no deficit SHALL give the exporter's reason and the age of the sample it was judged from, or say that no sample is exported for it.
- An output with no share SHALL give the row's `unavailable_reason`, else the reason its `source_basis` gives, else say no reason was published; a row without the `share_percent` key SHALL say so.
- A host with neither an output row nor an exported share SHALL say whether a level is recorded for it, or what its discovery state is.
- Where the view answers differing rows for one host, the host SHALL read unavailable and say how many.
- Where a whole source gives nothing (Prometheus failing or having no such series, `ix-board` lacking the command or the view, or failing), the section SHALL say so once above the hosts, with the reason, in place of that line under every host. The output has nothing only where neither the ledger nor Prometheus gives a share, and the deficit only where no count and no reason is exported.
- A failing command SHALL mark its source failed. A missing command or view SHALL NOT.
- Before the first read the section SHALL say it is reading.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-032-AC-1 | With every source answering, each host draws its busy ratio, its deficit and its output against its level with their samples' ages, and no summed deficit. | Test |
| FR-032-AC-2 | A busy sample older than 60 seconds is marked stale with its age, a fresh series is preferred to a stale one, and two fresh series or a ratio outside 0 to 1 read unavailable. | Test |
| FR-032-AC-3 | An output sample older than 10 minutes is marked stale with its age. | Test |
| FR-032-AC-4 | A null or absent share reads unavailable with the row's reason, the source basis's, or that none was published, or that the key is missing, and never 0. | Test |
| FR-032-AC-5 | A host with no deficit sample or no output row says why, with its level or discovery state, and differing rows read unavailable. | Test |
| FR-032-AC-6 | A source with nothing, failing or absent is named once with its reason while the others are drawn; a missing command or view marks no source failed and a failing command does. | Test |
| FR-032-AC-7 | The pane runs only the ledger query, once a minute and on `r`, and the widget reads nothing of the capacity. | Test |
| FR-032-AC-8 | In a real session the Team view shows the live busy ratios, and the deficit and output or why they are unavailable. | Demonstration |
| FR-032-AC-9 | A deficit over 10 minutes old or of unknown age is marked stale, and a host with only a reason or a sample time is listed as unavailable with it. | Test |
| FR-032-AC-10 | A host with no ledger row draws the share of Prometheus with its age, a ledger row wins over it, and with no ledger the shares are drawn while the failed command stays a failed source. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md)
