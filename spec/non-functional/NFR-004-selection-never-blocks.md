---
id: NFR-004
title: Selection never blocks
type: NFR
quality_attribute: reliability
relationships:
  - target: "ix://agent-ix/factory-panel/FR-005"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: constrains
  - target: "ix://agent-ix/factory-panel/US-007"
    type: traces_to
---
# NFR-004: Selection never blocks

## Statement

The mod SHALL paint the band first from the fallback within the first-paint target of [NFR-001](./NFR-001-first-paint.md), update it when `agent-msg` answers, give up on an `agent-msg` call after 5 seconds, and draw it when a declaration or choice file is missing or malformed.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Wait for `agent-msg whoami` or `agent-msg work` before the band draws from the fallback | 5 s | 5 s | Test |
| Bands drawn with a missing or malformed declaration or choice file | all | all | Test |

## Verification

A test replaces `agent-msg` with a command that never returns and asserts the band paints from the fallback within the NFR-001 target and the lookup is abandoned after 5 seconds and says the identity is unknown; a second test draws the band with a missing and a malformed declaration file and a malformed choice file.

## Dependencies

- **Upstream**: [FR-005](../functional/FR-005-relay-identity.md), [FR-011](../functional/FR-011-feature-declaration.md), [FR-012](../functional/FR-012-selection-precedence.md), [FR-013](../functional/FR-013-scoping.md)
