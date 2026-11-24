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

The mod SHALL have the ambient view on screen at the first redraw after session start, in both layouts, with no key pressed.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Time from session start to the ambient view on screen | First redraw | Within 5 seconds | Real-session capture in each layout |
| Key presses or commands needed before the view appears | 0 | 0 | Real-session capture |

## Verification

The layout check starts a real session in each layout, captures the screen five seconds after launch without sending any key, and asserts the band (classic) or the docked panel (fullscreen) is present.

## Dependencies

- **Upstream**: [FR-001](../functional/FR-001-ambient-view.md)
