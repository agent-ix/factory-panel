import type { EngineInterface } from 'claude-code'

// Whether the terminal pane this session runs in is on view. The engine draws a view whether or not
// anyone can see its terminal, so herdr or tmux is asked before a read. Only a definite no counts:
// with neither of them, with both (one inside the other), or with a command that fails, is slow or
// does not say, the session counts as on view.

/** The longest one answer is used, and the shortest time between two checks. */
export const VIEW_CHECK_MS = 15_000
const TIMEOUT_MS = 3_000

/** Viewing clients, whether a pane is zoomed, whether it is this one, and each client's control mode. */
const TMUX_FORMAT = '#{window_active_clients} #{window_zoomed_flag} #{pane_active} [#{L:#{client_control_mode}}]'

type HerdrView = {
  result?: {
    snapshot?: {
      focused_tab_id?: string
      panes?: { pane_id?: string; tab_id?: string; agent_session?: { value?: string } }[]
      layouts?: { tab_id?: string; zoomed?: boolean; focused_pane_id?: string }[]
    }
  }
}

/**
 * False only where `herdr api snapshot` lists the session in panes none of which is on the focused tab,
 * or only under another pane zoomed over them. The pane is found by the session id herdr's Claude
 * integration reports, since `HERDR_PANE_ID` can be left over from where a process was started.
 */
export const herdrOnView = (stdout: string, sessionId: string): boolean => {
  let view: HerdrView
  try {
    view = JSON.parse(stdout) as HerdrView
  } catch {
    return true
  }
  const snapshot = view.result?.snapshot
  const focused = snapshot?.focused_tab_id
  const mine = (snapshot?.panes ?? []).filter(p => sessionId !== '' && p.agent_session?.value === sessionId)
  if (focused === undefined || mine.length === 0) return true
  return mine.some(p => {
    if (p.tab_id !== focused) return false
    const layout = snapshot?.layouts?.find(l => l.tab_id === p.tab_id)
    return !(layout?.zoomed === true && layout.focused_pane_id !== p.pane_id)
  })
}

/**
 * False only where tmux says no attached client is viewing the pane's window, or another pane is zoomed
 * over it. A control mode client (iTerm2's tmux windows) shows windows its own way, so with one
 * attached the answer is not taken.
 */
export const tmuxOnView = (stdout: string): boolean => {
  const found = /^(\d+) ([01]) ([01]) \[([01]*)\]/.exec(stdout)
  if (found === null || found[4]!.includes('1')) return true
  if (found[1] === '0') return false
  return !(found[2] === '1' && found[3] === '0')
}

async function askHerdr($: EngineInterface): Promise<boolean> {
  const ran = await $.process.run(['herdr', 'api', 'snapshot'], { timeoutMs: TIMEOUT_MS })
  return ran.exitCode !== 0 || herdrOnView(ran.stdout, await $.session.id())
}

async function askTmux($: EngineInterface, pane: string): Promise<boolean> {
  const ran = await $.process.run(['tmux', 'display-message', '-p', '-t', pane, TMUX_FORMAT], { timeoutMs: TIMEOUT_MS })
  return ran.exitCode !== 0 || tmuxOnView(ran.stdout)
}

async function ask($: EngineInterface): Promise<boolean> {
  try {
    // The person's own switch: `off` reads wherever the engine draws.
    if ((await $.env.get('FACTORY_PANEL_VIEW_CHECK')) === 'off') return true
    const isHerdr = (await $.env.get('HERDR_ENV')) === '1'
    const pane = await $.env.get('TMUX_PANE')
    // One inside the other: neither can say what the person sees.
    if (isHerdr === (pane !== undefined && pane !== '')) return true
    if (isHerdr) return await askHerdr($)
    // A TMUX_PANE can be left over in a terminal started from tmux, and would name someone else's pane.
    const program = await $.env.get('TERM_PROGRAM')
    if (!(await $.env.get('TMUX')) || (program !== undefined && program !== 'tmux')) return true
    return await askTmux($, pane!)
  } catch {
    return true
  }
}

/** Asks, and where the answer is no, sees that the views are drawn again once it may be asked anew. */
async function check($: EngineInterface): Promise<boolean> {
  const isOn = await ask($)
  if (!isOn) void $.clock.after(VIEW_CHECK_MS, () => $.ui.invalidate('ui.render'))
  return isOn
}

let last: { at: number; answer: Promise<boolean> } | undefined

/** Forgets the last answer: a new session has not looked. */
export const resetOnView = (): void => void (last = undefined)

/** True unless the session's pane is known to be off view. Runs at most one command every 15 seconds. */
export async function isOnView($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  if (last === undefined || now - last.at >= VIEW_CHECK_MS) last = { at: now, answer: check($) }
  return last.answer
}
