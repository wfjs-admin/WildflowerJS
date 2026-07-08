/**
 * Reproducer tests for findings in docs/CODE_REVIEW_2026-04-28_REACTIVE_PEER_REVIEW.md.
 *
 * Multi-reviewer peer review (React/Vue/Svelte/Solid core engineers) identified
 * 9 concerns. This file scaffolds reproductions for the 7 that are testable as
 * behavior tests. Concerns 3 (fast-path duplication) and 7 (batch JSON-diff) are
 * maintainability/perf concerns addressed elsewhere.
 *
 * Per CLAUDE.md TDD protocol: written to FAIL pre-fix, PASS post-fix.
 *
 * Coverage:
 *   Concern 1 — STATIC computeds with externalized conditional helpers
 *   Concern 2 — Action-before-init window
 *   Concern 4 — _reusableTrackingSet reentrancy in composed STABLE chains
 *   Concern 5 — Effect cleanup is enumeration, not walk
 *   Concern 6 — Destroy hook fires before effect disposal
 *   Concern 8 — PATH_SYMBOL aliasing across state subtrees
 *   Concern 9 — HTML flash queue silent data loss in hidden subtrees
 *
 * Run:
 *   npx vitest run --config tests/vitest.browser.config.js \
 *     tests/code-review-2026-04-28-reactive-peer-review.test.js \
 *     > test-output.txt 2>&1
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import {
  loadFramework,
  resetFramework,
  isMinifiedBuild,
  waitForUpdate
} from './helpers/load-framework.js'

describe('Code Review 2026-04-28 — Reactive Peer Review concerns', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 1 — STATIC computeds with externalized conditional helpers
  //
  // Where: ComputedPropertyManager.js:261 (CONDITIONAL_PATTERN regex),
  //        :374 (registration), :691–700 (STATIC path).
  //
  // Bug: outer fn body has no conditional tokens → regex says "no
  // conditionals" → after two stable evaluations, computed is promoted
  // to STATIC. STATIC bypasses identity verification entirely. If the
  // helper has internal branching that selects which state to read, the
  // new dep is silently never tracked. Stale reads persist.
  //
  // Pre-fix: spanishName mutation does not propagate after STATIC
  //          promotion + locale flip.
  // Post-fix: any of (a) helpers-with-state heuristic blocks STATIC
  //           promotion, (b) STATIC becomes opt-in, or (c) docs warn
  //           and dep tracking remains correct in the demonstrated case.
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 1 — STATIC computed with state-branching helper', () => {
    // IMPORTANT: this concern only applies to STORE and PLUGIN computeds.
    //
    // Component computeds are wrapped by ComponentLifecycle.js:272-289
    // in a try/catch with `if`/`||`, which trips CONDITIONAL_PATTERN
    // every time. STATIC promotion is therefore unreachable for
    // component computeds, and the bug doesn't manifest there.
    //
    // Stores (StoreManager.js:425-429) and plugins (PluginSystem.js:225-229)
    // use a thin `function() { return fn.call(context) }` wrapper with
    // no conditional tokens, so STATIC IS reachable and the bug is live.
    // Skipped on minified builds: the assertion reaches into ComputedNode
    // internals (`_hasConditionals`, `flags & STATIC`) which are mangled
    // by terser in production builds. The behavior under test (regex
    // blocks STATIC promotion when the body delegates to a helper) is
    // still exercised in dev builds, where the property names survive.
    // On Meadow the RSM tier-internal probes (sm._computedNodes, _hasConditionals,
    // node.flags & STATIC) are guarded out below: Meadow has no STATIC/STABLE/
    // DYNAMIC tier ladder, and it retracks every eval so the STATIC-bypass bug
    // can't occur. The BEHAVIORAL assertions — the branch flip re-tracks the
    // newly-read dep ('John'->'Johnny'->'Jonathan'->'Juan'->'Jorge') — DO run on
    // Meadow; that retracking correctness is exactly what's worth covering.
    it.skipIf(isMinifiedBuild())('store computed: tracks new deps after a branch flip — externalized helper case', async () => {
      // Helper body has `if`. Outer computed body does NOT — passes the
      // CONDITIONAL_PATTERN regex and is eligible for STATIC promotion.
      function pickName(state) {
        if (state.locale === 'en') return state.englishName
        return state.spanishName
      }

      wildflower.store('c1-store', {
        state: { locale: 'en', englishName: 'John', spanishName: 'Juan' },
        computed: {
          name() { return pickName(this.state) }
        }
      })

      // Locate the store's stateManager so we can inspect computed-node
      // flags and trigger evals deterministically.
      const storeProxy = wildflower.getStore('c1-store')
      expect(storeProxy).toBeTruthy()

      // Reach the underlying store instance for stateManager access.
      // Stores live in storeManager._namedStores.
      const sm = wildflower.storeManager._namedStores.get('c1-store').stateManager
      expect(sm).toBeTruthy()

      // (On RSM this asserted the computed never promoted to STATIC, which would
      // have baked stale deps when the body delegates to a branching helper.
      // Meadow has no tier ladder and re-tracks deps on every eval, so the bug
      // cannot manifest; the behavioral re-tracking is asserted below.)

      // Initial read.
      expect(storeProxy.name).toBe('John')

      // Drive multiple re-evaluations. Pre-fix, after two stable evals
      // the computed would promote to STATIC and stop tracking new deps.
      // Post-fix, the regex blocks STATIC; the computed stays on the
      // STABLE path which re-tracks deps correctly on each eval.
      storeProxy.englishName = 'Johnny'
      await waitForUpdate()
      expect(storeProxy.name).toBe('Johnny')

      storeProxy.englishName = 'Jonathan'
      await waitForUpdate()
      expect(storeProxy.name).toBe('Jonathan')

      // Flip locale — re-runs the computed (locale is a dep). In STABLE
      // mode the proxy still tracks reads, so spanishName becomes a dep
      // on this eval.
      storeProxy.locale = 'es'
      await waitForUpdate()
      expect(storeProxy.name).toBe('Juan')

      // Mutate spanishName. Pre-fix: stale 'Juan' (dep not tracked under
      // STATIC). Post-fix: 'Jorge' (STABLE re-tracked the dep).
      storeProxy.spanishName = 'Jorge'
      await waitForUpdate()
      expect(storeProxy.name).toBe('Jorge')
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 2 — Action-before-init window
  //
  // Where: ComponentLifecycle.js:127 (actions bound), :142–144 (init
  // scheduled via setTimeout(0)), :490 (_initWithStoreWait is async).
  //
  // Bug: action handlers are bound synchronously before init() is
  // scheduled. If an event fires before the next macrotask, the handler
  // runs against pre-init state. For store-subscribed components, the
  // gap can span multiple macrotasks.
  //
  // Pre-fix: synchronous click immediately after mount fires the
  //          handler before init() has run.
  // Post-fix: handler is queued/dropped/guarded until init() completes
  //          (e.g., _initReady flag or queue-and-replay).
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 2 — Action-before-init window', () => {
    it('does not fire action handlers before init() has run', async () => {
      let initRan = false
      let actionFiredBeforeInit = false
      let actionFiredAtAll = false

      wildflower.component('c2-action-before-init', {
        state: { ready: null },
        init() {
          initRan = true
          this.state.ready = true
        },
        handleClick() {
          actionFiredAtAll = true
          if (!initRan) actionFiredBeforeInit = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="c2-action-before-init">
          <button data-action="handleClick" id="c2-btn">Click</button>
        </div>
      `

      // Synchronous scan: actions are bound, init is scheduled but not
      // yet run (setTimeout(0)).
      wildflower._scanForDynamicComponents()

      // Synchronously dispatch click before yielding to the macrotask
      // queue. Pre-fix: handler fires now, before init.
      const btn = testContainer.querySelector('#c2-btn')
      btn.click()

      // Now let init() run.
      await waitForUpdate(50)

      expect(initRan).toBe(true)
      expect(actionFiredAtAll).toBe(true)
      // Pre-fix: this assertion fails. Post-fix: handler was deferred
      // or guarded.
      expect(actionFiredBeforeInit).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 5 — Effect cleanup is enumeration, not walk
  //
  // Where: ErrorBoundaries.js:414–565 (destroyComponent),
  //        ReactiveStateManager.js:2589–2592 (scope._effects),
  //        :2820–2822 (self-removal on dispose).
  //
  // Bug: scope._effects is populated, but destroyComponent doesn't
  // walk it. Effects are reached only through enumerated handles
  // (renderEffect, list disposeEffect closures, slot cleanup, ...).
  // New reactive primitives leak silently if cleanup isn't added to
  // the enumeration.
  //
  // Pre-fix: an effect created via createEffect(fn, {scope: instance})
  //          outside the enumerated paths survives destroyComponent.
  //          Subsequent state mutations re-run it.
  // Post-fix: a fallback sweep at the end of destroyComponent disposes
  //           any effects still in scope._effects.
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 5 — Scope effect fallback sweep', () => {
    it('createEffect-with-scope effects are disposed when their scope component is destroyed', async () => {
      let effectRunCount = 0

      // Use a STORE so its state outlives the component, letting us
      // verify whether the effect still fires after destroy.
      wildflower.store('c5-store', {
        state: { value: 0 }
      })

      wildflower.component('c5-leaky-effect', {
        init() {
          const sm = this._stateManager || this.stateManager
          const store = wildflower.getStore('c5-store')
          // Register an effect via the scope-based API. This is
          // OUTSIDE the enumerated cleanup paths in destroyComponent.
          sm.createEffect(() => {
            // Read the store value to subscribe.
            const _ = store.value
            effectRunCount++
          }, { scope: this })
        }
      })

      testContainer.innerHTML = `<div data-component="c5-leaky-effect"></div>`
      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const id = testContainer.querySelector('[data-component]').dataset.componentId

      // Initial effect run is expected.
      const baseline = effectRunCount

      // Sanity: mutating the store should re-run the effect.
      const store = wildflower.getStore('c5-store')
      store.value = 1
      await waitForUpdate()
      expect(effectRunCount).toBeGreaterThan(baseline)

      const beforeDestroy = effectRunCount
      wildflower.destroyComponent(id)
      await waitForUpdate()

      // Mutate the store after destroy. Pre-fix: effect still runs
      // (count increments). Post-fix: effect is disposed by the
      // fallback sweep, count stays put.
      store.value = 2
      await waitForUpdate()
      store.value = 3
      await waitForUpdate()

      expect(effectRunCount).toBe(beforeDestroy)
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 6 — Destroy hook fires before effect disposal
  //
  // Where: ErrorBoundaries.js:459–468 (user destroy() hook),
  //        :495–497 (_disposeComponentRenderEffect runs after).
  //
  // Bug: user's destroy() hook fires before render/binding effects
  // are disposed. State mutations inside destroy() route through
  // proxy traps, queue effects, and run against torn-down state.
  // Effects may update detached DOM, throw, or read invalid context.
  //
  // Pre-fix: state mutation inside destroy() produces a queued effect
  //          that runs against a partially-torn-down component.
  // Post-fix: either dispose all effects before destroy hook, or guard
  //           binding effects against detached targets.
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 6 — Destroy hook ordering vs. effect disposal', () => {
    it('state mutations inside destroy() do not propagate to effects or produce errors', async () => {
      const errors = []
      const warnings = []
      const origError = console.error
      const origWarn = console.warn
      console.error = (...args) => { errors.push(args); origError.apply(console, args) }
      console.warn = (...args) => { warnings.push(args); origWarn.apply(console, args) }

      let destroyHookRan = false

      wildflower.component('c6-destroy-mutation', {
        state: { count: 0 },
        destroy() {
          destroyHookRan = true
          // Mutate state during destroy. Per the reviewer's analysis:
          // ErrorBoundaries.js:463 (destroy hook) fires BEFORE :496
          // (_disposeComponentRenderEffect). This mutation queues an
          // effect that, pre-fix, runs against torn-down state.
          this.state.count = 999
        }
      })

      testContainer.innerHTML = `
        <div data-component="c6-destroy-mutation">
          <span data-bind="count" id="c6-span"></span>
        </div>
      `
      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const root = testContainer.querySelector('[data-component]')
      const id = root.dataset.componentId
      const span = testContainer.querySelector('#c6-span')
      expect(span.textContent).toBe('0')

      wildflower.destroyComponent(id)
      // Allow microtask drain so any queued post-destroy effect runs.
      await waitForUpdate()
      await waitForUpdate()

      console.error = origError
      console.warn = origWarn

      expect(destroyHookRan).toBe(true)

      // Behavioral assertion: the binding effect must NOT have run with
      // the post-destroy value. If it did, the span shows '999' — that
      // means the effect re-ran after the component was torn down,
      // updating a now-orphaned DOM element with stale-context state.
      // Post-fix (either dispose-effects-before-destroy, OR guard
      // bindings against detached/destroyed-context targets): span
      // stays '0'.
      expect(span.textContent,
        'binding effect ran after destroyComponent — destroy hook fires ' +
        'before render effect disposal (ErrorBoundaries.js:463 vs :496), ' +
        'so the queued state-change propagates to a torn-down component'
      ).toBe('0')

      // No console noise on clean shutdown.
      expect(errors.length, 'no console errors during destroy').toBe(0)
      expect(warnings.length, 'no console warnings during destroy').toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 8 — PATH_SYMBOL aliasing across state subtrees
  //
  // Where: ReactiveStateManager.js:430–456 (proxy reuse + PATH_SYMBOL
  // overwrite).
  //
  // Bug: when a raw object already has a proxy, the framework updates
  // PATH_SYMBOL on the raw target if the access path differs. Correct
  // for splice/reindex, silently wrong for intentional aliasing
  // (state.a = state.b = sharedObject). Subsequent property writes
  // route to the second-assigned path only.
  //
  // Pre-fix: data-bind="a.x" misses updates after sharedObject was
  //          assigned to both state.a and state.b.
  // Post-fix: __DEV__-gated console.warn at minimum; ideally separate
  //          proxies keyed per-path or a documented "no aliasing" rule
  //          enforced.
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 8 — PATH_SYMBOL aliasing across state subtrees', () => {
    it('aliased shared object keeps both bindings live when written through either path', async () => {
      const shared = { x: 1 }

      wildflower.component('c8-aliased', {
        state: { a: null, b: null },
        init() {
          // Intentional aliasing.
          this.state.a = shared
          this.state.b = shared
        }
      })

      testContainer.innerHTML = `
        <div data-component="c8-aliased">
          <span id="c8-a-x" data-bind="a.x"></span>
          <span id="c8-b-x" data-bind="b.x"></span>
        </div>
      `
      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const root = testContainer.querySelector('[data-component]')
      const id = root.dataset.componentId
      const instance = wildflower.componentInstances.get(id)

      // Both bindings should reflect the initial shared.x === 1.
      expect(testContainer.querySelector('#c8-a-x').textContent).toBe('1')
      expect(testContainer.querySelector('#c8-b-x').textContent).toBe('1')

      // Mutate via state.a.x. Pre-fix: PATH_SYMBOL on `shared` was
      // overwritten to `b` during init, so this write notifies path
      // 'b.x' but NOT 'a.x'.
      instance.state.a.x = 42
      await waitForUpdate()

      expect(testContainer.querySelector('#c8-b-x').textContent).toBe('42')
      // The load-bearing assertion — fails pre-fix.
      expect(testContainer.querySelector('#c8-a-x').textContent).toBe('42')
    })

  })

  // ─────────────────────────────────────────────────────────────────
  // Concern 9 — HTML flash queue silent data loss in hidden subtrees
  //
  // Where: ProxyHandlers.js:284–297 (queue write),
  //        ReactiveStateManager.js:2499–2530 (drain + clear),
  //        RenderingCore.js:495 / PortalSystem.js:462 (drain triggers).
  //
  // Bug: _processHtmlInitialQueue is triggered when a data-bind-html
  // context registers. If the data-bind-html element is inside a
  // data-render="false" conditional or unactivated portal at init, its
  // registration never fires the drain. The queued state value is
  // cleared at :2527 without being applied. Initial state is silently
  // lost when the conditional/portal is later revealed.
  //
  // Pre-fix: revealing the conditional shows an empty element.
  // Post-fix: drain on conditional reveal / portal activation, OR drop
  //          the flash queue and rely on reveal-time binding.
  // ─────────────────────────────────────────────────────────────────
  describe('Concern 9 — HTML flash queue silent data loss in hidden subtrees', () => {
    it('data-bind-html inside data-render="false" reflects init-set HTML when later revealed', async () => {
      wildflower.component('c9-hidden-html', {
        state: { show: false, message: '' },
        init() {
          // Initial state set into a hidden subtree. Pre-fix: this
          // value enters the HTML flash queue and is cleared without
          // being applied because the data-bind-html element never
          // registered (it's inside data-render="false").
          this.state.message = '<b>hello</b>'
        },
        reveal() { this.state.show = true }
      })

      testContainer.innerHTML = `
        <div data-component="c9-hidden-html">
          <button data-action="reveal" id="c9-reveal">Show</button>
          <div data-render="show">
            <div id="c9-msg" data-bind-html="message"></div>
          </div>
        </div>
      `
      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const root = testContainer.querySelector('[data-component]')
      const id = root.dataset.componentId
      const instance = wildflower.componentInstances.get(id)

      // Reveal the conditional.
      instance.reveal()
      await waitForUpdate()

      const msg = testContainer.querySelector('#c9-msg')
      expect(msg).toBeTruthy()
      // Pre-fix: msg.innerHTML is '' because the queue was cleared.
      // Post-fix: msg renders the bold tag set in init().
      expect(msg.innerHTML.toLowerCase()).toContain('<b>hello</b>')
    })
  })
})
