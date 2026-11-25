---
id: NFR-004
title: Selection never blocks
type: NFR
quality_attribute: reliability
relationships:
  - target: "ix://agent-ix/factory-panel/FR-005"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-012"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-016"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-026"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-018"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-020"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-030"
    type: constrains
  - target: "ix://agent-ix/factory-panel/FR-031"
    type: constrains
  - target: "ix://agent-ix/factory-panel/US-007"
    type: traces_to
---
# NFR-004: Selection never blocks

## Statement

The mod SHALL paint the band first from the fallback within the first-paint target of [NFR-001](./NFR-001-first-paint.md), update it when `agent-msg` answers, give up on an `agent-msg` call after 5 seconds, except one lead's work report, given up on after 20 seconds ([FR-030](../functional/FR-030-lead-report-reads.md)), give up on each ix-board call (the roadmap call, an initiative call and a project call) after 20 seconds, and on an `agent-msg focuses` call and a Prometheus call after 5 seconds, and draw it when a declaration or choice file is missing or malformed. The mod SHALL end a progress refresh within 60 seconds, being the roadmap call of up to 20 seconds, then the initiative calls of rule 3 of FR-021, then the combined call and the calls for single milestones, tickets and known-bad selectors, then at most 12 calls of a search for a failing project, at most 4 at once and each of up to 20 seconds, counted from the first ix-board call of the refresh and not from the lookups of leads and definitions. The 4 processes at once are those of progress refreshes and of the read of single tickets ([FR-028](../functional/FR-028-work-tab.md)); `retro delta`, `retro eval` and the fleet ledger query run outside that limit, each one at a time for its own view. Where the chain is longer than 60 seconds the 60 second budget wins and each project still unanswered is marked timed out.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Wait for `agent-msg whoami` before the band draws from the fallback | 5 s | 5 s | Test |
| Wait for one lead's `agent-msg work show` | 20 s | 20 s | Test |
| Lead work reports being read at once per session | 8 | 8 | Test |
| Wait for one ix-board call (roadmap, initiative, combined or single) before the pane draws without it | 20 s | 20 s | Test |
| Wait for `agent-msg focuses list` or `show`, or Prometheus before the pane draws without it | 5 s | 5 s | Test |
| ix-board processes of progress refreshes and ticket reads running at once per session | 4 | 4 | Test |
| Wait for one `ix-board retro eval`, the rest of the Team view drawn meanwhile ([FR-031](../functional/FR-031-role-evaluations.md)) | 5 min | 5 min | Test |
| Total time of one progress refresh | 60 s | 60 s | Test |
| Bands drawn with a missing or malformed declaration or choice file | all | all | Test |
| Work reports of leads on other machines being read at once by all sessions of a machine ([FR-030](../functional/FR-030-lead-report-reads.md)) | 8 | 8 | Test |

## Verification

A test replaces `agent-msg` with a command that never returns and asserts the band paints from the fallback within the NFR-001 target and the lookup is abandoned after 5 seconds and says the identity is unknown; a third test replaces ix-board, `agent-msg focuses` and Prometheus with commands that never return and asserts each is abandoned at its timeout with an error shown; a second test draws the band with a missing and a malformed declaration file and a malformed choice file.

## Dependencies

- **Upstream**: [FR-005](../functional/FR-005-relay-identity.md), [FR-011](../functional/FR-011-feature-declaration.md), [FR-012](../functional/FR-012-selection-precedence.md), [FR-013](../functional/FR-013-scoping.md), [FR-016](../functional/FR-016-isolated-selectors.md), [FR-021](../functional/FR-021-initiative-expansion.md), [FR-026](../functional/FR-026-per-project-calls.md), [FR-025](../functional/FR-025-per-project-last-good.md), [FR-018](../functional/FR-018-errors-visible-not-fatal.md), [FR-020](../functional/FR-020-named-focus-resolution.md)
