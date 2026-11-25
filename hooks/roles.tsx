import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface } from 'claude-code'

import type { RoleReport, RoleRule, RoleScore, RolesView } from '../types'
import { CARD_BG, ago, errorText, failureText, pausedText } from './shared'
import { BOARD_INTERVAL_MS, UNKEPT_TTL_MS, gatedBoard } from './linear'
import { track } from './schedule'
import { focusTeams } from './band/modules'
import { getSelection, home, scopeOf, selectionReady } from './selection'
import { sourceFailed, sourceOk } from './sources'

// The Team view's Roles section: each role's score from `ix-board retro eval`, and what it was not scored on. An
// evaluation reads Linear and GitHub over two windows, so it runs through the gate every session shares.

const roles = atom({ plugin: 'factory-panel', key: 'roles' } as const, [] as RolesView[], { shape: 'roles-1' })
/** The roles whose rules are listed, as `team/role`. */
const rolesOpen = atom({ plugin: 'factory-panel', key: 'rolesOpen' } as const, [] as string[])

/** The teams whose retro health and role evaluations are shown: the teams the session's focus is about. */
export function retroTeams(): readonly string[] {
  const scope = scopeOf(getSelection())
  const picked = focusTeams(scope)
  if (picked !== null && picked.length > 0) return picked
  return scope.ownTeam !== null ? [scope.ownTeam] : scope.teams
}

// ---------------------------------------------------------------- reading

const EVAL_TIMEOUT_MS = 5 * 60 * 1000
/** How long an evaluation another session started is left to it: past its timeout. */
const EVAL_CLAIM_MS = 6 * 60 * 1000
/** A run that failed after this long has spent its reads, so it is not soon made again. */
const SLOW_FAILURE_MS = 10_000

const READING = 'reading the role evaluation, which can take minutes'
const ELSEWHERE = 'another session is reading it'
const NO_COMMAND = 'this ix-board has no `retro eval` command'
const NO_ROLE = 'the evaluation names no role'
const NOT_A_REPORT = 'the answer is not a retro eval report'

/** What the gate keeps of a run; a null report is an ix-board with no such command. */
type Answer = { report: RoleReport | null }

type Raw = Record<string, unknown>
const record = (v: unknown): Raw | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const need = <T,>(v: T | null): T => {
  if (v === null) throw new Error(NOT_A_REPORT)
  return v
}
const list = (v: unknown): Raw[] => need(Array.isArray(v) ? v : null).map(x => need(record(x)))

/** The window and roles of an answer of schema version 1; evidence and sessions are not kept. */
export function parseEval(answer: string): RoleReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    throw new Error(NOT_A_REPORT)
  }
  const doc = need(record(parsed))
  const schema = need(number(doc.schema_version))
  if (schema !== 1) throw new Error(`schema_version ${schema} is not one this mod reads`)
  const window = need(record(doc.window))
  const rule = (r: Raw): RoleRule => ({
    id: need(text(r.id)),
    status: need(text(r.status)),
    query: text(r.query) ?? '',
    value: number(r.value),
    comparator: text(r.comparator) ?? '',
    target: number(r.target),
    reason: text(r.reason),
    rubric: text(r.rubric_id),
  })
  const role = (r: Raw): RoleScore => {
    const score = need(record(r.score))
    return {
      role: need(text(r.role)),
      passed: need(number(score.passed)),
      evaluated: need(number(score.evaluated)),
      passRate: number(score.pass_rate),
      trend: number(r.trend),
      matched: number(r.trend_matched_rules),
      rules: list(r.rules).map(rule),
    }
  }
  return { startMs: need(number(window.start_ms)), endMs: need(number(window.end_ms)), roles: list(doc.roles).map(role) }
}

async function runEval($: EngineInterface, config: string): Promise<Answer> {
  const ran = await $.process.run(['ix-board', '--json', 'retro', 'eval', '--config', config, '--since', '24h'], { timeoutMs: EVAL_TIMEOUT_MS })
  // An ix-board from before the command refuses its name; nothing was read.
  if (ran.exitCode === 2 && ran.stderr.includes("unrecognized subcommand 'eval'")) return { report: null }
  if (ran.exitCode !== 0) throw new Error(failureText(ran.stderr, ran.exitCode))
  if (ran.isStdoutTruncated) throw new Error('the answer was cut at 4 MiB')
  return { report: parseEval(ran.stdout) }
}

async function readTeamRoles($: EngineInterface, dir: string, team: string): Promise<{ view: RolesView; error: string | null; isAnswered: boolean }> {
  const got = await gatedBoard($, `eval:${team}`, () => runEval($, `${dir}/${team}/config.json`), {
    // A missing command costs nothing to ask again, and an upgrade should show soon.
    keep: a => a.report !== null,
    errorHoldMs: ranMs => (ranMs < SLOW_FAILURE_MS ? UNKEPT_TTL_MS : BOARD_INTERVAL_MS),
    claimMs: EVAL_CLAIM_MS,
  })
  const report = got.data?.report ?? null
  const done = (note: string | null, isError = false) => ({ view: { team, report, note, isError }, error: got.error, isAnswered: got.data !== null })
  if (got.backoffUntil !== null) return done(pausedText(got.backoffUntil, await $.clock.now()))
  if (got.error !== null) return done(`retro eval: ${got.error}`, true)
  if (got.data === null) return done(ELSEWHERE)
  if (report === null) return done(NO_COMMAND)
  return done(report.roles.length === 0 ? NO_ROLE : null)
}

/** Reads each selected team's role evaluation, one team at a time; false when one failed. */
export function pollRoles($: EngineInterface): Promise<boolean> {
  return track($, 'roles', async () => {
    try {
      // Which teams are asked for is the session's scope, which waits for its identity.
      await selectionReady()
      const dir = `${await home($)}/.local/state/team-retro`
      const teams = retroTeams()
      await update($, roles, held => teams.map(team => held.find(v => v.team === team) ?? { team, report: null, note: READING, isError: false }))
      const errors: string[] = []
      let isAnswered = false
      for (const team of teams) {
        // The choice may have changed while an earlier team was evaluated.
        if (!retroTeams().includes(team)) continue
        const got = await readTeamRoles($, dir, team)
        if (got.error !== null) errors.push(`${team}: ${got.error}`)
        isAnswered ||= got.isAnswered
        await update($, roles, held => held.map(v => (v.team === team ? got.view : v)))
      }
      if (errors.length > 0) sourceFailed('ix-board retro eval', errors.join(' · '))
      else if (isAnswered) sourceOk('ix-board retro eval', await $.clock.now())
      return errors.length === 0
    } catch (error) {
      sourceFailed('ix-board retro eval', errorText(error))
      return false
    }
  })
}

// ---------------------------------------------------------------- drawing

type Mark = { mark: string; color: string }
const FAILED: Mark = { mark: '●', color: 'error' }
const PARTLY: Mark = { mark: '●', color: 'warning' }
const SOUND: Mark = { mark: '●', color: 'success' }
const UNSCORED: Mark = { mark: '○', color: 'inactive' }

/** The statuses of a rule the mod knows, with how one that is not scored is drawn and named. */
const NOT_SCORED: Record<string, Mark & { words: string }> = {
  unavailable: { ...UNSCORED, words: 'unavailable' },
  not_applicable: { mark: '◌', color: 'subtle', words: 'not applicable' },
  judgement_required: { mark: '▲', color: 'subtle', words: 'judgement required' },
}
const isKnown = (status: string): boolean => status === 'pass' || status === 'fail' || status in NOT_SCORED

function markOf(r: RoleScore): Mark {
  if (r.rules.some(x => x.status === 'fail')) return FAILED
  if (r.rules.some(x => x.status === 'unavailable' || !isKnown(x.status))) return PARTLY
  return r.evaluated === 0 ? UNSCORED : SOUND
}

// Rounded down, so that a rate short of all passing never reads 100%.
const scoreText = (r: RoleScore): string => (r.passRate === null ? 'no score' : `${Math.floor(r.passRate * 100 + 1e-9)}% · ${r.passed}/${r.evaluated} passed`)

/** The answer's trend, with the number of rules it compares: those scored in both windows. */
function trendOf({ trend, matched }: RoleScore): { text: string; color: string } {
  if (matched === 0) return { text: 'trend — · no rule scored in both windows', color: 'subtle' }
  if (trend === null) return { text: 'trend —', color: 'subtle' }
  const over = matched === null ? '' : ` over ${matched} ${matched === 1 ? 'rule' : 'rules'}`
  if (trend === 0) return { text: `= no change${over}`, color: 'subtle' }
  const points = Math.abs(trend) * 100
  const size = points < 1 - 1e-9 ? '<1' : `${trend > 0 ? '+' : '−'}${Math.round(points)}`
  return trend > 0 ? { text: `↑ ${size} pts${over}`, color: 'success' } : { text: `↓ ${size} pts${over}`, color: 'warning' }
}

function countsOf(r: RoleScore): string {
  const count = (test: (status: string) => boolean, words: string) => {
    const n = r.rules.filter(x => test(x.status)).length
    return n === 0 ? [] : [`${n} ${words}`]
  }
  return [
    ...count(s => s === 'fail', 'failing'),
    ...Object.entries(NOT_SCORED).flatMap(([status, { words }]) => count(s => s === status, status === 'judgement_required' ? 'judgement' : words)),
    ...count(s => !isKnown(s), 'unknown'),
  ].join(' · ')
}

const SIGNS: Record<string, string> = { '<=': '≤', '>=': '≥', '==': '=' }
const amount = (v: number): string => String(Math.round(v * 100) / 100)

function failedText(x: RoleRule): string {
  const value = x.value === null ? 'no value' : amount(x.value)
  const wants = x.target === null ? '' : `, wants ${SIGNS[x.comparator] ?? x.comparator} ${amount(x.target)}`
  return [x.id, `${value}${wants}`, x.query].filter(part => part !== '').join(' · ')
}

function unscoredText(x: RoleRule): string {
  const why = [x.status === 'judgement_required' && x.rubric !== null ? `rubric ${x.rubric}` : null, x.reason].filter(part => part !== null)
  return [x.id, NOT_SCORED[x.status]?.words ?? x.status, ...(why.length > 0 ? why : ['no reason given'])].join(' · ')
}

/** One section for each selected team: its roles, and under an opened role the rules that failed or were not scored. */
export async function drawRoles($: EngineInterface, { Box, Text, Button }: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>) {
  const [views, open] = await Promise.all([read($, roles), read($, rolesOpen)])
  const now = await $.clock.now()

  const line = (key: string, { mark, color }: Mark, words: string) => (
    <Box key={key} flexDirection="row" gap={1} paddingLeft={2}>
      <Text color={color}>{mark}</Text>
      <Text size="caption">{words}</Text>
    </Box>
  )

  const roleRows = (team: string, r: RoleScore) => {
    const id = `${team}/${r.role}`
    const isOpen = open.includes(id)
    const { mark, color } = markOf(r)
    const trend = trendOf(r)
    const counts = countsOf(r)
    const failing = r.rules.filter(x => x.status === 'fail')
    const unscored = r.rules.filter(x => x.status !== 'pass' && x.status !== 'fail')
    return (
      <Box key={id} flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text color={color}>{mark}</Text>
          <Button key={`role-${team}-${r.role}`} plain label={`${isOpen ? '▾' : '▸'} ${r.role}`} onPress={() => void update($, rolesOpen, l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))} />
          <Text tabular>{scoreText(r)}</Text>
          <Text color={trend.color}>{trend.text}</Text>
          {counts !== '' && <Text dimColor size="caption">{counts}</Text>}
        </Box>
        {isOpen && failing.map(x => line(`${id}/${x.id}`, FAILED, failedText(x)))}
        {isOpen && failing.length === 0 && r.evaluated > 0 && <Text dimColor size="caption">no failing rule</Text>}
        {isOpen && unscored.map(x => line(`${id}/${x.id}`, NOT_SCORED[x.status] ?? UNSCORED, unscoredText(x)))}
      </Box>
    )
  }

  return views.map(v => (
    <Box key={`roles-${v.team}`} flexDirection="column" padding={1} backgroundColor={CARD_BG}>
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Text weight="semibold">Roles · {v.team}</Text>
        {v.report !== null && <Text dimColor size="caption">{`${Math.round((v.report.endMs - v.report.startMs) / 3_600_000)}h window · ended ${ago(v.report.endMs, now)}`}</Text>}
      </Box>
      {v.note !== null && (
        <Box flexDirection="row" gap={1}>
          {v.isError && <Text color="warning">▲</Text>}
          <Text dimColor={!v.isError} size="caption">
            {v.note}
          </Text>
        </Box>
      )}
      {v.report?.roles.map(r => roleRows(v.team, r))}
    </Box>
  ))
}
