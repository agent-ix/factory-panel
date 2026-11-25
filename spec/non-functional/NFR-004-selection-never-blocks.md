---
id: NFR-004
title: Selection never blocks
type: NFR
quality_attribute: reliability
relationships:
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: constrains
---
# NFR-004: Selection never blocks

## Statement

The mod SHALL draw the band within the first-paint target of NFR-001 even when the declaration file, the relay or `agent-msg` is missing, slow or failing.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Time to a drawn band with the relay lookup failing | Within NFR-001 | NFR-001 threshold | Test with a stub `agent-msg` that hangs |

## Verification

A test replaces `agent-msg` with a command that never returns and asserts the band is drawn from the fallback and says the identity is unknown.

## Dependencies

- **Upstream**: [FR-011](../functional/FR-011-feature-declaration.md), [FR-012](../functional/FR-012-selection-precedence.md)
