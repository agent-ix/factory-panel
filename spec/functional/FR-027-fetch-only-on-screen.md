---
id: FR-027
title: Fetch only what is on screen
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-001"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-002"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-009"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/NFR-004"
    type: traces_to
---
# FR-027: Fetch only what is on screen

## Description

The mod SHALL read a source only while something on screen draws its data.

## Behavior

### On screen

- The mod SHALL count a view as on screen when the engine runs its `ui.render` hook, and the sources of that view as wanted only then.
- A terminal pane in a dock or inline counts only where `$.ui.panes()` still lists it shown and placed 150 ms after the drawing.
- A drawing of a widget, or on a surface other than the terminal, SHALL count on its own, since nothing says whether `$.ui.panes()` speaks for it.
- The band counts only in the classic layout with `inlineView` `band` or `status`, and only while no survey holds it.
- A collapsed band does not count where `inlineView` is `band`; the status line counts whether or not the band slot is collapsed.
- The mod SHALL redraw its sites at least every 15 seconds, or every `refreshSeconds` where that is shorter, so that a view that stays on screen keeps being read.
- The mod SHALL start no read from a timer or from session start other than through a drawing, except the identity lookup of an interactive session at start.
- A session that is not interactive SHALL run no identity lookup and no read.
- A typed `/factory show` or choice command, and a choice made in the Work view's header, reads the focus source once, through the same 30 minute gate, although no view draws it ([FR-014](./FR-014-user-choice.md)).
- A read of the focus source names its choices after the lead reports are in, through the gates of [FR-020](./FR-020-named-focus-resolution.md).

### A terminal nobody can see

The engine draws into a terminal whether or not it can be seen, so for a drawing on the terminal herdr or tmux is asked as well.

- The mod SHALL make no read for a terminal drawing while the session's pane is known to be off view, and SHALL read what is due within 15 seconds of its coming back.
- In herdr (`HERDR_ENV` is `1`) the mod SHALL ask `herdr api snapshot`, and the pane is off view only where every pane that lists this session's id is on a tab other than `focused_tab_id`, or on that tab under another pane zoomed over it.
- In tmux (`TMUX_PANE` is set) the mod SHALL ask `tmux display-message` for the pane, and the pane is off view only where no client is viewing its window, or another pane is zoomed over it, and no control mode client is attached. With several clients attached, one that views the window is enough.
- The mod SHALL count the pane on view where `TMUX_PANE` is set but `TMUX` is not, or `TERM_PROGRAM` is set to something other than `tmux`, since the variable is then left over from another terminal.
- The mod SHALL count the pane on view where neither or both of herdr and tmux are set, where the command fails or takes more than 3 seconds, where its answer does not say, and where `FACTORY_PANEL_VIEW_CHECK` is `off`.
- The mod SHALL run the check only when a drawn view has a read due of a source other than the selection, at most once in 15 seconds, and as one command. The selection is the local declaration and choice files, and is read without the check.
- The `r` key SHALL read without the check, since the person pressed it.

### What each view reads

| View | Sources |
|------|---------|
| Factory pane | selection, Prometheus machines, `herdr api snapshot`, `agent-msg doctor`; `ix-board agents` while its ix-board chip is open |
| Factory widget | Prometheus machines, `herdr api snapshot`, `agent-msg doctor` |
| Focus pane | selection, focus |
| Work pane | selection, `agent-msg work` reports, `agent-msg work events`, lane states (Prometheus fleet series), `ix-board issues`; under a chosen focus its focus status; with a lead open the project names; with Recent open the focus; with the focus list open the focus choices ([FR-028](./FR-028-work-tab.md)) |
| Work widget | selection, `agent-msg work` reports; under a chosen focus its focus status and `ix-board issues` |
| Escalations pane | `agent-msg escalations`, and `escalation show` of the rows of the shown view, the open rows and the selected row, where their detail is not held |
| Message pane | `agent-msg log`, and the lead list `agent-msg who` the Focus and Work views share |
| Team pane | selection, Prometheus team series, `ix-board retro delta`, fleet capacity (Prometheus fleet series and `ix-board fleet ledger query`) |
| Team widget | selection, Prometheus team series, `ix-board retro delta` |
| Band cells `health`, `local`, `agents`, `spend` | Prometheus machines |
| Band cells `focus`, `queue` | focus |
| Band cell `lead` | focus, `ix-board agents` |
| Band cell `lanes` | `ix-board agents` |
| Band cell `work` | focus, `agent-msg work` reports, `ix-board issues` |
| Band cell `attention` | `agent-msg escalations` |
| Band cell `relay` | `agent-msg doctor` |
| Band cell `team` | Prometheus team series |

- The band SHALL read the sources of every module it is selected to show, including a module that has nothing to say and draws no cell, and the selection.
- The focus and the work reports share their reads of the leads, so a lead's report just read for one is not read again for the other ([FR-030](./FR-030-lead-report-reads.md)).
- The Message pane SHALL read `agent-msg log` for 14 days, at most 2000 messages, once in a session, and afterwards only the minutes since its last read that answered and one more, at most 500 messages, keeping the 30 newest broadcasts. An answer of 500 messages SHALL be followed at once by the full read, whose broadcasts replace those held.
- The Message, Focus and Work views SHALL share one `agent-msg who` for 60 seconds; the refresh key of the Focus or Work view reads it anew.
- The Escalations pane SHALL read the detail of a row once, and again when its status moves, at most 4 `escalation show` at once; a row of another view whose detail is not held is read when it is shown or selected. Until its detail is read an open row SHALL be drawn as being read, and SHALL be neither resolved nor counted as having no recommendation.

### How often

| Source | Interval while on screen |
|--------|--------------------------|
| selection (declaration and choice files), Prometheus machines | `refreshSeconds` |
| `herdr api snapshot`, `agent-msg doctor` | 60 seconds, or `refreshSeconds` where that is longer |
| `ix-board agents`, escalations, escalation detail, relay broadcasts, work reports, fleet capacity, lane states, the Work view's project names and focus choices | 60 seconds |
| work events | 30 seconds |
| focus | 2 minutes |
| team series, `ix-board retro delta` | 5 minutes |
| `ix-board issues` | asked of the shared gate every 60 seconds, which runs it as [FR-028](./FR-028-work-tab.md) says |

- The mod SHALL read a source at once when a view that draws it comes on screen and the data is older than the interval.
- Opening a view by command or band digit SHALL force no read.
- The `r` key of a view SHALL read that view's sources at once, except that `ix-board agents` is read only while its chip is open and only once 60 seconds have passed since its last read.
- The mod SHALL say that a team of the `teams` choice matched nothing only where both the focus reports and `ix-board agents` for that team have been read, so a band that reads only one of them says nothing about it.
- A source that fails SHALL be next read after twice its interval, doubling with each further failure to at most 5 minutes, or its interval where that is longer, and SHALL return to its interval after a read that answers.
- A read that answers more slowly than its limit SHALL NOT count as a failure: the next read of that source SHALL be due after one and a half times its interval, and slow answers in a row SHALL NOT stretch it further. The limits are 5 seconds for herdr, escalations and relay broadcasts, 10 seconds for `agent-msg doctor`, and for Prometheus (the machines, team series, fleet capacity and lane states) four times the median of that source's last 64 reads, and at least 2.5 seconds. Prometheus is across the LAN and several hosts are on wifi, so a slow answer is normal there.
- While `agent-msg whoami` has not said who the session is, the mod SHALL ask it again with the same doubling, from `refreshSeconds` to 5 minutes; a command SHALL ask at once.
- A changed focus or teams value SHALL make the focus, `ix-board agents`, work report, `ix-board issues`, project name, focus choice and `ix-board retro delta` reads due at the next drawing.
- The Linear-backed reads of `ix-board` stay held by their own 30 minute gate ([FR-025](./FR-025-per-project-last-good.md)); this requirement only decides when the mod asks.
- `ix-board agents` reads herdr and makes no Linear call: the sessions of a machine SHALL share one read of it for 60 seconds through `~/.ix/factory-panel/agents-gate.json`, a file of its own beside the Linear gate, and Linear's rate limit SHALL neither hold it nor be set by it. A read is stamped when it starts and is asked again 5 seconds before its 60 seconds are up, so a read that takes seconds does not make the next ask find it fresh.
- The mod SHALL make no Prometheus read before the metrics address is known ([FR-007](./FR-007-endpoint-discovery.md)), and SHALL NOT count a drawing before then as a failed read.
- The mod SHALL raise no toast or notification from a read.

### Fetch budget and measurement

The mod SHALL count what it reads, so that how much it reads can be stated and checked.

- The mod SHALL count, in memory and by source: reads, host processes started, HTTP calls, bytes answered, failures, slow answers, reads skipped (the view not shown, the pane off view, no metrics address) and the outcomes of the shared gate (hit, fetched, claimed elsewhere, backoff, held), and SHALL keep the durations of the last 64 reads, calls or processes of each for p50, p95 and the longest.
- Every host process the mod starts SHALL be started through one function, and every Prometheus call through one other, so that none is missed.
- `/factory show fetch` SHALL print those counts as a table with a total of processes, HTTP calls and bytes, and SHALL start no read and no process.
- Where `FACTORY_PANEL_METER` is set to anything but empty or `0`, the mod SHALL write the counts to `~/.ix/factory-panel/meter-<session>.json` at most every 5 minutes, and after each Linear read the shared gate really ran SHALL record the Linear requests and query complexity `ix-board --json cache status` (`quota.requests_used`, `quota.complexity_used`) shows were spent since the last such sample, counting a drop as nothing spent. That spend is approximate: the counters are the whole machine's, so Linear calls another session or process makes in between are counted too, and the file says so. Where it is not set the mod SHALL write no meter file and SHALL ask ix-board for no counters.
- Counting SHALL NOT change when or what a source is read.
- The budgets below are upper bounds of what the mod reads on a scripted timeline of a fake clock in 5 second steps. A change to what is read lowers its bound and records the number it had before.

| Timeline | Before (0.10.2) | Budget (0.10.3) |
|----------|-----------------|-----------------|
| Factory pane, ix-board chip closed, 10 minutes | 1 `ix-board agents` | none |
| Factory pane, ix-board chip open, Linear rate limited, 1 hour | none while the limit holds, else 2 (30 minutes old) | at most 61 `ix-board agents`, none held by the limit |
| Escalations pane, 100 escalations of which 10 open, 10 minutes | 100 `escalation show`, all at once | at most 10, at most 4 at once |
| Band of the attention cell, the same 100, 10 minutes | 100 `escalation show` | none |
| Focus pane, a chosen focus Linear names, 11 leads, 30 minutes | 11 `work show` every 2 minutes | none |
| Focus pane, 11 leads, 1 hour | 330 `work show` | at most 77 |
| Message pane, 1 hour | 60 reads of 14 days of the log | 1 read of 14 days, at most 60 of the minutes since |
| Message and Focus panes, 1 hour | 90 `agent-msg who` | at most 61 |
| Team pane, 1 hour | 60 reads of the team series | at most 13 |
| Factory pane, Prometheus answering in 3 seconds, 10 minutes | 6 reads (each doubled the wait) | at least 30 reads, none failed |
| Focus pane in herdr, on view, 20 minutes | 80 view checks | at most 11 |
| Factory pane behind another herdr tab, 1 hour | 240 view checks and no other read | the same, the skipped reads counted off view |

## Constraints

| ID | Constraint | Type | Validation |
|----|------------|------|------------|
| FR-027-CON-1 | herdr 0.9.1 gives each attached client its own view and reports only the view of the client that last switched; neither `herdr api snapshot`, `herdr status`, `herdr session list` nor any method or event of its API lists or counts attached clients. Where two or more clients are attached to one herdr server (another window, or another machine's `herdr --machine`), a pane only another client views counts off view, and it still does after the other clients leave until the remaining one switches tab or workspace. A server with no client attached still reports a focused tab, whose sessions count on view. | Environment | Demonstration |
| FR-027-CON-2 | Nothing says whether the terminal window itself is hidden, covered or without focus, nor whether a session herdr's Claude integration has not reported, a session in tmux inside herdr, or one in another multiplexer is on view. These count as on view. A terminal started from a tmux pane inherits `TMUX` and `TMUX_PANE`; where it sets no `TERM_PROGRAM` of its own the mod cannot tell it from that pane. | Environment | Inspection |
| FR-027-CON-3 | Whether the desktop app draws panes that are not on screen, and what `$.ui.panes()` says of them, is not verified. Its drawings count as on view. | Environment | Inspection |

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-027-AC-1 | With nothing drawn, no Prometheus, herdr, `ix-board` or `agent-msg` read other than the identity lookup runs, however long the session runs. | Test |
| FR-027-AC-2 | A session that is not interactive runs no read and no identity lookup. | Test |
| FR-027-AC-3 | With one pane on screen, the sources the table gives that view are read and no other, for each of the six panes and the Factory widget. | Test |
| FR-027-AC-4 | With the band on screen, the sources of the selected modules are read and no other, including a module that draws no cell. | Test |
| FR-027-AC-5 | A pane drawn and then, 150 ms later, behind another tab, unplaced or closed is not read. | Test |
| FR-027-AC-6 | After a view leaves the screen its sources are not read again. | Test |
| FR-027-AC-7 | A view that comes back on screen reads at once when its data is older than the interval, and reads nothing when it is newer. | Test |
| FR-027-AC-8 | A collapsed band, a band under a survey, a fullscreen layout and `inlineView` `off` read nothing for the band; the status line with a collapsed band slot reads. | Test |
| FR-027-AC-9 | With `refreshSeconds` 5 and the Factory pane on screen, `agent-msg doctor` and `herdr api snapshot` run once a minute at most and Prometheus follows the setting. | Test |
| FR-027-AC-10 | A failing source is read after 2, then 4, then 5 minutes where its interval is 1 minute, and every minute again once it answers. | Test |
| FR-027-AC-11 | A source that answers more slowly than its limit, and answers, is next read after one and a half times its interval, never later however many slow answers come in a row. | Test |
| FR-027-AC-12 | The `r` key reads at once while the source is backed off and within its interval. | Test |
| FR-027-AC-13 | Opening a view by command runs no read for data the mod already holds. | Test |
| FR-027-AC-14 | With `agent-msg whoami` failing for 6 minutes it runs at most 6 times, and a command runs it at once. | Test |
| FR-027-AC-15 | A teams value changed by a declaration file reads the lanes again before their interval is up. | Test |
| FR-027-AC-16 | In a real session the log of commands run and queries made shows reads while the panel is open, only the shown tab's after switching tabs, and none once the panel is closed. | Demonstration |
| FR-027-AC-17 | A view drawn while the metrics address is still being looked up sends no Prometheus query, and reads as soon as the address is known, without waiting out a backed off interval. | Test |
| FR-027-AC-18 | With its ix-board chip open, the `r` key of the Factory view reads `ix-board agents` again once 60 seconds have passed since its last read, and not before. | Test |
| FR-027-AC-19 | No `team X matched nothing` note is drawn unless both the focus reports and `ix-board agents` for team X have been read. | Test |
| FR-027-AC-20 | A herdr snapshot counts the session off view only where its panes are all on tabs other than the focused one or under another zoomed pane; every pane of the focused tab counts on view. | Test |
| FR-027-AC-21 | A herdr or tmux command that fails, or an answer that does not say, leaves a drawn view reading. | Test |
| FR-027-AC-22 | A tmux answer counts the pane off view where no client views its window or another pane is zoomed over it, and on view where any one of several attached clients views it. | Test |
| FR-027-AC-23 | With the pane behind another herdr tab or tmux window nothing is read through a drawing, and what is due is read within 16 seconds of its coming back. | Test |
| FR-027-AC-24 | The check runs at most once in 15 seconds, and not while no drawn view has a read due of a source other than the selection. | Test |
| FR-027-AC-25 | With neither herdr nor tmux, with both, with a `TMUX_PANE` and no `TMUX` or another `TERM_PROGRAM`, or with `FACTORY_PANEL_VIEW_CHECK` `off`, no check runs and a drawn view reads. | Test |
| FR-027-AC-26 | The `r` key reads while the pane is off view. | Test |
| FR-027-AC-27 | A desktop pane or widget reads on being drawn, without a view check and whatever `$.ui.panes()` says. | Test |
| FR-027-AC-28 | In real herdr and tmux sessions a panel that is behind another tab, or in a session nobody is attached to, makes no read other than the view check, and reads again when it comes back. | Demonstration |
| FR-027-AC-29 | With `openOnStart` and `inlineView` at their defaults (off), a session opens no pane at start, draws no band and reads no pane source (no Prometheus, ix-board or agent-msg work read) until `/factory` opens a view. | Test |
| FR-027-AC-30 | `/factory show fetch` reports as many processes and HTTP calls as were run and made, and each source's process count is that of its commands. | Test |
| FR-027-AC-31 | Without `FACTORY_PANEL_METER` no meter file is written and no counters are asked of ix-board; with it the file is written at most every 5 minutes and the Linear requests spent by the gated reads after the first are recorded. | Test |
| FR-027-AC-32 | The Factory pane with its ix-board chip closed runs no `ix-board agents`; opening the chip reads it within 20 seconds, and closing it stops the reads. | Test |
| FR-027-AC-33 | With the chip open for an hour while Linear's rate limit holds, `ix-board agents` runs at least 50 and at most 61 times, no gate outcome is a backoff and no Linear spend is sampled; an answer another session read 30 seconds ago is used without a read; an `ix-board agents` that takes 8 seconds still runs at least 55 times in the hour, and only `agents-gate.json` is written for it. | Test |
| FR-027-AC-34 | With 100 escalations of which 10 are open, the Escalations pane runs exactly 10 `escalation show` in 10 minutes, at most 4 at once, and Resolve all offers the 10 recommendations; an open row whose detail is not yet read is drawn as being read, and neither Resolve all nor its own resolve sends it or counts it as having no recommendation. | Test |
| FR-027-AC-35 | A band of the attention cell alone runs `agent-msg escalations` and no `escalation show`. | Test |
| FR-027-AC-36 | A chosen focus that Linear names, with 10 more leads listed, is drawn in 30 minutes without a `work show`. | Test |
| FR-027-AC-37 | The Focus pane with 11 leads runs at most 77 `work show` in an hour, and the refresh key reads every lead at once. | Test |
| FR-027-AC-38 | The Message pane reads 14 days of the log once in an hour and otherwise at most 60 times the minutes since; with the Focus pane beside it `agent-msg who` runs at most 61 times in the hour; a later read that reaches its 500 messages is followed at once by a full read. | Test |
| FR-027-AC-39 | The Team pane reads its series at most 13 times in an hour. | Test |
| FR-027-AC-40 | A Prometheus that answers every query in 3 seconds is read at least 30 times in 10 minutes with `refreshSeconds` 15, with no failure and at most one slow answer. | Test |
| FR-027-AC-41 | The Focus pane on view in herdr runs at most 11 view checks in 20 minutes while its focus is read at least 9 times. | Test |
| FR-027-AC-42 | A Factory pane behind another herdr tab for an hour runs at most 241 view checks, no Prometheus call, no `agent-msg doctor` and no `ix-board`, and the meter counts the skipped Prometheus reads as off view. | Test |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md)
- **See also**: [FR-004](FR-004-detail-view.md), [FR-007](FR-007-endpoint-discovery.md), [FR-009](FR-009-band-cells.md), [FR-016](FR-016-isolated-selectors.md), [FR-025](FR-025-per-project-last-good.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
