---
id: NFR-002
title: No stalls at session start
type: NFR
quality_attribute: reliability
relationships:
  - target: "ix://agent-ix/factory-panel/FR-001"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-005"
    type: constrains
---
# NFR-002: No stalls at session start

## Statement

The mod SHALL NOT show a dialog, ask a question or take the keyboard at session start, because automation also starts sessions.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Dialogs, questions or focus grabs raised by the mod during session start | 0 | 0 | Test and real-session capture |

## Verification

A test starts a session with no stored role and asserts that no question is asked and no pane is opened with the keyboard; the layout check confirms the prompt has the keyboard after start.

## Dependencies

- **Upstream**: [FR-001](../functional/FR-001-ambient-view.md), [FR-005](../functional/FR-005-role-resolution.md)
