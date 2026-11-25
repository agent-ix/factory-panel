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
- The mod SHALL keep these records in one file, `~/.ix/factory-panel/progress.json`, in accordance with [FR-015](./FR-015-own-files.md).
- When a refresh of a selector fails and a record exists, the mod SHALL show the recorded progress marked old with its age, together with the error.
- When a refresh of a selector fails and no record exists, the mod SHALL show the error alone.
- A later success of a selector SHALL replace its record and clear its old mark.
- Where a record is older than 30 minutes, the mod SHALL label it stale and still show it.
- Where the file is missing, not valid JSON or not a JSON object, the mod SHALL treat it as holding no records and not fail.
- The aggregate SHALL say how many of its selectors are shown from old records.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-017-AC-1 | After a successful call for project C, `~/.ix/factory-panel/progress.json` holds C's progress and time, and a new session reads it. | Test |
| FR-017-AC-2 | Given a record for C from 5 minutes ago and a failing refresh of C, the pane shows C's progress marked old, age 5 minutes, and C's error. | Test |
| FR-017-AC-3 | After that failure, a successful refresh of C makes the pane show the new progress with no old mark and the record holds the new time. | Test |
| FR-017-AC-4 | Given a record 31 minutes old and a failing refresh, the pane labels the progress stale and still shows it. | Test |
| FR-017-AC-5 | Given a failing refresh of D with no record, the pane shows D's error and no progress for D. | Test |
| FR-017-AC-6 | Given a malformed `progress.json`, the pane draws, the mod writes a valid file on the next success, and no error is raised for the file. | Test |
| FR-017-AC-7 | Given two of four selectors shown from old records, the aggregate says two of four are old. | Test |

## Dependencies

- **Upstream**: [US-011](../usecase/US-011-focus-survives-bad-data.md)
- **See also**: [FR-015](FR-015-own-files.md)
