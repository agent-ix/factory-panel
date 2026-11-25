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

The mod SHALL learn the person's role from the `role` setting, then the session's relay address, then a stored answer for the working directory, then by asking once when the person first types `/factory`.

## Behavior

- Where the `role` setting names a role, the mod SHALL use it.
- Where an answer is stored for the working directory and the `role` setting does not name a role, the mod SHALL use the stored answer, even when the relay address names another role.
- Where neither the setting nor a stored answer gives a role and the relay address names a role (host:team:role), the mod SHALL use it.
- The resolution order SHALL be the `role` setting, the stored answer, the relay address, then the question.
- When the relay address cannot be read or names a role the mod does not know, the mod SHALL treat the role as not detected.
- When no role is known for the working directory and the person types `/factory`, the mod SHALL ask "What do you do in this session?" with the choices Program coordinator, Code lead, Planner and Other.
- The mod SHALL store the answer per working directory and reuse it in later sessions, without asking at a plain `/factory`.
- `/factory role` SHALL ask again whether or not a role is already known.
- The answer to `/factory role` SHALL replace the relay-detected role.
- If the person dismisses the question, the mod SHALL leave the role unanswered and ask again at the next `/factory`.
- The mod SHALL NOT ask for a role at session start.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-005-AC-1 | With the relay address `host:QSL:code` the role is code lead and no question is asked. | Test |
| FR-005-AC-2 | The relay addresses `host:ENG:plan` and `host:ENG:arch` give planner and coordinator. | Test |
| FR-005-AC-3 | A relay address that cannot be read, or names an unknown role, leaves the role not detected. | Test |
| FR-005-AC-4 | With no role known for the working directory, the first `/factory` asks the question with four choices and uses the answer. | Test |
| FR-005-AC-5 | An answer stored for a working directory is used in a later session there without asking, and a different working directory asks again. | Test |
| FR-005-AC-6 | A dismissed question leaves the role unanswered and the next `/factory` asks again. | Test |
| FR-005-AC-7 | At session start in any directory no question is asked. | Test |
| FR-005-AC-8 | The `role` setting wins over a relay address and over a stored answer, and no question is asked. | Test |
| FR-005-AC-9 | With the relay address `host:QSL:code` detected as code lead, answering `/factory role` with Planner makes the role planner and the reply says planner. With an answer stored, a plain `/factory` does not ask. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md)
