---
id: US-002
title: Open more with one command
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-003"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-004"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-003"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-008"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-009"
    type: traces_to
---
# US-002: Open more with one command

## Story

**As a** leader who saw something in the ambient view
**I want** one command that opens the detail view
**So that** I can look closer without knowing which of several commands or settings to use.

## Context

The mod used to offer `/band`, `/factory`, `/focuses`, `/escalations`, `/relay` and `/team`, plus settings. Users could not tell which to type, and the help listed commands without saying what a person was trying to do.

## Acceptance Examples (Illustrative)

### US-002-EX-1: Open the detail

- **Given** the band shows a project bar and a machine's load
- **When** the leader types `/factory`
- **Then** a view opens on the tab `/factory` opens by default, holds the keyboard, and says how to close it

### US-002-EX-2: Jump to a specific view

- **Given** the leader wants the escalations
- **When** they type `/factory escalations`
- **Then** that view opens directly
