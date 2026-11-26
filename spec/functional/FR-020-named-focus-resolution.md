---
id: FR-020
title: Focus choice
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-012"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-014"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-020: Focus choice

## Description

The focus choice SHALL be `all`, or one Linear initiative or project that leads report in their work scope, stored by its Linear ID and shown by its Linear name.

## Context

`agent-msg work --lead <address> show` prints `scope.initiatives` and `scope.projects`, which hold Linear UUIDs. `ix-board --json roadmap` names initiatives and the projects they hold, and `ix-board --json project-chunk <id>` names any project. The stored value is `initiative:<Linear ID>` or `project:<Linear ID>`, which says what the ID is of without a lookup.

## Behavior

### The choices

- The choices SHALL be `all` and each initiative and project that a lead of the selected teams reports by Linear ID, each once.
- A scope entry that is not a Linear ID SHALL NOT be offered.
- The mod SHALL name each choice with Linear's name, taken from the progress it holds, else `ix-board roadmap`, else, for a project, `ix-board project-chunk`.
- A choice nothing names SHALL be listed as its kind and the first 8 characters of its ID.
- The roadmap and the project names SHALL be read through the shared 30 minute gate of [FR-025](./FR-025-per-project-last-good.md).
- The Work view SHALL mark the chosen one, and SHALL add the kind where two choices share a name.

### Choosing

- A focus value of `all`, `own` or `team` SHALL mean `all`.
- `/factory focus <name or ID>` SHALL choose the one choice whose name, Linear ID or stored value is the value as typed, IDs in any case.
- Where it names none or several, the mod SHALL say so, list the choices with their stored values, and leave the choice unchanged.
- Where the choices are not read yet, the mod SHALL say so and leave the choice unchanged.
- The mod SHALL NOT match a focus value against a lead address, a lead focus summary, a part of a name or a name in another case.
- A stored or declared value that is neither `all` nor a stored form SHALL mean `all`, and the mod SHALL say so.
- A chosen focus that no lead of the selected teams reports and that nothing names SHALL show what `all` shows, and the mod SHALL say it is not known.
- A chosen focus that no lead of the selected teams reports but that Linear names SHALL stay applied and listed.

### What it shows

- With a chosen focus the Focus view SHALL show one card for it in place of the lead entries, with ix-board's progress over that initiative or project under [FR-016](./FR-016-isolated-selectors.md).
- A chosen initiative SHALL be expanded to its projects under [FR-021](./FR-021-initiative-expansion.md).
- The mod SHALL NOT run `agent-msg focuses`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-020-AC-1 | Given a stored focus of `own`, the focus is `all`. | Test |
| FR-020-AC-2 | `/factory focus` with the Linear name, ID or stored value of a reported focus stores `initiative:<ID>` or `project:<ID>`, and the command, the banner and the Work header show the name. | Test |
| FR-020-AC-3 | Given an initiative and a project of one name, `/factory focus <name>` is refused with both listed, the choice is unchanged, and the Work view tells them apart by kind. | Test |
| FR-020-AC-4 | A lead address, a lead summary, a part of a name and a name in another case are each refused with the choices listed, and the choice is unchanged. | Test |
| FR-020-AC-5 | The choices are exactly the initiatives and projects the leads of the selected teams report by Linear ID, by Linear name. | Test |
| FR-020-AC-6 | A project nothing names is listed as `project` and the first 8 characters of its ID. | Test |
| FR-020-AC-7 | A chosen project shows one card with progress over that project, in place of the lead entries. | Test |
| FR-020-AC-8 | A chosen initiative is expanded to its projects and shows their progress. | Test |
| FR-020-AC-9 | A chosen focus that no lead reports and that Linear names stays applied and listed. | Test |
| FR-020-AC-10 | A stored value that is not a stored form, and an ID nothing knows, are each `all` and said, and the lead entries and tickets of the selected teams stay shown. | Test |
| FR-020-AC-11 | The mod runs no `agent-msg focuses` command. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-014](FR-014-user-choice.md), [FR-016](FR-016-isolated-selectors.md), [FR-021](FR-021-initiative-expansion.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
