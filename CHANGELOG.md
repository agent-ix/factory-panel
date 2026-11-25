# Changelog

## 0.7.1

Fetch less.

- A source is read only while a view that draws it is on screen, and read at once when the view comes back with data older than its interval. A session that is not interactive reads nothing. Prometheus follows `refreshSeconds`; herdr and `agent-msg doctor` are read once a minute; a source that fails or answers slowly is read less often, up to every 5 minutes.
- Escalations pane reformatted: a line between rows, resolve and hide side by side on the title line, two lines of context and what a one-press resolve sends, a titled row for an unacted order, and a muted blue arrow in place of the `use` labels.
- The Relay pane is now titled Message, with lines around the To row and no repeated headings or field label. `/factory relay` still opens it.
- A source error inferred from refusals is held 5, 10, 20 and then 30 minutes while it repeats, and the refresh key asks after 60 seconds. What ix-board answered before a rate limit in the same level of a search is drawn and recorded. The queue cell shows `- ready` for a focus with no totals yet. A `TMUX_PANE` left over outside tmux no longer stops reads.
- No reads while the session's pane is off view: behind another herdr tab or a zoomed pane, or in a tmux window no client is viewing. herdr or tmux is asked at most once every 15 seconds; where the answer is unknown the mod reads. With several clients on one herdr server the answer follows the client that last switched. `FACTORY_PANEL_VIEW_CHECK=off` turns the check off.
- The `r` key of the Factory view reads `ix-board agents` too, 60 seconds after its last read at the earliest. A team is said to match nothing only when both the focus reports and the agents were read.
- All healthy projects of a focus are asked in one `ix-board --json focus status --project <ref> --project <ref> ...` call instead of one call each. Simulated over 6 hours for a focus of 20 projects with one bad project and an initiative that cannot be expanded: 22 ix-board calls at every 6-minute refresh (1342 in all) before; one call every 30 minutes, 4 once an hour for the retries (34 in all) after.
- A project that makes the combined call fail is found (from the id in the error, else by halves, in at most 12 further calls), remembered in `~/.ix/factory-panel/known-bad.json` for every session, left out of the combined call and asked alone at most once an hour or on the refresh key. An error of the source (ix-board missing or refusing, rate limit, a timed out combined call) is never blamed on a project.
- Linear-backed reads (progress, roadmap, `ix-board agents`) run at most once every 30 minutes across all sessions; the refresh key still asks after 60 seconds. A failed project no longer shortens the interval; only an error of the source holds a read for 5 minutes, and a read that fails outright is now held too instead of being repeated at every poll.
- An initiative's project list is used for 6 hours before the roadmap or an initiative call is asked again, the roadmap is read at most once every 30 minutes across all sessions, and an initiative that fails is tried again after an hour.
- Changed numbers: a combined answer does not say which project a blocker belongs to, so a project asked with others shows `-` for Blocked, as do the initiatives that hold it; the header Blocked is now the number of distinct open blockers of the focus, no longer a sum that counted a shared blocker once per project. Done, total and Ready are as before.
- A recorded value is drawn in the warning tone after 60 minutes (it was 30), since progress is now read every 30 minutes.
- `/factory show` and the choice commands read the focuses (gated as ever) when no view has, say `focus data: not read yet` instead of `no focus reported` or `no focus matches` before a read has ended, and otherwise print the age of the data.
- Where no status call of a refresh answers and the errors do not name every project, ix-board is taken to be at fault: a source error, nothing remembered, another try after 5 minutes. Two bad projects that fail in the same words are found while any other call answers or in the first two levels of the search.
- Ready of an initiative, the header and the queue cell is `-` while any counted project's Ready is unknown, and an unknown Ready is no longer recorded as 0.
- `linear-gate.json` is written whole (temporary file and rename) and drops entries unused for a day, and the unused keys of 0.7.0.

## 0.7.0

- The Focus card draws each initiative with its projects nested under it, each project with its own bar, `done/total`, Remaining, Ready and Blocked, and a header total over every counted project with the stage counts from `open_by_state`. The totals are honest: an initiative reads `X of Y projects`, is marked partial only when a project is missing, says `includes old data (oldest 5m)` when a counted project comes from a record, and a header with a missing or old part or an initiative that could not be expanded is never drawn as complete.
- ix-board is asked for one project at a time (`ix-board --json focus status --project <ref>`), four at a time, each call for at most 20 seconds and the refresh for at most 60. One project with bad data fails alone; the combined call, the per-selector retry, the `F fresh, O old, X failed` line and the focus-level record of 0.6.0 are gone. A project in two initiatives is called once and counted once in the header.
- An initiative is expanded to its projects by the `ix-board --json roadmap` (by id if the roadmap carries ids, else by exact name), else by one `focus status --initiative <uuid>` call whose own projects are used, else from the membership cached in `progress.json` under the reserved key `initiatives`. An initiative that cannot be expanded is one failed row, `projects unknown`; its directly listed projects are still called.
- Every error is folded into one warning on the freshness row of the card (`⚠ N`, clicked to expand), which expands to the full messages with ticket, milestone and project. Error text never appears in the card body or in a project row; `/factory show` lists it too.
- Progress records are keyed by project id and keep the project's name, identifier and id, so a failed project is drawn from its record, marked old, under its name. A project nobody has named yet is named once through `ix-board project-chunk`. A failed refresh is held for 5 minutes; the refresh key asks at once.
- Known limitation: SWM-295 makes ix-board fail a whole initiative call when one ticket references a missing milestone (`issue QSL-3236 references unavailable milestone ... in project a31003a8-...`), and SWM-296 means the roadmap lists initiatives by name only, not by id. Until either is fixed an initiative the lead scopes by UUID that has that defect, such as FSL Hardening, cannot be expanded unless a membership was cached while it worked: its row reads `projects unknown`. Where the error names a project, the initiative is drawn as the one roadmap initiative that holds that project when exactly one does (never a selected one); that guess is not stored. The mod needs no change when either is fixed.
- The focus data shape changes (`focuses-5`).

## 0.6.0

- The Focus card no longer goes empty when one ticket in Linear is bad. ix-board is asked once about the whole focus, and when that call fails on a selector's account, once for each initiative, project, milestone and ticket (at most four at a time, 30 seconds in all), so the others still show. The aggregate reads `F fresh, O old, X failed` and is marked partial when any are old or failed.
- The last good progress of each selector is kept in `~/.ix/factory-panel/progress.json` and shown, marked old with its age (stale after 30 minutes), beside the error when a refresh fails. Records are written by temporary file and rename, merged with another session's, and dropped after 24 hours unseen.
- A failing source (ix-board, `agent-msg work`, `agent-msg focuses`, Prometheus) is shown on the card of the module that uses it and listed with its error and the age of its last success by `/factory show`, and never blocks another source or the first paint. Prometheus calls and `agent-msg` calls are given up on after 5 seconds.
- The first line of the Focus pane and of `/factory show` says why these focuses are shown.
- `/factory focus <name>` resolves the keywords, then ix-relay's named focus definitions (read-only, `agent-msg focuses list` and `show`), then a lead address (`host:team:segment` or `team:segment`), then a lead summary, on every refresh. Exclusions of a definition are noted, not applied.
- A lead whose work report has no scope says `no selectors`.
- A refresh with a failed selector is not cached across polls; a successful combined call also writes a focus-level record that stands in, marked old, when every later call fails.
- The focus data shape changes (`focuses-4`, `focusMeta-2`).

## 0.5.0

- Breaking: the role question, the stored role answer, the `role` setting and `/factory role` are removed. The mod has no notion of role and asks nothing. The `bandModules` and `bandFocus` settings are removed too: `/factory use` and `/factory focus` replace them.
- The mod reads who the session is from `agent-msg whoami` (never waiting more than five seconds, and never before the first paint) and by default shows this machine, your own focus and your own team's lanes. When it cannot tell who the session is it shows everything and says so.
- What is shown is chosen per feature (cells, hosts, focus, teams). Order: your choice, then a declaration an agent wrote for the session (`~/.ix/factory-panel/features/<key>.json`), then the automatic view. A skill selects features by telling its agent to write that file; `/factory help` prints a snippet.
- New `/factory use`, `focus <own|team|name>`, `teams`, `hosts`, `show` and `reset` commands, with choices stored in `~/.ix/factory-panel/choices/<key>.json`.
- Focus scopes: `own`, `team` (grouped by team) or a focus name matched by exact then partial summary, with the number of matches. Lanes follow the teams list, which defaults to your own team.
- The Linear rate-limit cache moves to `~/.ix/factory-panel/linear-gate.json`; the old file under `~/.cache` is read once and not written.
- The focus data shape changes (`focuses-3` adds the lead's status).

## 0.4.0

- Breaking: `/band` is removed. `/factory` is the one command: `/factory` opens the view for your role, `/factory <view>` opens one, `/factory role` asks the role question again and `/factory help` explains in the words of your layout. Band cell digits switch views while one is open.
- `/focuses`, `/escalations`, `/relay` and `/team` remain as aliases for one release and will be removed after it.
- The role is read from the relay address, else asked once for each directory the first time `/factory` is typed. Starting a session never asks a question or takes the keyboard.
- Band cells carry digits 1 to 9 in the order drawn; a team cell shows the first team tile.
- Honest states: a machine that never reported is grey no-data, a stale one is not reporting, and the Factory view says when metrics are unavailable and marks old values.
- README rewritten around tasks; spec and tests traced to every requirement; end-to-end check in both layouts (`tests/e2e/layouts.mjs`).

## 0.3.1

- Metrics addresses are no longer hard-coded to localhost. `prometheusUrl` and `grafanaUrl` default to empty and are found at session start: the plugin setting, then the shared ix config (`ix config get observability.prometheusUrl` / `observability.grafanaUrl`), then this host's relay endpoint (`otlp_endpoint` in ~/.ix/relay/config.toml), then http://prometheus.luna.ix. Grafana follows Prometheus's `prometheus.<domain>` name when nothing else names it.
- Fix: the band and the fullscreen panes now appear at startup. The first draw ran before session start finished and was skipped, and nothing redrew it; the layout gate no longer waits for session start, and session start asks for a redraw.
- `/band` explains itself: what the band shows and why, the role, what to type, and `/band help` lists the commands with examples. An unknown argument says so and prints the help.

## 0.3.0

- Add the band: a one-row, role-based view above the prompt for sessions that are not in the fullscreen layout. Modules: health, local, focus, queue, lead, lanes, attention, relay, agents, spend. Each is a button with a digit hotkey (a bare digit at an empty prompt presses it); a press opens that module's full pane, focused, and Esc closes it.
- Each role has default modules: coordinator (hosts, focus, escalations, relay), code-lead (this machine, focus, lead, lanes), planner (focus, queue, lead), worker (this machine). New settings: `role`, `bandModules`, `bandFocus`, `inlineView` (band, status, off).
- `/band on|off|modules a,b,c|reset` changes the band for the session.

- The /factory, /focuses, /escalations, /relay and /team commands open their pane with the keyboard (Esc hands it back and closes it), so an inline pane on the main screen can be used without clicking.
- Panes no longer open at session start. An unasked pane is seated inline above the prompt, over the chat, unless the terminal runs the fullscreen layout that docks it; session start cannot tell which. The panes now open once, when the first prompt-band draw reports the fullscreen layout. On the main screen the status line says to type /factory.

## 0.2.0

- Fix the startup placement of the panes.
- Add a shared style layer: `docs/STYLE.md` and common widgets used by every pane.
- Compact Factory layout with status chips.
- Focus pane shows three-section bars (palette E).
- Escalations move from Relay into their own pane, with one-press Resolve, Hide all and Resolve all.
- ix-board reads share a Linear rate-limit gate across sessions on a machine.
- Team pane shows braille sparklines.
- Terminal layouts for each pane.
- Shorter Prometheus timeout error message.

## 0.1.0

- Initial release: Factory, Focus, Relay and Team panes.
