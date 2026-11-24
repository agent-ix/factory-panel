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
**I want** to answer one question about my role, once for each project, and to need no settings
**So that** the view fits my work from then on without editing configuration.

## Context

Roles differ per project, not per machine. The role can sometimes be read from the session's relay address, but not always. Metrics addresses were hard-coded to localhost, which was wrong on every factory host.

## Acceptance Examples (Illustrative)

### US-004-EX-1: First `/factory` in a project

- **Given** the role cannot be detected and the user has not been asked in this project
- **When** the user types `/factory`
- **Then** the user is asked what they do in this session, and the answer is remembered for that project

### US-004-EX-2: A host with no settings

- **Given** a factory host with no plugin settings
- **When** a session starts
- **Then** the views read the factory's metrics without any address being configured
