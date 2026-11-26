---
id: FR-032
title: Fleet hosts
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
# FR-032: Fleet hosts

## Description

The Team view SHALL show a table of the fleet's hosts: `host`, `working`, `stuck`, `idle`, `CPU` and `done/h`.

## Behavior

### Reading

- The mod SHALL read it every 60 seconds while a Team pane is on screen, and on its `r` key. The one-line widget SHALL read none of it.
- The mod SHALL run only one read-only command for it: `ix-board --json fleet ledger query host_output_share_of_recorded_level`, given up after 10 seconds. It SHALL NOT run `ix-board fleet saturation`, `fleet saturation collect`, or a `fleet capacity` command.
- Lanes SHALL come from the ix-relay watcher's `ix_fleet_lane_state_ratio{host,lane,state}` (value 1; `state` one of `working`, `idle`, `blocked`, `stuck`, `ended`) and `ix_fleet_lane_blocked_ratio{lane,reason}`.
- CPU SHALL come from `ix_fleet_host_busy_ratio`, finished work from the ledger view, and the shortfall of ready work from `ix_fleet_ready_buffer_deficit` with `ix_fleet_ready_buffer_deficit_timestamp_seconds`.
- A source that fails SHALL leave the others drawn.

### Columns

- A host SHALL be a row where the lane states, the busy ratio, the deficit or the ledger names it, in name order, host names compared without case.
- A lane SHALL count in the state of the newest of its state series, where that sample is at most 120 seconds old: the watcher stops writing the series of a state a lane has left, and Prometheus still answers it for a while. An `ended` lane SHALL count in none.
- `stuck` SHALL count the lanes that are `blocked` or `stuck`, except a lane blocked for `wait_loop`. The watcher gives that reason to a pane that repeats a sleep or poll line three times, which an agent waiting on a build also does, so such lanes SHALL read as `◌ N` after the figures, and not as stuck.
- A host with stuck or waiting lanes SHALL open by a press to them, each with its lane and reason.
- `CPU` SHALL be a gauge glyph and a whole percentage rounded down, from the one busy sample of the host at most 60 seconds old.
- `done/h` SHALL be the `output_per_hour` of the host's ledger row, with `(best N)` where the row has a `recorded_output_per_hour`. It SHALL read `—` where there is no row (the view has one only for a host with a recorded best), where the output is null, where rows differ, or where the sample is more than 10 minutes old.
- `↓ N`, the ready work short, SHALL follow a host whose deficit is above 0 and sampled at most 10 minutes ago.
- `⏱ 2h`, the mark of churning, SHALL follow a host that has lanes working, whose `done/h` is 0, and whose `ix_fleet_host_output_share_of_recorded_level` was 0 at every sample of the last 2 hours and had a sample 2 hours ago. Without `done/h` data it SHALL NOT be said.
- What follows a host's figures SHALL be marks and numbers only, none of them `⚠`; pressing them SHALL show and hide what each means in words.

### Missing

- A figure that is not known SHALL read `—`, never 0.
- A column that no host has a figure of (`working`, `stuck`, `idle`, `CPU`, `done/h`) SHALL be left out.
- Why something is missing SHALL be said only when the one `○` beside the heading is pressed, why a done/h is lacking included. Where done/h is all that is missing there SHALL be no `○`.
- A failing command SHALL mark its source failed. A missing command or view SHALL NOT.
- Before the first read the section SHALL say it is reading.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-032-AC-1 | Each host is one row of working, stuck and idle lanes, CPU as a gauge and percentage, and done/h with its best. | Test |
| FR-032-AC-2 | A CPU sample older than 60 seconds, two fresh samples or a ratio outside 0 to 1 read `—`, and a fresh series is preferred to a stale one. | Test |
| FR-032-AC-3 | A lane counts in the state of its newest series at most 120 seconds old, an ended lane in none, and a host with no current lane state reads `—`. | Test |
| FR-032-AC-4 | Blocked and stuck lanes are stuck, listed with their reason by a press; a lane blocked for `wait_loop` counts in `◌ N`, whose words a press shows. | Test |
| FR-032-AC-5 | done/h is the row's output with its best, and `—` with no row, a null output, differing rows or an old sample, never 0. | Test |
| FR-032-AC-6 | A shortfall above 0 reads `↓ N`, with its words by a press, and one of 0 or from an old sample says nothing. | Test |
| FR-032-AC-7 | `⏱ 2h` is said only with lanes working, a done/h of 0 and samples of 0 across the last 2 hours. | Test |
| FR-032-AC-8 | What is missing is said only behind the one `○`, which is not drawn where only done/h is missing, columns of nothing, done/h among them, are left out, a failing command marks its source failed and a missing command or view does not, and before the first read the section says it is reading. | Test |
| FR-032-AC-9 | The pane runs only the ledger query, once a minute and on `r`, and the widget reads nothing of the hosts. | Test |
| FR-032-AC-10 | In a real session the Team view shows the live hosts. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md)
