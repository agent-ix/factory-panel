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
- The mod SHALL choose the reason by the first of these that holds: 1, a focus definition chosen by the user or by a declaration is shown, with the line `your choice: <name>`; 2, no team is selected and the session is not identified, with the line `could not tell who this session is, showing every focus`; 3, every team is selected, with the line `focuses of every team`; 4, a lead of the selected teams has a focus entry, with the line `focuses of <teams>`; 5, otherwise, with the line `no focus reported by <teams>`.
- Where the chosen focus is archived, unavailable, unread or not a definition of relay, the Focus view SHALL add a separate line saying so, in the footer warning expansion and in `/factory show`.
- The line `no selectors` of a focus with no selector SHALL be drawn in the footer warning expansion and in `/factory show`.
- The line SHALL name exactly one reason.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-019-AC-1 | Given a chosen definition named `Beta`, the pane and `/factory show` have the line `your choice: Beta`, by name and not by ID. | Test |
| FR-019-AC-2 | Given nothing selected and an identified session of team QSL with a focus entry, the line is `focuses of QSL`. | Test |
| FR-019-AC-3 | Given `teams` of QSL and ENG, the line is `focuses of QSL, ENG`. | Test |
| FR-019-AC-4 | Given an identified session whose team has no focus entry, the line is `no focus reported by <team>`. | Test |
| FR-019-AC-5 | Given whoami fails and nothing selected, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-6 | Given a stored focus ID of a definition, the line is `your choice: <the definition's name>`. | Test |
| FR-019-AC-7 | Given a stored ID relay has no definition of, the line says why the lead entries are shown and a separate line says the ID is not a definition. | Test |
| FR-019-AC-8 | Given whoami fails and a chosen definition named `Beta`, the line is `your choice: Beta`. | Test |
| FR-019-AC-9 | Given whoami fails and a stored focus of `team`, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-10 | Given `/factory teams all`, the line is `focuses of every team`. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-020](FR-020-named-focus-resolution.md)
