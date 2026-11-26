---
id: SR-006
title: "Code review - factory-panel 0.10.0 (SWM-312, SWM-313)"
type: SpecReview
analysis: code-review
scope: "agent-ix/factory-panel; hooks/, types/, tests/"
review_set: subset
---

## Summary

Ticket: SWM-312 (also SWM-313). Reviewed PR #18 at head a09a711b354da8a9f474c3445f1ed104d36ec317, diff against origin/main. At head `claude plugin test .` with a temporary HOME is 533 pass 0 fail, `node --test tests/e2e/static.check.ts` is 6 pass and `claude plugin validate .` passes with warnings. FND-001 to FND-005 were reproduced with temporary tests that were removed afterwards. FND-006 and FND-007 are from reading the code.

## Verdict

**CONDITIONAL** - no high finding; five medium findings show a wrong or unknown value as fact, or miss a read gate. The e2e scripts that drive real sessions and the type check were not run. The React lane was not dispatched (component type claude-code-mod).

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | medium | A lead is said to be churning from data that is no longer current. flagOf ignores the age and error of the tickets answer, a failed events read and an events read still catching up. With ix-board issues (or agent-msg work events) failing after one good read, a working lead is later drawn with the churn mark, although a ticket or role change in that time could not be seen. Reproduced for both sources. Fix: say no churn unless the tickets answer is recent with no error and the last events read succeeded and was not truncated. | hooks/work.ts:417-428 |
| FND-002 | medium | Unknown ticket counts are drawn as 0. A host or lead whose report was never read shows count 0 and an empty bar beside the not-read mark. Under a chosen focus with the tickets not read, every ticket is of unknown place and the closed lines show 0 with no lower-bound mark, unlike the widget and band. Both reproduced. Fix: draw a dash or no count where nothing is known, and mark the count as a lower bound where tickets are unplaced. | hooks/workview.tsx:496-508 |
| FND-003 | medium | The lane states are asked of Prometheus before the metrics address is known. dueNow excludes prometheus, team and capacity but not workLanes, so a Work view drawn at session start sends four queries to an empty base URL and counts a failed read, against FR-027. Reproduced. Fix: add workLanes to the exclusion and cover it in a test. | hooks/visible.ts:162-165 |
| FND-004 | medium | Above 20 tickets the bar can give a state with fewer tickets more cells than one with more: 1 in review, 18 being worked on and 2 not started draws review 2 cells and not started 1. A state raised to the one-cell minimum keeps its remainder and also takes a spare cell. Reproduced. Fix: give no spare cell to a state already above its share. | hooks/work.ts:388-399 |
| FND-005 | medium | projectName answers null for every ix-board failure instead of throwing on a Linear rate limit or auth error. No shared backoff is set, so other reads keep calling during the limit, and the null is held 30 minutes for all sessions with no error shown, against the FR-025 five minute hold. Reproduced: rate-limit stderr leaves backoffUntil null. Fix: throw on failure as roadmapNames does for auth and rate errors, and hold other failures 5 minutes. | hooks/board.ts:299-312 |
| FND-006 | low | The host stuck count is taken from each lead's first alert only, so a stuck lead whose latest report read failed shows only the not-read mark and is not counted as stuck. A stuck lead folded away under a focus is not counted either. FR-028 says the count is of stuck leads. | hooks/workview.tsx:566-569 |
| FND-007 | low | A sparkline pads only when a history has fewer than 12 points. A series with 12 to 71 samples, for example 3 hours of data, fills the whole column as if it were 6 hours, with no dot for cells with no sample as FR-029 requires. | hooks/team.tsx:334-336 |

## New findings (disposition pass 1)

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-008 | low | A project name warning stays on the Work footer after ix-board recovers if the lead was closed. workNameError is cleared only by a projects read, which runs only with a lead open, so the old failure is shown as current until a lead is opened again. Reproduced at head 945ad1d. Fix: clear it when no lead with projects is open, or drop it once the held failure has passed. | hooks/workview.tsx:248-264 |

## Dispositions

| FND | outcome | reason |
| --- | --- | --- |
| FND-001 | fixed | churn needs a current tickets answer, a current complete events read and a readable report (head 945ad1d) |
| FND-002 | fixed | unknown counts read a dash and short ones a lower-bound mark, in the pane and widget (head 945ad1d) |
| FND-003 | fixed | workLanes waits for the metrics address, on the refresh key too (head 945ad1d) |
| FND-004 | fixed | small states take one cell first and the rest is shared by largest remainder, ties to the larger count (head 945ad1d) |
| FND-005 | fixed | a failed project name call throws into the gate, which holds a rate limit or the failure and the Work footer says it (head 945ad1d) |
| FND-006 | fixed | the host stuck count takes every stuck lead of the host (head 945ad1d) |
| FND-007 | fixed | each sparkline cell is its own half hour and an empty one is a dot (head 945ad1d) |
| FND-008 | still-open | found in this pass |
| FND-008 | fixed | closing the lead or its host clears the warning; a lead that leaves the view without a press, as on a teams change, can still keep it until a lead is opened, accepted as an edge (head 0e1a314) |
