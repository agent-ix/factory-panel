---
id: SR-004
title: "Integrity analysis - changed requirements of SWM-303"
type: SpecReview
analysis: integrity
scope: "agent-ix/factory-panel; spec/spec.md, spec/functional/FR-009,025,027-032, spec/non-functional/NFR-004"
review_set: subset
---

## Summary

Ticket: SWM-303. Checked the changed requirements for contradictions, completeness and testability. New FR-030 to FR-032 each have user story links and Test or Demonstration criteria. Two contradictions found.

## Verdict

**CONDITIONAL** - medium findings only.

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | medium | FR-029-AC-24 (and the Tiles statement `over all teams`, line 33) says the widget reads the closures of all teams; the Selected teams statements and FR-029-AC-34 say it reads the selected teams. Both cannot hold with a team selected. Fix: reword the statement and AC-24 to the teams the widget reads. | spec/functional/FR-029-team-metrics.md:116 |
| FND-002 | low | A busy sample of unknown age shall be marked stale, but the deficit, whose age is never known, shall only carry a note and is drawn as current. The two rules disagree on what unknown age means. Fix: require the deficit to be marked as of unknown age until its time is published. | spec/functional/FR-032-fleet-capacity.md:40 |

## Dispositions

| FND | outcome | reason |
| --- | --- | --- |
| FND-001 | fixed | statement and criterion say the teams the widget reads (head 9c36ef3) |
| FND-002 | fixed | unknown age is stale for the deficit as for the busy ratio (head 9c36ef3) |
