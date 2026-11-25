// What the real-session checks share: a temporary HOME holding the Claude login and little else, and
// the cleanup that leaves neither it nor a tmux session behind, however the check ends.

import { execFileSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** The keys of ~/.claude.json a session needs to start signed in, with no first-run questions (the last two answer the browser one). */
const LOGIN_KEYS = ['oauthAccount', 'userID', 'hasCompletedOnboarding', 'lastOnboardingVersion', 'lastReleaseNotesSeen', 'numStartups', 'installMethod', 'theme', 'claudeInChromeDefaultEnabled', 'cachedChromeExtensionInstalled']

const homes = new Set()
const endings = new Set()

/** Runs `end` when the check exits or is interrupted, before the temporary homes are removed. */
export const atEnd = end => {
  endings.add(end)
  return () => endings.delete(end)
}

export function removeHome(home) {
  // The links go first, so that nothing of the real ~/.claude or ~/Library is ever reached.
  for (const name of ['.claude', 'Library']) {
    try {
      if (lstatSync(join(home, name)).isSymbolicLink()) unlinkSync(join(home, name))
    } catch {}
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  homes.delete(home)
}

/**
 * A temporary HOME: a .claude.json with the login keys and the trust already given to `folder`, and
 * links to the named entries of the real home. `base` shortens the path where a socket goes under it.
 */
export function makeHome(prefix, folder, links, base = tmpdir()) {
  const home = mkdtempSync(join(base, prefix))
  homes.add(home)
  const real = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
  const kept = Object.fromEntries(LOGIN_KEYS.filter(key => real[key] !== undefined).map(key => [key, real[key]]))
  if (real.projects?.[folder]?.hasTrustDialogAccepted === true) kept.projects = { [folder]: { hasTrustDialogAccepted: true } }
  writeFileSync(join(home, '.claude.json'), JSON.stringify(kept), { mode: 0o600 })
  for (const name of links) symlinkSync(join(homedir(), name), join(home, name))
  return home
}

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Ends a tmux session on the socket `server` and waits for what ran in it, so that nothing writes to a removed home. */
export function endSession(server, name) {
  let pids = []
  try {
    pids = execFileSync('tmux', ['-L', server, 'list-panes', '-s', '-t', name, '-F', '#{pane_pid}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').map(Number)
    execFileSync('tmux', ['-L', server, 'kill-session', '-t', name], { stdio: 'ignore' })
  } catch {}
  const until = Date.now() + 10_000
  while (pids.some(alive) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
}

process.on('exit', () => {
  for (const end of [...endings]) {
    try {
      end()
    } catch {}
  }
  for (const home of [...homes]) removeHome(home)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130))
