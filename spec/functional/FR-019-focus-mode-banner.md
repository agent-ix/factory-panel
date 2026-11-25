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

- The Focus pane SHALL draw the line as its first line.
- `/factory show` SHALL print the same line.
- The mod SHALL choose the reason by the first of these that holds: 1, a focus name was chosen by the user or by a declaration, matched or not, with the line `your choice: <name>`; 2, the session is not identified, with the line `could not tell who this session is, showing every focus`, which also covers the keywords `own` and `team`; 3, the focus scope is `own` and the session's focus entry exists, with the line `own focus`; 4, the focus scope is `team`, with the line `team focuses`; 5, otherwise, with the line `no focus reported, showing the whole team`.
- Where a chosen name matched nothing, the Focus pane SHALL add a separate warning line `no focus matches "<name>"`.
- The line SHALL name exactly one reason.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-019-AC-1 | Given `/factory focus Release Train` that matches a lead summary and an identified session, the first line of the Focus pane and of `/factory show` is `your choice: Release Train`. | Test |
| FR-019-AC-2 | Given the default scope and an identified session with a focus entry, the line is `own focus`. | Test |
| FR-019-AC-3 | Given focus `team` and an identified session, the line is `team focuses`. | Test |
| FR-019-AC-4 | Given an identified session whose team has no focus entry, the line is `no focus reported, showing the whole team`. | Test |
| FR-019-AC-5 | Given whoami fails and focus `own`, the line is `could not tell who this session is, showing every focus`. | Test |
| FR-019-AC-6 | Given a name that matches a named focus definition, the line is `your choice: <name>`. | Test |
| FR-019-AC-7 | Given a name that matches nothing, the line is `your choice: <name>` and a separate warning line reads `no focus matches "<name>"`. | Test |
| FR-019-AC-8 | Given whoami fails and the name `Beta`, the line is `your choice: Beta`. | Test |
| FR-019-AC-9 | Given whoami fails and focus `team`, the line is `could not tell who this session is, showing every focus`. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-020](FR-020-named-focus-resolution.md)
