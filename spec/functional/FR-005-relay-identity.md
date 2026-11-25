---
id: FR-005
title: Relay identity as an input
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-004"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-007"
    type: implements
---
# FR-005: Relay identity as an input

## Description

The mod SHALL read the session's identity from the relay to scope what it shows, not to pick a role. This requirement supersedes the 0.4.0 role resolution, the stored role answer and the `/factory role` question.

## Behavior

- The mod SHALL read the host, team and focus of the session from `agent-msg whoami` and `agent-msg work`.
- Where the output of `agent-msg whoami` is unreadable or has no `host:team:segment` form, the mod SHALL treat the identity as not detected.
- The mod SHALL NOT interpret the third segment of the address.
- The mod SHALL NOT ask a question at session start.
- The mod SHALL ignore a role answer stored by 0.4.0.
- The mod SHALL ignore the `role` setting where it is still present.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-005-AC-1 | With the relay address `host1:QSL:code` the scope uses team QSL and no question is asked. | Test |
| FR-005-AC-2 | The addresses `host1:ENG:plan`, `host1:ENG:code` and `host1:ENG:zzz` give identical bands. | Test |
| FR-005-AC-3 | An unreadable `agent-msg whoami` output, and the text `no placement`, each leave the identity not detected. | Test |
| FR-005-AC-4 | A stored 0.4.0 role answer and a `role` setting change nothing. | Test |
| FR-005-AC-5 | At session start in any directory no question is asked. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md), [US-007](../usecase/US-007-own-focus.md)
- **Superseded by**: [FR-012](FR-012-selection-precedence.md)
