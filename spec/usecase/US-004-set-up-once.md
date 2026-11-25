---
id: US-004
title: Set up once
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-005"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-007"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-002"
    type: traces_to
---
# US-004: Set up once

## Story

**As a** new user of the mod
**I want** to need no settings and no questions
**So that** the view fits my session from the relay without editing configuration.

## Context

The relay supplies the session identity; no question is asked. Metrics addresses were hard-coded to localhost, which was wrong on every factory host.

## Acceptance Examples (Illustrative)

### US-004-EX-1: First `/factory` in a session

- **Given** the user has selected nothing for this session
- **When** the user types `/factory`
- **Then** the detail view opens and no question is asked

### US-004-EX-2: A host with no settings

- **Given** a factory host with no plugin settings
- **When** a session starts
- **Then** the views read the factory's metrics without any address being configured
