---
id: FR-013
title: Scoping hosts, focus and teams
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-007"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-008"
    type: implements
---
# FR-013: Scoping hosts, focus and teams

## Description

The mod SHALL narrow the hosts, the focuses and the lanes it shows to the scope selected for each, defaulting to the narrowest scope the session's identity allows.

## Behavior

- With hosts `local` the mod SHALL show only this machine; with hosts `all` it shows every machine. The default is `local`.
- With focus `own` the mod shows only the focus of this session's own lead; with focus `team` it shows the own focus and the leads of this session's teams, grouped under each team; with a focus name it shows the focus whose summary matches the name. The default is `own`.
- A focus is named by its lead's focus summary; the mod SHALL NOT require a named-focus field from ix-board.
- A focus name that matches no focus SHALL show no focus and say that it matched nothing.
- A focus name that matches no focus SHALL NOT fall back to the first focus.
- When `agent-msg whoami` fails, the mod SHALL use the configured or declared teams, and when there are none the mod shows everything and say it could not tell who this session is.
- Lanes SHALL default to this session's own team.
- A `teams` selection SHALL replace the default team list.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-013-AC-1 | Given three leads on the relay and focus `own`, the band shows only this session's lead. | Test |
| FR-013-AC-2 | Given focus `team` and a session in teams QSL and ENG, the view groups the leads under QSL and ENG. | Test |
| FR-013-AC-3 | Given hosts `local`, the band shows only this machine; given `all`, it shows every machine. | Test |
| FR-013-AC-4 | Given a focus name that matches no summary, the band shows no focus and says nothing matched. | Test |
| FR-013-AC-5 | Given whoami fails and no teams configured, the band shows everything and says it could not tell who the session is. | Test |
| FR-013-AC-6 | Given whoami fails and teams configured, the band shows those teams. | Test |
| FR-013-AC-7 | With no selection, lanes shows only this session's team. | Test |

## Dependencies

- **Upstream**: [US-007](../usecase/US-007-own-focus.md), [US-008](../usecase/US-008-coordinator-teams.md)
