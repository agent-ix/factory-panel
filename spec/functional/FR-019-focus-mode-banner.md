---
id: FR-019
title: Focus mode banner
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-012"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-020"
    type: traces_to
---
# FR-019: Focus mode banner

## Description

The mod SHALL state in one line why the focuses it shows are shown.

## Behavior

- The Focus pane SHALL state the line in the footer warning expansion.
- `/factory show` SHALL print the line as its banner line.
- The card body SHALL NOT carry the line.
- The mod SHALL choose the reason by the first of these that holds: 1, a focus name was chosen by the user or by a declaration, matched or not, with the line `your choice: <name>`; 2, no team is selected and the session is not identified, with the line `could not tell who this session is, showing every focus`; 3, every team is selected, with the line `focuses of every team`; 4, a lead of the selected teams has a focus entry, with the line `focuses of <teams>`; 5, otherwise, with the line `no focus reported by <teams>`.
- Where a chosen name matched nothing, the Focus view SHALL add a separate line `no focus matches "<name>"` in the footer warning expansion and in `/factory show`.
- The line `no selectors` of a focus with no selector SHALL be drawn in the footer warning expansion and in `/factory show`.
- The line SHALL name exactly one reason.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-019-AC-1 | Given `/factory focus Release Train` that matches a lead summary and an identified session, `/factory show` has the line `your choice: Release Train`. | Test |
| FR-019-AC-2 | Given nothing selected and an identified session of team QSL with a focus entry, the line is `focuses of QSL`. | Test |
| FR-019-AC-3 | Given `teams` of QSL and ENG, the line is `focuses of QSL, ENG`. | Test |
| FR-019-AC-4 | Given an identified session whose team has no focus entry, the line is `no focus reported by <team>`. | Test |
| FR-019-AC-5 | Given whoami fails and nothing selected, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-6 | Given a name that matches a named focus definition, the line is `your choice: <name>`. | Test |
| FR-019-AC-7 | Given a name that matches nothing, the line is `your choice: <name>` and a separate warning line reads `no focus matches "<name>"`. | Test |
| FR-019-AC-8 | Given whoami fails and the name `Beta`, the line is `your choice: Beta`. | Test |
| FR-019-AC-9 | Given whoami fails and a stored focus of `team`, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-10 | Given `/factory teams all`, the line is `focuses of every team`. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-020](FR-020-named-focus-resolution.md)
