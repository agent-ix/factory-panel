# Changelog

## Unreleased

- The focus is `all` or one ix-relay named focus definition, stored by its ID and shown by its name. `/factory focus` takes an exact name or ID and refuses anything else, listing the definitions. Lead address and summary matching are gone; a stored name now reads as `all` and says so.
- Teams and focus are two settings. Teams say which leads are listed (your own by default, one or more, or `all`); the focus, one named focus or `all` (the default), narrows their tickets and never widens the teams. Both are at the top of the Work tab, clickable, and `/factory teams` and `/factory focus` set the same values.
- Under a focus the Work tab lists the tickets of the focus, folds the leads with nothing in it, keeps tickets of unknown project behind a line of their own and keeps unread leads listed; Recent, the widget and the band's work cell follow.
- The `own` and `team` focus values are gone: a stored or declared one means `all`. The Focus tab and band pick lead focus entries by the teams, or show the chosen definition, and their banner reads `focuses of <teams>` or `your choice: <name>`.
- A Work tab ticket row reads id, title, badges, age. The role and status words (`coder running`, `reviewer done`, `focus`) and the Linear state are gone, the ages stand in one column and the title takes the freed width. A ticket with no title because Linear has no record of it, or it could not be read, still says so.

## 0.9.0

Review events and a work cell, role evaluations, fleet capacity and daily velocity. Team keys, the daily rows and tile coverage need ix-board 0.12.0; roles, and the capacity’s deficit and output, need an ix-board newer than 0.11.0. Until one is installed and its exporter runs, those say why they read `—` or what they lack.

- The Work tab's Recent list gains review, spec and gate events: under `a`, each start and finish of a reviewer, spec or gate agent, with its ticket, lead and age, for the leads of the selected teams. Merges stay the default. The events of `agent-msg work events` are now a read of their own every 30 seconds that waits on no lead's work report, so a review shows within a minute of its report.
- New `work` band cell, shown by default: `N tickets · M PRs open · K merged 24h`, opening the Work view. It counts the tickets in hand of leads with a report at most 2 hours old, `≥N tickets (r/t leads)` where fewer report than are listed, with the tickets only older reports name apart. An unknown number reads `—` with its reason, and an ix-board answer over 35 minutes old has its age said.
- `merged 24h`, in the band and the Work widget, counts distinct PRs (a PR linked to two tickets was counted twice) and reads `≥K` where ix-board’s 200-entry cap on activity cuts into the day.
- A changed focus or teams choice reads the leads' work reports again at once.
- Leads on other machines are no longer cut off. A lead's work report is given 20 seconds (it was 5, under what an ssh read can take), at most eight are read at once, Focus and Work share the reads, and a Redis, herdr or ssh failure that may pass is tried once more. A lead that cannot be read stays on the Work tab: drawn from its last report and marked old, or listed as not read. Each lead is drawn as it answers, and the first Focus drawing waits 5 seconds at most for them.
- Under `a`, five of Recent's ten rows are held for review, spec and gate events, so a busy focus no longer crowds them out.
- A progress answer that a session on an older build wrote to the shared gate is read again at once, instead of leaving PRs and merges unknown until it expired.
- The Team tab’s health strip takes each metric’s class from the `class` field of `ix-board --json retro delta` instead of a table of its own, so a metric new to ix-board lands in its class. It needs ix-board 0.11.0: an older one reads `needs ix-board ≥0.11.0` with no marks. A team with fewer than two retro snapshots reads `no retro delta yet` instead of an empty strip.
- The Team tab heads each team with its Linear team key, from the exporter’s `team_key` label (ix-board 0.12.0); without the label the exporter id is shown and marked. It no longer derives effort per closure or the changes-requested share from other series: they read `—` until the exporter publishes them. A series that has stopped reads `—` instead of its last value, and the one-line widget no longer counts an unknown number of closures as 0.
- New per-team rows on the Team tab: completed issues (Linear moves into a completed state, not the verified-closure tile) and merged PRs for each of the last 7 UTC days, from the exporter’s `ix_team_closures_day` and `ix_team_merged_prs_day`, with yesterday against the average of the earlier days.
- A team with several exporter scopes reads every count (verified closures, merges per hour, confirmed findings, work remaining, in progress, blocked, ready unmerged PRs, ready issues, executing agents and the daily counts) as `≥N`, the largest scope’s, instead of adding scopes that may overlap.
- New Roles section on the Team tab: each role’s pass rate and trend from `ix-board --json retro eval`, with the number of rules the trend compares, its failing rules, and its unavailable, not applicable and judgement-required rules with their reasons, never counted as zero or a pass. An evaluation runs at most once in 30 minutes across sessions. It needs an ix-board with `retro eval` (not in 0.11.0, which the section says) and the team’s `eval.json`.
- New Capacity section on the Team tab: each host’s busy ratio, ready-buffer deficit and output against its recorded sustainable level, from the `ix_fleet_*` series and one read-only ledger query a minute, with stale samples marked and absent values `unavailable` with their reason. The deficit and output need the ix-board that publishes them (not 0.11.0).
- A Team tile says `N% covered` where the exporter’s `ix_team_metric_coverage` of its series is below 100%.
- The health strip waits for the session to know its team before reading, instead of saying `no retro baseline` for 5 minutes where the Team view opened first, and reads again when the teams choice changes. It says when it is still reading and when no team is selected.
- The Work tab lists the tickets a lead’s focus names beside those of its agents, and the band and widget count them; a lead with no ticket shows its focus summary, and the leads that have reported no work are counted in one line that opens to their addresses. Finished tickets are folded under their lead and a report over 2 hours old is marked old.
- A reported ticket that no focus status names gets its state, title and `[pr]` from one gated `ix-board --json issues` read.
- The Work tab shows ix-board failures in its warnings and says the age of an old answer; its widget says it is reading, or that the leads could not be read, instead of counting 0.
- The sessions of a machine share the reads of leads on other machines, at most eight at once over all of them.
- The Team tab’s tiles, its widget and the band’s team cell follow the selected teams. An exporter id with no team key cannot be matched, so with a team selected it is one closed row that opens to its tiles, and a selected team with no series is named.
- The selected teams of the tiles, health strip, Roles, widget and band cell are your teams choice or a session’s declaration, else your own team. A team with no retro configuration reads `no retro baseline` under Roles too.
- An expanded role lists its objective metrics.
- A Team tile or daily row with no value says why; `Oldest in a stage` reads `—` or `≥` where a stage’s age is not fully measured.

## 0.8.0

Who works on what, what merged, and how the teams perform.

- New Work tab after Focus (`/factory work`). One block per code lead from `agent-msg who`, with a status mark and the age of its latest report; under it the tickets of the lead's agents (`agent-msg work --lead <address> show`) with Linear state and title, the badges `[pr]` (open or draft PR), `[review×N]`, `[spec]` and `[gate]`, and the last action from `agent-msg work events` (read in pages, since the stream starts at its oldest event). A lead collapses with its arrow. Below, a Recent list of merges, newest first; `a` shows closed and opened entries too.
- The Work tab makes no Linear call of its own. Tickets, PRs and activity come from the `ix-board --json focus status` answer the Focus tab already reads under its 30 minute gate; the answer's `in_progress[]`, `recently_closed[]` and `activity[]` are kept instead of being counted, and an answer wrapped in a stale `result` key is read as the object inside. With an ix-board older than 0.9.0 (no `prs`, no `activity`) the tickets show without a PR badge and Recent says `needs ix-board ≥0.9.0`.
- Team tab: review quality (first-review latency, share of PRs with findings, confirmed findings by severity, changes requested), effort per verified closure, and flow and capacity (oldest age in a stage, ready issues beside executing agents), in three rows per team. A metric a team has no series for reads `—`, never 0. Effort per closure and the changes-requested share are computed from `ix_team_execution_seconds_total`, `ix_team_prs_changes_requested` and `ix_team_prs_open` where the exporter has no series of its own.
- Team tab health strip: one mark per department class (progress, flow, rework, stability, scope, utilization, resource) from `ix-board --json retro delta --config ~/.local/state/team-retro/<team>/config.json` for the teams of your focus, read from the stored snapshots every 5 minutes: red where a metric regresses, amber where some metric has no value, green otherwise. A team with no retro config or snapshot reads `no retro baseline`.
- Six panes now open in the fullscreen layout.

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
