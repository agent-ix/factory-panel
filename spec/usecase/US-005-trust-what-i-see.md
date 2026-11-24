---
id: US-005
title: Trust what I see
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-007"
    type: traces_to
---
# US-005: Trust what I see

## Story

**As a** leader deciding what to do next
**I want** a missing, stale or failed source to be shown as missing, with the reason
**So that** I never take a green mark to mean "healthy" when it means "no data".

## Context

The factory's metrics host has been slow and has restarted under load. A view that shows green when its source is down hides exactly the situation the leader needs to see.

## Acceptance Examples (Illustrative)

### US-005-EX-1: A host stops reporting

- **Given** a host's watcher has not pushed for several minutes
- **When** the band draws
- **Then** that host shows as not reporting, not as up, and says so

### US-005-EX-2: Metrics are unavailable

- **Given** the metrics service does not answer
- **When** a view draws
- **Then** it shows that the metrics are unavailable and why, and keeps showing the last known values only as old
