---
id: US-008
title: See the teams under me
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: traces_to
---
# US-008: See the teams under me

## Story

**As a** program coordinator
**I want** every host, and each team under me with its leads, shown together
**So that** I can tell which team and which machine needs me.

## Context

A coordinator cares about all hosts; a single code lead cares only about its own machine's resources. The mod does not know which of these a session is. The coordinator's skill selects the wider scope.

## Acceptance Examples (Illustrative)

### US-008-EX-1: Coordinator view

- **Given** a coordinator's skill selected all hosts and the leads grouped by team
- **When** the band draws
- **Then** it covers all hosts and groups the leads under their teams
