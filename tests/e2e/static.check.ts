// Checks that read the repository's own files, which the plugin test sandbox cannot do.
// Run: node --test tests/e2e/static.check.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const trace = (..._ids: string[]): void => {}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const hooks = sourceFiles(join(ROOT, 'hooks')).map(file => ({ file, text: readFileSync(file, 'utf8') }))

test('no hotkey in the band or in any view is an arrow key', () => {
  trace("FR-004-AC-4")
  const hotkeys = hooks.flatMap(h => [...h.text.matchAll(/\bhotkey=(\{[^}]*\}|"[^"]*"|'[^']*')/g)].map(m => m[1]!))
  assert.ok(hotkeys.length > 0, 'found no hotkeys to check')
  // Each is a single letter or digit, or the band's digit for the cell.
  for (const h of hotkeys) assert.match(h, /^("[0-9a-z]"|'[0-9a-z]'|\{digitFor\(i\)\}|\{hotkey\})$/)
  // A chip's hotkey is the argument its caller passes: a single letter.
  const chips = hooks.flatMap(h => [...h.text.matchAll(/statusChip\('[^']*', '[^']*', ('[^']*')/g)].map(m => m[1]!))
  assert.ok(chips.length > 0)
  for (const c of chips) assert.match(c, /^'[0-9a-z]'$/)
  // No arrow key is named anywhere in the mod's source.
  for (const h of hooks) assert.doesNotMatch(h.text, /arrow(up|down|left|right)|(up|down|left|right)arrow|['"]arrow['"]/i, h.file)
})

test('the README has its sections in order', () => {
  trace("FR-008-AC-3")
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.deepEqual(headings, ['What you see', 'How to use it', 'Choosing what to show', 'Advanced settings', 'Install', 'Developing'])
})

test('no role presets or role files remain in hooks', () => {
  trace("FR-002-AC-4", "FR-010-AC-4")
  assert.deepEqual(hooks.filter(h => /PRESETS/.test(h.text)).map(h => h.file), [])
  assert.ok(!existsSync(join(ROOT, 'hooks', 'role.ts')))
  assert.ok(!existsSync(join(ROOT, 'hooks', 'band', 'roles.ts')))
  // `/factory role` is not a command: the router does not name it.
  const router = readFileSync(join(ROOT, 'hooks', 'router.ts'), 'utf8')
  assert.doesNotMatch(router, /'role'|"role"/)
})

test('every path the mod keeps for its own state is under ~/.ix/factory-panel except the old cache read', () => {
  trace("FR-015-AC-4")
  const matches = hooks.flatMap(h => [...h.text.matchAll(/^.*(\.cache|\.config).*$/gm)].map(m => ({ file: h.file, line: m[0].trim() })))
  assert.equal(matches.length, 1, JSON.stringify(matches))
  assert.match(matches[0]!.line, /oldPath = .*\.cache\/factory-panel\//)
  assert.match(matches[0]!.file, /linear\.ts$/)
  // The relay config is the one file of another tool, and nothing else is read from a home path.
  const homes = hooks.flatMap(h => [...h.text.matchAll(/\$\{home\}\/(\.[a-z]+)\/([a-z-]+)/g)].map(m => `${m[1]}/${m[2]}`))
  assert.deepEqual([...new Set(homes)].sort(), ['.cache/factory-panel', '.ix/factory-panel', '.ix/relay'])
})

test('every command and setting the README names is registered by the plugin', () => {
  trace("FR-008-AC-4")
  const registered = new Set(hooks.flatMap(h => [...h.text.matchAll(/\$\.command\.register\(\{\s*name: '([a-z-]+)'/g)].map(m => m[1]!)))
  const views = new Set(readFileSync(join(ROOT, 'hooks', 'views.ts'), 'utf8').match(/VIEW_IDS[^=]*= \[([^\]]*)\]/)![1]!.split(',').map(v => v.trim().replace(/'/g, '')))
  const commands = [...readme.matchAll(/`\/([a-z][a-z-]*)([^`]*)`/g)].map(m => ({ name: m[1]!, rest: m[2]!.trim() }))
  assert.ok(commands.length > 0)
  for (const c of commands) {
    assert.ok(registered.has(c.name), `README names /${c.name}, which the plugin does not register`)
    const word = c.rest.split(/\s+/)[0] ?? ''
    if (c.name === 'factory' && word !== '') assert.ok(views.has(word) || ['help', 'use', 'teams', 'hosts', 'show', 'reset'].includes(word), `README names /factory ${word}, which is neither a view nor a choice command`)
  }
  assert.ok(!commands.some(c => c.name === 'band'))
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as { userConfig: Record<string, unknown> }
  const section = readme.split(/^## Advanced settings$/m)[1]!.split(/^## /m)[0]!
  const named = [...section.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(m => m[1]!)
  assert.deepEqual([...named].sort(), Object.keys(manifest.userConfig).sort())
})
