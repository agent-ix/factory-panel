---
id: SR-008
title: "Integrity analysis - changed requirements of SWM-312 and SWM-313"
type: SpecReview
analysis: integrity
scope: "agent-ix/factory-panel; spec/, README.md"
review_set: subset
---

## Summary

Ticket: SWM-312. Manual integrity check at head a09a711b354da8a9f474c3445f1ed104d36ec317 of the changed requirements against the code and the design recorded on SWM-312 and SWM-313; the spec-review skill and its other sub-analyses were not run. `quire validate` passes on each changed spec file.

## Verdict

**CONDITIONAL** - two low findings.

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | low | README and NFR-004 still name agent-msg focuses as a source and a timed call, while FR-020 says the mod never runs it and the code no longer does. | README.md:88 |
| FND-002 | low | The last focus decision recorded on SWM-312 is a relay named definition by ID. The PR specifies and builds a Linear initiative or project the leads report, and no ticket comment records that change. The build was accepted on the ticket, so only the record needs adding. | spec/functional/FR-020-named-focus-resolution.md:20 |

## Dispositions

| FND | outcome | reason |
| --- | --- | --- |
| FND-001 | fixed | README and NFR-004 no longer name agent-msg focuses (head 945ad1d) |
| FND-002 | fixed | a decision record comment on SWM-312 states the final focus model and supersedes the earlier one |
