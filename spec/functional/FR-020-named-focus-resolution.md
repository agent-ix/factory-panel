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
---
# FR-020: Named focus resolution

## Description

The mod SHALL resolve the name of `/factory focus <name>` against the keywords, the named focus definitions, the lead addresses and the lead summaries, in that order, as a read-only lookup.

## Behavior

- The order SHALL be: the keywords `own` and `team`; a named focus definition; a lead address; a lead focus summary.
- The mod SHALL stop at the first step that matches.
- The mod SHALL read definitions with `agent-msg focuses list --json`, whose `definitions` array holds `focus_id`, `team`, `name`, `state` and further members.
- The mod SHALL match a definition by its `focus_id` (`foc-` followed by 32 lowercase hexadecimal characters) or by its `name`, equal ignoring case.
- The mod SHALL skip a definition whose `state` is not `active` and a definition that reports `available` as false.
- Where the session is identified, the mod SHALL consider only definitions whose `team` equals the session's team.
- Where the session is not identified, the mod SHALL consider every definition.
- The mod SHALL read the members of a matched definition with `agent-msg focuses show <focus_id> --json`, from `definition.include` and its lists `initiatives`, `projects`, `milestones` and `tickets`, each member holding `ref` and, for a milestone, `project`.
- The mod SHALL compute the progress of a named focus over those members as selectors under [FR-016](./FR-016-isolated-selectors.md) and [FR-017](./FR-017-last-good-progress.md).
- Where `definition.exclude` is not empty, the mod SHALL say the exclusions are not applied to progress.
- Where `empty_selection` is true or the `definition` is null, the mod SHALL show the definition's name and say it selects nothing.
- The mod SHALL accept a lead address as `host:team:segment` or as the suffix `team:segment`.
- Where `agent-msg focuses list --json` lists no definition or fails, the mod SHALL continue with the lead address and lead summary steps.
- Where a definition matches by a name that two active definitions share, the mod SHALL show both and say how many matched.
- The mod SHALL NOT create, change, archive or take ownership of a named focus.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-020-AC-1 | Given a definition named `Own` and `/factory focus own`, the own-focus scope applies and the definition is not used. | Test |
| FR-020-AC-2 | Given an active definition named `Beta` for the session's team, `/factory focus beta` and `/factory focus <its focus_id>` each show progress over that definition's members. | Test |
| FR-020-AC-3 | Given definitions named `Beta` for teams QSL and ENG and the session `host1:QSL:code`, `/factory focus Beta` uses only the QSL definition; given whoami fails, it shows both and says two matched. | Test |
| FR-020-AC-4 | Given `agent-msg focuses list --json` returns `{"definitions":[]}` and a lead summary equal to the name, the lead summary focus is shown. | Test |
| FR-020-AC-5 | Given the list command fails or its output is not JSON, `/factory focus host1:QSL:code` resolves by lead address, the failure is shown as a source error under [FR-018](./FR-018-errors-visible-not-fatal.md), and nothing else breaks. | Test |
| FR-020-AC-6 | Given a definition whose `show` has `empty_selection` true, the pane shows its name and says it selects nothing, and ix-board is not called. | Test |
| FR-020-AC-7 | Given a definition with a non-empty `exclude`, the pane says exclusions are not applied. | Test |
| FR-020-AC-8 | Given an archived definition named `Beta`, `/factory focus Beta` does not use it. | Test |
| FR-020-AC-9 | Given no definition, no lead address and no summary matches, the pane shows no focus and says nothing matched. | Test |
| FR-020-AC-10 | Across every test, the only `agent-msg focuses` subcommands the mod runs are `list` and `show`; this is checked by inspection of `hooks/`. | Inspection |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-014](FR-014-user-choice.md)
