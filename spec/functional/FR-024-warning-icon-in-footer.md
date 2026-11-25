---
id: FR-024
title: Warnings as a footer icon
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-013"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-018"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-006"
    type: traces_to
---
# FR-024: Warnings as a footer icon

## Description

The mod SHALL fold every source and selector error of the Focus card into one expandable warning icon in the card footer, so that the card body never prints error text.

## Behavior

- The mod SHALL draw one warning icon with its count, such as `⚠ 1`, in the same footer row element as the freshness text, such as `updated 0s ago`, to the left of that text, with no hotkey label.
- The mod SHALL expand the icon on activation of the icon, the `e` key not being shown.
- The warning count SHALL be the number of distinct projects whose call failed plus the number of source errors.
- An initiative whose projects cannot be enumerated SHALL count once.
- A project whose call failed and that is drawn from an old record SHALL count.
- The mod SHALL draw no warning icon where the count is zero.
- The mod SHALL draw the warning icon in the warning tone.
- The mod SHALL draw no error text in the card body or in a project row.
- The mod SHALL expand the warning icon into the full messages just above the footer, followed by the explanations of FR-019, FR-020, FR-022 and FR-023 that the card body does not carry, when the user activates the icon.
- An expanded message SHALL name the ticket, milestone and project with their ids and names where the error text supplies them.
- The mod SHALL collapse the messages on the next activation.
- The mod SHALL keep the same error text in `/factory show` as [FR-018](./FR-018-errors-visible-not-fatal.md) requires.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-024-AC-1 | With one project failed, the footer shows `⚠ 1` in the warning tone, to the left of the freshness text, in the same footer row element. | Test |
| FR-024-AC-2 | With a failed project and a source error the line counts 2, with an initiative that cannot be enumerated and one failed project it counts 2, and a failed project drawn from an old record counts. | Test |
| FR-024-AC-3 | With no problem no warning line is drawn, and with problems the card body holds no error text. | Test |
| FR-024-AC-4 | Activating the icon shows the full messages above the footer with ticket, milestone and project ids and names, and a second activation hides them. | Test |
| FR-024-AC-5 | An error text with no milestone expands to the parts it has and does not fail. | Test |
| FR-024-AC-6 | With the same errors, `/factory show` lists each source with its full error text. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-018](FR-018-errors-visible-not-fatal.md)
