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

The Team view SHALL show velocity and effort, review quality, flow and capacity and the completed issues and merged PRs of each of the last 7 days for each selected team from the `ix_team_*` series, and the health of the selected teams' departments from their stored retro snapshots.

## Behavior

### Tiles

- Each team drawn SHALL have one tile for every metric, in three rows: velocity and effort, review quality, flow and capacity.
- Velocity and effort SHALL hold verified closures in 24 hours, effort per verified closure (`ix_team_effort_per_verified_path_closure_seconds_24h`), merges per hour and the median PR cycle.
- Review quality SHALL hold the median first-review latency, the share of PRs with findings, confirmed findings of high, medium and low severity, and the share of PRs with changes requested (`ix_team_pr_changes_requested_share`).
- Flow and capacity SHALL hold the work remaining, in progress, blocked, ready unmerged PRs, the oldest age in a stage, ready issues and executing agents.
- A metric for which a team has no series SHALL read `—`, with no history, and SHALL NOT read 0.
- A tile SHALL show a value only where its series has a sample no older than one 5 minute step. A series that has stopped SHALL read `—` and keep its history.
- Each value SHALL be the exporter's own series: the mod SHALL derive none from other series where it is absent.
- A share SHALL be drawn as a percentage.
- The one-line widget SHALL say the verified closures of 24 hours over all teams, `≥N` where some team has no value or only a lower bound, and `—` where none has a value.

### Teams

- A team SHALL be headed by the Linear team key its series carry in the `team_key` label (ix-board's exporter 0.12.0 and later). The mod SHALL keep no table of exporter ids and team keys.
- Series of an exporter `team_id` that carry no `team_key`, such as samples from before an upgrade, SHALL be joined to the team key that other series of that id carry, where those name exactly one key.
- A team no series gives a key SHALL be headed by its exporter id, marked `exporter id, no team key`.
- Where several exporter ids carry one team key, their values at one time SHALL be combined as the metric is: the largest of durations, ages and shares, and counts as below.
- Where a series with the key and one without it have a sample at one time, the one with the key SHALL be drawn.

### Selected teams

- The selected teams SHALL be the teams of the session's focus, else those of the teams choice, for the tiles, the retro health and the role evaluations alike.
- A team with a key that is not among the selected teams SHALL NOT be drawn. The selected teams SHALL be drawn in the order of the selection.
- With no team selected, every team SHALL be drawn, those with a key first.
- An exporter id with no team key cannot be matched to a selected team. Where a team is selected, each SHALL be drawn after the selected teams as one closed row, its id, `exporter id, no team key` and `N of M metrics have a value`, which opens and closes its tiles.
- Where a selected team has no series, the view SHALL say `No team series carries the key <keys>.`, and where there are exporter ids with no key, that they have no `team_key` (ix-board publishes it from 0.12.0), so which team each is cannot be told.
- The widget and the band's team cell SHALL read the selected teams that have series, and where none has, the exporter ids with no key. The widget's number SHALL be a lower bound where a selected team has no series beside one that has.

### Teams with several scopes

- A scope of a team SHALL be a `team_id` and `scope_id` that a current series of the team names, `ix_team_source_available`, which the exporter publishes for every scope, among them.
- Scopes may select the same issues and repositories, and a count says nothing of which, so the counts of scopes SHALL NOT be added. These are verified closures, merged PRs per hour, confirmed findings of each severity, work remaining, in progress, blocked, ready unmerged PRs, ready issues, executing agents, and the days of both daily rows.
- Where a team has several scopes, each of those SHALL be drawn as `≥N`, with N the largest of one scope, also where only one scope reports it. With one scope it SHALL be drawn exactly.
- The team cell of the band ([FR-009](./FR-009-band-cells.md)) SHALL draw a lower bound with its `≥`.
- Where one scope has samples with and without the team key at one time, the keyed one SHALL be drawn; a scope without a key SHALL NOT be dropped for another scope's keyed sample.

### Closures and merges per day

- Each team SHALL have a row `Completed` (`ix_team_closures_day`) and a row `Merged PRs` (`ix_team_merged_prs_day`), each with the 7 UTC calendar days that the `days_ago` label numbers `0` (today, so far) to `6`, drawn oldest first with today last.
- A day of the `Completed` row counts Linear transitions into a completed state of the issues of the exporter's scope. It is not the `Verified closures · 24h` tile, which counts the verified closures on the configured gate path over the trailing 24 hours, and the two SHALL NOT be expected to agree.
- A day of the `Merged PRs` row counts PRs of the scope's repositories by GitHub's merge time.
- The mod SHALL draw only current samples, as for the tiles. A day with none SHALL read `—` and never 0.
- Where a team has several scopes each day SHALL be drawn as `≥N`, as [above](#teams-with-several-scopes).
- Each row SHALL say how yesterday, the newest whole day, compares with the average of the earlier whole days that have a value: `↑`, `↓` or `=` with that average. Today, a part day, SHALL take no part.
- Where yesterday has no value, or the counts are lower bounds, the row SHALL claim no trend, and where no earlier day has a value it SHALL say there is none to compare.

### Coverage

- Where the current `ix_team_metric_coverage` of a tile's series, whose `metric` label is the series name without `ix_team_`, is below 1, the tile SHALL say `N% covered` beside its value, N rounded down, whether or not it has a value.
- The coverage of `Oldest in a stage` SHALL be the lowest over the stages (`stage_oldest_age_seconds_<stage>`), and a tile over several scopes SHALL show the lowest of them.
- A tile whose series has no current coverage sample SHALL say nothing of coverage.

### Retro health

- The mod SHALL read each selected team's department classes with `ix-board --json retro delta --config ~/.local/state/team-retro/<team>/config.json`, which reads the stored snapshots and makes no network call, for the selected teams, once every 5 minutes while the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)).
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
| FR-029-AC-19 | Two exporter ids with one team key make one team, its counts lower bounds of the largest and durations taken at their largest. | Test |
| FR-029-AC-20 | No query derives effort or changes-requested from other series: where those two are absent they read `—`. | Test |
| FR-029-AC-21 | A series whose last sample is older than one step reads `—` while its history is drawn. | Test |
| FR-029-AC-22 | The `Completed` and `Merged PRs` rows show the days `days_ago` 6 to 0 left to right, `—` for a day with no current sample, from the two daily series and no other. | Test |
| FR-029-AC-23 | The rows say `↑`, `↓` or `=` for yesterday against the average of the earlier days with values, ignore today, claim no trend with no yesterday, and say there is nothing to compare with no earlier day. | Test |
| FR-029-AC-24 | The widget reads the closures of all teams, `≥N` where a team has none or only a lower bound, and `—` where none has. | Test |
| FR-029-AC-26 | A tile says `N% covered` for a current coverage below 1, with or without a value, taking the lowest over stages and scopes, and nothing for 1 or no sample. | Test |
| FR-029-AC-27 | A team with two scopes shows each day as `≥` the larger count with no trend, and a team with one scope shows exact counts. | Test |
| FR-029-AC-28 | A team with two scopes shows verified closures, merges per hour and confirmed findings as `≥` the larger, on the tiles, in the widget and in the band's team cell; one scope shows them exactly. | Test |
| FR-029-AC-30 | A team with two scopes shows work remaining, in progress, blocked, ready unmerged PRs, ready issues and executing agents as `≥` the larger, never their sum, also where only one scope reports one; one scope shows them exactly. | Test |
| FR-029-AC-29 | A second scope that reports none of those counts, or reports them without the team key, still makes them lower bounds, and one scope's samples from before the key do not. | Test |
| FR-029-AC-31 | With one team selected, the tiles of that team key are drawn and those of another key are not; selected teams are drawn in the order of the selection, and with no team selected all are drawn, keyed first. | Test |
| FR-029-AC-32 | With a team selected, an exporter id with no key is one closed row with the count of metrics that have a value, which opens to its tiles and closes again. | Test |
| FR-029-AC-33 | A selected team with no series is named, with why an exporter id with no key cannot be told apart. | Test |
| FR-029-AC-34 | The widget and the band team cell read the selected teams' series, a lower bound where one of them has none, and the keyless ids where no selected team has any. | Test |
| FR-029-AC-25 | Against the factory's Prometheus the Team view shows the values and days Prometheus answers. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-028](FR-028-work-tab.md)
