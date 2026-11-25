# factory-panel

factory-panel is a Claude Code plugin that keeps the state of an Agent IX factory in view while you work: what is wrong, how far your project has come and what needs you.

## What you see

In the classic layout there is one line above the prompt. Each cell on it starts with a number and shows one thing: machines up or down, this machine's load, your focus and its progress, tickets ready, the lead, the lanes, escalations waiting, relay problems, team velocity. A cell with nothing to report is left out. A machine that has not reported shows as no data, never as healthy.

In the fullscreen layout the same views are docked at the right of the chat as tabs and there is no line above the prompt.

The views behind the cells are:

| View | Shows |
| --- | --- |
| Factory | Each machine's up or down, CPU, memory and temperature, agents by status, 24-hour spend, and the herdr, ix-relay and ix-board state |
| Focus | One card per named focus: its initiatives with their projects nested under them, progress, Ready and Blocked, and one warning icon |
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
| `/factory focus team` | Show the leads of your teams, grouped by team. `own` shows your own focus. Any other text is a name, resolved as described under Name resolution below |
| `/factory teams QSL,ENG` | The teams whose leads and lanes show. A team that matches nothing is kept and the band says so |
| `/factory hosts all` | `all` shows every machine (and puts the host list first), `local` only this one |
| `/factory show` | Prints each feature, its value and whether it came from you, a declaration or the default, with the session key |
| `/factory reset` | Clears your choices |

Your choices are kept in `~/.ix/factory-panel/choices/<key>.json`. The key is the relay address with `:` and any character outside letters, digits, `_`, `.` and `-` replaced by `_` (`host1:QSL:code` is `host1_QSL_code`), or `default` when the session has no placement. Without a file for the key the mod reads `default.json` in the same folder.

A skill selects cells for its agent by telling it to write `~/.ix/factory-panel/features/<key>.json` for its own key. The file is a JSON object with the optional keys `modules`, `hosts`, `focus` and `teams`. Writing it replaces everything an earlier write selected, and the mod re-reads it on every refresh. `/factory help` prints a snippet to paste into a skill. A file that is not a JSON object, or a value of the wrong kind, is ignored with one note naming the file and the reason. The mod never writes a declaration.

The first line of the Focus pane, and a line of `/factory show`, says why these focuses are shown: `your choice: <name>`, `could not tell who this session is, showing every focus`, `own focus`, `team focuses` or `no focus reported, showing the whole team`. A name that matches nothing adds the line `no focus matches "<name>"`.

### Name resolution

`/factory focus <name>` looks the name up in this order and stops at the first step that matches:

1. The keywords `own` and `team`.
2. A named focus definition. The mod reads them with `agent-msg focuses list --json` and then `agent-msg focuses show <focus_id> --json` for the match, and never creates, changes or archives one. A definition matches by its name or its `focus_id`, ignoring case, when it is active and belongs to your team (every team when the relay cannot tell who you are). Its progress is computed over its `include` members. Exclusions are not applied, and the pane says so. A definition that selects nothing, or whose selection cannot be read, is named with that reason and shows no progress. Two definitions with the same name are both shown, with the count. A row `list` marks unavailable matches by its `focus_id` only and shows the reason.
3. A lead address, as `host:team:segment` or `team:segment`, ignoring case. A `team:segment` that matches leads on several hosts shows every match, with the count.
4. A lead's focus summary: the summary equal to the name ignoring case, else those that contain it.

The lookup runs again on every refresh while your choice is a name, so a definition whose members change is followed. If `agent-msg focuses` fails, times out (after 5 seconds) or prints something that is not JSON, the pane shows its error and carries on with steps 3 and 4. No named focus needs to exist.

### When a source fails

Each source keeps to its own part of the view. ix-board is asked for one project per call (`ix-board --json focus status --project <ref>`), so a project with bad data, such as a ticket that references a milestone that is not available, fails alone and the other projects draw. At most four ix-board processes run at once across every focus, each call is given up on after 20 seconds, and a refresh ends after 60 seconds. An ix-board that is missing, times out before it has answered anything or refuses your credentials shows one error and no more calls.

An initiative of the focus is expanded to its projects first: from `ix-board --json roadmap` (by id where the roadmap lists ids, else by the initiative's exact name), else by one `focus status --initiative <uuid>` call whose projects are used as they come, else from the project list cached in `progress.json`. An initiative that cannot be expanded is one row, `projects unknown`, and the projects the focus lists directly are still drawn. The initiative row reads `X of Y projects`, is marked partial only when a project is missing, and says `includes old data (oldest 5m)` where a counted project is drawn from its record. The header sums every distinct counted project once and prints the stage counts; it is never drawn as complete while a part is missing, old or not expanded.

Each initiative shows its projects indented beneath it with a bar, `done/total`, Remaining, Ready and Blocked, and can be collapsed; completed projects are hidden unless shown. Errors never appear in the card body. One warning, `⚠ N`, sits on the freshness row of the card, and the key `e` expands it into the full messages with ticket, milestone and project. `/factory show` lists the same errors.

A project whose call failed shows its last good progress marked old with its age (`old 5m`, `stale` past 30 minutes) and counts in its initiative; one with no record of at most 24 hours is shown failed, under its name, with no counts. A refresh with a failure in it is held for 5 minutes and marked as an earlier outcome; the refresh key always asks at once. A Linear rate limit is one ix-board error with no further calls. A lead whose work report has no initiatives, projects or tickets says `no selectors`.

Known limitation (SWM-295, SWM-296): ix-board fails a whole initiative call when one ticket references a milestone missing from its project, and the roadmap lists names, not ids. An initiative scoped by UUID that has this defect, such as FSL Hardening, cannot be expanded until the data is fixed, the roadmap carries ids, or a project list was cached while it worked.

The last good progress is kept in `~/.ix/factory-panel/progress.json`, shared by the sessions on the machine, by project id with the project's name, and with the project list of each initiative under the key `initiatives`; a record is dropped when no refresh has shown it for 24 hours. Errors of the other sources (`agent-msg work`, `agent-msg focuses`, Prometheus) are shown on the card of the module that uses them, and `/factory show` lists every failing source with its error and the age of its last success. A failing source never blocks another or the first paint.

All of the mod's own files are under `~/.ix/factory-panel/`: the choices, the declarations it reads, the last good progress and the Linear rate-limit cache.

## Advanced settings

All settings are optional and appear in the config menu.

| Setting | What it does |
| --- | --- |
| `inlineView` | What a classic session shows: band, status or off |
| `prometheusUrl` | Prometheus to query. Empty uses the shared ix config, then this host's relay endpoint, then the factory's |
| `grafanaUrl` | Grafana for dashboard links. Empty follows Prometheus's name |
| `teams` | Comma-separated herdr workspace labels. The ix-board query list for a session the relay cannot identify, used only when no choice or declaration names teams. For such a session the board is fetched for these teams alone, so lanes show only them |
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
