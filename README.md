# factory-panel

factory-panel is a Claude Code plugin that keeps the state of an Agent IX factory in view while you work: what is wrong, how far your project has come and what needs you.

## What you see

In the classic layout there is one line above the prompt. Each cell on it starts with a number and shows one thing: machines up or down, this machine's load, your focus and its progress, tickets ready, the lead, the lanes, the work in hand (tickets, open PRs, merges of the last 24 hours), escalations waiting, relay problems, team velocity. A cell with nothing to report is left out. A machine that has not reported shows as no data, never as healthy. The work cell reads `N tickets · M PRs open · K merged 24h`; `—` is a number that is not known, and `≥` one that may be short (a lead whose report was never read, a ticket whose PRs ix-board does not name, or more merges than ix-board lists).

In the fullscreen layout the same views are docked at the right of the chat as tabs and there is no line above the prompt.

The views behind the cells are:

| View | Shows |
| --- | --- |
| Factory | Each machine's up or down, CPU, memory and temperature, agents by status, 24-hour spend, and the herdr, ix-relay and ix-board state |
| Focus | One card per named focus: its initiatives with their projects nested under them, progress, Ready and Blocked, and one warning icon |
| Work | Each code lead with its tickets: Linear state, title, `[pr]`, `[review×N]`, `[spec]` and `[gate]` badges and the last action; below them the recent merges (`a` shows every kind: closed and opened entries, and the reviews, specs and gates that started or finished, read from the relay every 30 seconds; half of the ten rows are held for these, so busy ticket activity does not hide them). A lead that cannot be read shows `▲` with `not read`, or `old` with the age of the report drawn. Needs ix-board 0.9.0 for PRs and merges; without it the tickets show without a PR badge |
| Escalations | What the leads escalated, open first, with context, options and recommendation |
| Message (`/factory relay`) | A message to every lead or one lead, and the recent broadcasts |
| Team | Tiles per team with six-hour history in three rows (velocity and effort, review quality, flow and capacity), and the health of your teams' departments from their stored retro snapshots, or `no retro baseline`. A series the exporter does not publish reads `—`, never 0 |

## How to use it

- Open more: type `/factory`. It opens Focus when the focus cell is shown and Factory otherwise. `/factory focus`, `/factory work`, `/factory escalations`, `/factory relay`, `/factory team` and `/factory factory` open one view directly.
- Switch: with a view open in the classic layout, type a cell's number at an empty prompt. A number typed while the prompt holds text goes into the prompt. In the fullscreen layout, click a tab or type `/factory` and the view name.
- Refresh and close: `r` refreshes the open view and Esc closes it and gives the keyboard back to the prompt.
- Reading: the mod reads a source only while a view that draws it is on screen, and catches up when the view appears. In herdr and tmux that excludes a session whose pane is off view.
- Help: `/factory help` answers these questions in the words of your layout.
- Older commands `/focuses`, `/escalations`, `/relay` and `/team` still work as aliases for one release.

## Choosing what to show

The mod asks no question. It reads who the session is from the relay (`agent-msg whoami`, an address like `host:TEAM:segment`) and shows this machine, your own focus and your own team's lanes: the cells local, focus, lead and lanes. If the relay does not answer within five seconds the band is drawn anyway, shows everything, and says it could not tell who this session is.

What is shown is decided one feature at a time, from the first of these that selects it:

1. Your choice, made with `/factory`.
2. A declaration an agent wrote for this session, usually because a skill told it to.
3. The automatic view from the relay.

The features are the cells (`health`, `local`, `lanes`, `agents`, `spend`, `focus`, `queue`, `lead`, `work`, `attention`, `relay`, `team`), the hosts scope (`all` or `local`), the focus scope (`own`, `team` or a focus name) and the teams list.

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

The first line of the Focus pane, and a line of `/factory show`, says why these focuses are shown: `your choice: <name>`, `could not tell who this session is, showing every focus`, `own focus`, `team focuses` or `no focus reported, showing the whole team`. A name that matches nothing adds the line `no focus matches "<name>"`. `/factory show` and a choice command read the focuses themselves when no view has, through the same gates, and wait up to 5 seconds. Until a read has ended they say `focus data: not read yet` and claim neither that no focus is reported nor that none matches; afterwards they say how old the data is.

### Name resolution

`/factory focus <name>` looks the name up in this order and stops at the first step that matches:

1. The keywords `own` and `team`.
2. A named focus definition. The mod reads them with `agent-msg focuses list --json` and then `agent-msg focuses show <focus_id> --json` for the match, and never creates, changes or archives one. A definition matches by its name or its `focus_id`, ignoring case, when it is active and belongs to your team (every team when the relay cannot tell who you are). Its progress is computed over its `include` members. Exclusions are not applied, and the pane says so. A definition that selects nothing, or whose selection cannot be read, is named with that reason and shows no progress. Two definitions with the same name are both shown, with the count. A row `list` marks unavailable matches by its `focus_id` only and shows the reason.
3. A lead address, as `host:team:segment` or `team:segment`, ignoring case. A `team:segment` that matches leads on several hosts shows every match, with the count.
4. A lead's focus summary: the summary equal to the name ignoring case, else those that contain it.

The lookup runs again on every refresh while your choice is a name, so a definition whose members change is followed. If `agent-msg focuses` fails, times out (after 5 seconds) or prints something that is not JSON, the pane shows its error and carries on with steps 3 and 4. No named focus needs to exist.

### When a source fails

The leads' work reports are read once for the Focus and Work views, at most eight at a time, each given 20 seconds since a lead on another machine is reached through ssh; a Redis, herdr or ssh failure that may pass is tried once more. A lead that cannot be read is drawn from the report last read and marked old, or listed as not read.

Each source keeps to its own part of the view. ix-board is asked about all the projects of a focus in one call (`ix-board --json focus status --project <ref> --project <ref>`), and about each milestone and ticket on its own. At most four ix-board processes run at once across every focus, each call is given up on after 20 seconds, and a refresh ends after 60 seconds. An ix-board that is missing, refuses your credentials, does not answer the combined call in time or is rate limited by Linear shows one error and no more calls; such an error is never blamed on a project.

A project with bad data, such as a ticket that references a milestone that is not available, makes the whole combined call fail. The mod finds it (from the id in the error, else by asking for halves, in at most 12 further calls), remembers it in `known-bad.json` for every session, leaves it out of the combined call, and asks for it alone at most once an hour or when you press the refresh key. The other projects draw. Where no status call answers at all and the errors do not name every project, that is taken for ix-board's own trouble: one error, nothing remembered, and another try after 5 minutes.

An initiative of the focus is expanded to its projects first: from the project list cached in `progress.json` while that is less than 6 hours old, else from `ix-board --json roadmap` (by id where the roadmap lists ids, else by the initiative's exact name), else by one `focus status --initiative <uuid>` call whose projects are used as they come, else from the older cached list. An initiative that cannot be expanded is one row, `projects unknown`, and the projects the focus lists directly are still drawn; it is tried again after an hour. The initiative row reads `X of Y projects`, is marked partial only when a project is missing, and says `includes old data (oldest 5m)` where a counted project is drawn from its record. The header sums every distinct counted project once and prints the stage counts; it is never drawn as complete while a part is missing, old or not expanded.

Each initiative shows its projects indented beneath it with a bar and `done/total`, and can be collapsed; Remaining, Ready and Blocked are in the expanded warning and in `/factory show`; completed projects are hidden unless shown. A combined answer does not say which project a blocker belongs to, so a project asked together with others shows `-` for Blocked, and the header counts each open blocker of the focus once. Ready of an initiative, of the header and of the band's queue cell is `-` while any counted project's Ready is unknown, never a smaller number. Errors never appear in the card body. One warning, `⚠ N`, sits on the freshness row of the card; clicking it expands the full messages with ticket, milestone and project, the banner and the notes of the card. `/factory show` lists the same errors.

Progress is read at most once every 30 minutes across all sessions on the machine; the refresh key asks again once 60 seconds have passed. A project that fails shows its last good progress as a normal row with a dim age after its counts (`13m`; the age is in the warning tone past 60 minutes) and counts in its initiative; one with no record of at most 24 hours is shown failed, under its name, with no counts. A failed project does not shorten the 30 minutes. Only an error of the source holds the refresh for 5 minutes instead, marked as an earlier outcome, and the refresh key asks again at once. An error the mod only infers from refusals, which could be a project's doing, is held twice as long each time it repeats, up to 30 minutes, and the key asks after 60 seconds. A Linear rate limit is one ix-board error with no further calls until its time has passed. A lead whose work report has no initiatives, projects or tickets says `no selectors`.

Known limitation (SWM-295, SWM-296): ix-board fails a whole call when one ticket references a milestone missing from its project, and the roadmap lists names, not ids. An initiative scoped by UUID that has this defect, such as FSL Hardening, cannot be expanded until the data is fixed, the roadmap carries ids, or a project list was cached while it worked.

The last good progress is kept in `~/.ix/factory-panel/progress.json`, shared by the sessions on the machine, by project id with the project's name, and with the project list of each initiative under the key `initiatives`; a record is dropped when no refresh has shown it for 24 hours. Errors of the other sources (`agent-msg work`, `agent-msg focuses`, Prometheus) are shown on the card of the module that uses them, and `/factory show` lists every failing source with its error and the age of its last success. A failing source never blocks another or the first paint.

All of the mod's own files are under `~/.ix/factory-panel/`: the choices, the declarations it reads, the last good progress, the known-bad selectors and the Linear rate-limit cache.

## Advanced settings

All settings are optional and appear in the config menu.

| Setting | What it does |
| --- | --- |
| `inlineView` | What a classic session shows: band, status or off |
| `prometheusUrl` | Prometheus to query. Empty uses the shared ix config, then this host's relay endpoint, then the factory's |
| `grafanaUrl` | Grafana for dashboard links. Empty follows Prometheus's name |
| `teams` | Comma-separated herdr workspace labels. The ix-board query list for a session the relay cannot identify, used only when no choice or declaration names teams. For such a session the board is fetched for these teams alone, so lanes show only them |
| `refreshSeconds` | How often Prometheus is polled and the declaration and choice files are re-read while a view that draws them is on screen. herdr and `agent-msg doctor` are read once a minute, or at this interval where it is longer |

ix-board reads of Linear (progress, the roadmap and `ix-board agents`) share a gate across sessions on a machine. It keeps each read's result and any Linear retry time in `~/.ix/factory-panel/linear-gate.json`, runs each read at most once every 30 minutes (60 seconds for a manual refresh, 5 minutes after an error of the source) and calls ix-board again only after a Linear rate limit has passed. The file is replaced whole, and a write drops entries nobody has read for a day (those of 0.7.0, after an hour). A cache an earlier version left in `~/.cache/factory-panel/` is read once as the starting point and never written.

A source that fails or answers slowly is read less often, up to every 5 minutes.

The engine draws into a terminal whether or not it can be seen, so before reading for a terminal view the mod asks herdr (`herdr api snapshot`) or tmux (`tmux display-message`), at most once every 15 seconds. Nothing is read while herdr shows another tab (or another pane zoomed over this one), or while no tmux client is viewing the window; reads resume within 15 seconds of coming back, and `r` always reads. Where the answer is unknown the mod reads: outside herdr and tmux, with tmux inside herdr, without herdr's Claude integration, or when the command fails. A terminal window that is hidden or covered counts as on screen.

With two or more clients attached to one herdr server (a second window, or another machine's `herdr --machine`), herdr reports only the view of the client that last switched. A panel that only another client views stops reading until that client switches tab, also after the other clients leave. Set the environment variable `FACTORY_PANEL_VIEW_CHECK=off` to read wherever a view is drawn.

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
node tests/e2e/onscreen.mjs
```

`static.check.ts` checks this README and the hotkeys against the plugin's source. `layouts.mjs` drives real sessions in tmux in both layouts and saves captures under `tests/e2e/evidence/`. `onscreen.mjs [seconds-per-phase] [plugin-folder]` logs every read made while views are on and off screen, including behind another herdr tab (on a herdr server of its own) and in a tmux session nobody is attached to, against stand-in commands and a stand-in metrics service. Requirements and their tests are in `spec/`; see `docs/STYLE.md` for the colours, spacing and widgets the views share.
