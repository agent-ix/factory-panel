---
id: US-009
title: Let a skill select the features
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-010"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: traces_to
---
# US-009: Let a skill select the features

## Story

**As a** author of an agent skill for a team role
**I want** the skill's instructions to make the agent select the mod's features that the role cares about
**So that** the role's view is defined with the role, and the mod needs no change when a role is added or altered.

## Context

The mod has features and no notion of role. A skill tells the agent which features to select (for example hosts for all machines, a focus scope, the attention module). The agent sets them; the mod only reads them.

## Acceptance Examples (Illustrative)

### US-009-EX-1: A new role

- **Given** a skill for a new role that tells the agent to select the queue and lanes features
- **When** a session runs that skill
- **Then** the band shows the queue and lanes modules, with no mod release
