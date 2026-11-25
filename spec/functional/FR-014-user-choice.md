---
id: FR-014
title: User choice of display
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-010"
    type: implements
---
# FR-014: User choice of display

## Description

The mod SHALL let the user choose the modules, focus, teams and hosts from `/factory`; the choice outranks every other source.

## Behavior

- The mod SHALL accept `/factory use <modules>`, `/factory focus <own|team|name>`, `/factory teams <list>` and `/factory hosts <all|local>` to select the modules, focus scope, teams and hosts scope respectively.
- `/factory focus` with no argument SHALL open the Focus view.
- The mod SHALL store a choice for the working directory and reuse it in later sessions there.
- `/factory reset` SHALL clear the user's choices.
- `/factory show` SHALL print each feature with its value and the source that decided it (user, declaration or default).
- The mod SHALL reject an unknown module name, naming the valid ones, with the choice unchanged.
- The help SHALL list each choice command with one example.
- The mod SHALL NOT register a second command for these choices.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-014-AC-1 | `/factory use queue,lanes` makes the band show queue and lanes, and a later session in the same directory shows them. | Test |
| FR-014-AC-2 | `/factory focus team`, `/factory teams QSL` and `/factory hosts all` each change the named scope and no other. | Test |
| FR-014-AC-3 | `/factory show` prints each feature, its value and its source. | Test |
| FR-014-AC-4 | `/factory reset` returns the display to the declaration or the defaults. | Test |
| FR-014-AC-5 | `/factory use bogus` names the valid modules and changes nothing. | Test |
| FR-014-AC-6 | `/factory help` lists `use`, `focus`, `teams`, `hosts`, `show` and `reset` with an example each, and `/factory focus` with no argument opens the Focus view. | Test |

## Dependencies

- **Upstream**: [US-010](../usecase/US-010-choose-display.md)
