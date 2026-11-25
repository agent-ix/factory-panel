---
id: FR-015
title: Files kept under the ix home
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-004"
    type: implements
  - target: "ix://agent-ix/factory-panel/FR-011"
    type: traces_to
  - target: "ix://agent-ix/factory-panel/FR-014"
    type: traces_to
---
# FR-015: Files kept under the ix home

## Description

The mod SHALL keep every file it reads or writes for its own state under `~/.ix/factory-panel/`.

## Behavior

- The mod SHALL write the Linear gate cache to `~/.ix/factory-panel/linear-gate.json`.
- Where `~/.ix/factory-panel/linear-gate.json` does not exist and `~/.cache/factory-panel/linear-gate.json` does, the mod SHALL read the old file once as the initial cache.
- The mod SHALL NOT write to `~/.cache/factory-panel/` or `~/.config/factory-panel/`.
- The mod SHALL NOT create a file for its own state outside `~/.ix/factory-panel/` and `$.store`.
- The mod SHALL read files owned by other tools, such as `~/.ix/relay/config.toml`, only where another requirement names them.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-015-AC-1 | After a Linear gate refresh the cache exists at `~/.ix/factory-panel/linear-gate.json`. | Test |
| FR-015-AC-2 | Given only the old `~/.cache/factory-panel/linear-gate.json`, the first read uses its content, and later writes go to the new path and leave the old file unchanged. | Test |
| FR-015-AC-3 | After a full session, no file exists under `~/.cache/factory-panel/` or `~/.config/factory-panel/` that the mod created. | Test |
| FR-015-AC-4 | Every home path in `hooks/` is under `~/.ix/factory-panel/` except the read of `~/.ix/relay/config.toml` and the old cache read; `grep -rnE "\.cache\|\.config" hooks/` matches only that old cache read. | Inspection |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md)
