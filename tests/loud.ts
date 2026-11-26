import { test as base } from 'claude-code/testing'

// The shipped defaults are quiet (no panes at start, no band). Most tests exercise the views, so
// they start from the loud settings; a test that is about the defaults sets its own options.
const LOUD = { openOnStart: true, inlineView: 'band' }

type Base = typeof base
export const test = ((name: string, a: unknown, b?: unknown) => {
  const [opts, fn] = typeof a === 'function' ? [{}, a] : [a as { options?: Record<string, unknown> }, b]
  return (base as (...x: unknown[]) => unknown)(name, { ...opts, options: { ...LOUD, ...opts.options } }, fn)
}) as unknown as Base
