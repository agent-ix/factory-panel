---
id: FR-028
title: Work tab
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-004"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-013"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-027"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-030"
    type: depends_on
---
# FR-028: Work tab

## Description

The mod SHALL draw a Work view that shows which code leads are working, what each has in hand, what merged lately, and which reviews, specs and gates started and finished.

## Behavior

### Leads and tickets

- The Work view SHALL be the third view, after Focus, in the dock and in `/factory` ([FR-003](./FR-003-one-command.md)), opened by `/factory work`.
- The mod SHALL list the verified leads of `agent-msg who` that the selected teams allow and that have a report or could not be read ([FR-030](./FR-030-lead-report-reads.md)), each with a status mark (`◐` running, `◌` waiting or unknown, `✕` failed, `✓` done) and the age of its latest report.
- A lead whose last read failed SHALL carry the mark `▲` in place of its status, and read `old <age>` where an earlier report is drawn, with the age of that read, or `not read` where there is none.
- Each lead SHALL be drawn as its read answers.
- A lead whose latest report is more than 2 hours old says what it did and not what it does: its row SHALL carry the mark `◌`, read `old <age>` and draw its tickets dimmed.
- The header SHALL say how many leads are listed, and how many are `not read` and `old`, a lead with an old report among the `old`.
- Under each lead the mod SHALL list the tickets of the agents in `agent-msg work --lead <address> show`, keeping each agent's name, ticket, role, status and report time, and the tickets the report's focus names (`focus.tickets`), newest action first.
- A ticket is finished where it has an agent, every agent on it is `done` or `canceled`, and the lead's focus does not name it. A lead's finished tickets SHALL be folded under it behind `▸ N finished`, which opens and closes them. The other tickets are those the lead has in hand.
- A lead with no ticket SHALL say `no ticket reported`, with the summary of its reported focus under it where it has one.
- The listed leads of the selected teams that answered with no report SHALL be counted in one line under the leads, `▸ N leads report no work`, which shows and hides their addresses.
- Leads that another session is reading, and of which nothing is at hand, SHALL be counted in a line of their own.
- A badge SHALL count only agents that are running or waiting.
- A ticket row SHALL show, in this order, its id, its title where ix-board names the ticket (see [Data and drawing](#data-and-drawing)), its badges and its age.
- A ticket row SHALL NOT show a role, an agent status, the word `focus` or a Linear state.
- The ages SHALL be right-aligned in one column at the right edge of the row, and the title SHALL take the width the id, badges and age leave, cut with `…`.
- The age of a ticket that only a focus names, with no agent and no transition in the events, SHALL be that of the focus report.
- The age SHALL be that of the latest transition of an agent on that ticket in `agent-msg work events`. The stream starts at its oldest event, so the mod SHALL read it in pages of 1000 after a cursor it keeps between reads, at most 5 pages per read, so that a later read asks only for newer events; where more than 5 pages are behind it SHALL warn and carry on at the next read; where the events cannot be read it SHALL be the latest report of an agent on the ticket.
- The badges SHALL be `[pr]` for a ticket with an open or draft PR, `[review×N]` for N agents in a reviewer role on the ticket (`[review]` when N is 1), `[spec]` for a spec role or the state Specify or Specced, and `[gate]` for a gate role.
- A ticket that is in progress in the focus status but that no lead reports SHALL NOT be listed under a lead.
- A ticket ix-board gives nothing of SHALL say why in the place of its title, where ix-board has answered or failed: `not in Linear` where the tickets read names it as unknown, which it may say by exiting 3 with its answer and no message, and `state not read` where that read never succeeded or did not ask for it.
- A lead SHALL collapse to one row that says how many tickets it has in hand, and expand again, by the arrow beside it.

### Teams and focus

- The top of the Work view SHALL show both choices of [FR-013](./FR-013-scoping.md), `Teams: <teams> ▾` (the names, `all`, or their number where the names are long) and `Focus: <focus> ▾`.
- Pressing `Teams` SHALL list `all teams` and each team of a lead of `agent-msg who` and of the selection, the selected ones marked. Pressing a team SHALL add or remove it, and removing the last SHALL select every team.
- Pressing `Focus` SHALL list the choices of [FR-020](./FR-020-named-focus-resolution.md), the chosen one marked, and pressing one SHALL choose it and close the list.
- A choice SHALL be saved in the user's choice file as `/factory teams` and `/factory focus` save it, and a choice that cannot be saved SHALL be said.
- The leads listed SHALL be those of the selected teams, whatever the focus.
- Under a named focus a lead's tickets SHALL be only those of the focus. A ticket is of the focus where the definition names it, where a focus status answer over the definition's members lists it, or where `ix-board issues` places it in a project or milestone of the definition.
- A ticket whose place is not known (its project not said, the ticket not read or unknown to Linear, or a member of the focus without a known id) SHALL NOT be dropped: it SHALL be listed under its lead behind `▸ N tickets with unknown project`. A ticket SHALL be left out of a focus only where every project of the focus is known.
- Where a focus definition has exclusions, the view SHALL say they are not applied.
- A lead that was read and has no ticket in the focus and none of unknown place SHALL be folded into one line, `▸ N leads with nothing in this focus`, which shows and hides their addresses and how many tickets each has outside it. A lead whose report could not be read SHALL stay listed as without a focus.
- Where the focus selects nothing, the view SHALL say `this focus selects nothing`.
- Until the chosen focus is read, the view SHALL show every ticket and say `the focus is not read yet: every ticket is shown`.
- Where the chosen focus cannot be applied ([FR-020](./FR-020-named-focus-resolution.md)), the view SHALL show every ticket and say why.

### Recent

- The Recent section SHALL list at most 10 rows, newest first.
- It SHALL list merges only until the `a` key shows every kind, and the `a` key SHALL toggle back. Every kind is the merged, closed and opened entries of the focus status's `activity[]`, and the `review` and `spec` events of the relay with the gate events.
- Under every kind, 5 of the 10 rows SHALL be held for the newest role events, however much newer `activity[]` there is, and the other 5 for the newest `activity[]` entries. Rows one of the two does not fill SHALL go to the other. The rows chosen SHALL be listed together, newest first.
- A row of an `activity[]` entry SHALL show its mark (`✓` merged, `●` closed, `○` opened), its age, the repository and PR number, the ticket id and the title.
- Under a named focus, the `activity[]` entries SHALL be those of the focus statuses over its members, and only the role events of the selected teams on tickets of the focus SHALL be listed. Under every kind, the view SHALL say how many events of tickets with unknown project are not listed. A merge is not attributed to a team.
- Where the focus reports name no tracker work, so that no focus status is read, Recent SHALL say that there is none to read merges from, and where the read of every focus status failed, that it could not be read.
- Where the focus status has no `activity` key (an ix-board older than 0.9.0) it SHALL say `needs ix-board ≥0.9.0`, and the tickets SHALL show without a PR badge. Under every kind the relay's events SHALL be listed with that line, and with the line that says the focus status is awaited before one is read.

### Review, spec and gate events

- The events SHALL be the role transitions of `agent-msg work events`: a role that contains `review` is `review`, else one that contains `gate` is `gate`, else one that contains `spec` is `spec`. Other roles SHALL add no event.
- A `start` SHALL be the first `running` report of an assignment (lead, agent and ticket) that is not already running, so a repeated report, and a `running` after `waiting`, add no second start.
- A `done` SHALL be the first `done` report of an assignment since it last ran.
- A `failed` or `canceled` report, and the removal of the agent, SHALL end the assignment without an event.
- An event row SHALL show its mark (`◐` start, `✓` done), its age from the time of the transition, the role and step (as `review start`), the ticket id and the lead's address.
- Only the events of leads that the selected teams allow SHALL be listed.
- The mod SHALL keep the newest 200 events.

### Data and drawing

- The states and PRs of the tickets and the activity SHALL come from the gated `ix-board --json focus status` answers the Focus view reads, and the Work view SHALL read an answer wrapped in a `result` key as the object inside.
- The reported tickets that no focus status names, and under a named focus every reported ticket, for the project that places it, SHALL be read with one `ix-board --json issues <ids>`, once the leads and the focus statuses have been read, of at most 100 identifiers of the form `KEY-123`, those of tickets in hand first, within the limit of ix-board processes of [NFR-004](../non-functional/NFR-004-selection-never-blocks.md). `focus status --issue` is not used for it: it gives states and PRs of started and lately closed tickets only, and fails as a whole for one unknown identifier.
- That answer SHALL be shared by the sessions through the gate file of [FR-025](./FR-025-per-project-last-good.md), by the teams read and whether a focus is named. It SHALL be read again after 30 minutes, or after 5 minutes where a reported ticket was not asked for.
- Where the attachments of a ticket are cut short, nothing SHALL be said of its PRs.
- The Work view SHALL make no other Linear or ix-board call.
- Where a ticket is in several answers, the newest that names its PRs SHALL be drawn.
- An answer SHALL keep the time it was read. A failed or refused read SHALL keep the earlier answer. Where an answer drawn is more than 35 minutes old, Recent SHALL say its age and that states, PRs and merges are as of then, and SHALL NOT say that nothing merged lately.
- An ix-board read that failed, or that Linear's rate limit holds, SHALL be among the footer's warnings.
- While the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)) the leads and their work reports SHALL be read once a minute and the events every 30 seconds, one read of each at a time, so that a transition is listed within 60 seconds of its report. The events read SHALL NOT wait on the leads' reports. The `r` key SHALL read both at once.
- Failed relay reads, one for each lead not read, and failed ix-board reads SHALL be one warning icon with their count on the footer, as on the Focus view ([FR-024](./FR-024-warning-icon-in-footer.md)).
- Colour SHALL mark state only: the status and activity marks are coloured, ticket text is not. A row SHALL fit 60 columns, with ages like `4m` and no blank row inside the lead block.
- The widget SHALL say `N leads · M tickets · K merged 24h`, with M and K as the work cell counts them ([FR-009](./FR-009-band-cells.md)): `≥M` where fewer leads give a current report than are listed, `+L old` for the L tickets only old reports name, and `≥K` where merges may be missing. It SHALL add the leads `not read` and `old`, and the age of an old ix-board answer. Under a named focus N SHALL leave out the leads with nothing in it, M SHALL count its tickets, `≥M · +U unknown project` where U in hand have an unknown project, and a focus not read yet SHALL be said.
- Before the first read of the leads has ended, the widget SHALL say they are being read, and where that read failed and no lead is drawn, that they could not be read. It SHALL then give no count.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-028-AC-1 | A lead of `agent-msg who` is listed with its status mark and age, and under it each ticket of its agents as id, title, badges and the age from the events, with the ages in one column and no role, status or state word. | Test |
| FR-028-AC-2 | `[pr]` shows for an open or draft PR and not for a merged one; `[review×2]` for two reviewer agents and `[review]` for one; `[spec]` for a spec role or the state Specified; `[gate]` for a gate role. | Test |
| FR-028-AC-3 | A ticket in progress in the focus status that no lead reports is not listed. | Test |
| FR-028-AC-4 | A lead collapses to `(N tickets)`, the number it has in hand, and expands again; a ticket row is at most 60 columns wide, its title cut to the room left. | Test |
| FR-028-AC-5 | Recent lists merged activity newest first with repository, PR number, ticket and title; `a` shows closed and opened entries and the role events too and toggles back. | Test |
| FR-028-AC-6 | With a focus status that has no `activity` and no `prs`, Recent says `needs ix-board ≥0.9.0` and the tickets show without a PR badge. | Test |
| FR-028-AC-7 | An answer wrapped in `result` gives the same tickets and activity; beside the focus status call of the Focus read, the Work view makes one ix-board call, for the tickets no focus status names. | Test |
| FR-028-AC-8 | Where the events cannot be read the tickets still show with the age of the latest agent report, events already held stay listed, and the footer shows one warning. | Test |
| FR-028-AC-9 | The widget says `N leads · M tickets · K merged 24h`, M the tickets in hand and K a lower bound where the activity is cut inside the day. | Test |
| FR-028-AC-10 | The Work tab follows Focus in the dock order, and `/factory work` opens it. | Test |
| FR-028-AC-12 | The events are read after the cursor of the page before, a later read asks only for events after the last cursor and keeps earlier ages, and five full pages with more behind give one warning and are carried on at the next read. | Test |
| FR-028-AC-11 | In a real session the tab shows the leads, their tickets with badges, today's merges and, under `a`, the role events of the bus. | Demonstration |
| FR-028-AC-13 | Recent lists no role event until `a`; then it lists review, spec and gate starts and finishes with ticket, lead and age, newest first among the merged, closed and opened entries. | Test |
| FR-028-AC-14 | A repeated report and a resume after `waiting` add no event; `running` after `done`, `failed`, `canceled` or removal is a new start; `failed`, `canceled` and other roles add none; the newest 200 events are kept. | Test |
| FR-028-AC-15 | The events of a lead outside the selected teams are not listed. | Test |
| FR-028-AC-16 | A review reported while the view is on screen is listed within 60 seconds. | Test |
| FR-028-AC-17 | With no `activity` in the focus status, `a` lists the role events and says `needs ix-board ≥0.9.0`. | Test |
| FR-028-AC-18 | Under `a`, 5 role events show beside 40 newer activity entries, and rows either kind does not fill go to the other, listed together newest first. | Test |
| FR-028-AC-19 | A ticket the focus of a lead names is listed under it once, also where it has no agent, with the age of the focus report where no agent or transition speaks of it, and is counted with the tickets. | Test |
| FR-028-AC-20 | A lead with no ticket says `no ticket reported` and the summary of its focus. | Test |
| FR-028-AC-21 | The leads of the selected teams that answer with no report are counted in one line that shows and hides their addresses, and a lead that could not be read is not among them. | Test |
| FR-028-AC-22 | A ticket whose agents are all done or canceled and that no focus names is folded under its lead behind `▸ N finished` and is not counted; one the focus names is counted. | Test |
| FR-028-AC-23 | Before the first read of the leads the widget says they are being read, and after a failed one with none drawn that they could not be read, with no count in either. | Test |
| FR-028-AC-24 | A reported ticket no focus status names is drawn with the title and `[pr]` of one `ix-board issues` answer; no PR is claimed where its attachments are cut short, and a word that is no identifier is not asked for. | Test |
| FR-028-AC-25 | The tickets answer is read again after 5 minutes where a ticket was not asked for, else after 30 minutes. | Test |
| FR-028-AC-26 | A failed ix-board read is a warning on the footer, and an answer more than 35 minutes old says its age in Recent, with no claim that nothing merged lately. | Test |
| FR-028-AC-27 | A lead whose report is more than 2 hours old has the hollow mark and reads `old <age>`, and the widget counts its tickets apart. | Test |
| FR-028-AC-28 | A ticket Linear has no record of reads `not in Linear`, also where ix-board exits 3 with its answer and no message, and one whose read failed `state not read`. | Test |
| FR-028-AC-29 | With no focus naming tracker work, Recent says there is no focus status to read merges from, and neither that it is waiting nor that nothing merged. | Test |
| FR-028-AC-30 | Of more than 100 tickets no focus names, those in hand are asked for first, and one left out reads `state not read`. | Test |
| FR-028-AC-31 | Under a named focus a lead lists only the tickets the focus lists or whose project is of it, and with focus `all` every ticket; a lead of a team that is not selected is not listed for holding a ticket of the focus. | Test |
| FR-028-AC-32 | A ticket whose place is unknown is listed behind `▸ N tickets with unknown project`, and a ticket is left out only where every member of the focus is known. | Test |
| FR-028-AC-33 | A lead with nothing in the focus is counted in one line that shows and hides its address. | Test |
| FR-028-AC-34 | Under a named focus Recent lists only the role events of its tickets and says how many of unknown project it leaves out, and the widget counts its leads and tickets with those of unknown project apart. | Test |
| FR-028-AC-35 | A lead whose report cannot be read stays listed under a named focus. | Test |
| FR-028-AC-36 | A focus that selects nothing is said to, and every lead that was read is folded. | Test |
| FR-028-AC-37 | Where the chosen focus cannot be read, every ticket is listed and the view says why. | Test |
| FR-028-AC-38 | The header's choices list the teams and the focus names, save what is pressed and show it. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md), [FR-030](FR-030-lead-report-reads.md)
- **See also**: [FR-004](FR-004-detail-view.md), [FR-009](FR-009-band-cells.md), [FR-025](FR-025-per-project-last-good.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
