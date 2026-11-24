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
---
# NFR-003: Few steps

## Statement

The mod SHALL let a person complete each user story in at most two typed commands or key presses once the ambient view is on screen.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Typed commands or key presses to open detail, switch views and close | 2 or fewer each | 2 | Walk-through in a real session of each layout |

## Verification

The layout check performs open, switch and close in each layout and counts the inputs sent; the count must not exceed the threshold.

## Dependencies

- **Upstream**: [FR-003](../functional/FR-003-one-command.md), [FR-004](../functional/FR-004-detail-view.md)
