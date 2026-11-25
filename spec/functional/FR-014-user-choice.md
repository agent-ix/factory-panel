---
id: FR-014
title: User choice of display
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-010"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-010"
    type: traces_to
---
# FR-014: User choice of display

## Description

The mod SHALL let the user choose the modules, focus, teams and hosts from `/factory`, and the choice outranks every other source.

## Behavior

- `/factory use <modules>` SHALL replace the module selection with the listed modules.
- `/factory focus <own|team|name>` SHALL set the focus scope, where the name is the rest of the line including spaces.
- `/factory focus` with no argument SHALL open the Focus view.
- `/factory teams <list>` SHALL replace the `teams` selection.
- A team that matches nothing SHALL be kept in the `teams` selection and reported as matching nothing.
- `/factory hosts <all|local>` SHALL set the hosts scope.
- The mod SHALL reject a value that is not valid for a choice, name the valid values, and leave the choice unchanged.
- The mod SHALL reject `/factory use` with no argument and name the valid modules.
- The mod SHALL store a choice in `~/.ix/factory-panel/choices/<key>.json`, using the sanitized key of [FR-011](./FR-011-feature-declaration.md).
- Where the key's choice file does not exist, or is ignored because it is not a JSON object or not valid JSON, the mod SHALL read `default.json` there.
- Where two sessions share one key, the last write to the choice file SHALL win.
- `/factory reset` SHALL write an empty JSON object to the key's own choice file.
- `/factory reset` SHALL NOT change `default.json` or any other key's file.
- `/factory show` SHALL print each feature with its value and the source that decided it, being `user`, `declaration` or `default`.
- `/factory show` SHALL print the session's key and the third segment of its address verbatim.
- The help SHALL list each choice command with one example.
- The mod SHALL NOT register a command for these choices other than `/factory` and the aliases of [FR-003](./FR-003-one-command.md).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-014-AC-1 | `/factory use queue,lanes` makes the band show queue and lanes, a later `/factory use focus` replaces them, and a later session with the same key shows focus. | Test |
| FR-014-AC-2 | `/factory focus team`, `/factory teams QSL` and `/factory hosts all` each change the named scope and no other. | Test |
| FR-014-AC-3 | `/factory focus Release Train` sets the focus name `Release Train`. | Test |
| FR-014-AC-4 | `/factory hosts bogus` names `all` and `local` and leaves the hosts scope unchanged. | Test |
| FR-014-AC-5 | `/factory use bogus` and `/factory use` with no argument each name the valid modules and change nothing. | Test |
| FR-014-AC-6 | `/factory teams NOPE` keeps `NOPE`, and the band says team NOPE matched nothing. | Test |
| FR-014-AC-7 | `/factory show` prints each feature with its value and a source that is `user`, `declaration` or `default`, matching where each came from. | Test |
| FR-014-AC-8 | `/factory show` for the session `host1:QSL:code` prints the key `host1_QSL_code` and the word `code`. | Test |
| FR-014-AC-9 | `/factory reset` returns each feature to its declaration or default and `/factory show` says so. | Test |
| FR-014-AC-10 | Choices made for the session `host1:QSL:code` do not change the band of the session `host2:ENG:plan`. | Test |
| FR-014-AC-11 | `/factory help` lists `use`, `focus`, `teams`, `hosts`, `show` and `reset`, each with an example. | Test |
| FR-014-AC-14 | Given a malformed key choice file and a `default.json` of choices, the choices of `default.json` apply, and after `/factory reset` the key has none and `default.json` is unchanged. | Test |
| FR-014-AC-13 | For two sessions with the same key, a choice made in the first and then one in the second leaves the second's choice in effect for both. | Test |
| FR-014-AC-12 | The plugin registers `/factory` and the aliases of FR-003 and no other command. | Test |

## Dependencies

- **Upstream**: [US-010](../usecase/US-010-choose-display.md)
- **See also**: [FR-010](FR-010-features.md)
