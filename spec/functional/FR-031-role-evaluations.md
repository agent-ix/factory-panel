---
id: FR-031
title: Role evaluations
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-027"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-029"
    type: traces_to
---
# FR-031: Role evaluations

## Description

The Team view SHALL show, for each selected team, what `ix-board retro eval` says of each role: its score, its trend, its failing rules and the rules it did not score, or why there is no evaluation to show.

## Behavior

### Reading

- The mod SHALL read each selected team's evaluation with `ix-board --json retro eval --config ~/.local/state/team-retro/<team>/config.json --since 24h`, for the teams whose retro health is shown ([FR-029](./FR-029-team-metrics.md)), one team at a time.
- An evaluation reads Linear and GitHub, so each team's SHALL run at most once in 30 minutes across all sessions on the machine, through the shared gate file of [FR-025](./FR-025-per-project-last-good.md). A drawing between those times SHALL start no `ix-board` process for it.
- The mod SHALL give up on an evaluation after 5 minutes.
- For 6 minutes after another session started an evaluation, the mod SHALL leave it to that session.
- A failure that took less than 10 seconds SHALL be held for 5 minutes. A failure that took longer SHALL be held for 30 minutes, since it has spent its reads.
- Only a Team pane SHALL start an evaluation; the one-line widget SHALL start none. The `r` key SHALL start none.
- The rest of the Team view SHALL be drawn while an evaluation runs.
- The mod SHALL keep of an answer only the window, and each role's name, score, trend and rules.

### Roles

- Each selected team SHALL have a section `Roles` saying the length of the evaluated window and how long ago it ended.
- Each role of the answer SHALL have one row with its pass rate, `P/E passed` of the rules the answer scored, its trend, and the number of its rules that failed, are unavailable, are not applicable, require judgement and have an unknown status, each omitted where 0.
- The pass rate SHALL be the answer's `score.pass_rate` as a whole percentage rounded down. Where it is null the row SHALL read `no score`, never 0%.
- The trend SHALL read `↑ +N pts` or `↓ −N pts` for the answer's change in pass rate, `= no change` where it is 0, and `trend —` where it is null. A change smaller than one point SHALL read `<1`.
- The row's mark SHALL be red where any rule fails; otherwise amber where some rule is unavailable or has a status the mod does not know; otherwise hollow where no rule was scored; otherwise green.
- A button SHALL expand a role to its failing rules, each with its id, its value, the comparator and target, and its query, and to its rules that are not scored.
- An unavailable and a not applicable rule SHALL read its status and the answer's reason, or `no reason given`. A rule that requires judgement SHALL read `judgement required` with its rubric id, and its reason where it has one. A rule with an unknown status SHALL read that status.
- A rule that is not scored SHALL NOT be drawn with the mark or the words of a pass or a failure, and SHALL show no value.
- Where a role has rules scored and none fails, the expanded role SHALL say `no failing rule`.

### No evaluation

- Before a team's first answer the section SHALL say the evaluation is being read, and where another session is running it, say so.
- Where `ix-board` has no `retro eval` command (exit code 2, `unrecognized subcommand`), the section SHALL say so, mark no source failed and draw no role.
- Any other failure (a missing binary, a timeout, a non-zero exit, output cut short, an answer that is not a `schema_version` 1 report) SHALL be said in the section with its message and mark the source failed. An earlier answer SHALL stay drawn, with its age, under the message.
- While Linear's rate limit holds, the section SHALL say reads are paused.
- A changed focus or teams choice SHALL make the evaluations due again.
- An answer that names no role SHALL read `the evaluation names no role`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-031-AC-1 | Each role of an answer draws its pass rate, passed and scored counts, trend and the counts of failing and unscored rules, and an expanded role draws its failing rules with value, comparator and target. | Test |
| FR-031-AC-2 | Unavailable, not applicable and judgement required rules draw their status with the reason or rubric id, with no value, no 0 and no pass mark. | Test |
| FR-031-AC-3 | A null pass rate reads `no score`, a null trend `trend —`, and the trend reads up, down, unchanged or less than a point by its sign and size. | Test |
| FR-031-AC-4 | The mark is red with a failing rule, amber with an unavailable one and none failing, hollow with nothing scored, and green otherwise. | Test |
| FR-031-AC-5 | The evaluation is run with the team's config path and `--since 24h`, one team at a time, once in 30 minutes however often the view is drawn, and not at all by the widget or the `r` key. | Test |
| FR-031-AC-6 | An answer another session left in the gate file is drawn with no run, and one another session is running is waited for. | Test |
| FR-031-AC-7 | An `ix-board` with no `retro eval` says so, with no role and no failed source, and is asked again after 5 minutes. | Test |
| FR-031-AC-8 | A failing run, a run that times out, cut output and an answer that is no report each say so in the section and mark the source failed; a quick failure is asked again after 5 minutes and a slow one after 30. | Test |
| FR-031-AC-9 | A failed refresh keeps the earlier answer drawn with its age under the error. | Test |
| FR-031-AC-10 | Before the first answer the section says it is reading while the rest of the Team view is drawn, and a changed teams choice reads the new team without waiting out the 30 minutes. | Test |
| FR-031-AC-11 | In a real session the Team view shows the state of `ix-board retro eval`. | Demonstration |
| FR-031-AC-12 | Under a Linear rate limit no evaluation runs and the section says reads are paused, and an answer with no role says it names none. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-025](FR-025-per-project-last-good.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md)
