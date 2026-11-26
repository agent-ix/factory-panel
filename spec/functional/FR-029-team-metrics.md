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

The Team view SHALL show, for each selected team ([Selected teams](#selected-teams)), what shipped, what is in progress, what is ready and how long review takes, from the `ix_team_*` series, and the health of the selected teams' departments from their stored retro snapshots.

## Behavior

### Figures

- Each team drawn SHALL show its figures on lines, each figure under its own name and no line or group under a label of its own.
- The first line SHALL hold tickets closed (`closed`, `ix_team_closures_day`) and PRs merged (`merged`, `ix_team_merged_prs_day`), each today's count and a sparkline of the last 7 UTC days.
- The second SHALL hold `in progress` (`ix_team_wip_active`), `blocked` (`ix_team_blocked_issues`) and `oldest`, the oldest age in a stage (`ix_team_stage_oldest_age_seconds`).
- The third SHALL hold `ready` (`ix_team_ready_issues`).
- The fourth SHALL hold `first review` (`ix_team_new_pr_first_review_median_seconds_24h`) and `PR cycle` (`ix_team_pr_cycle_median_seconds_24h`).
- A button `more` SHALL open and close the leaf work remaining, ready unmerged PRs, confirmed findings of high, medium and low severity, and the share of PRs with changes requested.
- Each figure below the first line SHALL have a sparkline of its samples of the last 6 hours.
- The view SHALL NOT show verified closures, effort per closure, merges per hour, the share of PRs with findings or executing agents, and SHALL NOT ask Prometheus for them.
- A figure SHALL show a value only where its series has a sample no older than one 5 minute step.
- Each value SHALL be the exporter's own series: the mod SHALL derive none from other series where it is absent.
- A share SHALL be drawn as a percentage, and a duration of 48 hours or more in days.
- The one-line widget SHALL read `N closed today` for the teams it reads ([Selected teams](#selected-teams)), `≥N` where one of them has no count or only a lower bound, and `— closed today` where none has one.

### Missing figures

- A figure with no value SHALL NOT be drawn: no `0`, no dash and no words in its place. A line, and `more`, with nothing to draw SHALL NOT be drawn.
- A team with anything missing, `more`'s figures included, SHALL have exactly one `○`, beside its name, and no other mark of what is missing.
- Pressing it SHALL list each missing figure by name with why: `no series published` where the team has no series of it, `no current sample` where its series has stopped, or `age not measured` where no stage age is known.
- A team with no data at all SHALL be its name and the `○`.
- A day with no current sample SHALL be drawn as `·` in a sparkline of days, never as a count of 0.
- Where Prometheus gives no team series and no team is selected, the view SHALL show `Teams` with one `○`, which says why when pressed.

### Teams

- A team SHALL be headed by the Linear team key its series carry in the `team_key` label (ix-board's exporter 0.12.0 and later). The mod SHALL keep no table of exporter ids and team keys.
- Series of an exporter `team_id` that carry no `team_key`, such as samples from before an upgrade, SHALL be joined to the team key that other series of that id carry, where those name exactly one key.
- A team no series gives a key SHALL be headed by its exporter id, marked `no team key`.
- Where several exporter ids carry one team key, their values at one time SHALL be combined as the metric is: the largest of durations, ages and shares, and counts as below.
- Where a series with the key and one without it have a sample at one time, the one with the key SHALL be drawn.

### Selected teams

- The selected teams SHALL be the same for the rows, the retro health, the widget and the band's team cell.
- Where the teams are chosen, by the user's teams choice or else a session declaration ([FR-012](./FR-012-selection-precedence.md)), the selected teams SHALL be those, whatever the focus is: `all` or a name. A `teams` choice of `all` selects no team in particular.
- Where no teams are chosen, the selected teams SHALL be the session's own team, for the focus `all` and a chosen focus alike; a focus SHALL NOT select any.
- Where no teams are chosen and `agent-msg whoami` fails, no team is selected.
- The leads the Work and Focus views read follow the focus, not this rule.
- A team with a key that is not among the selected teams SHALL NOT be drawn. The selected teams SHALL be drawn in the order of the selection.
- With no team selected, every team SHALL be drawn, those with a key first.
- An exporter id with no team key cannot be matched to a selected team. Where a team is selected, each SHALL be drawn after the selected teams as one closed line, its id, `no team key` and its `○` where something is missing, which opens and closes its figures.
- Where a selected team has no series, the view SHALL show its key and the `○`, and pressing it SHALL say that no team series carries the key and, where there are exporter ids with no key, that they cannot be told apart (ix-board publishes `team_key` from 0.12.0).
- The widget and the band's team cell SHALL read the selected teams that have series. The widget's number SHALL be a lower bound where a selected team has no series beside one that has.
- Where there are series and a team is selected but no series carries a selected key, the widget SHALL read `— closed today`.
- Where no selected team has series, the band's team cell SHALL read the exporter ids with no key, each named by its id.

### Teams with several scopes

- A scope of a team SHALL be a `team_id` and `scope_id` that a current series of the team names, `ix_team_source_available`, which the exporter publishes for every scope, among them.
- Scopes may select the same issues and repositories, and a count says nothing of which, so the counts of scopes SHALL NOT be added. These are tickets closed and PRs merged of each day, confirmed findings of each severity, leaf work remaining, in progress, blocked, ready unmerged PRs and ready issues.
- Where a team has several scopes, each of those SHALL be drawn as `≥N`, with N the largest of one scope, also where only one scope reports it. With one scope it SHALL be drawn exactly.
- The team cell of the band ([FR-009](./FR-009-band-cells.md)) SHALL draw a lower bound with its `≥`.
- Where one scope has samples with and without the team key at one time, the keyed one SHALL be drawn; a scope without a key SHALL NOT be dropped for another scope's keyed sample.

### Days

- The days of `closed` and `merged` SHALL be the 7 UTC calendar days that the `days_ago` label numbers `0` (today, so far) to `6`, drawn oldest first with today last.
- A closed ticket is a Linear transition into a completed state of the issues of the exporter's scope. A merged PR is one of the scope's repositories, by GitHub's merge time.
- Only current samples SHALL be drawn. Where today has no sample but other days do, the team's `○` SHALL say so.
- Where a team has several scopes today's count SHALL be drawn as `≥N`, as [above](#teams-with-several-scopes).

### Coverage

- Where the current `ix_team_metric_coverage` of a figure's series, whose `metric` label is the series name without `ix_team_`, is below 1, `more` SHALL say `<figure>: N% covered`, N rounded down.
- The coverage of the oldest age SHALL be the lowest over the stages (`stage_oldest_age_seconds_<stage>`), and a figure over several scopes SHALL take the lowest of them.
- Where that coverage is below 1, the oldest age SHALL be drawn as a lower bound (`≥`), since work of unknown age may be older.
- Where that coverage is 0 and no age above zero is published, no age SHALL be drawn, and never 0: the exporter publishes 0 for an empty stage and no age for a stage whose active work has no known start.
- A figure whose series has no current coverage sample SHALL say nothing of coverage.

### Retro health

- The mod SHALL read each selected team's department classes with `ix-board --json retro delta --config ~/.local/state/team-retro/<team>/config.json`, which reads the stored snapshots and makes no network call, for the selected teams, once every 5 minutes while the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)).
- The mod SHALL place each metric of the delta in the class the answer's `class` field names (ix-board 0.11.0 and later), and SHALL keep no table of its own of which metric belongs to which class.
- The read SHALL wait until the session knows its teams, and a changed focus or teams choice SHALL make the retro health due again.
- Each selected team SHALL have exactly one health line, with or without data: `◔ Health  retro <age> old ▸` where the delta has classes, and `○ Health  no retro ▸` otherwise. With several teams the line SHALL name its team.
- The `◔` SHALL be red where any metric regresses, otherwise amber where a class has a metric with no value, inactive where no class has any value, and green otherwise.
- Before the first read the view SHALL read `○ Health  reading`, and where a read found no team to ask for, `○ Health  no team`.
- Pressing the line SHALL say what the retro checks (the number of metrics and their classes), which metrics regress, by class, which classes have metrics with no value, when it last ran and the command that runs it, `ix-board retro snapshot --config ~/.local/state/team-retro/<team>/config.json`.
- The classes SHALL be those the answer's `class` field names (ix-board 0.11.0 and later), in the order first named, and a metric with no `class` in an answer where others have one SHALL be counted under `unclassified`, last. The mod SHALL keep no table of its own of which metric belongs to which class.
- With no data, the opened line SHALL say why: `needs ix-board ≥0.11.0` where no metric has a `class`, `no retro delta yet` with fewer than two stored snapshots, `no retro baseline` where ix-board cannot read the config (exit code 3), and the command. None of these SHALL warn.
- Any other failure (a missing binary, a timeout, another exit code, an answer that is not the delta) SHALL read `retro unavailable` when opened, mark the source failed and show one warning icon with the error.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-029-AC-1 | A team draws its figures by name on their lines, with no group label, the other figures behind `more`, and none of the removed figures is drawn or asked for. | Test |
| FR-029-AC-2 | A figure with no series is left out, with no 0 and no dash; a team missing anything has one `○` beside its name, one with everything has none, and one with no data is its name and the `○`. | Test |
| FR-029-AC-3 | A share is drawn as a percentage, a duration as one, and each figure has a sparkline. | Test |
| FR-029-AC-4 | The health of a team is one line with the age of the retro, its mark coloured by the worst class. | Test |
| FR-029-AC-5 | The opened health line says what it checks, what regresses, what has no value, when it last ran and the command. | Test |
| FR-029-AC-6 | A team whose retro config cannot be read (exit 3) reads `no retro` and says `no retro baseline` when opened, with no warning. | Test |
| FR-029-AC-9 | A retro delta that fails otherwise, or prints text that is not JSON, reads `retro unavailable` when opened and shows a warning icon. | Test |
| FR-029-AC-7 | The retro delta is read with the team's config path, for the selected teams only, and never more than once in 5 minutes. | Test |
| FR-029-AC-8 | In a real session the Team view shows the team’s figures and the health line. | Demonstration |
| FR-029-AC-10 | A metric is named in the class its `class` field names, whatever its id, in the order the answer names the classes. | Test |
| FR-029-AC-11 | A delta with no `class` on any metric reads `no retro`, says `needs ix-board ≥0.11.0` when opened, with no warning. | Test |
| FR-029-AC-12 | A metric with no `class` beside classed ones is counted under `unclassified`, last. | Test |
| FR-029-AC-13 | A delta with no metric reads `no retro`, says `no retro delta yet` when opened, with no warning. | Test |
| FR-029-AC-14 | With the identity answering after 3 seconds, the view reads `○ Health  reading`, then reads the delta of that team, and never says there is no retro meanwhile. | Test |
| FR-029-AC-15 | A changed teams choice reads the new team's delta without waiting out the 5 minutes. | Test |
| FR-029-AC-16 | A session with no team to ask for reads `○ Health  no team` and asks for no delta. | Test |
| FR-029-AC-17 | Series with `team_key` are headed by it; samples of the same id from before the label join that team, with the keyed sample drawn where both have one. | Test |
| FR-029-AC-18 | Series with no `team_key` are headed by the exporter id and marked `no team key`. | Test |
| FR-029-AC-19 | Two exporter ids with one team key make one team, its counts lower bounds of the largest and durations taken at their largest. | Test |
| FR-029-AC-20 | No query derives changes requested from other series: where its series is absent it has no value. | Test |
| FR-029-AC-21 | A series whose last sample is older than one step has no value, and the team’s `○` says `no current sample`. | Test |
| FR-029-AC-22 | Closed and merged draw the days `days_ago` 6 to 0 left to right, `·` for a day with no current sample, from the two daily series and no other. | Test |
| FR-029-AC-24 | The widget reads the tickets closed today of the teams it reads, `≥N` where one has none or only a lower bound, and `—` where none has. | Test |
| FR-029-AC-26 | `more` says `N% covered` for a current coverage below 1, taking the lowest over stages and scopes, and nothing for 1 or no sample. | Test |
| FR-029-AC-27 | A team with two scopes shows today as `≥` the larger count, and a team with one scope the exact count. | Test |
| FR-029-AC-28 | A team with two scopes shows confirmed findings and tickets closed as `≥` the larger, in the view, the widget and the band’s team cell; one scope shows them exactly. | Test |
| FR-029-AC-30 | A team with two scopes shows leaf work remaining, in progress, blocked, ready unmerged PRs and ready issues as `≥` the larger, never their sum, also where only one scope reports one; one scope shows them exactly. | Test |
| FR-029-AC-29 | A second scope that reports none of those counts, or reports them without the team key, still makes them lower bounds, and one scope's samples from before the key do not. | Test |
| FR-029-AC-31 | With one team selected, that team key is drawn and another is not; selected teams are drawn in the order of the selection, and with no team selected all are drawn, keyed first. | Test |
| FR-029-AC-32 | With a team selected, an exporter id with no key is one closed line, which opens to its figures and closes again. | Test |
| FR-029-AC-33 | A selected team with no series is its key and the `○`, which says why, and why an exporter id with no key cannot be told apart. | Test |
| FR-029-AC-34 | The widget and the band team cell read the selected teams’ tickets closed, the widget a lower bound where one of them has no series, and `—` where no selected team has any. | Test |
| FR-029-AC-35 | With a stage coverage of 0 and no age above zero no oldest age is drawn; below 1 with an age it reads `≥`; with every stage covered it reads exactly. | Test |
| FR-029-AC-36 | A teams choice or declaration selects the Team view's teams under the focus `all` and a name; with none chosen each of those selects the session's own team. | Test |
| FR-029-AC-37 | The team’s `○` lists each missing figure, `more`’s included, with why: no series published, no current sample, or an age not measured. | Test |
| FR-029-AC-25 | Against the factory’s Prometheus the Team view shows the values and days Prometheus answers. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-028](FR-028-work-tab.md)
