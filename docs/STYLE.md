# Style guide

This is the style guide for the factory-panel plugin's panes. It fixes the colours, spacing, type, number formats and drawing helpers every pane uses, so the Factory, Focus, Relay and Team panes look like one product on the terminal and on desktop. The drawing helpers live in `hooks/ui/glyphs.ts` and `hooks/ui/widgets.tsx`; `hooks/factory.tsx` is the reference pane.

## Tokens

Colour is semantic. Text and Box colours use the host's names, not hex values: `success`, `warning`, `error`, `inactive`, `subtle`, `claude`. `claude` marks work in progress, `subtle` is quiet status text, `inactive` is absent or unknown data. The light blue accent and the in-progress teal are hex tokens from `hooks/ui/glyphs.ts` (see Accent). Other hex and rgba values appear only inside Svg drawing and card backgrounds (`INK`, `CARD_BG` and `loadInk` in the desktop path of the Factory pane).

- Load percentage: under 75 is `success`, 75 or more is `warning`, 90 or more is `error`, null is `inactive` (`loadColor`).
- Temperature in Celsius: under 80 is `success`, 80 or more is `warning`, 90 or more is `error`, null is `inactive` (`tempColor`).
- Muted text uses `dimColor`. Do not reach for a grey colour name.
- State is shown by a mark beside the text, not by colouring the body text: `●` up, `○` down, `✓` done, `◐` working, `◌` idle, `▲` a relay check or a service that needs attention. Colour the mark; leave the words in the default colour. Numbers that breach a threshold may take its colour, because the number is the state.

## Spacing

A terminal row is about twice as tall as a cell is wide, so vertical space costs more than it looks.

- No blank rows inside a card on the terminal: the Factory `compactCard` stacks its lines directly. The desktop cards and the Focus card use padding and `gap` instead.
- One blank row (`gap={1}`) between cards and between sections.
- Only `statTile` draws a border. Machine cards are set off with `backgroundColor`; rows, lists and the status chips have neither.
- Horizontal gaps inside a row are 1 or 2 cells.

## Type

- `weight="semibold"` for names and numbers.
- `size="heading"` for the big number in a tile and the pane title.
- `size="caption"` for secondary lines, usually together with `dimColor`.
- `tabular` on the numbers that change in tile values, gauges and card headings, so they do not jitter. The caption count lines (`1 working · 0 idle`) are plain text.

## Number formats

| Kind | Format | Helper |
| --- | --- | --- |
| Money | `$8.51`, `$107`, `$1.2k` | `usd` |
| Percent | `26%`, whole numbers; once per card, in its header, never on rows | none |
| Count | `done/total`, such as `10/72` or `241/545`, right-aligned in a fixed column | none |
| Temperature | `79°`, whole degrees, no unit letter | none |
| Age | `4m`, `2h`, `3d` | `ago` in `hooks/shared.ts` |

`ago` returns text such as `4m ago` and `never`. Where an age sits in a dim column on its own, drop the word "ago".

## Surfaces

Each pane has one `ui.render` definition. It does not fork per surface; it branches inside the render.

- Desktop or terminal: the terminal's element table has no `Svg`, desktop's does. The Factory pane tests `'Svg' in els` and also requires `e.surface !== 'terminal'`, because the test host's terminal table lists `Svg` too. Desktop draws Svg rings and bars; the terminal draws glyph bars (`bar`) and sparklines (`spark`).
- Widget seat: `e.props.placement === 'widget'` is the one-line seat. Return a single row with the headline numbers and nothing else.
- Width: `e.props.bodyColumns` is the pane's width in columns. The sidebar pane is about 60 columns, so design for that first. Focus clamps it with `Math.max(30, e.props.bodyColumns ?? 60)` and sizes bars from it.

## Widgets

Everything below is in `hooks/ui`. `glyphs.ts` holds plain functions; `widgets.tsx` exports `widgets(els)`, which binds the element widgets to the surface being drawn: `const { statTile, gaugeLine, heading, statusChip, chipRow } = widgets($.ui.resolve(e))`.

- `statTile(key, label, value, sub, color?)`: a bordered, rounded tile with a dim label, a big number and a dim line. Use it for the few headline totals at the top of a pane.
- `gaugeLine(key, label, pct, text, color?)`: `CPU ██░░░░ 26%`, a label, a six-cell bar and a number in the load's colour. Use it for one percentage metric per row.
- `heading(name, right)`: a section title on the left, dim detail on the right.
- `statusChip(key, name, hotkey, mark, color, selected, onPress)`: a coloured mark, then a `Button` named for the thing (`●  herdr`). The mark carries the state and the name stays uncoloured; a dim `▾` follows the open chip. Chips show no counts: the numbers and error text go in the detail below. `chipRow(chips)` lays them out in one line. The Factory pane uses three: herdr (`▲` when its read failed, else `●` running or `○` down), ix-relay (`▲` when its read failed or it is not ok, else `●`) and ix-board (`●` has agents, `▲` error, `◌` collecting or no data). A service not yet read shows `◌`. The error text goes in the detail.
- `bar(share, cells)`: a block bar filled to `share` (0 to 1) in eighth-block steps (`▏▎▍▌▋▊▉█`), so a 10-cell bar has 80 steps; `null` and NaN draw it empty. The empty track is `░`, which sits cleanly beside a partial block. Use it when you place the bar yourself.
- `cellBar(share, cells)`: a whole-cell bar rounded to whole cells (`███░░░`, `░` track). `gaugeLine` and so the Factory CPU and memory gauges use it.
- `stackBar(done, inProgress, ready, total, cells)`: a stacked progress bar of `cells` whole cells, one cell standing for total / cells items. The cells are shared out among done, in progress, ready and the remainder by the largest-remainder method (a tie goes to the earlier section), so the counts add up to `cells` exactly. A non-zero section gets at least one cell when there is room, taken from the largest section. While work remains (done under total) done takes at most `cells - 1` cells and the remainder keeps a cell when any item is neither done, in progress nor ready, so the bar never reads full. Every cell is `█` in its section's colour: no fractions of a cell, no background colour. It returns runs of `{ fg, text }` (categories 0 done, 1 in progress, 2 ready, 3 track), adjacent cells of one section merged; NaN and a zero total give an all-track bar.
- `segmentBar(key, done, inProgress, ready, total, cells)`: those runs as one row of Texts, each with `color` set from the four colours.
- `progressRow(key, name, done, inProgress, ready, total, nameCells, barCells, dim?)`: one project per row: the name truncated to a fixed column, a segment bar, and `done/total` right-aligned. No percentage and no "N of M done" text. The Focus rows pass ready 0: ix-board's `focus status` gives one global `ready_queue`, not a per-project count, so ready shows only on the overall bar.
- `legend()`: the coloured marks `■ done  ■ in progress  ■ ready  ■ rest`, the last in the track colour; draw it once, under the overall bar of a card, not on rows.
- `dots(values, rows = 1)`: a braille dot histogram, two samples per character and four levels per row, filled from the bottom; returns one string per row, top first. The Team pane draws each tile's six-hour series with it on the terminal. Braille needs a terminal font that has it; the plugin does not detect this.
- `ACCENT`, `DOING`, `READY` and `TRACK`: the colour tokens, below.
- `spark(values)`: a one-row sparkline scaled between the series' own minimum and maximum. Use it for a short history.
- `loadColor(pct)` and `tempColor(c)`: the thresholds above, returning a semantic colour.
- `usd(n)`: money in the format above.

## The reference look

- Bordered rounded stat tiles in a row: dim label, big number, dim sub-line.
- Titled sections, each with its heading row.
- Aligned dim columns for age and count, so the eye can scan down them.
- Green and red marks for state, as in the Factory machine rows and the status chips; one detail opens under the chips at a time, its first line the counts.
- A key-hint footer row naming the hotkeys (`r` refresh, `h` `x` `b` for the chips). The panes bind the hotkeys today; a dedicated hint row is not yet drawn by any widget.

`heading` and `spark` are in the catalogue and tested but are not yet called from a pane.

## Accent

The host's Text and Box colour accepts any string (a theme key, a colour name or hex), so the blue is a hex value: `ACCENT` is `#3b82c4`, defined once in `hooks/ui/glyphs.ts`. A theme key was not chosen because `suggestion` and `permission` follow the person's theme and read lavender rather than light blue. It is used for bars, tile numbers and heading accents on the terminal path (the Factory title, tile numbers, the Focus percentage, the Team dots), and `INK.calm`, the Svg palette's accent, is set to it so desktop and terminal agree. State colours stay `success`, `warning` and `error`.

Progress bars stack four sections, each a whole-cell run in one colour. The tokens, in `hooks/ui/glyphs.ts`, with HSL read from the code (the legend and the desktop Svg `progressBar` use the same four):

| Token | Hex | HSL | Use |
| --- | --- | --- | --- |
| `ACCENT` | `#3b82c4` | h 209, s 54%, l 50% | done; also tile numbers and headings |
| `DOING` | `#e0a34a` | h 36, s 71%, l 58% | in progress (not a state colour) |
| `READY` | `#7e8aa3` | h 221, s 17%, l 57% | ready |
| `TRACK` | `#2d3543` | h 218, s 20%, l 22% | the remainder |

This is the owner's chosen palette: deliberately muted, with a blue-grey for ready. Contrast on a `#1e1e1e` terminal background (WCAG ratio, checked by `tests/ui.test.tsx` with `contrastRatio`): done 4.1, in progress 7.5, ready 4.8, track 1.35. The track against each section is at least 3.0. Between neighbours: done and in progress 1.84, in progress and ready 1.57, ready and track 3.56, done and ready 1.17, done and track 3.04. The tests require each section at 3:1 or more on the background, the track at 1.1:1 on the background and at 2.9:1 or more under every section, and floors for the neighbour pairs set to those values less a margin (1.7, 1.45, 3.3, 1.1 and 2.9). In progress counts tickets from ix-board's `focus status`, not pull requests. The hex values were checked against the host's `Color` type; how they render in a given terminal theme was not seen.

Focus rows fill the pane width. A row is a name column (the longest project name, 10 to 30 cells), a bar, and a 10-cell right-aligned `done/total`, with a gap between each and a cell of card padding either side. The bar takes the rest: `bodyColumns - 3 - 12 - name cells` (one column is kept spare so a row never wraps), at least 8 (30 cells at the 60-column sidebar, 60 at 90, 10 at 40). On the terminal the overall bar is drawn at the same width as the rows' bars (the desktop path sizes its Svg bars separately).

## Adding a widget

1. Put it in `hooks/ui`: a pure function in `glyphs.ts`, or an element widget inside `widgets()` in `widgets.tsx`.
2. Import only from `'claude-code'` (types) and other files in `hooks/ui`. No pane files, no ix-board or agent-msg imports, no reading of plugin state. This lets `hooks/ui` move into its own package later without edits.
3. Take colours as the semantic names above and take every string and number as an argument.
4. Add a test in `tests/ui.test.tsx`.
5. Run `claude plugin test .` and `claude plugin validate .`.
