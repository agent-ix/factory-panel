---
id: FR-011
title: Feature selection by an agent
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-009"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-008"
    type: implements
---
# FR-011: Feature selection by an agent

## Description

A skill SHALL select features by instructing its agent to write a declaration file that the mod reads for the session.

## Behavior

- The declaration file for a session SHALL be `~/.ix/factory-panel/features/<key>.json`, where `<key>` is the output of `agent-msg whoami` with every `:` replaced by `_`, or `default` when the session has no placement, after which every character outside `[A-Za-z0-9_.-]` is replaced by `_`.
- The mod SHALL read the file named by its own key.
- Where that file does not exist, the mod SHALL read `default.json`.
- The mod SHALL NOT use the working directory as part of the key.
- Where two sessions with no placement write `default.json`, the last write SHALL win.
- The file SHALL be a JSON object with the optional keys `modules` (list of module names), `hosts` (`all` or `local`), `focus` (`all`, `initiative:<Linear ID>` or `project:<Linear ID>`) and `teams` (list of team names, or `["all"]`).
- Writing the file SHALL replace every earlier selection from that file, so that writing the same content again leaves the same display.
- The mod SHALL re-read the file on each refresh.
- The mod SHALL ignore a key it does not know.
- The mod SHALL treat a `modules` list with no known module name, an empty list, or a value of the wrong type as not selected.
- The mod SHALL ignore a file that is not a JSON object, or is not valid JSON.
- The mod SHALL treat an ignored file as if it did not exist, so that it reads `default.json` where the ignored file was the key's own file.
- The mod SHALL show one note naming the file and the reason when it ignores a file or a value, in `/factory show` and once in the band line.
- The mod SHALL NOT repeat the band note on later refreshes of the same file content.
- The mod SHALL treat a missing `~/.ix/factory-panel` directory as no declaration.
- The mod SHALL NOT write, create or delete a declaration file.
- The help SHALL contain a copy-ready skill snippet that tells an agent to write the file for its own key.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-011-AC-1 | Given a file for the session's key with `modules` of queue and lanes, the band shows queue and lanes only. | Test |
| FR-011-AC-2 | Given a file with `modules` and `hosts` is replaced by a file with `modules` only, the band no longer applies the earlier `hosts` value. | Test |
| FR-011-AC-3 | Given the same file written twice, the band is identical after each write, and a rewrite with other modules changes the band on the next refresh. | Test |
| FR-011-AC-4 | Given a file with an unknown key, the known keys apply and nothing fails. | Test |
| FR-011-AC-5 | Given a `modules` list that is empty, holds only unknown names, or is not a list, the fallback modules show and `/factory show` names the reason. | Test |
| FR-011-AC-6 | Given a file whose content is not a JSON object or is not valid JSON, the display is as if no file existed and one note names the file and the reason. | Test |
| FR-011-AC-7 | Given the same malformed file over three refreshes, the band shows the note once and `/factory show` shows it each time. | Test |
| FR-011-AC-8 | Given no `~/.ix/factory-panel` directory, the band shows the fallback modules, no note, and the mod creates no directory. | Test |
| FR-011-AC-9 | Given sessions `host1:QSL:code` and `host2:ENG:plan` with different files, each band follows its own file. | Test |
| FR-011-AC-10 | Given a file for the session's key and a `default.json`, the band follows the key's file, and with the key's file removed it follows `default.json`. | Test |
| FR-011-AC-12 | Given the address `host1:QSL:../../x`, the key contains only characters of `[A-Za-z0-9_.-]` and the file read lies directly inside `~/.ix/factory-panel/features/`. | Test |
| FR-011-AC-11 | The snippet in `/factory help` parses as a file the mod accepts and names the path for this session's key. | Test |

## Dependencies

- **Upstream**: [US-009](../usecase/US-009-select-features.md), [US-008](../usecase/US-008-coordinator-teams.md)
