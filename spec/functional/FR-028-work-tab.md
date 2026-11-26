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

The mod SHALL draw a Work view that shows where each code lead's tickets stand and which leads are stuck or going nowhere, by host, with what each has in hand, what merged lately and which reviews, specs and gates started and finished shown when opened.

## Behavior

### Leads and tickets

- The Work view SHALL be the third view, after Focus, in the dock and in `/factory` ([FR-003](./FR-003-one-command.md)), opened by `/factory work`.
- The mod SHALL list the verified leads of `agent-msg who` that the selected teams allow and that have a report or could not be read ([FR-030](./FR-030-lead-report-reads.md)), grouped by host, the first part of the lead's address.
- The view SHALL open as one line for each host, every line closed, and Recent closed.
- A host SHALL open to one closed line for each of its leads, and a lead to its tickets. What is open SHALL be remembered for the session.
- The `⚠ N` of a host SHALL count every stuck lead of it, whatever the lead's row shows first, one folded away under a focus among them.
- A host line SHALL show the host, a bar of the distinct tickets of its leads by state, their count, and its alerts: `⚠ N` for its stuck leads, `⏱ N` for its leads with a time warning and `▲ N` for its leads whose report was not read. A ticket of two leads SHALL count once.
- A lead line SHALL show the lead by workspace and tab, a bar of its tickets by state, their count and at most one alert. It SHALL NOT name a project or a ticket.
- The bars, counts and alerts of the host and lead lines SHALL each start in one column, whatever is open.
- The tickets of a lead SHALL be those of the agents in `agent-msg work --lead <address> show`, keeping each agent's name, ticket, role, status and report time, and those the report's focus names (`focus.tickets`), the finished ones among them.
- A ticket's state SHALL be, from the `ix-board issues` answer: `done` where Linear's state type is completed; else `in review` where its state name says Review or a PR of it is open or draft; else `being worked on` where its state type is started or an agent on it runs; else `not started`. A canceled ticket SHALL NOT be drawn in a bar or counted. A ticket ix-board gave no state of is `unread` and SHALL NOT be given another state.
- The states SHALL be drawn, in this order, as `█` done (success colour), `▓` in review (warning), `▒` being worked on (suggestion), `░` not started (inactive) and `?` unread, so that they are told apart without colour.
- A bar SHALL be one cell for each ticket up to 20 cells; above 20 the cells SHALL be shared in proportion, each state with a ticket keeping at least one, and no state SHALL have fewer cells than a state with fewer tickets. The count SHALL follow the bar.
- Where tickets may be missing from a count (a lead's report never read, or tickets whose place under the chosen focus is unknown) it SHALL read `≥N`, and `—` where none is known. A count that is not known SHALL NOT read 0.
- A lead line's alert SHALL be the first that applies of: `▲ <age>` where its last read failed, with the age of the report drawn, or `▲` where none ever was; `⚠ <duration>` where it is stuck; `⏱ <age>` where its report is more than 2 hours old; `⏱ <duration>` where it is churning. A row with an old report SHALL be dimmed. An alert SHALL be a mark and a number, with no words.
- A lead is stuck where its lane ([FR-032](./FR-032-fleet-capacity.md) series) is `stuck`, or `blocked` with the reason `permission`, `dialog`, `question`, `queued_question`, `login` or `usage_limit`; `wait_loop` is not stuck. The duration SHALL run from the last sample of the past 24 hours at which the lane was neither blocked nor stuck, else from its first sample of those hours.
- A lead is churning where its lane is `working` and for 2 hours no agent of it has changed role, status or ticket in `agent-msg work events`, Linear has updated none of its tickets and no PR of them was opened or merged. A repeated report is no change. Linear's update time stands for the ticket's last state change, so a ticket updated in any way within 2 hours is no churn.
- A lead SHALL be said to be churning only where its report's last read succeeded, the tickets answer is at most 10 minutes old and its read succeeded, and the events were last read at most 5 minutes ago, without error and to the end of the stream.
- A project name read that fails SHALL NOT be kept as an answer: a Linear rate limit SHALL hold every gated read, any other failure SHALL be held 5 minutes, and the failure SHALL be among the footer's warnings.
- Where a lane's state is not known or older than 5 minutes, no change of the lead's agents is known, a ticket of it is unread, its PRs are not known, or every ticket of it is finished, the lead SHALL NOT be said to be churning; with no current lane state it SHALL NOT be said to be stuck.
- An opened lead SHALL say each of its alerts in words: why its report was not read, what it is blocked on and for how long, that its report is old and since when, or that there is no movement and for how long.
- An opened lead SHALL list its tickets under a heading for each Linear project, `no project` or `project unknown`, those being worked on first and the finished last. Where tickets are unread it SHALL say how many and why.
- A lead's leads with a report more than 2 hours old SHALL be folded under their host behind `▸ ⏱ N`.
- A lead with no ticket SHALL say `no ticket reported` when opened, with the summary of its reported focus under it where it has one.
- The listed leads of the selected teams that answered with no report SHALL be counted in one line under their host, `▸ N leads report no work`, which shows and hides their addresses.
- Leads that another session is reading, and of which nothing is at hand, SHALL be counted in a line of their own.
- A badge SHALL count only agents that are running or waiting.
- A ticket row SHALL show, in this order, its state mark, its id, its title where ix-board names the ticket, its badges and its age.
- A ticket row SHALL NOT show a role, an agent status, the word `focus` or a Linear state.
- The ages SHALL be right-aligned in one column at the right edge of the row, and the title SHALL take the width the id, badges and age leave, cut with `…`.
- The age of a ticket that only a focus names, with no agent and no transition in the events, SHALL be that of the focus report.
- The age SHALL be that of the latest transition of an agent on that ticket in `agent-msg work events`. The stream starts at its oldest event, so the mod SHALL read it in pages of 1000 after a cursor it keeps between reads, at most 5 pages per read, so that a later read asks only for newer events; where more than 5 pages are behind it SHALL warn and carry on at the next read; where the events cannot be read it SHALL be the latest report of an agent on the ticket.
- The badges SHALL be `[pr]` for a ticket with an open or draft PR, `[review×N]` for N agents in a reviewer role on the ticket (`[review]` when N is 1), `[spec]` for a spec role or the state Specify or Specced, and `[gate]` for a gate role.
- A ticket that is in progress in the focus status but that no lead reports SHALL NOT be listed under a lead.
- A ticket ix-board gives nothing of SHALL say why in the place of its title, where ix-board has answered or failed: `not in Linear` where the tickets read names it as unknown, which it may say by exiting 3 with its answer and no message, and `state not read` where that read never succeeded or did not ask for it.

### Teams and focus

- The top of the Work view SHALL show both choices of [FR-013](./FR-013-scoping.md), `Teams: <teams> ▾` (the names, `all`, or their number where the names are long) and `Focus: <focus> ▾`.
- Pressing `Teams` SHALL list `all teams` and each team of a lead of `agent-msg who` and of the selection, the selected ones marked. Pressing a team SHALL add or remove it, and removing the last SHALL select every team.
- Pressing `Focus` SHALL read and list the choices of [FR-020](./FR-020-named-focus-resolution.md), the chosen one marked, and pressing one SHALL choose it and close the list.
- A choice SHALL be saved in the user's choice file as `/factory teams` and `/factory focus` save it, and a choice that cannot be saved SHALL be said.
- The leads listed SHALL be those of the selected teams, whatever the focus.
- Under a chosen focus a lead's tickets SHALL be only those of the focus. A ticket is of the focus where a focus status answer over it lists the ticket, or where `ix-board issues` places it in the chosen project or in a project of the chosen initiative.
- A ticket whose place is not known (its project not said, the ticket not read or unknown to Linear, or an initiative whose projects are not all known) SHALL NOT be dropped: it SHALL be listed under its lead behind `▸ N tickets with unknown project`. A ticket SHALL be left out of a focus only where every project of the focus is known.
- A lead that was read and has no ticket in the focus and none of unknown place SHALL be folded into one line under its host, `▸ N leads with nothing in this focus`, which shows and hides their addresses and how many tickets each has outside it. A lead whose report could not be read SHALL stay listed as without a focus.
- Where the chosen focus is not known, the view SHALL show every ticket and say so.
- Until the chosen focus is read, the view SHALL show every ticket and say `focus not read: all tickets shown`.

### Recent

- Recent SHALL be closed until it is opened, and its focus statuses SHALL NOT be read while it is closed.
- The Recent section SHALL list at most 10 rows, newest first.
- It SHALL list merges only until the `a` key shows every kind, and the `a` key SHALL toggle back. Every kind is the merged, closed and opened entries of the focus status's `activity[]`, and the `review` and `spec` events of the relay with the gate events.
- Under every kind, 5 of the 10 rows SHALL be held for the newest role events, however much newer `activity[]` there is, and the other 5 for the newest `activity[]` entries. Rows one of the two does not fill SHALL go to the other. The rows chosen SHALL be listed together, newest first.
- A row of an `activity[]` entry SHALL show its mark (`✓` merged, `●` closed, `○` opened), its age, the repository and PR number, the ticket id and the title.
- Under a chosen focus, the `activity[]` entries SHALL be those of the focus statuses over the focus, and only the role events of the selected teams on tickets of the focus SHALL be listed. Under every kind, the view SHALL say how many events of tickets with unknown project are not listed. A merge is not attributed to a team.
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

- The titles, states, state types, projects, update times and PRs of every reported ticket of the selected teams' leads SHALL be read by one `ix-board --json issues <ids>` read, of calls of at most 100 identifiers of the form `KEY-123` and at most 1000 identifiers, those of tickets in hand first, within the limit of ix-board processes of [NFR-004](../non-functional/NFR-004-selection-never-blocks.md). `focus status --issue` is not used for it: it gives states and PRs of started and lately closed tickets only, and fails as a whole for one unknown identifier.
- That answer SHALL be shared by the sessions through the gate file of [FR-025](./FR-025-per-project-last-good.md), by the teams read, and SHALL be read again 5 minutes after it was read.
- With every line closed the view SHALL read the leads and their reports, the events, the lane states and that one tickets answer, and SHALL NOT read a focus status, a roadmap, a project or a focus name.
- The project names of an opened lead's tickets SHALL be read when it is opened.
- Under a chosen focus the view SHALL read that focus's own status and name, for which tickets are of it, and no other focus or name while Recent and the focus list are closed.
- The activity of Recent SHALL come from the gated `ix-board --json focus status` answers the Focus view reads, and the Work view SHALL read an answer wrapped in a `result` key as the object inside.
- Where the attachments of a ticket are cut short, nothing SHALL be said of its PRs.
- The Work view SHALL make no other Linear or ix-board call.
- Where a ticket is in several answers, the newest that names its PRs SHALL be drawn.
- An answer SHALL keep the time it was read. A failed or refused read SHALL keep the earlier answer. Where an answer drawn is more than 35 minutes old, Recent SHALL say its age and that states, PRs and merges are as of then, and SHALL NOT say that nothing merged lately.
- An ix-board read that failed, or that Linear's rate limit holds, SHALL be among the footer's warnings.
- While the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)) the leads, their work reports and the lane states SHALL be read once a minute and the events every 30 seconds, one read of each at a time, so that a transition is listed within 60 seconds of its report. The events read SHALL NOT wait on the leads' reports. The `r` key SHALL read them, and what is open, at once.
- Failed relay reads, one for each lead not read, and failed ix-board reads SHALL be one warning icon with their count on the footer, as on the Focus view ([FR-024](./FR-024-warning-icon-in-footer.md)).
- Colour SHALL mark state only: the status and activity marks are coloured, ticket text is not. A ticket row SHALL fit 60 columns, with ages like `4m` and no blank row inside the lead block.
- The widget SHALL say `N leads · A active · M tickets` from the leads' reports, A the leads whose report is current and has running work, and M the tickets in hand ([FR-009](./FR-009-band-cells.md)): `≥M` where fewer leads give a current report than are listed. It SHALL add `▲ N` for leads whose report was not read and `⏱ N` for leads whose report is old. Under a chosen focus N SHALL leave out the leads with nothing in it, M SHALL count its tickets, `≥M · +U unknown project` where U in hand have an unknown project, and a focus not read yet SHALL be said. The widget SHALL NOT read ix-board with the focus `all`.
- Before the first read of the leads has ended, the widget SHALL say they are being read, and where that read failed and no lead is drawn, that they could not be read. It SHALL then give no count.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-028-AC-1 | A lead of `agent-msg who` is listed under its host by workspace and tab, and opened shows each ticket of its agents as id, title, badges and the age from the events, with the ages in one column and no role, status or state word. | Test |
| FR-028-AC-2 | `[pr]` shows for an open or draft PR and not for a merged one; `[review×2]` for two reviewer agents and `[review]` for one; `[spec]` for a spec role or the state Specified; `[gate]` for a gate role. | Test |
| FR-028-AC-3 | A ticket in progress in the focus status that no lead reports is not listed. | Test |
| FR-028-AC-4 | A lead closes to its one line and opens again; a ticket row is at most 60 columns wide, its title cut to the room left. | Test |
| FR-028-AC-5 | Recent lists merged activity newest first with repository, PR number, ticket and title; `a` shows closed and opened entries and the role events too and toggles back. | Test |
| FR-028-AC-6 | With a focus status that has no `activity` and no `prs`, Recent says `needs ix-board ≥0.9.0` and the tickets show without a PR badge. | Test |
| FR-028-AC-7 | An answer wrapped in `result` gives the same tickets and activity; beside the focus status call of Recent, the Work view makes one ix-board call, for the reported tickets. | Test |
| FR-028-AC-8 | Where the events cannot be read the tickets still show with the age of the latest agent report, events already held stay listed, and the footer shows one warning. | Test |
| FR-028-AC-9 | The widget says `N leads · A active · M tickets`, M the tickets in hand. | Test |
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
| FR-028-AC-21 | The leads of the selected teams that answer with no report are counted under their host in one line that shows and hides their addresses, and a lead that could not be read is not among them. | Test |
| FR-028-AC-22 | A ticket whose agents are all done or canceled and that no focus names stays listed and drawn under its lead, and is not counted as in hand; one the focus names is. | Test |
| FR-028-AC-23 | Before the first read of the leads the widget says they are being read, and after a failed one with none drawn that they could not be read, with no count in either. | Test |
| FR-028-AC-24 | A reported ticket is drawn with the title and `[pr]` of the one `ix-board issues` answer; no PR is claimed where its attachments are cut short, and a word that is no identifier is not asked for. | Test |
| FR-028-AC-25 | The tickets answer is read with every lead closed, and again 5 minutes after it was read and not before. | Test |
| FR-028-AC-26 | A failed ix-board read is a warning on the footer, and an answer more than 35 minutes old says its age in Recent, with no claim that nothing merged lately. | Test |
| FR-028-AC-27 | A lead whose report is more than 2 hours old is folded under its host, dimmed, with `⏱ <age>`, says so in words when opened, and the widget counts it and not its tickets. | Test |
| FR-028-AC-28 | A ticket Linear has no record of reads `not in Linear`, also where ix-board exits 3 with its answer and no message, and one whose read failed `state not read`. | Test |
| FR-028-AC-29 | With no focus naming tracker work, Recent says there is no focus status to read merges from, and neither that it is waiting nor that nothing merged. | Test |
| FR-028-AC-30 | More than 100 reported tickets are asked for in calls of at most 100 within one read. | Test |
| FR-028-AC-31 | Under a chosen focus a lead lists only the tickets the focus lists or whose project is of it, and with focus `all` every ticket; a lead of a team that is not selected is not listed for holding a ticket of the focus. | Test |
| FR-028-AC-32 | A ticket whose place is unknown is listed behind `▸ N tickets with unknown project`, and a ticket is left out only where every member of the focus is known. | Test |
| FR-028-AC-33 | A lead with nothing in the focus is counted under its host in one line that shows and hides its address. | Test |
| FR-028-AC-34 | Under a chosen focus Recent lists only the role events of its tickets and says how many of unknown project it leaves out, and the widget counts its leads and tickets with those of unknown project apart. | Test |
| FR-028-AC-35 | A lead whose report cannot be read stays listed under a chosen focus. | Test |
| FR-028-AC-36 | A stored focus nothing knows is said, and every ticket is listed. | Test |
| FR-028-AC-37 | Until the chosen focus is read, nothing is filtered out and the view says the focus is not read yet. | Test |
| FR-028-AC-38 | The header's choices list the teams and the focus names, save what is pressed and show it. | Test |
| FR-028-AC-39 | A ticket is done, in review, being worked on or not started by its Linear state type, state name, PRs and running agents; canceled is not drawn; with no state it is unread. | Test |
| FR-028-AC-40 | A bar has one cell a ticket up to 20, above that 20 shared in proportion with at least one for each state present. | Test |
| FR-028-AC-41 | A lead is stuck for a stuck lane or a blocked one waiting on a person or its usage limit, not for `wait_loop`; churning for a working lane with no role, ticket or PR change for 2 hours; neither without the data. | Test |
| FR-028-AC-42 | Host and lead lines show bar, count and alerts in one column each; a ticket of two leads counts once on its host, and the alerts count stuck leads and time warnings. | Test |
| FR-028-AC-43 | With every line closed one tickets read is made and no focus status, roadmap, project or name is read. | Test |
| FR-028-AC-44 | An opened lead lists its tickets under their projects with a state mark each. | Test |
| FR-028-AC-45 | An opened lead says in words why it is stuck, has no movement or has an old report. | Test |
| FR-028-AC-46 | Recent is closed at first, its focus status is read only once it is opened, and the focus choices only once their list is opened. | Test |
| FR-028-AC-47 | Under a chosen focus with Recent and the list closed, only the chosen focus's status and name are read. | Test |
| FR-028-AC-48 | A lead is not said to be churning once its tickets or the events are old, failed to be read or are still being caught up. | Test |
| FR-028-AC-49 | A count with nothing known reads `—` and one that may be short `≥N`, in the pane and the widget, and never 0. | Test |
| FR-028-AC-50 | A failed project name read is not cached as no name: a rate limit holds every gated read, another failure is held 5 minutes, and either is a warning. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md), [FR-030](FR-030-lead-report-reads.md)
- **See also**: [FR-004](FR-004-detail-view.md), [FR-009](FR-009-band-cells.md), [FR-025](FR-025-per-project-last-good.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md), [FR-032](FR-032-fleet-capacity.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
