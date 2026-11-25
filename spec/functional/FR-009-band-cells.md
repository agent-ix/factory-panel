---
id: FR-009
title: Band cells and digits
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-003"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-030"
    type: depends_on
---
# FR-009: Band cells and digits

## Description

The mod SHALL draw each band module as one cell that carries a digit and opens its view when that digit is pressed.

## Behavior

- The mod SHALL leave out a module that has nothing to report.
- The mod SHALL draw the selected modules in the order the selection lists them, ignoring unknown names and repeated names after the first.
- The mod SHALL assign the digits 1 to 9 to the cells in the order drawn, so the digits follow what is on screen.
- The mod SHALL draw a cell's digit before its text.
- The mod SHALL draw a cell beyond the ninth without a digit.
- When a digit is pressed at an empty prompt, the mod SHALL open the view of the cell that carries it, replacing any view already open.
- A pressed digit that no cell carries SHALL do nothing.
- The module-to-view table SHALL be the one definition of the modules and their views, as follows:

  | Module | View |
  |--------|------|
  | health | Factory |
  | local | Factory |
  | lanes | Factory |
  | agents | Factory |
  | spend | Factory |
  | focus | Focus |
  | queue | Focus |
  | lead | Focus |
  | work | Work |
  | attention | Escalations |
  | relay | Message |
  | team | Team |

- The team module SHALL show the label and value of the first tile that has a reading, of the first team that has one among the selected teams that have series (the exporter ids with no key where none has), with `≥` before a value that is a lower bound ([FR-029](./FR-029-team-metrics.md)).
- The mod SHALL leave out the team module when no team metrics exist.

### The work module

- The work module SHALL read `N tickets · M PRs open · K merged 24h`, with `ticket` and `PR` in the singular for one.
- N SHALL be the distinct tickets the leads with a current report have in hand: those their agents report and those their focus names, without the finished ones ([FR-028](./FR-028-work-tab.md)). A report is current where it was read and its newest time is at most 2 hours old.
- Where fewer leads have a current report than are listed, N SHALL be drawn as a lower bound with the two numbers, `≥N tickets (r/t leads)`.
- The tickets only older reports name SHALL be counted apart, `+L old`, and SHALL be in neither N nor M.
- M SHALL be the distinct open or draft PRs of those tickets, as ix-board names them: in a focus status, or for a ticket none names, in its `issues` answer ([FR-028](./FR-028-work-tab.md)).
- K SHALL be the distinct PRs of the merged entries of the focus status's `activity[]` of the last 24 hours, so that a PR of two tickets is one; an entry that names no PR counts by itself.
- ix-board puts at most 200 entries in `activity[]`, newest first. Where an answer holds that many and its oldest is under 24 hours old, K SHALL be drawn as a lower bound (`≥K`).
- Where ix-board names the PRs of only some of the tickets, M SHALL be drawn as a lower bound (`≥M`).
- A number that is unknown SHALL read `—` and never 0: M where no answer of ix-board names the PRs of any of those tickets, and K where no focus status has an `activity` key.
- Where M or K reads `—`, the cell SHALL say why in brackets, a reason both share once: no focus status read, ix-board not read yet or could not be read, no PRs named, ix-board older than 0.9.0, or leads not read.
- An answer of ix-board more than 35 minutes old SHALL NOT be drawn as current: the cell SHALL say its age, `ix-board <age> old`, and K SHALL be a lower bound where a focus status is that old or was never answered.
- Wherever N is drawn as a lower bound, M SHALL be too.
- The mod SHALL leave out the work module until the first read of the relay's leads has ended or failed.
- A report held from an earlier read SHALL count as any other by its age ([FR-030](./FR-030-lead-report-reads.md)).
- Where no report is held and the read of the leads failed, N and M SHALL read `—`.
- Where the leads cannot be listed, or none answered, the band SHALL show that error.
- Where some leads' reads failed, the band SHALL say how many of the leads were not read, and how many of those are shown from an earlier read.
- Where every report was read, the band SHALL show the ix-board error of the focus the band shows, if any.
- The band SHALL show an error text that two cells share once.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-009-AC-1 | Each cell drawn within the first nine shows its digit before its text, so a person can read which key opens it. | Test |
| FR-009-AC-2 | The digits follow the cells drawn: when attention is omitted, the cells after it move up one digit. | Test |
| FR-009-AC-3 | With ten modules listed, the first nine cells carry digits 1 to 9 and the tenth is drawn without a digit. | Test |
| FR-009-AC-4 | With the selection `focus,nope,focus,local`, the band shows focus then local, with digits 1 and 2. | Test |
| FR-009-AC-5 | Pressing a digit that no cell carries opens nothing and changes nothing. | Test |
| FR-009-AC-6 | Pressing the digit of a cell opens the view named in the module-to-view table, for every module in the table. | Test |
| FR-009-AC-7 | The team cell shows the first tile with a reading of the first selected team that has one, and is left out when no team metrics exist. | Test |
| FR-009-AC-8 | In a real classic session a digit typed while the prompt holds text is typed into the prompt and opens nothing. | Demonstration |
| FR-009-AC-9 | The work cell reads the distinct tickets the leads have in hand, their distinct open and draft PRs and the merges of 24 hours. | Test |
| FR-009-AC-10 | The work cell reads `—` for PRs and merges that ix-board has not said, and `≥M` where only some tickets' PRs are known. | Test |
| FR-009-AC-11 | The work cell is left out until the first read of the leads has ended or failed. | Test |
| FR-009-AC-12 | A failed read of the leads counts the reports held and shows the error; with none held tickets and PRs read `—`; an ix-board error of the focus shows where the leads were read. | Test |
| FR-009-AC-13 | Where a lead was never read, tickets and PRs read as lower bounds; the band says how many leads were not read and how many are shown from an earlier read. | Test |
| FR-009-AC-14 | Where an `activity[]` of 200 entries reaches back less than 24 hours, the merges read as a lower bound. | Test |
| FR-009-AC-15 | With fewer current reports than leads listed the cell reads `≥N tickets (r/t leads)`, and the tickets only reports over 2 hours old name are counted apart. | Test |
| FR-009-AC-16 | An ix-board answer over 35 minutes old has its age said and makes the merges a lower bound, as a focus status never answered does. | Test |
| FR-009-AC-17 | A cell with `—` for PRs or merges says why. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md), [US-003](../usecase/US-003-switch-and-act.md), [FR-030](FR-030-lead-report-reads.md)
