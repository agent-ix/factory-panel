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
- The mod SHALL write the Linear gate cache by writing a temporary file and renaming it over the cache.
- Where that rename fails, the mod SHALL leave the cache as it was.
- At each write of the Linear gate cache the mod SHALL drop every entry that has been neither fetched nor claimed for 24 hours.
- At each write the mod SHALL drop every entry whose key begins `focus:`, the progress keys of 0.7.0, that has been neither fetched nor claimed for 60 minutes, so that a session still running 0.7.0 keeps the entry it uses.
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
| FR-015-AC-5 | Given a gate cache holding an entry last fetched 25 hours ago, one never fetched, one fetched 23 hours ago and `focus:` entries 61 and 10 minutes old, the next write keeps only the 23 hour one, the 10 minute `focus:` one and the entry written. | Test |
| FR-015-AC-6 | The cache is replaced by a rename of a temporary file, never written in place, and a failed rename leaves the earlier cache and no temporary file. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md)
