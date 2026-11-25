---
id: FR-029
title: Team metrics and retro health
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
---
# FR-029: Team metrics and retro health

## Description

The Team view SHALL show velocity and effort, review quality and flow and capacity for each team from the `ix_team_*` series, and the health of the selected teams' departments from their stored retro snapshots.

## Behavior

### Tiles

- Each team the series name SHALL have one tile for every metric, in three rows: velocity and effort, review quality, flow and capacity.
- Velocity and effort SHALL hold verified closures in 24 hours, effort per verified closure (`ix_team_effort_per_verified_path_closure_seconds_24h`, else the execution time of the day over the verified closures), merges per hour and the median PR cycle.
- Review quality SHALL hold the median first-review latency, the share of PRs with findings, confirmed findings of high, medium and low severity, and the share of open PRs with changes requested.
- Flow and capacity SHALL hold the work remaining, in progress, blocked, ready unmerged PRs, the oldest age in a stage, ready issues and executing agents.
- A metric for which a team has no series SHALL read `—`, with no history, and SHALL NOT read 0.
- A share SHALL be drawn as a percentage.

### Retro health

- The mod SHALL read each selected team's department classes with `ix-board --json retro delta --config ~/.local/state/team-retro/<team>/config.json`, which reads the stored snapshots and makes no network call, for the teams of the session's focus, once every 5 minutes while the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)).
- The strip SHALL draw one mark and name per class of the retro catalog (progress, flow, rework, stability, scope, utilization, resource): red where any metric of the class regresses, amber where none regresses and some has no value, green where all are fine, and a hollow inactive mark where none has a value.
- A button SHALL expand the strip to the regressing metrics, named by class.
- A team whose config ix-board cannot read (exit code 3) SHALL read `no retro baseline`. Any other failure (a missing binary, a timeout, another exit code, an answer that is not the delta) SHALL read `retro unavailable`, mark the source failed and show one warning icon with the error. No mark SHALL be drawn for either.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-029-AC-1 | A team with series draws the velocity, review and flow tiles in three rows. | Test |
| FR-029-AC-2 | A metric the exporter has no series for reads `—` and never 0, while the others show their values. | Test |
| FR-029-AC-3 | A share is drawn as a percentage; effort per closure falls back to execution time over verified closures. | Test |
| FR-029-AC-4 | The retro strip draws one mark per class, red for a regressing class, amber for one with missing values and green for a sound one. | Test |
| FR-029-AC-5 | The strip expands to the regressing metrics. | Test |
| FR-029-AC-6 | A team whose retro config cannot be read (exit 3) reads `no retro baseline` with no warning. | Test |
| FR-029-AC-9 | A retro delta that fails otherwise, or prints text that is not JSON, reads `retro unavailable` and shows a warning icon with the error. | Test |
| FR-029-AC-7 | The retro delta is read with the team's config path, for the focus's teams only, and never more than once in 5 minutes. | Test |
| FR-029-AC-8 | In a real session the Team view shows the new tiles and the QSL health strip. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-028](FR-028-work-tab.md)
