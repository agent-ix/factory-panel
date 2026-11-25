---
id: FR-009
title: Band cells and digits
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-003"
    type: implements
---
# FR-009: Band cells and digits

## Description

The mod SHALL draw each band module as one cell that carries a digit and opens its view when that digit is pressed.

## Behavior

- The mod SHALL leave out a module that has nothing to report.
- Where the `bandModules` setting is set, the mod SHALL use that list in its order, ignoring unknown names and repeated names after the first.
- The mod SHALL assign the digits 1 to 9 to the cells in the order drawn, so the digits follow what is on screen.
- The mod SHALL draw a cell's digit before its text.
- The mod SHALL draw a cell beyond the ninth without a digit.
- When a digit is pressed at an empty prompt, the mod SHALL open the view of the cell that carries it, replacing any view already open.
- A pressed digit that no cell carries SHALL do nothing.
- The module-to-view map SHALL open Factory from health, local, lanes, agents and spend; Focus from focus, queue and lead; Escalations from attention; Relay from relay; and Team from team.
- The team module SHALL show the label and value of the first tile that has a reading, of the first team that has one.
- The mod SHALL leave out the team module when no team metrics exist.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-009-AC-1 | Each cell drawn within the first nine shows its digit before its text, so a person can read which key opens it. | Test |
| FR-009-AC-2 | The digits follow the cells drawn: when attention is omitted, the cells after it move up one digit. | Test |
| FR-009-AC-3 | With ten modules listed, the first nine cells carry digits 1 to 9 and the tenth is drawn without a digit. | Test |
| FR-009-AC-4 | With `bandModules` set to `focus,nope,focus,local`, the band shows focus then local, with digits 1 and 2. | Test |
| FR-009-AC-5 | Pressing a digit that no cell carries opens nothing and changes nothing. | Test |
| FR-009-AC-6 | Pressing the digit of a cell opens the view named in the module-to-view map, for every module in the map. | Test |
| FR-009-AC-7 | The team cell shows the first tile with a reading of the first team that has one, and is left out when no team metrics exist. | Test |
| FR-009-AC-8 | In a real classic session a digit typed while the prompt holds text is typed into the prompt and opens nothing. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md)
