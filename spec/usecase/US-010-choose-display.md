---
id: US-010
title: Choose what to display
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-014"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: traces_to
---
# US-010: Choose what to display

## Story

**As a** user of the mod
**I want** to override the automatic view by choosing modules, focus, teams and hosts
**So that** I see what I care about even when a skill or the default chose otherwise.

## Context

Automatic is the default because the relay already supplies status and identity. A user's own choice is always the last word.

## Acceptance Examples (Illustrative)

### US-010-EX-1: Looking at a named focus

- **Given** the view shows this session's own focus
- **When** the user types `/factory focus <name>`
- **Then** the band follows the named focus until the user resets it
