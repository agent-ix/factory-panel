---
id: US-007
title: See only my own focus
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
---
# US-007: See only my own focus

## Story

**As a** lead working in a session that shares a factory with other leads
**I want** the view to show my own focus and my own machine
**So that** I am not distracted by every other lead's work.

## Context

The automatic view listed every lead's focus, which made it unclear which one was mine. The relay knows which session this is and what it is working on, so the mod can narrow its scope without being told.

## Acceptance Examples (Illustrative)

### US-007-EX-1: A lead among other leads

- **Given** three leads are registered on the relay and this session is one of them
- **When** the session starts with nothing selected
- **Then** the band shows this lead's focus and this machine, and none of the other leads

### US-007-EX-2: The session cannot tell who it is

- **Given** the relay does not answer
- **When** the band draws
- **Then** it shows the configured teams, or everything when none are configured, and says it could not tell who this session is
