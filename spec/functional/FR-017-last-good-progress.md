---
id: FR-017
title: Last good progress
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-011"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-015"
    type: traces_to
---
# FR-017: Last good progress

## Description

The mod SHALL keep the last successful progress of each selector and show it, marked old, when a refresh of that selector fails.

## Behavior

- The mod SHALL record the progress and the time of each successful selector call.
- The mod SHALL also record, after each successful combined call, one focus-level record: the aggregate, under the key `focus:<address or definition id>:<selector keys>` of the focus shown, where the selector keys are those of its selectors, sorted and joined by `+`.
- Where that key would be longer than 120 characters, the mod SHALL replace the selector keys by a short stable hash of them.
- The mod SHALL use a focus-level record as a stand-in only where its key matches the selectors now shown.
- The mod SHALL set `seen_ms` of a focus-level record to the current time only in a refresh that shows it with matching selectors.
- Where every selector of a refresh fails, no record of any selector exists, and a focus-level record exists, the mod SHALL show the focus-level record marked old with its age, together with the errors.
- The mod SHALL keep the records in one file, `~/.ix/factory-panel/progress.json`, in accordance with [FR-015](./FR-015-own-files.md).
- The file SHALL be a JSON object whose key is `kind:ref` for an initiative, project or ticket and `milestone:ref:project` for a milestone.
- Each entry SHALL hold `at_ms`, `seen_ms`, `done`, `total`, `inProgress` and `ready`.
- The mod SHALL set `seen_ms` to the current time on every refresh in which the selector is shown.
- The mod SHALL write the file by writing a temporary file and renaming it.
- When the mod is about to write, it SHALL re-read the file and merge by selector, keeping the newer `at_ms` and the newer `seen_ms` independently.
- The mod SHALL delete a record whose `seen_ms` is older than 24 hours.
- When a refresh of a selector fails and a record exists, the mod SHALL show the recorded progress marked old with its age, together with the error.
- When a refresh of a selector fails and no record exists, the mod SHALL show the error alone.
- A later success of a selector SHALL replace its record and clear its old mark.
- The mod SHALL label a record older than 30 minutes stale and show it.
- The mod SHALL show a record of exactly 30 minutes as old and not stale.
- Where a record's time is in the future, the mod SHALL treat its age as zero.
- Where the file is missing, not valid JSON or not a JSON object, the mod SHALL treat it as holding no records.
- Where the file was missing or invalid, the mod SHALL write a valid file on the next success.
- Where one entry is malformed, the mod SHALL ignore that entry alone.
- The mod SHALL keep the time of the last success of `agent-msg work` and of Prometheus in memory only.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-017-AC-1 | After a successful call for project C, `progress.json` holds the key `project:C` with `at_ms`, `seen_ms`, `done`, `total`, `inProgress` and `ready`, and a new session reads it. | Test |
| FR-017-AC-2 | Given a record for C from 5 minutes ago and a failing refresh of C, the pane shows C's progress marked old, age 5 minutes, and C's error. | Test |
| FR-017-AC-3 | After that failure, a successful refresh of C makes the pane show the new progress with no old mark and the record holds the new time. | Test |
| FR-017-AC-4 | A record 30 minutes 0 seconds old is shown old and not stale, and one 30 minutes 1 second old is labelled stale and still shown. | Test |
| FR-017-AC-5 | Given a failing refresh of D with no record, the pane shows D's error and no progress for D. | Test |
| FR-017-AC-6 | Given a malformed `progress.json`, the pane draws, no error is raised for the file, and the next success writes a valid file. | Test |
| FR-017-AC-7 | Given one malformed entry among valid ones, the valid entries are used and the malformed one is ignored. | Test |
| FR-017-AC-8 | Given a record whose `at_ms` is 10 minutes in the future, its age is shown as zero. | Test |
| FR-017-AC-9 | Given another process wrote record E between this mod's read and write, the file holds both E and this mod's record, and an interrupted write leaves the previous file intact. | Test |
| FR-017-AC-10 | Given a record whose `seen_ms` is 24 hours 1 minute old, the next write removes it, a record at 23 hours stays, and a record whose `at_ms` is old but whose `seen_ms` is current stays. | Test |
| FR-017-AC-11 | The age of last success in `/factory show` for ix-board comes from `progress.json`, and for `agent-msg work` and Prometheus from memory, so a new session shows no age for them until they answer. | Test |
| FR-017-AC-12 | After a successful combined call over several selectors, `progress.json` holds `focus:<address>:<selector keys>` with the aggregate `done`, `total`, `inProgress` and `ready`. | Test |
| FR-017-AC-13 | Given a focus-level record from 5 minutes ago and no per-selector record, and a combined call that fails with every single call failing, the pane shows the aggregate marked old with age 5 minutes and the errors, not an empty card. | Test |
| FR-017-AC-14 | Given a focus-level record for the selectors A and B and a focus whose scope is now A and C, with every call failing, the pane shows no stand-in, and the old record's `seen_ms` is not changed. | Test |


## Superseded in 0.7.0

[FR-025](./FR-025-per-project-last-good.md) keys records by project and drops the focus-level record: the `focus:` key, its stand-in rule and acceptance criteria FR-017-AC-12, AC-13 and AC-14 no longer apply, and an initiative is a roll-up of project records. Every other rule of this requirement remains.

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-015](FR-015-own-files.md), [FR-016](FR-016-isolated-selectors.md)
