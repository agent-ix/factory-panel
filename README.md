# factory-panel

factory-panel is a Claude Code plugin that adds panes beside the chat for running the Agent IX factory. Each pane is a tab and refreshes in place.

| Pane | Command | Shows | Source |
| --- | --- | --- | --- |
| Factory | `/factory` | Each machine's up/down, CPU, memory and temperature gauges, agents by status, and 24-hour spend. Also herdr, ix-relay health and ix-board team activity tiles. | Prometheus; `herdr api snapshot`; `agent-msg doctor`; `ix-board agents` |
| Focus | `/focuses` | One card per named focus: the coordinator's focus line, overall progress, open projects with progress bars, items in progress and ready | The coordinator's `agent-msg work` report; `ix-board focus status` over its scope |
| Escalations | `/escalations` | What the leads escalated, open first, with context, options and recommendation. One press resolves a row with its recommendation or hides it; the header has Hide all and Resolve all. | `agent-msg escalations`, `escalation show`, `resolve`, `investigate`, `send` |
| Relay | `/relay` | Announcements: send to every lead or one lead, and the recent broadcasts. | `agent-msg send`, `log`, `who` |
| Team | `/team` | Velocity and quality tiles per team with six-hour sparklines | The `ix_team_*` series behind Grafana's "Team flow and effort" dashboard |

In the Escalations pane, Resolve on a row sends that row's recommendation in one press. Resolve all sends each open row's own recommendation after a confirm that names the count, skips rows with none and says how many, and reports any item that failed without stopping the rest. Hide and Hide all are local: nothing is sent, and a hidden row comes back if its status changes. A typed decision, a reply, an investigate and a Relay send take a second press to confirm.

ix-board reads share a rate-limit gate across sessions on a machine: it keeps each read's result and any Linear retry time in `~/.cache/factory-panel/linear-gate.json` (under `$HOME`), runs each read at most once every 15 minutes (60 seconds for a manual refresh), and calls ix-board again only after a Linear rate limit has passed.

## Install

```bash
claude plugin install factory-panel --marketplace agent-ix/factory-panel
```

Once the plugin is in the agent-ix marketplace, you can install it from there instead:

```bash
claude plugin marketplace add agent-ix/agent-plugins
claude plugin install factory-panel@agent-ix
```

## Setup

For development, point Claude Code at this folder, for example in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/dev/factory-panel" } }
```

Options appear in the config menu: Prometheus URL, Grafana URL, the ix-board teams for the
Factory pane, and the Factory refresh interval.

## Developing

```bash
claude plugin validate .
claude plugin test .
```

Style: see [docs/STYLE.md](docs/STYLE.md) for the colours, spacing, number formats and widgets the panes share.
