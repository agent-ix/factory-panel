---
id: FR-005
title: Role resolution
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-004"
    type: implements
---
# FR-005: Role resolution

## Description

The mod SHALL learn the person's role from the session's relay address when it names one, otherwise from a stored answer for the working directory, otherwise by asking once when the person first types `/factory`.

## Behavior

- Where the `role` setting names a role, the mod SHALL use it.
- When the relay address names a role (host:team:role), the mod SHALL use it.
- The mod SHALL NOT ask for a role at session start.
- When no role is known for the working directory and the person types `/factory`, the mod SHALL ask "What do you do in this session?" with the choices Program coordinator, Code lead, Planner and Other.
- The mod SHALL store the answer per working directory and reuse it in later sessions.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-005-AC-1 | Given the relay address `host:QSL:code`, the role is code lead and no question is asked. | Test |
| FR-005-AC-2 | Given no role is known for the working directory, the first `/factory` asks the question with four choices and uses the answer. | Test |
| FR-005-AC-3 | Given an answer was stored for a working directory, a later session there does not ask and uses the stored role; a different working directory asks again. | Test |
| FR-005-AC-4 | Given a session start in any directory, no question is asked. | Test |
| FR-005-AC-5 | Given the `role` setting is set, the setting wins over a stored answer and no question is asked. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md)
