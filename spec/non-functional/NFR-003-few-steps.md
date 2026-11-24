---
id: NFR-003
title: Few steps
type: NFR
quality_attribute: usability
relationships:
  - target: "ix://agent-ix/factory-panel/FR-003"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-004"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-009"
    type: constrains
---
# NFR-003: Few steps

## Statement

The mod SHALL let a person open a detail view, switch to another and close it in at most two typed commands or key presses each, once the ambient view is on screen. The one-time role question is a setup step and is not counted.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Typed commands or key presses to open a detail view | 1 | 2 | Walk-through in a real session of each layout |
| Typed commands or key presses to switch to another view | 1 | 2 | Walk-through in a real session of each layout |
| Typed commands or key presses to close | 1 | 2 | Walk-through in a real session of each layout |

## Verification

The layout check performs open, switch and close in each layout and counts the inputs sent; no count may exceed the threshold.

## Dependencies

- **Upstream**: [FR-003](../functional/FR-003-one-command.md), [FR-004](../functional/FR-004-detail-view.md), [FR-009](../functional/FR-009-band-cells.md)
