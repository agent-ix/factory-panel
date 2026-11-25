---
id: FR-017
title: Last good progress
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-011"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-015"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
---
# FR-017: Last good progress

## Description

The mod SHALL keep the last successful progress of each selector and show it, marked old, when a refresh of that selector fails.

## Behavior

- The mod SHALL record the progress and the time of each successful selector call.
- The mod SHALL keep the records in one file, `~/.ix/factory-panel/progress.json`, in accordance with [FR-015](./FR-015-own-files.md).
- The file SHALL be a JSON object whose key is `kind:ref` for a ticket, `project:<project id>` for a project, as [FR-025](./FR-025-per-project-last-good.md) states, and `milestone:ref:project` for a milestone, with the reserved key `initiatives` holding initiative membership.
- The reserved key `initiatives` SHALL be exempt from the progress-field rule.
- The mod SHALL read `initiatives` as a map from initiative id or name to `at_ms`, `seen_ms` and `projects`, a list of `{id, name}`.
- The mod SHALL merge `initiatives` by key when it writes, keeping the newer `seen_ms`.
- The mod SHALL NOT treat `initiatives` as a malformed progress entry.
- Where one `initiatives` entry is malformed, the mod SHALL ignore that entry alone.
- Each progress entry SHALL hold `at_ms`, `seen_ms`, `done`, `total`, `inProgress` and `ready`.
- The mod SHALL set `seen_ms` to the current time on every refresh in which the selector is shown.
- The mod SHALL write the file by writing a temporary file and renaming it.
- When the mod is about to write, it SHALL re-read the file and merge by selector, keeping the newer `at_ms` and the newer `seen_ms` independently.
- The mod SHALL delete a record whose `seen_ms` is older than 24 hours.
- When a refresh of a selector fails and a record exists, the mod SHALL show the recorded progress marked old with its age, and the error in the footer warning of [FR-024](./FR-024-warning-icon-in-footer.md) and in `/factory show`.
- When a refresh of a selector fails and no record exists, the mod SHALL show the row as failed with a short mark, and the error in the footer warning and in `/factory show`.
- A later success of a selector SHALL replace its record and clear its old mark.
- The mod SHALL show a record older than 30 minutes with its age after the counts in the warning tone.
- The mod SHALL show a record of exactly 30 minutes with its age after the counts in the dim tone.
- Where a record's time is in the future, the mod SHALL treat its age as zero.
- Where the file is missing, not valid JSON or not a JSON object, the mod SHALL treat it as holding no records.
- Where the file was missing or invalid, the mod SHALL write a valid file on the next success.
- Where one entry is malformed, the mod SHALL ignore that entry alone.
- The mod SHALL keep the time of the last success of `agent-msg work` and of Prometheus in memory only.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-017-AC-1 | After a successful call for project C, `progress.json` holds the key `project:C` with `at_ms`, `seen_ms`, `done`, `total`, `inProgress` and `ready`, and a new session reads it. | Test |
| FR-017-AC-2 | Given a record for C from 5 minutes ago and a failing refresh of C, the pane shows C's progress marked old, age 5 minutes, and no error text in the card body, the error being in the footer warning expansion and in `/factory show`. | Test |
| FR-017-AC-3 | After that failure, a successful refresh of C makes the pane show the new progress with no old mark and the record holds the new time. | Test |
| FR-017-AC-4 | A record 30 minutes 0 seconds old is drawn with a dim age after its counts, and one 30 minutes 1 second old is drawn with that age in the warning tone. | Test |
| FR-017-AC-5 | Given a failing refresh of D with no record, the pane shows D as failed with a short mark and no progress, and D's error is in the footer warning expansion and in `/factory show`, not in the card body. | Test |
| FR-017-AC-6 | Given a malformed `progress.json`, the pane draws, no error is raised for the file, and the next success writes a valid file. | Test |
| FR-017-AC-7 | Given one malformed entry among valid ones, the valid entries are used and the malformed one is ignored. | Test |
| FR-017-AC-8 | Given a record whose `at_ms` is 10 minutes in the future, its age is shown as zero. | Test |
| FR-017-AC-9 | Given another process wrote record E between this mod's read and write, the file holds both E and this mod's record, and an interrupted write leaves the previous file intact. | Test |
| FR-017-AC-10 | Given a record whose `seen_ms` is 24 hours 1 minute old, the next write removes it, a record at 23 hours stays, and a record whose `at_ms` is old but whose `seen_ms` is current stays. | Test |
| FR-017-AC-11 | The age of last success in `/factory show` for ix-board comes from `progress.json`, and for `agent-msg work` and Prometheus from memory, so a new session shows no age for them until they answer. | Test |
| FR-017-AC-15 | Given a `progress.json` with a valid `initiatives` map, one malformed `initiatives` entry and valid progress entries, the `initiatives` key is not rejected as a progress entry, the malformed entry alone is ignored, and a write by another process that holds a newer `seen_ms` for an entry keeps the newer one. | Test |

## Superseded in 0.7.0

[FR-025](./FR-025-per-project-last-good.md) keys project records by project id and drops the focus-level record. The focus-level bullets and the criteria listed below were removed from this requirement. Every other rule of this requirement remains.

| Removed | Replaced by |
|---------|-------------|
| FR-017-AC-12 (focus-level record written) | dropped; an initiative is a roll-up and has no record of its own, see FR-025-AC-6 |
| FR-017-AC-13 (focus-level stand-in when all calls fail) | FR-025-AC-2 and FR-025-AC-8 |
| FR-017-AC-14 (focus-level key mismatch) | dropped with the focus-level record |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-015](FR-015-own-files.md), [FR-016](FR-016-isolated-selectors.md)
