---
id: FR-013
title: Scoping hosts, focus and teams
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-007"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-008"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-020"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-019"
    type: traces_to
---
# FR-013: Scoping hosts, focus and teams

## Description

The mod SHALL narrow the hosts, focuses, tickets and lanes it shows to the scope selected for each.

## Behavior

- The default hosts scope SHALL be `local`.
- The hosts scope `all` SHALL show every machine.
- Teams and focus SHALL be two settings, each chosen and remembered on its own.
- The teams setting SHALL say which leads are listed and read: one or more teams, or `all`, which is every team.
- The default `teams` list SHALL be the session's own team.
- A `teams` selection SHALL replace the default `teams` list.
- A `teams` list that names `all` SHALL select every team.
- The focus setting SHALL be one Linear initiative or project, or `all` ([FR-020](./FR-020-named-focus-resolution.md)).
- The default focus SHALL be `all`.
- A focus value of `own` or `team`, typed, stored or declared, SHALL mean `all`.
- A focus SHALL narrow what is shown within the selected teams.
- A focus SHALL NOT change or widen the selected teams.
- With focus `all` the mod SHALL show the lead entries of the selected teams, together under each team in the order the teams are listed, under the team's name where more than one team is shown.
- With a chosen focus the Focus view and band SHALL show that focus in place of the lead entries.
- Where the chosen focus is not known, the mod SHALL show what focus `all` shows and say so.
- The Work view SHALL narrow its tickets by the focus as [FR-028](./FR-028-work-tab.md) says.
- Lanes SHALL show only the teams of the `teams` list.
- Where `agent-msg whoami` fails and no `teams` selection exists, the mod SHALL show every machine, every focus and every team's lanes.
- Where `agent-msg whoami` fails and a `teams` selection exists, the mod SHALL restrict focuses and lanes to those teams.
- Where `agent-msg whoami` fails, the mod SHALL say it could not tell who this session is.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-013-AC-1 | Given focus entries for `host1:QSL:code`, `host2:ENG:code` and `host3:SWM:code`, the session `host1:QSL:plan` and nothing selected, only the QSL entry is shown. | Test |
| FR-013-AC-2 | Given `teams` of QSL and ENG, the view groups the leads under QSL and ENG, and given every team it shows every entry. | Test |
| FR-013-AC-3 | Given hosts `local` the band shows only this machine, and given `all` it shows every machine. | Test |
| FR-013-AC-4 | Given a chosen focus, the Focus view and band show it in place of the lead entries, and with focus `all` the lead entries of the selected teams. | Test |
| FR-013-AC-5 | Given a chosen focus nothing is held for, the lead entries of the selected teams stay shown, and what is wrong with the focus is said. | Test |
| FR-013-AC-6 | Given a stored focus that is not a stored form, the focus is `all` and a note says so. | Test |
| FR-013-AC-7 | Given a stored or declared focus of `own` or `team`, in any case, the focus is `all`. | Test |
| FR-013-AC-8 | Given whoami fails and no `teams` selection, the band shows every machine, every focus and all lanes, and says it could not tell who the session is. | Test |
| FR-013-AC-9 | Given whoami fails and `teams` of ENG, focuses and lanes show only ENG. | Test |
| FR-013-AC-10 | Given the session `host1:QSL:code` and no `teams` selection, lanes shows only QSL, and given `teams` of ENG it shows only ENG. | Test |
| FR-013-AC-11 | Given `teams` naming `all`, every team is selected. | Test |

## Dependencies

- **Upstream**: [US-007](../usecase/US-007-own-focus.md), [US-008](../usecase/US-008-coordinator-teams.md)
- **See also**: [FR-019](FR-019-focus-mode-banner.md), [FR-020](FR-020-named-focus-resolution.md)
