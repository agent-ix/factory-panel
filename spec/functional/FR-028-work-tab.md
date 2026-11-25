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
  - target: "ix://agent-ix/factory-panel/FR-027"
    type: traces_to
---
# FR-028: Work tab

## Description

The mod SHALL draw a Work view that shows which code leads are working, what each has in hand, what merged lately, and which reviews, specs and gates started and finished.

## Behavior

### Leads and tickets

- The Work view SHALL be the third view, after Focus, in the dock and in `/factory` ([FR-003](./FR-003-one-command.md)), opened by `/factory work`.
- The mod SHALL list the verified leads of `agent-msg who` that the selected teams allow, each with a status mark (`◐` running, `◌` waiting or unknown, `✕` failed, `✓` done) and the age of its latest report.
- Under each lead the mod SHALL list the tickets of the agents in `agent-msg work --lead <address> show`, keeping each agent's name, ticket, role, status and report time, newest action first.
- A badge SHALL count only agents that are running or waiting.
- A ticket row SHALL show its id, the Linear state and title where ix-board's focus status names the ticket, its badges, and its last action as `<role> <status> <age>`.
- The last action SHALL be the latest transition of an agent on that ticket in `agent-msg work events`. The stream starts at its oldest event, so the mod SHALL read it in pages of 1000 after a cursor it keeps between reads, at most 5 pages per read, so that a later read asks only for newer events; where more than 5 pages are behind it SHALL warn and carry on at the next read; where the events cannot be read it SHALL be the latest report of an agent on the ticket.
- The badges SHALL be `[pr]` for a ticket with an open or draft PR, `[review×N]` for N agents in a reviewer role on the ticket (`[review]` when N is 1), `[spec]` for a spec role or the state Specify or Specced, and `[gate]` for a gate role.
- A ticket that is in progress in the focus status but that no lead reports SHALL NOT be listed under a lead.
- A lead SHALL collapse to one row that says how many tickets it holds, and expand again, by the arrow beside it.

### Recent

- The Recent section SHALL list at most 10 rows, newest first.
- It SHALL list merges only until the `a` key shows every kind, and the `a` key SHALL toggle back. Every kind is the merged, closed and opened entries of the focus status's `activity[]`, and the `review` and `spec` events of the relay with the gate events.
- A row of an `activity[]` entry SHALL show its mark (`✓` merged, `●` closed, `○` opened), its age, the repository and PR number, the ticket id and the title.
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

- The tickets, their states and PRs and the activity SHALL come from the same gated `ix-board --json focus status` answer the Focus view reads: the Work view SHALL make no further Linear or ix-board call, and SHALL read an answer wrapped in a `result` key as the object inside.
- While the view is on screen ([FR-027](./FR-027-fetch-only-on-screen.md)) the leads and their work reports SHALL be read once a minute and the events every 30 seconds, one read of each at a time, so that a transition is listed within 60 seconds of its report. The events read SHALL NOT wait on the leads' reports. The `r` key SHALL read both at once.
- A failed relay read SHALL be one warning icon with its count on the footer, as on the Focus view ([FR-024](./FR-024-warning-icon-in-footer.md)).
- Colour SHALL mark state only: the status and activity marks are coloured, ticket text is not. A row SHALL fit 60 columns, with ages like `4m` and no blank row inside the lead block.
- The widget SHALL say `N leads · M tickets · K merged 24h`, with M the distinct tickets and K the distinct merged PRs, drawn `≥K` where ix-board cut its activity inside the day ([FR-009](./FR-009-band-cells.md)).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-028-AC-1 | A lead of `agent-msg who` is listed with its status mark and age, and under it each ticket of its agents with state, title, badges and last action from the events. | Test |
| FR-028-AC-2 | `[pr]` shows for an open or draft PR and not for a merged one; `[review×2]` for two reviewer agents and `[review]` for one; `[spec]` for a spec role or the state Specified; `[gate]` for a gate role. | Test |
| FR-028-AC-3 | A ticket in progress in the focus status that no lead reports is not listed. | Test |
| FR-028-AC-4 | A lead collapses to `(N tickets)` and expands again; a ticket row is at most 60 columns wide. | Test |
| FR-028-AC-5 | Recent lists merged activity newest first with repository, PR number, ticket and title; `a` shows closed and opened entries and the role events too and toggles back. | Test |
| FR-028-AC-6 | With a focus status that has no `activity` and no `prs`, Recent says `needs ix-board ≥0.9.0` and the tickets show without a PR badge. | Test |
| FR-028-AC-7 | An answer wrapped in `result` gives the same tickets and activity; the Work view makes no ix-board call other than the one focus status call of the Focus read. | Test |
| FR-028-AC-8 | Where the events cannot be read the tickets still show with the age of the latest agent report, events already held stay listed, and the footer shows one warning. | Test |
| FR-028-AC-9 | The widget says `N leads · M tickets · K merged 24h`. | Test |
| FR-028-AC-10 | The Work tab follows Focus in the dock order, and `/factory work` opens it. | Test |
| FR-028-AC-12 | The events are read after the cursor of the page before, a later read asks only for events after the last cursor and keeps earlier last actions, and five full pages with more behind give one warning and are carried on at the next read. | Test |
| FR-028-AC-11 | In a real session the tab shows the leads, their tickets with badges, today's merges and, under `a`, the role events of the bus. | Demonstration |
| FR-028-AC-13 | Recent lists no role event until `a`; then it lists review, spec and gate starts and finishes with ticket, lead and age, newest first among the merged, closed and opened entries. | Test |
| FR-028-AC-14 | A repeated report and a resume after `waiting` add no event; `running` after `done`, `failed`, `canceled` or removal is a new start; `failed`, `canceled` and other roles add none; the newest 200 events are kept. | Test |
| FR-028-AC-15 | The events of a lead outside the selected teams are not listed. | Test |
| FR-028-AC-16 | A review reported while the view is on screen is listed within 60 seconds. | Test |
| FR-028-AC-17 | With no `activity` in the focus status, `a` lists the role events and says `needs ix-board ≥0.9.0`. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md)
- **See also**: [FR-004](FR-004-detail-view.md), [FR-025](FR-025-per-project-last-good.md), [FR-027](FR-027-fetch-only-on-screen.md), [FR-029](FR-029-team-metrics.md)
