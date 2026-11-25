---
id: SR-001
title: "Code review - factory-panel 0.9.0 (SWM-303)"
type: SpecReview
analysis: code-review
scope: "agent-ix/factory-panel; hooks/, types/, tests/, tests/e2e/"
review_set: subset
---

## Summary

Ticket: SWM-303. Reviewed PR #17 at head 3f358bf893af5e644ed4dc44a4027a4f7842f9e5 against the plan (R1-R6 panel side) and the upstream contracts of ix-board PRs 99, 102 (head 056a782) and 104. At head `claude plugin test .` is 514 pass 0 fail, `node --test tests/e2e/static.check.ts` is 6 pass and `claude plugin validate .` passes with warnings. FND-001, FND-003 and FND-007 and the band half of FND-002 were reproduced with temporary tests that were removed afterwards.

## Verdict

**CONDITIONAL** - no high finding. The new reads are read-only (retro eval, ledger query, relay reads, Prometheus). Neither e2e script was run: both need workspace trust for the worktree, which only the owner may give, and layouts.mjs links the real ~/.claude into its temporary HOME. The React lane was not dispatched (no package.json, component_type claude-code-mod); the Rust lane does not apply. No AssuranceProfile exists under spec/.

Plan judgement. Work tab: ticket rows, badges and last action are drawn, and state, title and [pr] only for tickets of the focus shown (FND-006); with 39 of 43 leads reporting nothing, the tab cannot show what is active, which is upstream. Band cell: implemented, not shown by default (FND-009).

## Findings

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-001 | medium | With an identified session on the default `own` focus, selectedTeams is [ownTeam] and a `/factory teams` choice is ignored for tiles, health, Roles, widget and band team cell. 0.9.0 newly hides every keyed team that is not selected (0.8.0 drew all). A session in a workspace whose name is not a Linear key (for example ix-relay) shows no keyed tiles at all and `/factory teams QSL` changes nothing; only `/factory focus team` or a named focus shows QSL. Reproduced. Fix: let an explicit teams choice or declaration take precedence for the Team view, and amend FR-029. | hooks/band/modules.ts:82-90 |
| FND-002 | medium | Ticket facts and activity carry no read time and a held board is kept when later reads fail (hooks/focus.tsx:310) or served old under a Linear rate limit. The band then reads an exact `1 PR open · 0 merged 24h` from a 20 hour old answer (reproduced; only a rate-limit line follows), and the Work tab draws old states, [pr] badges and `Nothing merged lately.` with no ix-board warning, its warnings being relay errors only (hooks/workview.tsx:294). A lead whose focus never answered also leaves merged short with no `≥`. Fix: keep the answer time with each board, mark counts older than the gate interval as old or `—`, and show the ix-board error on the Work tab. | hooks/work.ts:297-301 |
| FND-003 | medium | `Oldest in a stage` takes the largest stage sample and ignores a stage with coverage 0. ix-board PR 99 omits the age of a stage whose active work has no known start and publishes 0 for empty stages, so the tile reads `0m` with `0% covered` while work of unknown age is in progress (reproduced): unavailable shown as zero. Fix: read `—` where a stage coverage is 0 and no positive age exists, and `≥` where any stage coverage is below 1. | hooks/team.tsx:201-205 |
| FND-004 | medium | The ready-buffer deficit is drawn with state `ok`, as current, whatever its age. In ix-board PR 102 at 056a782 the exporter serves the newest saturation_sample per host with no age filter, so after the collector stops the last deficit is scraped as fresh for as long as the exporter runs. The caption `sample age is not published` does not mark it stale. Fix upstream (omit samples older than twice the collection interval or publish their timestamp); until then draw the deficit as of unknown age, as an unknown-age busy sample is drawn. | hooks/capacity.tsx:90-97 |
| FND-005 | medium | The cap of 8 and the 30 s reuse are per session, and nothing is shared between sessions on a machine. Live, `agent-msg who` lists 43 verified leads, 24 on other machines at 1.1 to 6.6 s each over ssh, so every session that reads all leads (a named focus) with the Work tab or the work cell on screen makes 24 ssh reads a minute, 39 of 43 answering null; five sessions make 120 a minute with up to 40 at once, above sshd MaxStartups defaults, and the transient retry adds to it. The PR already saw ssh closing connections. Fix: a machine-wide report cache with a claim, like linear-gate.json, and a slower interval for remote leads that report nothing. | hooks/leads.ts:10-16 |
| FND-006 | medium | Plan view 1 asks for tickets with state and [pr] badges. Facts come only from the focus statuses of the shown focus, so a ticket a lead reports outside it shows an id with no state, title or [pr], and the band reads `— PRs open` (the PR reports this for all 11 live tickets). Finished (done-only) agent tickets are listed beside active ones. Fix in the panel: one gated `ix-board --json focus status --issue <id>...` for reported tickets no board names (confirm it returns state and PRs for them, else upstream in ix-board), and drop or fold done-only tickets. | hooks/work.ts:175-190 |
| FND-007 | medium | The Work widget reads `0 leads · 0 tickets` before the first read and when `agent-msg who` fails (both reproduced): unknown shown as zero, against FR-030 (say the leads could not be read, not that none reported). Fix: use meta.at and meta.relayError and draw `—` or the same words as the pane. The widget line predates this PR; relayError is added by it and not used here. | hooks/workview.tsx:244-247 |
| FND-008 | low | The `leads report no work` line wraps every address. With the live 39 silent leads it is about 15 rows at 60 columns and pushes Recent down the owner main view. Fix: show the count with a button that expands the names. | hooks/workview.tsx:317-319 |
| FND-009 | low | Plan verification says the band shows the work cell. It is not a fallback module and no module choice selects it, so after R7 the owner sees no work cell (and a fullscreen layout draws no band). Fix: add `work` to FALLBACK_MODULES and amend FR-002, after FND-005, since every classic session would then read all leads; or have R7 select it with `/factory use ... work` with the owner agreement. | hooks/selection.ts:14-15 |
| FND-010 | low | A selected team with no retro config makes Roles draw an error, mark the source failed and retry every 5 minutes, while the health strip reads `no retro baseline` for the same condition (exit 3). The default selected team is the session workspace, which often has no config. Fix: treat exit 3 as `no retro baseline` and hold it. | hooks/roles.tsx:91-92 |
| FND-011 | medium | layouts.mjs symlinks the real ~/.claude into the temporary HOME of a live session, which can write the owner settings, history and plugin state through it. Plan R7 requires running this script. Pre-existing and outside this diff. Fix: copy the files the session needs into the temporary HOME, as onscreen.mjs links no ~/.claude. | tests/e2e/layouts.mjs:45 |
| FND-012 | medium | Neither e2e script exercises what 0.9.0 adds: no stand-in for retro delta, retro eval or fleet ledger query, no visit to the Team tab, no work band module, no Recent role events or silent-lead line. Neither was run at this head (trust prompt for the worktree). R7 therefore has no script that checks the new views. Fix: add stand-ins and checks for the Team tab, the work cell and `a` in Recent, and run both before release. | tests/e2e/onscreen.mjs:79-84 |

## Dispositions

| FND | outcome | reason |
| --- | --- | --- |
| FND-001 | fixed | a teams choice or declaration now wins whatever the focus; FR-029 amended, AC-36 (head 9c36ef3) |
| FND-002 | fixed | answers keep read time and error; reproduced at head: after 1h of failures the band says ix-board 1h old and Work says the answer is old. The narrower partial-answer case is FND-014 (head 9c36ef3) |
| FND-003 | fixed | reproduced at head: coverage 0 reads a dash with age not measured (head 9c36ef3) |
| FND-004 | fixed | a deficit over 10 minutes old or of unknown age is stale (head 9c36ef3) |
| FND-005 | fixed | machine-wide report file with claims, 8 at once, silent remote leads every 5 minutes; unlocked cross-process writes can at worst repeat a read (head 9c36ef3) |
| FND-006 | fixed | one gated ix-board issues read; verified with installed ix-board 0.11.0: every live reported ticket drew state, title and [pr]; finished tickets are folded. Edges are FND-013 and FND-015 (head 9c36ef3) |
| FND-007 | fixed | reproduced at head: widget says reading, then The leads could not be read (head 9c36ef3) |
| FND-008 | fixed | one counted line that opens (head 9c36ef3) |
| FND-009 | fixed | work is a fallback module; live run drew the cell in the default band (head 9c36ef3) |
| FND-010 | fixed | matches the stderr installed ix-board prints for a missing retro config (head 9c36ef3) |
| FND-011 | fixed | no ~/.claude link; the only link into the real home is the keychain, and an untrusted folder is refused (head 9c36ef3) |
| FND-012 | fixed | stand-ins and checks added; the 150 s on-screen run in the worktree reports 55/55 and layouts 27/27 (head 9c36ef3) |
| FND-013 | fixed | exit 3 with no message is read as an answer; a test covers it and a control that exit 3 with a message fails (head ab6ff6e) |
| FND-014 | fixed | a focus status whose latest refresh failed makes the merges a lower bound (head ab6ff6e) |
| FND-015 | fixed | tickets in hand are asked for first, and one not asked for reads state not read; FR-028-AC-30 (head ab6ff6e) |
| FND-016 | fixed | the widget says the closures are unknown and which keys no series carries; FR-029-AC-34 amended (head ab6ff6e) |

## New findings (disposition pass 1)

| ID | Severity | Summary | Refs |
| --- | --- | --- | --- |
| FND-013 | low | When none of the asked ids exists, installed ix-board 0.11.0 `issues` exits 3 with empty stderr and the JSON answer on stdout. runIssues throws on any non-zero exit, so the Work tab says `state not read` and `ix-board: ix-board exited 3` instead of `not in Linear` (reproduced). Fix: replace the exit check by `if (ran.exitCode !== 0 && !(ran.exitCode === 3 && ran.stderr.trim() === '')) throw new Error(failureText(ran.stderr, ran.exitCode))`, add a test. | hooks/workview.tsx:142-144 |
| FND-014 | low | A progress refresh cut short by a source error keeps the answers it got, with fresh read time and a non-null error. mergedPartial ignores the error, so the band and widget draw that partial merge count as exact (a warning still shows). From code, not reproduced. Fix in boardNotes: `isShort: focuses.some(b => b.at === null \|\| b.activity === null \|\| Boolean(b.error) \|\| isOldAt(b.at, now))`, add a test. | hooks/work.ts:200 |
| FND-015 | low | More than 100 reported tickets outside the focus statuses are sorted by id and cut at 100. Finished tickets count against the limit, and the rest are drawn with no state and no reason. Live there are 53 reported tickets. Fix: fill the 100 from activeIds(leads) first, then the other ids, and draw `state not read` for an id not in the answer's asked list. | hooks/workview.tsx:160 |
| FND-016 | low | Where no series carries the selected team key, the widget sums the keyless exporter ids. With the live exporter an ix-relay session reads `≥0 closures / 24h`: a bound of zero, from ids not known to be that team, with no reason, until ix-board publishes team_key (live capture). Fix: when `shown.length === 0 && selected.length > 0` draw `closures / 24h unknown · no series carries the key <selected>`, and amend FR-029-AC-34. | hooks/team.tsx:371-383 |
