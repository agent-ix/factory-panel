---
id: FR-020
title: Named focus resolution
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
# FR-020: Named focus resolution

## Description

The focus choice SHALL be `all` or one named focus definition of ix-relay, stored by its focus ID and shown by its name, with relay resolving every name and ID and the mod only reading.

## Context

ix-relay owns named focus definitions (its FR-061, FR-063 and FR-064). A focus ID is `foc-` and 32 lowercase hexadecimal characters and is never reused. A name is a label, unique among the definitions of one Linear team that are not archived. `agent-msg focuses list --json` prints `{"definitions":[...]}`, without the archived ones. An available row holds `focus_id`, `team`, `name`, `state` and owner fields. An unavailable row holds only `focus_id`, `available` (false), `code` and `reason`. `agent-msg focuses show <focus> --json`, where `<focus>` is a focus ID or an exact current name, prints `focus_id`, `state`, `empty_selection` and `definition` (null when the selection cannot be decoded) with `name`, `include` and `exclude`, each list set holding `initiatives`, `projects`, `milestones` and `tickets` whose members hold `ref`, `label` and, for a milestone, `project`. A refusal prints `{"code","message"}` on standard error: `not_found` for an unknown ID or name, `invalid_argument` for a name that definitions of several teams have, `unavailable_definition` for a record that cannot be used.

## Behavior

### Choosing

- A focus value of `all`, `own` or `team` SHALL mean `all`.
- `/factory focus <name or ID>` SHALL ask `agent-msg focuses show` for the value as typed and store the `focus_id` of the answer.
- Where relay refuses the value, the definition is archived or relay cannot be asked, the mod SHALL say why and leave the choice unchanged.
- A refusal SHALL list the definitions that can be chosen, each with its name, team and ID, or say that relay has none and how one is created.
- The mod SHALL NOT match a focus value against a lead address, a lead focus summary, a part of a name or a name in another case.
- A stored or declared value that is neither `all` nor a focus ID SHALL mean `all`, and the mod SHALL say so.
- The Work view's focus choice SHALL offer `all` and every definition `list` returns, by name, with the team where two share a name, and SHALL name an unavailable one with its reason.
- Where relay has no definition, the Work view SHALL say `relay has no focus definitions` and `create one: agent-msg focuses create --file <file.json>`.

### Reading

- The mod SHALL run `agent-msg focuses list --json` on every read of the focus source, and `agent-msg focuses show <ID> --json` on each read while the choice is a definition.
- The mod SHALL run each with a timeout of 5 seconds.
- Where either fails, times out or prints text that is not JSON, the mod SHALL show a source error.
- Where `show` has not answered the chosen definition in any read, the mod SHALL show everything of the selected teams and say the focus could not be read.
- Where `show` fails after an earlier read of the chosen definition, the mod SHALL keep showing it and say it is shown as last read.
- Where relay has no definition of the stored ID, the mod SHALL say so and show everything of the selected teams.
- Where the chosen definition is unavailable or its `definition` is null, the mod SHALL say so with the reason and show everything of the selected teams.
- Where the chosen definition is archived, the mod SHALL keep it chosen, apply its members and say it is archived.
- The mod SHALL read the members of a definition from `definition.include` and compute progress over them as selectors under [FR-016](./FR-016-isolated-selectors.md).
- Where any list of `definition.exclude` is not empty, the mod SHALL say the exclusions are not applied to progress.
- Where `empty_selection` is true, the mod SHALL show the definition's name and say it selects nothing.
- The Focus pane SHALL show the chosen definition's card in place of the lead entries.
- The mod SHALL NOT create, change, archive or take ownership of a named focus.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-020-AC-1 | Given a definition named `Own` and a stored focus of `own`, the focus is `all` and the definition is not used. | Test |
| FR-020-AC-2 | `/factory focus <exact name>` and `/factory focus <ID>` each store the ID, and the commands and the Work header show the name. | Test |
| FR-020-AC-3 | Given definitions named `Beta` of two teams, `/factory focus Beta` is refused with both listed by team and ID, and the choice is unchanged. | Test |
| FR-020-AC-4 | A lead address, a lead summary, a part of a name and a name in another case are each refused with the definitions listed, and the choice is unchanged. | Test |
| FR-020-AC-5 | Given `list` exits non-zero or prints text that is not JSON, the failure is shown as a source error and the chosen definition is still read. | Test |
| FR-020-AC-6 | Given a definition whose `show` has `empty_selection` true, the pane shows its name and says it selects nothing, and ix-board is not called. | Test |
| FR-020-AC-7 | Given a chosen definition whose `definition` is null and `empty_selection` false, the pane says it is unavailable and shows the lead entries of the selected teams. | Test |
| FR-020-AC-8 | Given a definition with a non-empty `tickets` list in `exclude`, the pane says exclusions are not applied. | Test |
| FR-020-AC-9 | A chosen definition that is archived stays chosen and is said to be archived, and `/factory focus` does not newly choose it. | Test |
| FR-020-AC-10 | A stored value that is not a focus ID, and an ID relay has no definition of, are each `all` and said, and the lead entries and tickets of the selected teams stay shown. | Test |
| FR-020-AC-11 | The only `agent-msg focuses` subcommands the mod runs are `list` and `show`. | Inspection |
| FR-020-AC-12 | Given `show` refuses the chosen ID with `unavailable_definition`, the pane says it is unavailable with the reason and shows the lead entries. | Test |
| FR-020-AC-13 | Given a failing `show`, a source error is shown, with everything shown before any successful read and the definition kept as last read after one. | Test |
| FR-020-AC-14 | Given `list` or `show` never returns, it is given up on after 5 seconds and a source error is shown. | Test |
| FR-020-AC-15 | Given relay has no definition, the Work header says so and how one is created, the view shows everything of the selected teams, and `/factory focus <name>` is refused. | Test |
| FR-020-AC-16 | Given the members of the chosen definition change between two refreshes, the second computes progress over the new members. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-014](FR-014-user-choice.md), [FR-016](FR-016-isolated-selectors.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
