---
id: SR-002
title: "Gap analysis - factory-panel 0.9.0 (SWM-303)"
type: SpecReview
analysis: gap-analysis
scope: "agent-ix/factory-panel; spec/, tests/, hooks/"
review_set: subset
---

## Summary

Ticket: SWM-303. Planless audit at head 3f358bf893af5e644ed4dc44a4027a4f7842f9e5 with `quoin matrix --repo . --json`: 351 criteria tagged, 22 untagged, 8 method-without-symbol. Every Test criterion of FR-009, FR-025 and FR-027 to FR-032 is tagged; NFR-004-M-6 to M-9 are not.

## Verdict

**FAIL** - four Test criteria of NFR-004 are untagged (one was already untagged on main) and existing tags now bind other metrics.

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | medium | Three metric rows were inserted inside the table, and metric ids are positional. NFR-004-M-6 to M-9 are now untagged, and unchanged tags bind other rows: M-2 (focuses and Prometheus tests) now claims the 20 s lead report limit, M-3 (ix-board timeout) the 8 concurrent reads, M-4 (4 ix-board processes) the 20 s ix-board call, M-5 (malformed files) the focuses and Prometheus limit. M-2, M-3 and M-5 were already off on main; this PR makes M-4 wrong and adds untagged rows. Fix: retag all NFR-004 tests to the current ids, tagging the FR-030 limit tests and the eval limit test too. | spec/non-functional/NFR-004-selection-never-blocks.md:40-48 |
| FND-002 | low | NFR-004 limits ix-board processes to 4 at once per session. The limiter is in hooks/board.ts only; retro eval (up to 5 minutes) and the capacity ledger query (hooks/capacity.tsx:55) run outside it, beside up to 4 board calls. retro delta already did. Fix: route every ix-board run through one limiter, or scope the metric to progress calls. | hooks/roles.tsx:89 |

## Coverage

Plan completion: not assessed

Semantic review: skipped (opt-in, not requested). Demonstration criteria of the changed requirements (FR-028-AC-11, FR-029-AC-25, FR-030-AC-9, FR-031-AC-11, FR-032-AC-8) are untagged as expected; the PR records them as partly shown live or by fixtures. Run evidence: not bound.
