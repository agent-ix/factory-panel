# Changelog

## Unreleased

- Metrics addresses are no longer hard-coded to localhost. `prometheusUrl` and `grafanaUrl` default to empty and are found at session start: the plugin setting, then the shared ix config (`ix config get observability.prometheusUrl` / `observability.grafanaUrl`), then this host's relay endpoint (`otlp_endpoint` in ~/.ix/relay/config.toml), then http://prometheus.luna.ix. Grafana follows Prometheus's `prometheus.<domain>` name when nothing else names it.
- The band draws when the layout is not known to be fullscreen, and `/band` says what the last draw saw and why a band was or was not drawn. An unknown `/band` argument now says so instead of printing the usage line.

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
