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

- The mod SHALL draw one warning line, such as `⚠ 1 project failed`, in the card footer on the same line as the freshness text.
- The warning line SHALL state the count of problems, covering failed projects, failed selectors and source errors.
- The mod SHALL draw no warning line where there are no problems.
- The mod SHALL draw the warning line in the warning tone.
- The mod SHALL draw no error text in the card body.
- The mod SHALL expand the warning line, when the user activates it by Button or hotkey, into the full messages just above the footer.
- An expanded message SHALL name the ticket, milestone, project and their ids and names where the error text supplies them.
- The mod SHALL collapse the messages on the next activation.
- The mod SHALL keep the same error text in `/factory show` as [FR-018](./FR-018-errors-visible-not-fatal.md) requires.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-024-AC-1 | Given one project failed, the footer shows `⚠ 1 project failed` on the same line as the freshness text, in the warning tone. | Test |
| FR-024-AC-2 | Given a failed project and a failed roadmap source, the line counts 2 problems and the card body holds no error text. | Test |
| FR-024-AC-3 | Given no problem, no warning line is drawn. | Test |
| FR-024-AC-4 | Given activation by Button or hotkey, the full messages appear above the footer with ticket, milestone and project ids and names, and a second activation hides them. | Test |
| FR-024-AC-5 | Given an error text that carries no milestone, the expanded message shows only the parts it has and does not fail. | Test |
| FR-024-AC-6 | Given the same errors, `/factory show` lists each source with its full error text. | Test |

## Dependencies

- **Upstream**: [US-013](../usecase/US-013-see-initiatives-with-their-projects.md)
- **See also**: [FR-006](FR-006-honest-states.md), [FR-018](FR-018-errors-visible-not-fatal.md)
