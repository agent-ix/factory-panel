---
id: FR-030
title: Lead report reads
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-027"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-028"
    type: traces_to
---
# FR-030: Lead report reads

## Description

The mod SHALL read the work reports of the leads once for the views that draw them, keeping every lead it cannot read in view as not read or as old.

## Behavior

### Reading

- The Focus view, the Work view and the band cells that draw them SHALL share one reader of `agent-msg who` and `agent-msg work --lead <address> show`.
- The reader SHALL give up on one lead's report after 20 seconds. A lead on another machine is reached through ssh and has answered after 10 seconds.
- The reader SHALL give up on `agent-msg who` and `agent-msg work events` after 5 seconds.
- At most 8 lead reports SHALL be read at once in a session, whichever views ask.
- A lead asked while a read of it is under way SHALL get that read's answer.
- A lead asked less than 30 seconds ago SHALL be answered from that read, except where the refresh key or a choice command asks, which read anew.
- A call of `agent-msg who`, `work show` or `work events` that fails because Redis answers `Resource temporarily unavailable`, or because herdr or ssh did not answer for another machine (`herdr call timed out`, `ConnectionAborted`, `Connection closed by`), SHALL be made once more at once.

### The first drawing

- The first read of a choice SHALL draw the focuses after at most 5 seconds from the reports in by then, saying nothing of the leads still being read.
- The mod SHALL draw those leads when their reads end, with no second read of a lead already asked.

### A lead that cannot be read

- Where a lead's read fails and a report of it was read earlier in the session, the views SHALL draw that report, marked old.
- An answer that the lead has reported nothing SHALL count as a report read: such a lead whose later read fails is drawn as old, with no ticket.
- Where a lead's read fails and no report of it was ever read, the Work view SHALL list the lead as not read and claim nothing of its tickets.
- The Focus view SHALL draw a card from an earlier report with a note of how long ago it was read.
- Where `agent-msg who` fails, the leads drawn SHALL stay, marked old.
- Where the read of the leads failed and none is drawn, the Work view SHALL say the leads could not be read, and not that none has reported.
- A lead that `agent-msg who` no longer lists SHALL be forgotten with its report.
- The last good reports SHALL be kept in memory only.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-030-AC-1 | A lead's report is read with a limit of 20 seconds, and one that answers after 10 seconds is drawn. | Test |
| FR-030-AC-2 | With 30 leads and both views asking, at most 8 reads are under way at once and each lead is read once. | Test |
| FR-030-AC-3 | A view that asks within 30 seconds of another's read makes no call; the refresh key reads anew; the views' own intervals read again afterwards. | Test |
| FR-030-AC-4 | A transient Redis, herdr or ssh failure of the lead list, a report or the events is tried once more at once; a second one, or another failure, is not. | Test |
| FR-030-AC-5 | A lead never read is listed as not read with the others, counted as such in the Work header and widget, with its error in the footer warning. | Test |
| FR-030-AC-6 | A lead that stops answering, or all leads where the list fails, are drawn as last read and marked old, until they answer again. | Test |
| FR-030-AC-7 | A lead no longer listed is not drawn from its earlier report. | Test |
| FR-030-AC-8 | A lead that answers is drawn while another is still being read, and a review event is listed within a minute while lead reads are slow. | Test |
| FR-030-AC-9 | In a real session every reachable lead of the selected teams is read, those on other machines among them. | Demonstration |
| FR-030-AC-10 | Where the leads were never listed, the Work view says they could not be read and shows one warning. | Test |
| FR-030-AC-11 | With one lead taking 15 seconds, the Focus view draws the others within 6 seconds with no warning, and the slow one when it answers, each asked once. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-005](../usecase/US-005-trust-what-i-see.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-028](FR-028-work-tab.md), [FR-009](FR-009-band-cells.md)
