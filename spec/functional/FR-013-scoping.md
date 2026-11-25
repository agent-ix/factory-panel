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

The mod SHALL narrow the hosts, focuses and lanes it shows to the scope selected for each.

## Behavior

- The default hosts scope SHALL be `local`.
- The hosts scope `all` SHALL show every machine.
- The default focus scope SHALL be `own`.
- With focus `own` the mod SHALL show the one focus entry whose address team segment equals the session's team segment, which for a session addressed `plan`, `arch` or `code` is its team's lead entry.
- With focus `team` the mod SHALL show the own focus and the lead entries of the teams in the `teams` selection, grouped under each team.
- The mod SHALL take multiple teams from the `teams` selection only.
- The default `teams` list SHALL be the session's own team.
- A `teams` selection SHALL replace the default `teams` list.
- A focus value of `own` or `team` SHALL win over a focus name that is spelled the same.
- The mod SHALL resolve a focus name in the order of [FR-020](./FR-020-named-focus-resolution.md), whose last step is to show the focus whose summary equals the name ignoring case, and when none equals it, the focuses whose summary contains the name ignoring case.
- Where more than one focus matches a name, the mod SHALL show all matches.
- Where more than one focus matches a name, the mod SHALL say how many matched.
- Where no focus matches a name, the mod SHALL show no focus and say that it matched nothing.
- Lanes SHALL show only the teams of the `teams` list.
- Where `agent-msg whoami` fails and no `teams` selection exists, the mod SHALL show every machine, every focus and every team's lanes.
- Where `agent-msg whoami` fails and a `teams` selection exists, the mod SHALL restrict focuses and lanes to those teams.
- Where `agent-msg whoami` fails, the mod SHALL say it could not tell who this session is.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-013-AC-1 | Given focus entries for `host1:QSL:code`, `host2:ENG:code` and `host3:SWM:code` and the session `host1:QSL:plan`, focus `own` shows only the QSL entry. | Test |
| FR-013-AC-2 | Given focus `team`, `teams` of QSL and ENG, the view groups the leads under QSL and ENG. | Test |
| FR-013-AC-3 | Given hosts `local` the band shows only this machine, and given `all` it shows every machine. | Test |
| FR-013-AC-4 | Given a focus name equal to one summary ignoring case, the band shows exactly that focus. | Test |
| FR-013-AC-5 | Given a focus name contained in two summaries and equal to neither, the band shows both and says two matched. | Test |
| FR-013-AC-6 | Given a focus name that matches no summary, the band shows no focus and says nothing matched. | Test |
| FR-013-AC-7 | Given a focus name `team` and a summary containing `team`, the `team` scope applies. | Test |
| FR-013-AC-8 | Given whoami fails and no `teams` selection, the band shows every machine, every focus and all lanes, and says it could not tell who the session is. | Test |
| FR-013-AC-9 | Given whoami fails and `teams` of ENG, focuses and lanes show only ENG. | Test |
| FR-013-AC-10 | Given the session `host1:QSL:code` and no `teams` selection, lanes shows only QSL, and given `teams` of ENG it shows only ENG. | Test |

## Dependencies

- **Upstream**: [US-007](../usecase/US-007-own-focus.md), [US-008](../usecase/US-008-coordinator-teams.md)
- **See also**: [FR-019](FR-019-focus-mode-banner.md), [FR-020](FR-020-named-focus-resolution.md)
