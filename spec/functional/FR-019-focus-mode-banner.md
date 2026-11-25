---
id: FR-019
title: Focus mode banner
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-012"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
---
# FR-019: Focus mode banner

## Description

The mod SHALL state in one line why the focuses it shows are shown.

## Behavior

- The Focus pane SHALL draw the line as its first line.
- `/factory show` SHALL print the same line.
- With a focus name chosen by the user the line SHALL read `your choice: <name>`.
- With focus `own` the line SHALL read `own focus`.
- With focus `team` the line SHALL read `team focuses`.
- Where the session is identified and no focus matches its team, the line SHALL read `no focus reported, showing the whole team`.
- Where `agent-msg whoami` fails, the line SHALL read `could not tell who this session is, showing every focus`.
- The line SHALL name exactly one reason.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-019-AC-1 | Given `/factory focus Release Train`, the first line of the Focus pane and of `/factory show` is `your choice: Release Train`. | Test |
| FR-019-AC-2 | Given focus `own` and an identified session with a focus entry, the line is `own focus`. | Test |
| FR-019-AC-3 | Given focus `team`, the line is `team focuses`. | Test |
| FR-019-AC-4 | Given an identified session whose team has no focus entry, the line is `no focus reported, showing the whole team`. | Test |
| FR-019-AC-5 | Given whoami fails, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-6 | Given a name that matches nothing, the line is `your choice: <name>` and the pane says it matched nothing. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md)
