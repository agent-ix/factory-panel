---
id: US-013
title: See initiatives with their projects and trust the numbers
type: US
relationships:
  - target: "ix://agent-ix/factory-panel/FR-021"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-022"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-023"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-024"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-025"
    type: traces_to
---
# US-013: See initiatives with their projects and trust the numbers

## Story

**As a** lead who watches my focus in the Focus pane
**I want** each initiative drawn with its projects nested under it, with counts as complete as the relay terminal monitor shows, and problems folded into one small icon
**So that** I know what an initiative is made of, I can rely on its totals, and one bad project neither empties the card nor fills it with warning text.

## Context

Owner feedback on 0.6.0: the plugin's style is preferred, but (1) the reference error is too loud and should be an icon that expands to show the warning, and (2) children of initiatives should be shown nested under the initiative. Compared with the relay terminal monitor's Scope view, the monitor shows more (Progress, Remaining, Ready and Blocked per row, and initiatives that expand to their projects) and its numbers are more correct.

The cause of the wrong numbers: the Focus card asked `ix-board focus status` per initiative. One ticket references a milestone that is missing from its project, ix-board fails the whole initiative call with `issue <id> references unavailable milestone <id> in project <id>`, and the largest initiative dropped out, leaving the total at 60 of 108 marked partial. The same call succeeds for every other project of that initiative. The relay monitor is unaffected because it reads the cached snapshot and counts itself. Fixing ix-board is out of scope; the mod must work with the defect present and unchanged after it is fixed.

## Acceptance Examples (Illustrative)

### US-013-EX-1: One bad project

- **Given** an initiative of 18 projects of which one has a dangling milestone
- **When** the Focus card draws
- **Then** the initiative shows 17 of 18 projects counted, the 17 project rows have bars and counts, the bad project row carries a short mark, and the footer shows `⚠ 1 project failed`

### US-013-EX-2: Open the warning

- **Given** the footer shows `⚠ 1 project failed`
- **When** the user presses the warning key
- **Then** the full message appears just above the footer with the ticket, milestone and project, and a second press hides it again
