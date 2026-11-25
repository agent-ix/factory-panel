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

The mod SHALL resolve the name of `/factory focus <name>` against the keywords, the named focus definitions, the lead addresses and the lead summaries, in that order, as a read-only lookup.

## Context

`agent-msg focuses list --json` prints `{"definitions":[...]}`. An available row holds `focus_id`, `team`, `name`, `state` and owner fields. An unavailable row holds only `focus_id`, `available` (false), `code` and `reason`. `agent-msg focuses show <focus_id> --json` prints `empty_selection`, `definition` (null when the selection cannot be decoded) and `definition.include` and `definition.exclude`, each with the lists `initiatives`, `projects`, `milestones` and `tickets` whose members hold `ref`, `label` and, for a milestone, `project`. `agent-msg focuses list --team <TEAM>` can limit the rows by team. The relay owns these shapes (`crates/relay-core/src/named_focus/model.rs`).

## Behavior

- The order SHALL be: the keywords `own` and `team`; a named focus definition; a lead address; a lead focus summary.
- The mod SHALL stop at the first step that matches.
- The mod SHALL run the resolution on every progress refresh while the focus choice is a name, with `list` for the lookup and `show` only for the matched definition.
- The mod SHALL run `agent-msg focuses list` and `agent-msg focuses show` with a timeout of 5 seconds each.
- Where `list` or `show` fails, times out or prints text that is not JSON, the mod SHALL show a source error.
- Where `list` or `show` fails, times out or prints text that is not JSON, the mod SHALL continue with the lead address and lead summary steps.
- The mod SHALL match a definition by its `focus_id` or by its `name`, each equal ignoring case.
- A row lacking `name`, `team` or `state` SHALL match by `focus_id` only.
- Where a row matched by `focus_id` is unavailable, the mod SHALL show the id with the row's `reason` and no progress.
- The mod SHALL skip a definition whose `state` is not `active`, including one that `list` returns without `--archived`.
- Where the session is identified, the mod SHALL consider only definitions whose `team` equals the session's team.
- Where the session is not identified, the mod SHALL consider every definition.
- The mod SHALL read the members of a matched definition from `definition.include`.
- The mod SHALL compute the progress of a named focus over those members as selectors under [FR-016](./FR-016-isolated-selectors.md).
- Where any list of `definition.exclude` is not empty, the mod SHALL say the exclusions are not applied to progress.
- Where `empty_selection` is true, the mod SHALL show the definition's name and say it selects nothing.
- Where `definition` is null and `empty_selection` is false, the mod SHALL show the definition's name and say the selection is unavailable.
- The mod SHALL accept a lead address as `host:team:segment` or as the suffix `team:segment`, each equal ignoring case.
- Where a suffix matches leads on several hosts, the mod SHALL show every match.
- Where a suffix matches leads on several hosts, the mod SHALL say how many matched.
- Where two active definitions share the name, the mod SHALL show both.
- Where two active definitions share the name, the mod SHALL say how many matched.
- The Focus pane SHALL show the focus of the matched lead or the matched definition.
- The mod SHALL NOT create, change, archive or take ownership of a named focus.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-020-AC-1 | Given a definition named `Own` and `/factory focus own`, the own-focus scope applies and the definition is not used. | Test |
| FR-020-AC-2 | Given an active definition named `Beta` for the session's team, `/factory focus BETA` and `/factory focus <its focus_id in upper case>` each show progress over that definition's members. | Test |
| FR-020-AC-3 | Given definitions named `Beta` for teams QSL and ENG and the session `host1:QSL:code`, `/factory focus Beta` uses only the QSL definition, and given whoami fails it shows both and says two matched. | Test |
| FR-020-AC-4 | Given `list --json` returns `{"definitions":[]}` and a lead summary equal to the name, the lead summary focus is shown. | Test |
| FR-020-AC-5 | Given `list` exits non-zero or prints text that is not JSON, `/factory focus host1:QSL:code` resolves by lead address and the failure is shown as a source error. | Test |
| FR-020-AC-6 | Given a definition whose `show` has `empty_selection` true, the pane shows its name and says it selects nothing, and ix-board is not called. | Test |
| FR-020-AC-7 | Given a definition whose `show` has `definition` null and `empty_selection` false, the pane shows its name and says the selection is unavailable. | Test |
| FR-020-AC-8 | Given a definition with a non-empty `tickets` list in `exclude`, the pane says exclusions are not applied. | Test |
| FR-020-AC-9 | Given an archived definition named `Beta` that `list` returns, `/factory focus Beta` does not use it. | Test |
| FR-020-AC-10 | Given no definition, no lead address and no summary matches, the pane shows no focus and says nothing matched. | Test |
| FR-020-AC-11 | Across every test, the only `agent-msg focuses` subcommands the mod runs are `list` and `show`. | Inspection |
| FR-020-AC-12 | Given an unavailable row `{focus_id, available:false, code, reason}`, `/factory focus <that focus_id>` shows the id and the reason with no progress, and a name equal to no field of it never matches it. | Test |
| FR-020-AC-13 | Given a `show` that exits non-zero or prints text that is not JSON for a matched definition, the mod shows a source error and continues with the lead address and lead summary steps. | Test |
| FR-020-AC-14 | Given `list` or `show` that never returns, the mod falls to the lead address and lead summary steps within 5 seconds and shows a source error. | Test |
| FR-020-AC-15 | Given `/factory focus QSL:CODE` and leads `host1:QSL:code` and `host2:QSL:code`, both are shown and the pane says two matched. | Test |
| FR-020-AC-16 | Given the focus choice is a definition name and the definition's members change between two refreshes, the second refresh computes progress over the new members. | Test |

## Dependencies

- **Upstream**: [US-012](../usecase/US-012-know-why-and-name-a-focus.md)
- **See also**: [FR-013](FR-013-scoping.md), [FR-014](FR-014-user-choice.md), [FR-016](FR-016-isolated-selectors.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
