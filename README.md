# factory-panel

factory-panel is a Claude Code plugin that keeps the state of an Agent IX factory in view while you work: what is wrong, how far your project has come and what needs you.

## What you see

In the classic layout there is one line above the prompt. Each cell on it starts with a number and shows one thing: machines up or down, this machine's load, your focus and its progress, tickets ready, the lead, the lanes, escalations waiting, relay problems, team velocity. A cell with nothing to report is left out. A machine that has not reported shows as no data, never as healthy.

In the fullscreen layout the same views are docked at the right of the chat as tabs and there is no line above the prompt.

The views behind the cells are:

| View | Shows |
| --- | --- |
| Factory | Each machine's up or down, CPU, memory and temperature, agents by status, 24-hour spend, and the herdr, ix-relay and ix-board state |
| Focus | One card per named focus: its progress, open projects, items in progress and ready |
| Escalations | What the leads escalated, open first, with context, options and recommendation |
| Relay | Announcements to every lead or one lead, and the recent broadcasts |
| Team | Velocity and quality tiles per team with six-hour history |

## How to use it

- Open more: type `/factory`. It opens the view your role looks at first: Focus for a code lead or planner, Factory for a coordinator or worker. `/factory focus`, `/factory escalations`, `/factory relay`, `/factory team` and `/factory factory` open one view directly.
- Switch: with a view open in the classic layout, type a cell's number at an empty prompt. A number typed while the prompt holds text goes into the prompt. In the fullscreen layout, click a tab or type `/factory` and the view name.
- Refresh and close: `r` refreshes the open view and Esc closes it and gives the keyboard back to the prompt.
- Help: `/factory help` answers these questions in the words of your layout.
- Older commands `/focuses`, `/escalations`, `/relay` and `/team` still work as aliases for one release.

## Roles

The plugin shows what your role needs. The first time you type `/factory` in a project it asks what you do in that session, remembers the answer for the directory and does not ask again. `/factory role` asks again. Starting a session never asks.

| Role | Band cells |
| --- | --- |
| coordinator | health, focus, attention, relay |
| code-lead | local, focus, lead, lanes |
| planner | focus, queue, lead |
| worker | local |

The role comes from, in order: the `role` setting, the relay address of the session, the stored answer, then the question. A session with no role known is treated as a code lead until it is answered.

## Advanced settings

All settings are optional and appear in the config menu.

| Setting | What it does |
| --- | --- |
| `role` | Fixes the role: coordinator, code-lead, planner, worker, or auto |
| `bandModules` | Comma list that replaces the role's cells, in the order written |
| `bandFocus` | The focus the band bar follows: an address or part of its summary |
| `inlineView` | What a classic session shows: band, status or off |
| `prometheusUrl` | Prometheus to query. Empty uses the shared ix config, then this host's relay endpoint, then the factory's |
| `grafanaUrl` | Grafana for dashboard links. Empty follows Prometheus's name |
| `teams` | Comma-separated herdr workspace labels ix-board should report on |
| `refreshSeconds` | How often Prometheus and herdr are polled |

ix-board reads share a rate-limit gate across sessions on a machine. It keeps each read's result and any Linear retry time in `~/.cache/factory-panel/linear-gate.json`, runs each read at most once every 15 minutes (60 seconds for a manual refresh) and calls ix-board again only after a Linear rate limit has passed.

## Install

```bash
claude plugin install factory-panel --marketplace agent-ix/factory-panel
```

Or from the agent-ix marketplace:

```bash
claude plugin marketplace add agent-ix/agent-plugins
claude plugin install factory-panel@agent-ix
```

## Developing

Point Claude Code at this folder with `claude --plugin-dir ~/dev/factory-panel`, then:

```bash
claude plugin validate .
claude plugin test .
node tests/e2e/layouts.mjs
```

The last command drives real sessions in tmux in both layouts and saves captures under `tests/e2e/evidence/`. Requirements and their tests are in `spec/`; see `docs/STYLE.md` for the colours, spacing and widgets the views share.
