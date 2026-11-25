---
id: SR-003
title: "EARS conformance - changed requirements of SWM-303"
type: SpecReview
analysis: ears-conformance
scope: "agent-ix/factory-panel; spec/functional/FR-009,025,027-032, spec/non-functional/NFR-004"
review_set: subset
---

## Summary

Ticket: SWM-303. `quire validate --scope . "spec/**/*.md" --summary` reports 50 of 50 documents grammar-clean with no grammar finding. The semantic pass over the changed statements found one ambiguous term.

## Verdict

**CONDITIONAL** - one low finding.

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | low | `the teams of the session's focus` is not defined for a named focus: one reader takes the teams of the resolved definition, another (the code) no teams, falling back to the teams choice. Fix: state the rule for own, team and a named focus. | spec/functional/FR-029-team-metrics.md:45 |
