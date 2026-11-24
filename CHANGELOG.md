# Changelog

## Unreleased

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
