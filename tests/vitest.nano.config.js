import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import path from 'path'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Nano-tier test config.
//
// The nano build is the below-mini widget tier: NO data-list render cluster
// (and no pools/portals/transitions/plugins/router/ssr). ~189 of ~320 test
// files exercise `data-list`, so per-file skipIf gating is impractical. Instead
// this config runs the LIST-FREE subset of the suite plus the nano smoke suite,
// by dynamically EXCLUDING any test file whose source references `data-list`.
//
// - Files that use data-list  -> excluded wholesale (they run on every list tier).
// - Files nano fully supports -> run (real coverage: bindings, data-show/render,
//   data-model, computed, expressions, events, forms, stores, props, external(),
//   directives, hooks, non-list templates/slots, CSP).
// - Files testing other nano-absent features (pools/portals/ssr/router) that slip
//   through already skipIf(!hasFeature(...)) and skip harmlessly.
//
// Auto-maintaining: a newly added list test is excluded automatically the moment
// it references data-list; no allow/deny list to keep in sync.
//
// Usage:
//   WILDFLOWER_DIST=nano-dev npx vitest run --config tests/vitest.nano.config.js
//   WILDFLOWER_DIST=nano-min npx vitest run --config tests/vitest.nano.config.js
// ---------------------------------------------------------------------------

// Serves BOTH list-free tiers: nano and mini-pool (nano's shape + PoolRenderer).
// Pool suites gate themselves via hasFeature('pools'), so they auto-skip on
// nano and run on mini-pool with no config difference.
const distMode = process.env.WILDFLOWER_DIST || 'nano-dev'
if (!distMode.startsWith('nano') && !distMode.startsWith('mini-pool')) {
  throw new Error(`vitest.nano.config.js expects a list-free build (got WILDFLOWER_DIST=${distMode}). Use nano / nano-dev / nano-min / mini-pool / mini-pool-dev / mini-pool-min.`)
}
const distDir = process.env.WILDFLOWER_DIST_DIR || '/dist'
const browser = process.env.WILDFLOWER_BROWSER || 'chromium'
const browserInstances = browser === 'all'
    ? [{ browser: 'chromium' }, { browser: 'firefox' }]
    : [{ browser: browser }]

const testDir = __dirname

// The nano smoke suite is always kept even though it references data-list (the
// "stray data-list does not crash" case); it self-gates with skipIf(!IS_NANO).
const ALWAYS_KEEP = new Set(['nano-smoke.test.js'])

// Explicit excludes: list-free files that exercise a nano-absent feature WITHOUT
// a hasFeature/skipIf gate (so the dynamic data-list filter and the feature gates
// both miss them). Kept intentionally short; grow only with evidence from a real
// nano run. game-plugin.test.js drives the plugin system directly (absent in nano).
const EXTRA_EXCLUDE = new Set([
  'game-plugin.test.js',        // drives the plugin system directly (absent in nano)
  'polymorphic-templates.test.js', // data-template-key switching — excluded from nano by decision
  'security-escape-html.test.js',  // tests _escapeHTML directly — a dead list-internal, no nano surface
  'maparray-primitives.test.js',   // tests the sm.mapArray reconciler directly — list-internal, no nano surface (reconciler is __FEATURE_LISTS__-gated out of nano)
])

// Walk tests/ (excluding archive) and collect files that reference data-list,
// classifying each as { rel, pure } where pure === every it()/test() block in the
// file references data-list (so excluding it loses no non-list coverage).
function collectListFiles(dir, rel = 'test-new') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'archive') continue
    const abs = path.join(dir, entry.name)
    const relPath = `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...collectListFiles(abs, relPath))
    } else if (/\.(test|spec)\.js$/.test(entry.name) && !ALWAYS_KEEP.has(entry.name)) {
      if (EXTRA_EXCLUDE.has(entry.name)) { out.push({ rel: relPath, pure: true }); continue }
      const src = fs.readFileSync(abs, 'utf8')
      if (!src.includes('data-list') && !src.includes('data-wf-list')) continue
      // Split into it()/test() blocks; pure if none of them is list-free.
      const starts = []
      const re = /\b(it|test)\s*(\.\w+)?\s*\(/g
      let m
      while ((m = re.exec(src))) starts.push(m.index)
      let hasNonListTest = false
      for (let i = 0; i < starts.length; i++) {
        const seg = src.slice(starts[i], starts[i + 1] ?? src.length)
        if (!/data-list|data-wf-list/.test(seg)) { hasNonListTest = true; break }
      }
      out.push({ rel: relPath, pure: !hasNonListTest })
    }
  }
  return out
}

// Only PURE-list files (every test in them touches data-list) are excluded
// outright — they add no non-list coverage and would otherwise just run-then-skip.
// MIXED files (list + non-list tests) stay IN and the runtime auto-skip setup
// (nano-list-autoskip.js) skips only their individual list tests.
const pureListExcludes = collectListFiles(testDir).filter(f => f.pure).map(f => f.rel)

export default defineConfig({
  root: path.resolve(__dirname, '..'),

  define: {
    __WILDFLOWER_DIST__: JSON.stringify(distMode),
    __WILDFLOWER_DIST_DIR__: JSON.stringify(distDir),
  },

  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: browserInstances,
      headless: true,
    },

    // Runtime per-test auto-skip for list tests (import-agnostic global hooks).
    setupFiles: [path.resolve(__dirname, 'nano-list-autoskip.js')],

    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],

    exclude: [
      'tests/archive/**',
      'tests/benchmark-*.test.js',
      ...pureListExcludes,
    ],

    testTimeout: 30000,
    isolate: true,
    globals: true,
    reporters: ['default', path.resolve(__dirname, 'assertion-reporter.js')],
  },

  publicDir: false,
})
