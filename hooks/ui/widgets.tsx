import type { Elements } from 'claude-code'

import { ACCENT, DOING, READY, TRACK, cellBar, loadColor, stackBar } from './glyphs'

const BAR_COLORS = [ACCENT, DOING, READY, TRACK]

// Widgets drawn from the host's own elements, so they run on any surface that has Box and
// Text. `widgets($.ui.resolve(e))` binds them to the surface being drawn.

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Color = 'success' | 'warning' | 'error' | 'inactive' | 'subtle' | 'claude'

export function widgets({ Box, Text, Button }: Els) {
  /** A bordered stat tile: a dim label, a big number, a dim line under it. */
  const statTile = (key: string, label: string, value: string, sub: string, color?: Color) => (
    <Box key={key} flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor size="caption">
        {label}
      </Text>
      <Text weight="semibold" size="heading" tabular color={color ?? ACCENT}>
        {value}
      </Text>
      <Text dimColor size="caption" wrap="truncate-end">
        {sub}
      </Text>
    </Box>
  )

  /** `CPU ██░░░░ 26%`: a label, a bar and a number, all in the load's color. */
  const gaugeLine = (key: string, label: string, pct: number | null, text: string, color = loadColor(pct)) => (
    <Box key={key} flexDirection="row" gap={1}>
      <Text dimColor>{label}</Text>
      <Text color={color}>{cellBar(pct === null ? null : pct / 100, 6)}</Text>
      <Text weight="semibold" tabular color={color === 'success' ? undefined : color}>
        {text}
      </Text>
    </Box>
  )

  /** A section heading row: a name on the left, dim detail on the right. */
  const heading = (name: string, right: string) => (
    <Box flexDirection="row" justifyContent="space-between">
      <Text weight="semibold">{name}</Text>
      <Text dimColor size="caption">
        {right}
      </Text>
    </Box>
  )

  /** One status chip: `[name]`, grey brackets round a name in the state's color, pressable; a ▾ shows the open one. The hotkey sits on a hidden twin, since a plain Button that has one draws it as a prefix. */
  const statusChip = (key: string, name: string, hotkey: string, color: Color, selected: boolean, onPress: () => void) => (
    <Box key={`${key}-chip`} flexDirection="row" gap={1}>
      <Button key={key} plain label={name} onPress={onPress}>
        <Text dimColor>[</Text>
        <Text color={color}>{name}</Text>
        <Text dimColor>]</Text>
      </Button>
      <Box display="none">
        <Button key={`${key}-key`} plain label={name} hotkey={hotkey} onPress={onPress} />
      </Box>
      {selected && <Text dimColor>▾</Text>}
    </Box>
  )

  /** Chips in one line. */
  const chipRow = (chips: readonly ReturnType<typeof statusChip>[]) => (
    <Box flexDirection="row" gap={1}>
      {chips}
    </Box>
  )

  /** A stacked bar in one row: done (accent), in progress (amber), ready (blue-grey), then the dim track. */
  const segmentBar = (key: string, done: number, inProgress: number, ready: number, total: number, cells: number) => (
    <Box key={key} flexDirection="row">
      {stackBar(done, inProgress, ready, total, cells).map((run, i) => (
        <Text key={i} color={BAR_COLORS[run.fg]}>
          {run.text}
        </Text>
      ))}
    </Box>
  )

  /** One project on one row: a truncated name, a segment bar and a right-aligned `done/total`, in fixed columns. No percentage: the bar shows it. */
  const progressRow = (key: string, name: string, done: number, inProgress: number, ready: number, total: number, nameCells: number, barCells: number, dim = false) => (
    <Box key={key} flexDirection="row" gap={1}>
      <Box width={nameCells}>
        <Text dimColor={dim} wrap="truncate-end">{name}</Text>
      </Box>
      {segmentBar(`${key}-bar`, done, inProgress, ready, total, barCells)}
      <Box width={10} justifyContent="flex-end">
        <Text dimColor size="caption" tabular wrap="truncate-end">{done}/{total}</Text>
      </Box>
    </Box>
  )

  /** The legend for segment bars: coloured marks naming done, in progress, ready and the rest. */
  const legend = () => (
    <Box flexDirection="row" gap={2}>
      <Box key="done" flexDirection="row" gap={1}>
        <Text color={ACCENT}>■</Text>
        <Text dimColor size="caption">done</Text>
      </Box>
      <Box key="doing" flexDirection="row" gap={1}>
        <Text color={DOING}>■</Text>
        <Text dimColor size="caption">in progress</Text>
      </Box>
      <Box key="ready" flexDirection="row" gap={1}>
        <Text color={READY}>■</Text>
        <Text dimColor size="caption">ready</Text>
      </Box>
      <Box key="rest" flexDirection="row" gap={1}>
        <Text color={TRACK}>█</Text>
        <Text dimColor size="caption">rest</Text>
      </Box>
    </Box>
  )

  return { statTile, gaugeLine, heading, statusChip, chipRow, segmentBar, progressRow, legend }
}
