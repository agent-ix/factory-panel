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

The mod SHALL read the features an agent selects for its session from a declaration file that the agent writes.

## Behavior

- The declaration file SHALL be `.factory-panel/features.json` under the session's working directory, a JSON object with the optional keys `modules` (list of module names), `hosts` (`all` or `local`), `focus` (`own`, `team` or a focus name) and `teams` (list of team names).
- A skill SHALL select features by instructing the agent to write that file with the file-writing tool.
- The mod SHALL document the file and a copy-ready skill snippet in its help.
- Writing the file SHALL replace every earlier selection, so that writing the same content again leaves the same display.
- The mod SHALL re-read the file on each refresh.
- The mod SHALL ignore a key or module name it does not know.
- When the file is malformed, the mod SHALL ignore it and show a note naming the file and the parse error.
- The mod SHALL NOT write, create or delete the declaration file.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-011-AC-1 | Given a file with `modules` of queue and lanes, the band shows queue and lanes only. | Test |
| FR-011-AC-2 | Given the same file written twice, the band is identical after each write. | Test |
| FR-011-AC-3 | Given the file is rewritten with different modules during a session, the band changes on the next refresh. | Test |
| FR-011-AC-4 | Given a file with an unknown key and an unknown module name, the known values apply and nothing fails. | Test |
| FR-011-AC-5 | Given a file that is not valid JSON, the display falls back as if no file existed and a note names the parse error. | Test |
| FR-011-AC-6 | After a session with no file, the mod has created none. | Test |

## Dependencies

- **Upstream**: [US-009](../usecase/US-009-select-features.md), [US-008](../usecase/US-008-coordinator-teams.md)
