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

The Team view SHALL show velocity and effort, review quality, flow and capacity and the closures and merges of each of the last 7 days for each team from the `ix_team_*` series, and the health of the selected teams' departments from their stored retro snapshots.

## Behavior

### Tiles

- Each team the series name SHALL have one tile for every metric, in three rows: velocity and effort, review quality, flow and capacity.
- Velocity and effort SHALL hold verified closures in 24 hours, effort per verified closure (`ix_team_effort_per_verified_path_closure_seconds_24h`), merges per hour and the median PR cycle.
- Review quality SHALL hold the median first-review latency, the share of PRs with findings, confirmed findings of high, medium and low severity, and the share of PRs with changes requested (`ix_team_pr_changes_requested_share`).
- Flow and capacity SHALL hold the work remaining, in progress, blocked, ready unmerged PRs, the oldest age in a stage, ready issues and executing agents.
- A metric for which a team has no series SHALL read `—`, with no history, and SHALL NOT read 0.
- A tile SHALL show a value only where its series has a sample no older than one 5 minute step. A series that has stopped SHALL read `—` and keep its history.
- Each value SHALL be the exporter's own series: the mod SHALL derive none from other series where it is absent.
- A share SHALL be drawn as a percentage.
- The one-line widget SHALL say the verified closures of 24 hours over all teams, `≥N` where some team has no value and `—` where none has.

### Teams

- A team SHALL be headed by the Linear team key its series carry in the `team_key` label (ix-board's exporter 0.12.0 and later). The mod SHALL keep no table of exporter ids and team keys.
- Series of an exporter `team_id` that carry no `team_key`, such as samples from before an upgrade, SHALL be joined to the team key that other series of that id carry, where those name exactly one key.
- A team no series gives a key SHALL be headed by its exporter id, marked `exporter id, no team key`.
- Where several exporter ids carry one team key, their values at one time SHALL be combined as the metric is: counts and rates added, the largest of durations, ages and shares.
- Where a series with the key and one without it have a sample at one time, the one with the key SHALL be drawn.

### Closures and merges per day

- Each team SHALL have a row of verified closures (`ix_team_verified_path_closed_24h`) and a row of merged PRs (24 times `ix_team_pr_merges_per_hour_24h`) for each of the last 7 days, oldest first.
- Each day SHALL be the 24 hours ending that many whole days before now, read from the last sample of the hour before that time. A day with no sample SHALL read `—` and never 0.
- Each row SHALL say how the newest day compares with the average of the earlier days that have a value: `↑`, `↓` or `=` with that average.
- Where the newest day has no value the row SHALL claim no trend, and where no earlier day has one it SHALL say there is none to compare.

### Retro health

- The mod SHALL read each selected team's department classes with `ix-board --json retro delta --config ~/.local/state/team-retro/<team>/config.json`, which reads the stored snapshots and makes no network call, for the teams of the session's focus, once every 5 minutes while the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)).
- The mod SHALL place each metric of the delta in the class the answer's `class` field names (ix-board 0.11.0 and later), and SHALL keep no table of its own of which metric belongs to which class.
- The read SHALL wait until the session knows its teams, and a changed focus or teams choice SHALL make the retro health due again.
- Before the first read the Team view SHALL say the retro snapshots are being read, and where a read found no team to ask for it SHALL say `no team selected`.
- The strip SHALL draw one mark and name per class the answer names, in the order the classes first appear in it: red where any metric of the class regresses, amber where none regresses and some has no value, green where all are fine, and a hollow inactive mark where none has a value.
- A metric with no `class`, in an answer where others have one, SHALL be drawn under `unclassified`, after the named classes.
- Where no metric of the answer has a `class` (an ix-board older than 0.11.0), the team SHALL read `needs ix-board ≥0.11.0`, with no mark, no regressing list and no warning.
- Where the answer holds no metric (fewer than two stored snapshots), the team SHALL read `no retro delta yet`, with no mark and no warning.
- A button SHALL expand the strip to the regressing metrics, named by class.
- A team whose config ix-board cannot read (exit code 3) SHALL read `no retro baseline`. Any other failure (a missing binary, a timeout, another exit code, an answer that is not the delta) SHALL read `retro unavailable`, mark the source failed and show one warning icon with the error. No mark SHALL be drawn for either.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-029-AC-1 | A team with series draws the velocity, review and flow tiles in three rows. | Test |
| FR-029-AC-2 | A metric the exporter has no series for reads `—` and never 0, while the others show their values. | Test |
| FR-029-AC-3 | A share is drawn as a percentage, and effort per closure as a duration. | Test |
| FR-029-AC-4 | The retro strip draws one mark per class, red for a regressing class, amber for one with missing values and green for a sound one. | Test |
| FR-029-AC-5 | The strip expands to the regressing metrics. | Test |
| FR-029-AC-6 | A team whose retro config cannot be read (exit 3) reads `no retro baseline` with no warning. | Test |
| FR-029-AC-9 | A retro delta that fails otherwise, or prints text that is not JSON, reads `retro unavailable` and shows a warning icon with the error. | Test |
| FR-029-AC-7 | The retro delta is read with the team's config path, for the focus's teams only, and never more than once in 5 minutes. | Test |
| FR-029-AC-8 | In a real session the Team view shows the new tiles and the QSL health strip. | Demonstration |
| FR-029-AC-10 | A metric is drawn in the class its `class` field names, whatever its id, and a class the mod has not heard of is drawn by its name, in the order the answer names the classes. | Test |
| FR-029-AC-11 | A delta with no `class` on any metric reads `needs ix-board ≥0.11.0`, with no mark, no regressing button and no warning. | Test |
| FR-029-AC-12 | A metric with no `class` beside classed ones is drawn under `unclassified`, last, and in no other class. | Test |
| FR-029-AC-13 | A delta with no metric reads `no retro delta yet`, with no mark and no warning. | Test |
| FR-029-AC-14 | With the identity answering after 3 seconds, the Team view says the snapshots are being read, then reads the delta of that team, and never says there is no baseline meanwhile. | Test |
| FR-029-AC-15 | A changed teams choice reads the new team's delta without waiting out the 5 minutes. | Test |
| FR-029-AC-16 | A session with no team to ask for reads `no team selected` and asks for no delta. | Test |
| FR-029-AC-17 | Series with `team_key` are headed by it; samples of the same id from before the label join that team, with the keyed sample drawn where both have one. | Test |
| FR-029-AC-18 | Series with no `team_key` are headed by the exporter id and marked as having no team key. | Test |
| FR-029-AC-19 | Two exporter ids with one team key make one team, counts added and durations taken at their largest. | Test |
| FR-029-AC-20 | No query derives effort or changes-requested from other series: where those two are absent they read `—`. | Test |
| FR-029-AC-21 | A series whose last sample is older than one step reads `—` while its history is drawn. | Test |
| FR-029-AC-22 | The closure and merge rows show 7 days oldest first, `—` for a day with no sample, merges as 24 times the hourly rate. | Test |
| FR-029-AC-23 | The rows say `↑`, `↓` or `=` against the average of the earlier days with values, claim no trend with no newest value, and say there is nothing to compare with no earlier one. | Test |
| FR-029-AC-24 | The widget reads the closures of all teams, `≥N` where a team has none, and `—` where none has. | Test |
| FR-029-AC-25 | Against the factory's Prometheus the Team view shows the values and days Prometheus answers. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-028](FR-028-work-tab.md)
