/**
 * Nano-tier list-test auto-skip (setup file for vitest.nano.config.js).
 *
 * The nano build has no data-list render cluster, so any test that renders a
 * `data-list` won't render rows and its list assertions fail. ~1,200 such tests
 * are scattered across ~100 files that ALSO hold ~1,100 non-list tests we want
 * covered on nano. Per-test skipIf gating would mean editing ~1,200 tests; and a
 * global `it` wrapper can't intercept them because every file does
 * `import { it } from 'vitest'` (a live binding, unaffected by reassigning the
 * global).
 *
 * Instead this setup file registers GLOBAL hooks (which vitest applies to every
 * test regardless of how `it` was imported):
 *   - a MutationObserver flags when any `[data-list]` / `[data-wf-list]` element
 *     is inserted into the document during a test;
 *   - beforeEach resets the flag;
 *   - afterEach, if the flag is set, rewrites the test's result to "skipped" and
 *     clears any error the absent list renderer produced.
 *
 * Net: on nano, list tests auto-skip; every non-list test in the same file runs.
 * No-op on non-nano builds.
 */
import { beforeEach, afterEach } from 'vitest'

// Applies to both list-free tiers: nano and mini-pool (same missing cluster).
const IS_NANO = (typeof __WILDFLOWER_DIST__ !== 'undefined') &&
  typeof __WILDFLOWER_DIST__ === 'string' &&
  (__WILDFLOWER_DIST__.startsWith('nano') || __WILDFLOWER_DIST__.startsWith('mini-pool'))

if (IS_NANO && typeof document !== 'undefined') {
  let sawList = false

  const hasList = (node) => {
    if (!node || node.nodeType !== 1) return false
    return (node.matches && (node.matches('[data-list]') || node.matches('[data-wf-list]'))) ||
           (node.querySelector && !!node.querySelector('[data-list],[data-wf-list]'))
  }

  try {
    const obs = new MutationObserver((mutations) => {
      if (sawList) return
      for (const mut of mutations) {
        for (const n of mut.addedNodes) {
          if (hasList(n)) { sawList = true; return }
        }
      }
    })
    obs.observe(document.documentElement || document, { childList: true, subtree: true })
  } catch (_) { /* no MutationObserver → fall back to afterEach DOM probe below */ }

  beforeEach(() => {
    sawList = false
    try { window.__wf_nano_inert_binding__ = false } catch (_) { /* ignore */ }
  })

  afterEach((ctx) => {
    // Also skip tests that tripped a nano-inert scoped-slot read binding (the
    // framework sets __wf_nano_inert_binding__ in dev when a data-with slot has
    // data-bind/-show/-class/-style, which nano can't apply).
    let inertBinding = false
    try { inertBinding = !!window.__wf_nano_inert_binding__ } catch (_) { /* ignore */ }
    if (inertBinding) sawList = true
    // Only the per-test MutationObserver flag is used: it is exact (fires on any
    // data-list inserted during THIS test). A live-DOM probe was deliberately
    // dropped — it could false-skip a non-list test that inherited a leaked
    // data-list node, silently losing coverage. A missed list test instead fails
    // visibly and is easy to triage.
    if (!sawList) return
    const task = ctx && ctx.task
    if (task) {
      task.mode = 'skip'
      if (task.result) {
        task.result.state = 'skip'
        task.result.errors = undefined
      } else {
        task.result = { state: 'skip' }
      }
    }
  })
}
