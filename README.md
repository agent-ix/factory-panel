# factory-panel

Panes beside the Claude Code chat for running the Agent IX factory. Each pane is a tab and
refreshes in place.

| Pane | Command | Shows | Source |
| --- | --- | --- | --- |
| Factory | `/factory` | Each machine's up/down, CPU, memory and temperature gauges, agents by status, and 24-hour spend. Also herdr, ix-relay health and ix-board team activity tiles. | Prometheus; `herdr api snapshot`; `agent-msg doctor`; `ix-board agents` |
| Focus | `/focuses` | One card per named focus: the coordinator's focus line, overall progress, open projects with progress bars, items in progress and ready | The coordinator's `agent-msg work` report; `ix-board focus status` over its scope |
| Relay | `/relay` | Escalations by status, with context, options and recommendation. Resolve or investigate one, and send announcements to every lead or one lead. | `agent-msg escalations`, `escalation show`, `resolve`, `investigate`, `send`, `log` |
| Team | `/team` | Velocity and quality tiles per team with six-hour sparklines | The `ix_team_*` series behind Grafana's "Team flow and effort" dashboard |

Anything that leaves the Relay pane (resolve, investigate, send) takes a second press to confirm.

## Setup

Point Claude Code at this folder, for example in `~/.claude/settings.json`:

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
