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

- Open more: type `/factory`. It opens Focus when the focus cell is shown and Factory otherwise. `/factory focus`, `/factory escalations`, `/factory relay`, `/factory team` and `/factory factory` open one view directly.
- Switch: with a view open in the classic layout, type a cell's number at an empty prompt. A number typed while the prompt holds text goes into the prompt. In the fullscreen layout, click a tab or type `/factory` and the view name.
- Refresh and close: `r` refreshes the open view and Esc closes it and gives the keyboard back to the prompt.
- Help: `/factory help` answers these questions in the words of your layout.
- Older commands `/focuses`, `/escalations`, `/relay` and `/team` still work as aliases for one release.

## Choosing what to show

The mod asks no question. It reads who the session is from the relay (`agent-msg whoami`, an address like `host:TEAM:segment`) and shows this machine, your own focus and your own team's lanes: the cells local, focus, lead and lanes. If the relay does not answer within five seconds the band is drawn anyway, shows everything, and says it could not tell who this session is.

What is shown is decided one feature at a time, from the first of these that selects it:

1. Your choice, made with `/factory`.
2. A declaration an agent wrote for this session, usually because a skill told it to.
3. The automatic view from the relay.

The features are the cells (`health`, `local`, `lanes`, `agents`, `spend`, `focus`, `queue`, `lead`, `attention`, `relay`, `team`), the hosts scope (`all` or `local`), the focus scope (`own`, `team` or a focus name) and the teams list.

| Command | Effect |
| --- | --- |
| `/factory use queue,lanes` | Show these cells, in this order |
| `/factory focus team` | Show the leads of your teams, grouped by team. `own` shows your own focus. Any other text, such as `/factory focus Release Train`, shows the focus whose summary equals it ignoring case, else those that contain it, and says how many matched |
| `/factory teams QSL,ENG` | The teams whose leads and lanes show. A team that matches nothing is kept and the band says so |
| `/factory hosts all` | `all` shows every machine (and puts the host list first), `local` only this one |
| `/factory show` | Prints each feature, its value and whether it came from you, a declaration or the default, with the session key |
| `/factory reset` | Clears your choices |

Your choices are kept in `~/.ix/factory-panel/choices/<key>.json`. The key is the relay address with `:` and any character outside letters, digits, `_`, `.` and `-` replaced by `_` (`host1:QSL:code` is `host1_QSL_code`), or `default` when the session has no placement. Without a file for the key the mod reads `default.json` in the same folder.

A skill selects cells for its agent by telling it to write `~/.ix/factory-panel/features/<key>.json` for its own key. The file is a JSON object with the optional keys `modules`, `hosts`, `focus` and `teams`. Writing it replaces everything an earlier write selected, and the mod re-reads it on every refresh. `/factory help` prints a snippet to paste into a skill. A file that is not a JSON object, or a value of the wrong kind, is ignored with one note naming the file and the reason. The mod never writes a declaration.

All of the mod's own files are under `~/.ix/factory-panel/`: the choices, the declarations it reads and the Linear rate-limit cache.

## Advanced settings

All settings are optional and appear in the config menu.

| Setting | What it does |
| --- | --- |
| `inlineView` | What a classic session shows: band, status or off |
| `prometheusUrl` | Prometheus to query. Empty uses the shared ix config, then this host's relay endpoint, then the factory's |
| `grafanaUrl` | Grafana for dashboard links. Empty follows Prometheus's name |
| `teams` | Comma-separated herdr workspace labels. Only the ix-board query list for a session the relay cannot identify, and only when no choice or declaration names teams; it never narrows what is shown |
| `refreshSeconds` | How often Prometheus and herdr are polled, and the declaration and choice files are re-read |

ix-board reads share a rate-limit gate across sessions on a machine. It keeps each read's result and any Linear retry time in `~/.ix/factory-panel/linear-gate.json`, runs each read at most once every 15 minutes (60 seconds for a manual refresh) and calls ix-board again only after a Linear rate limit has passed. A cache an earlier version left in `~/.cache/factory-panel/` is read once as the starting point and never written.

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
node --test tests/e2e/static.check.ts
node tests/e2e/layouts.mjs
```

`static.check.ts` checks this README and the hotkeys against the plugin's source. `layouts.mjs` drives real sessions in tmux in both layouts and saves captures under `tests/e2e/evidence/`. Requirements and their tests are in `spec/`; see `docs/STYLE.md` for the colours, spacing and widgets the views share.
