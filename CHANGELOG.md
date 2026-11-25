# Changelog

## 0.6.0

- The Focus card no longer goes empty when one ticket in Linear is bad. ix-board is asked once about the whole focus, and when that call fails on a selector's account, once for each initiative, project, milestone and ticket (at most four at a time, 30 seconds in all), so the others still show. The aggregate reads `F fresh, O old, X failed` and is marked partial when any are old or failed.
- The last good progress of each selector is kept in `~/.ix/factory-panel/progress.json` and shown, marked old with its age (stale after 30 minutes), beside the error when a refresh fails. Records are written by temporary file and rename, merged with another session's, and dropped after 24 hours unseen.
- A failing source (ix-board, `agent-msg work`, `agent-msg focuses`, Prometheus) is shown on the card of the module that uses it and listed with its error and the age of its last success by `/factory show`, and never blocks another source or the first paint. Prometheus calls and `agent-msg` calls are given up on after 5 seconds.
- The first line of the Focus pane and of `/factory show` says why these focuses are shown.
- `/factory focus <name>` resolves the keywords, then ix-relay's named focus definitions (read-only, `agent-msg focuses list` and `show`), then a lead address (`host:team:segment` or `team:segment`), then a lead summary, on every refresh. Exclusions of a definition are noted, not applied.
- A lead whose work report has no scope says `no selectors`.
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
