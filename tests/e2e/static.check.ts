// Checks that read the repository's own files, which the plugin test sandbox cannot do.
// Run: node --test tests/e2e/static.check.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
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

test('the README has the six sections in order', () => {
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map(m => m[1])
  assert.deepEqual(headings, ['What you see', 'How to use it', 'Roles', 'Advanced settings', 'Install', 'Developing'])
})

test('every command and setting the README names is registered by the plugin', () => {
  trace("FR-008-AC-4")
  const registered = new Set(hooks.flatMap(h => [...h.text.matchAll(/\$\.command\.register\(\{\s*name: '([a-z-]+)'/g)].map(m => m[1]!)))
  const views = new Set(readFileSync(join(ROOT, 'hooks', 'views.ts'), 'utf8').match(/VIEW_IDS[^=]*= \[([^\]]*)\]/)![1]!.split(',').map(v => v.trim().replace(/'/g, '')))
  const commands = [...readme.matchAll(/`\/([a-z][a-z-]*)([^`]*)`/g)].map(m => ({ name: m[1]!, rest: m[2]!.trim() }))
  assert.ok(commands.length > 0)
  for (const c of commands) {
    assert.ok(registered.has(c.name), `README names /${c.name}, which the plugin does not register`)
    if (c.name === 'factory' && /^[a-z]+$/.test(c.rest) && c.rest !== 'help' && c.rest !== 'role') assert.ok(views.has(c.rest), `README names /factory ${c.rest}, which is not a view`)
  }
  assert.ok(!commands.some(c => c.name === 'band'))
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as { userConfig: Record<string, unknown> }
  const section = readme.split(/^## Advanced settings$/m)[1]!.split(/^## /m)[0]!
  const named = [...section.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(m => m[1]!)
  assert.deepEqual([...named].sort(), Object.keys(manifest.userConfig).sort())
})
