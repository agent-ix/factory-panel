---
id: SR-005
title: "Dependency analysis - new relationships of SWM-303"
type: SpecReview
analysis: dependency
scope: "agent-ix/factory-panel; spec/functional/FR-009,028-032"
review_set: subset
---

## Summary

Ticket: SWM-303. The relationship edges of FR-030 to FR-032 resolve to existing artifacts and make no prerequisite cycle. Order: FR-025, FR-027 and FR-006, then FR-030, then FR-028 and FR-009; FR-029, then FR-031 and FR-032. One prerequisite edge is missing.

## Verdict

**CONDITIONAL** - one low finding.

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | low | FR-028 now relies on FR-030 for which leads are listed and how an unread one is drawn, and FR-009 does for the work cell counts, but neither declares a relationship to FR-030; only the reverse edge FR-030 to FR-028 exists, which orders them backwards. Fix: add the prerequisite edges from FR-028 and FR-009 to FR-030. | spec/functional/FR-028-work-tab.md:1-16 |

## Dispositions

| FND | outcome | reason |
| --- | --- | --- |
| FND-001 | fixed | both prerequisite edges added (head 9c36ef3) |
