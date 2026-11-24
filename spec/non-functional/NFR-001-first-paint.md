---
id: NFR-001
title: First paint
type: NFR
quality_attribute: performance_efficiency
relationships:
  - target: "ix://agent-ix/factory-panel/FR-001"
    type: constrains
---
# NFR-001: First paint

## Statement

The mod SHALL have the ambient view on screen in the first screen capture taken five seconds after launch, in both layouts, with no key sent.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Ambient view present in a capture taken 5 seconds after launch with no key sent | Present | Present | Real-session capture in each layout |

## Verification

The layout check starts a real session in each layout, captures the screen five seconds after launch without sending any key, and asserts the band (classic) or the docked panel (fullscreen) is present.

## Dependencies

- **Upstream**: [FR-001](../functional/FR-001-ambient-view.md)
