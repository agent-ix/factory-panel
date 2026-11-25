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
- A pane counts only where `$.ui.panes()` still lists it shown and placed 150 ms after the drawing.
- The band counts only in the classic layout with `inlineView` `band` or `status`, and only while no survey holds it.
- A collapsed band does not count where `inlineView` is `band`; the status line counts whether or not the band slot is collapsed.
- The mod SHALL redraw its sites at least every 15 seconds, or every `refreshSeconds` where that is shorter, so that a view that stays on screen keeps being read.
- The mod SHALL start no read from a timer or from session start other than through a drawing, except the identity lookup of an interactive session at start.
- A session that is not interactive SHALL run no identity lookup and no read.

### What each view reads

| View | Sources |
|------|---------|
| Factory pane | selection, Prometheus machines, `herdr api snapshot`, `agent-msg doctor`, `ix-board agents` |
| Factory widget | Prometheus machines, `herdr api snapshot`, `agent-msg doctor` |
| Focus pane | selection, focus |
| Escalations pane | `agent-msg escalations` and `escalation show` |
| Relay pane | `agent-msg log` and `agent-msg who` |
| Team pane | Prometheus team series |
| Band cells `health`, `local`, `agents`, `spend` | Prometheus machines |
| Band cells `focus`, `queue` | focus |
| Band cell `lead` | focus, `ix-board agents` |
| Band cell `lanes` | `ix-board agents` |
| Band cell `attention` | `agent-msg escalations` and `escalation show` |
| Band cell `relay` | `agent-msg doctor` |
| Band cell `team` | Prometheus team series |

- The band SHALL read the sources of every module it is selected to show, including a module that has nothing to say and draws no cell, and the selection.

### How often

| Source | Interval while on screen |
|--------|--------------------------|
| selection (declaration and choice files), Prometheus machines | `refreshSeconds` |
| `herdr api snapshot`, `agent-msg doctor` | 60 seconds, or `refreshSeconds` where that is longer |
| `ix-board agents`, escalations, relay broadcasts, team series | 60 seconds |
| focus | 2 minutes |

- The mod SHALL read a source at once when a view that draws it comes on screen and the data is older than the interval.
- Opening a view by command or band digit SHALL force no read.
- The `r` key of a view SHALL read that view's sources at once.
- A source that fails, or answers more slowly than its limit, SHALL be next read after twice its interval, doubling with each further failure to at most 5 minutes, or its interval where that is longer, and SHALL return to its interval after a read that answers in time. The limits are 2.5 seconds for Prometheus, 5 seconds for herdr, escalations and relay broadcasts, and 10 seconds for `agent-msg doctor`.
- While `agent-msg whoami` has not said who the session is, the mod SHALL ask it again with the same doubling, from `refreshSeconds` to 5 minutes; a command SHALL ask at once.
- A changed focus or teams value SHALL make the focus and `ix-board agents` reads due at the next drawing.
- The Linear-backed reads of `ix-board` stay held by their own 30 minute gate ([FR-025](./FR-025-per-project-last-good.md)); this requirement only decides when the mod asks.
- The mod SHALL raise no toast or notification from a read.

## Constraints

| ID | Constraint | Type | Validation |
|----|------------|------|------------|
| FR-027-CON-1 | The engine does not tell a mod whether the terminal itself can be seen. A detached tmux session, a herdr pane on a tab or workspace that is not on view, and a terminal window that is hidden in the dock, covered or without focus draw as usual, so their views count as on screen. | Environment | Demonstration |

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-027-AC-1 | With nothing drawn, no Prometheus, herdr, `ix-board` or `agent-msg` read other than the identity lookup runs, however long the session runs. | Test |
| FR-027-AC-2 | A session that is not interactive runs no read and no identity lookup. | Test |
| FR-027-AC-3 | With one pane on screen, the sources the table gives that view are read and no other, for each of the five panes and the Factory widget. | Test |
| FR-027-AC-4 | With the band on screen, the sources of the selected modules are read and no other, including a module that draws no cell. | Test |
| FR-027-AC-5 | A pane drawn and then, 150 ms later, behind another tab, unplaced or closed is not read. | Test |
| FR-027-AC-6 | After a view leaves the screen its sources are not read again. | Test |
| FR-027-AC-7 | A view that comes back on screen reads at once when its data is older than the interval, and reads nothing when it is newer. | Test |
| FR-027-AC-8 | A collapsed band, a band under a survey, a fullscreen layout and `inlineView` `off` read nothing for the band; the status line with a collapsed band slot reads. | Test |
| FR-027-AC-9 | With `refreshSeconds` 5 and the Factory pane on screen, `agent-msg doctor` and `herdr api snapshot` run once a minute at most and Prometheus follows the setting. | Test |
| FR-027-AC-10 | A failing source is read after 2, then 4, then 5 minutes where its interval is 1 minute, and every minute again once it answers. | Test |
| FR-027-AC-11 | A source that answers more slowly than its limit is read less often in the same way. | Test |
| FR-027-AC-12 | The `r` key reads at once while the source is backed off and within its interval. | Test |
| FR-027-AC-13 | Opening a view by command runs no read for data the mod already holds. | Test |
| FR-027-AC-14 | With `agent-msg whoami` failing for 6 minutes it runs at most 6 times, and a command runs it at once. | Test |
| FR-027-AC-15 | A teams value changed by a declaration file reads the lanes again before their interval is up. | Test |
| FR-027-AC-16 | In a real session the log of commands run and queries made shows reads while the panel is open, only the shown tab's after switching tabs, and none once the panel is closed. | Demonstration |

## Dependencies

- **Upstream**: [US-001](../usecase/US-001-glance.md), [US-002](../usecase/US-002-open-more.md)
- **See also**: [FR-004](FR-004-detail-view.md), [FR-009](FR-009-band-cells.md), [FR-016](FR-016-isolated-selectors.md), [FR-025](FR-025-per-project-last-good.md), [NFR-004](../non-functional/NFR-004-selection-never-blocks.md)
