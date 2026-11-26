/** The folds of the Work pane that hold leads and tickets, and Recent. */
export const FOLDS = /^(host:|lead:|old:|recent$)/
/** Those and the finished tickets. */
export const ALL_FOLDS = /^(host:|lead:|old:|finished-|recent$)/
/** The folds to the leads and tickets alone, Recent left closed. */
export const LEAD_FOLDS = /^(host:|lead:|old:)/

type Pane = { findAll: (q: { type: string }) => Promise<{ key?: unknown; props: unknown }[]>; press: (q: { key: string }) => Promise<unknown> }

/**
 * Opens what is closed in a Work pane: by default every host, lead and `old` fold, and Recent.
 * `wait` lets the reads an opening asks for run, after which what they drew is opened too.
 */
export async function openWork(ui: Pane, wait: () => Promise<unknown> = async () => undefined, folds: RegExp = FOLDS): Promise<void> {
  for (let pass = 0; pass < 6; pass++) {
    const closed = (await ui.findAll({ type: 'Button' })).filter(b => {
      const key = String(b.key ?? '')
      return folds.test(key) && String((b.props as { label?: string }).label ?? '').startsWith('▸')
    })
    if (closed.length === 0) return
    for (const b of closed) await ui.press({ key: String(b.key) })
    await wait()
  }
}
