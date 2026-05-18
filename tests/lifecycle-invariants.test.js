/**
 * Lifecycle invariant audit — Plan A from
 * docs/future/REACTIVITY_HARDENING_PROPOSAL_2026-05-17.md.
 *
 * Each test asserts a phase-ordering invariant that the framework's
 * lifecycle assumes but doesn't enforce structurally. The probe pattern
 * mirrors tests/scanner-subscribe-before-computed.test.js: instrument
 * the dependent phase, capture the moment it observes the prerequisite,
 * and assert the prerequisite was already in place.
 *
 * If an invariant test fails, the framework has a latent ordering race in
 * the corresponding code path — even if the visible bug only surfaces
 * under specific timing.
 *
 * Companion doc: docs/LIFECYCLE_INVARIANTS.md.
 *
 * Author: amber-otter-23, 2026-05-17.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('lifecycle invariants', () => {
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
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (wildflower?._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) {
        cancelAnimationFrame(wildflower._poolLoopId)
        wildflower._poolLoopId = null
      }
    }
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // =========================================================================
  // I-PROPS: props initialized before first computed eval
  //
  // _initializeProps runs inside _createComponentCore (phase 3 of the batch
  // orchestrator and the first sub-step of mid-life). _setupComputedProperties
  // runs in phase 5 (batch) / a few lines later (mid-life). A computed reading
  // a prop on its first eval must see the prop's initial value, not undefined.
  // =========================================================================
  it('I-PROPS: computed first eval sees initialized props', async () => {
    let firstEvalValue = null

    wildflower.component('props-parent', {
      state: { greeting: 'hi' }
    })
    wildflower.component('props-child', {
      props: { greeting: { type: String } },
      computed: {
        upper() {
          // First eval — props must already be initialized.
          if (firstEvalValue === null) {
            firstEvalValue = this.props.greeting
          }
          return (this.props.greeting || '').toUpperCase()
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="props-parent">
        <div data-component="props-child" data-prop-greeting="greeting"></div>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(firstEvalValue).toBe('hi')
  })

  // =========================================================================
  // I-WATCHER: watchers wired before init() can mutate state
  //
  // _setupWatchers runs in features phase (phase 9 batch / line 129 mid-life).
  // User init() runs in the deferred macrotask (phase 14). Any state mutation
  // inside init() must trigger its watcher.
  //
  // Edge case: synchronous mutations in init() — the watcher must fire.
  // =========================================================================
  it('I-WATCHER: watcher fires for state mutation inside init()', async () => {
    let watcherFiredWith = null

    wildflower.component('watcher-init', {
      state: { count: 0 },
      watch: {
        count(newVal) {
          watcherFiredWith = newVal
        }
      },
      init() {
        this.state.count = 42
      }
    })

    testContainer.innerHTML = '<div data-component="watcher-init"></div>'
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(watcherFiredWith).toBe(42)
  })

  // =========================================================================
  // I-LIST-MIDLIFE: list relationships populated for late-registered components
  //
  // The async batch orchestrator added _prepopulateListRelationships as a
  // pre-features pass so render effects see relationships when they fire.
  // But _initializeComponentElement (mid-life path, e.g. dynamic SPA mount)
  // doesn't run that pre-pass — it relies on per-component _setupListContexts
  // which runs AFTER _processComponentBindings creates the render effect.
  //
  // If this invariant fails, a late-mounted component with a nested data-list
  // will render the outer list but not the inner one on the first pass.
  // =========================================================================
  it('I-LIST-MIDLIFE: late-mounted nested list renders inner items', async () => {
    wildflower.component('host-shell', {
      state: {}
    })

    wildflower.component('nested-list-comp', {
      state: {
        sections: [
          { title: 'A', items: [{ id: 1, text: 'a1' }, { id: 2, text: 'a2' }] },
          { title: 'B', items: [{ id: 3, text: 'b1' }] }
        ]
      }
    })

    // Mount the shell first so framework is fully initialized.
    testContainer.innerHTML = '<div id="shell" data-component="host-shell"></div>'
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // Now inject the nested-list component LATE — this exercises the
    // mid-life path (_initializeComponentElement) rather than the batch
    // orchestrator. Any list-relationship race specific to that path
    // surfaces here.
    const shell = testContainer.querySelector('#shell')
    shell.innerHTML = `
      <div data-component="nested-list-comp">
        <div data-list="sections">
          <template>
            <div class="section">
              <h3 data-bind="title"></h3>
              <ul data-list="items">
                <template>
                  <li data-bind="text"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `
    await waitForCompleteRender()

    const inner = shell.querySelectorAll('li')
    expect(inner.length).toBe(3)
    const texts = Array.from(inner).map(li => li.textContent)
    expect(texts).toEqual(['a1', 'a2', 'b1'])
  })

  // =========================================================================
  // I-POOL-RENDERS: pool populated from state in init() actually renders entities
  //
  // The audit-time finding: PoolHandle.length / .size are plain JS getters with
  // no reactive proxy — so a computed reading pool.length will NEVER update.
  // This is by design (pools intentionally bypass reactivity for performance).
  // The doc's "lurking #2" was based on an incorrect assumption that cascade
  // existed; empirically it does not. We document this in LIFECYCLE_INVARIANTS.md
  // as a known limitation + footgun (computed properties cannot reactively read
  // pool aggregate state — use store/state intermediaries instead).
  //
  // The actual invariant to verify here: a pool populated inside the deferred
  // init() macrotask (phase 14) does render its entities — i.e. _setupPools
  // (phase 9) runs early enough that the PoolHandle exists when init() fires.
  // This is the "pool setup precedes init" ordering invariant.
  // =========================================================================
  const itIfPools = hasFeature('pools') ? it : it.skip
  itIfPools('I-POOL-RENDERS: pool populated in init() renders entities', async () => {
    testContainer.innerHTML = `
      <div data-component="pool-renders">
        <div data-pool="enemies">
          <template>
            <div class="enemy"><span data-bind="name"></span></div>
          </template>
        </div>
      </div>
    `

    wildflower.component('pool-renders', {
      state: {},
      init() {
        // Pool must exist by the time init() runs (i.e. _setupPools (phase 9)
        // completed before the deferred init macrotask (phase 14)).
        const p = this.pool('enemies')
        if (!p) throw new Error('pool not initialized before init()')
        p.add({ id: 1, name: 'a' })
        p.add({ id: 2, name: 'b' })
        p.add({ id: 3, name: 'c' })
      }
    })

    ensureComponentScanning(wildflower)
    await waitForCompleteRender()
    // Pool render flush is rAF-driven — wait an extra frame.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await waitForCompleteRender()

    const enemies = testContainer.querySelectorAll('.enemy')
    expect(enemies.length).toBe(3)
  })

  // =========================================================================
  // I-RENDER-EFFECT-DEPS: render effect re-fires when computed deps change
  //
  // _processComponentBindings (phase 9 batch / line 144 mid-life) creates
  // the component render effect. The effect reads any computed referenced
  // by data-bind. STABLE-promotion happens after the computed's second eval
  // — the render effect may capture the computed when it's still UNSTABLE.
  //
  // The invariant: regardless of computed STABILITY state at effect-creation
  // time, a later mutation of a dep that the computed reads MUST trigger
  // the render effect to re-fire and update the DOM.
  // =========================================================================
  it('I-RENDER-EFFECT-DEPS: computed dep mutation cascades to render effect', async () => {
    wildflower.store('render-effect-store', {
      state: { multiplier: 1 }
    })

    wildflower.component('render-effect-comp', {
      subscribe: { 'render-effect-store': ['multiplier'] },
      state: { base: 5 },
      computed: {
        // Reads both local state AND a cross-store dep — exercises the
        // mixed-dep registration that previous races have hit.
        product() {
          return this.state.base * this.stores['render-effect-store'].multiplier
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="render-effect-comp">
        <span class="result" data-bind="product"></span>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const span = testContainer.querySelector('.result')
    expect(span.textContent).toBe('5')

    // Mutate the store dep — render effect must re-fire.
    wildflower.getStore('render-effect-store').multiplier = 3
    await waitForCompleteRender()
    expect(span.textContent).toBe('15')

    // Mutate the local state dep — render effect must re-fire.
    const instance = wildflower.componentInstances.get(
      testContainer.querySelector('[data-component="render-effect-comp"]').dataset.componentId
    )
    instance.context.state.base = 10
    await waitForCompleteRender()
    expect(span.textContent).toBe('30')
  })

  // =========================================================================
  // I-DESTROY-NO-RESURRECT: destroy + DOM removal prevents init from running
  //
  // Lurking risk #4 from the proposal: "Component destroy + in-flight async
  // work. If _disposeMapArray runs while a store mutation is queued in the
  // same microtask, can effects fire on disposed nodes?"
  //
  // Plan A finding: destroyComponent alone does NOT prevent init() if the
  // element remains in the live DOM. The framework's auto-resurrect path
  // (ComponentScanning.js line 154; ErrorBoundaries.js GC sweep line 835)
  // strips the stale data-component-id from any live element whose instance
  // is gone, and a subsequent scan re-creates + re-inits the component as a
  // fresh instance. This is by design (handles third-party HTML caching) but
  // means destroyComponent is not a sufficient prevent-init signal.
  //
  // The actual contract is: destroy + remove-from-DOM prevents init. This is
  // documented in LIFECYCLE_INVARIANTS.md under "Known behaviors that look
  // like bugs but aren't" and tested here as the supported pattern.
  // =========================================================================
  it('I-DESTROY-NO-RESURRECT: destroy + DOM removal prevents init', async () => {
    let initRunCount = 0

    wildflower.store('destroy-store', { state: { x: 0 } })

    wildflower.component('destroy-victim', {
      subscribe: { 'destroy-store': ['x'] },
      init() {
        initRunCount++
      }
    })

    testContainer.innerHTML = '<div data-component="destroy-victim"></div>'
    ensureComponentScanning(wildflower)
    // Force a synchronous scan so the instance is created in this task.
    // init() is deferred via setTimeout(0) inside _initializeComponentElement.
    wildflower.scan(testContainer)

    const el = testContainer.querySelector('[data-component="destroy-victim"]')
    const instanceId = el.dataset.componentId
    expect(instanceId).toBeTruthy()
    expect(wildflower.componentInstances.has(instanceId)).toBe(true)

    // Remove FIRST, then destroy. Removal severs the auto-resurrect path
    // (no live element → no re-scan → no fresh instance).
    el.remove()
    wildflower.destroyComponent(instanceId)
    expect(wildflower.componentInstances.has(instanceId)).toBe(false)

    // Let the deferred init macrotask fire — it should bail out via the
    // componentInstances guard, not throw, and not run init().
    await waitForCompleteRender()

    expect(initRunCount).toBe(0)

    // Mutate the store — the destroyed component must not be cascade-invoked
    // (no error, no stale watcher firing).
    wildflower.getStore('destroy-store').x = 99
    await waitForCompleteRender()
    expect(initRunCount).toBe(0)
  })

  // =========================================================================
  // I-NESTED-PROP-REACTIVE: parent state change propagates to child via prop
  //
  // Tests the prop-as-reactive-binding contract: child component with
  // data-prop-foo="bar" reads parent.state.bar; when parent mutates bar,
  // child's view of the prop updates.
  //
  // Lifecycle invariant: parent's state binding for the prop path must be
  // wired BEFORE the child's render effect captures the prop in its deps.
  // Otherwise the child sees a stale value forever.
  // =========================================================================
  it('I-NESTED-PROP-REACTIVE: parent state change propagates to child prop', async () => {
    wildflower.component('nested-parent', {
      state: { greeting: 'hello' }
    })
    wildflower.component('nested-child', {
      props: { greeting: { type: String } }
    })

    testContainer.innerHTML = `
      <div data-component="nested-parent">
        <div data-component="nested-child" data-prop-greeting="greeting">
          <span class="out" data-bind="props.greeting"></span>
        </div>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const out = testContainer.querySelector('.out')
    expect(out.textContent).toBe('hello')

    // Mutate parent state — child prop must reactively update.
    const parentEl = testContainer.querySelector('[data-component="nested-parent"]')
    const parentInstance = wildflower.componentInstances.get(parentEl.dataset.componentId)
    parentInstance.context.state.greeting = 'world'
    await waitForCompleteRender()

    expect(out.textContent).toBe('world')
  })

  // =========================================================================
  // I-CROSS-STORE-NO-SUBSCRIBE: doc-flagged known gap (medium risk)
  //
  // Per the proposal's "Medium: cross-store dep gaps in non-subscribe paths":
  // a computed that reads a store via a method call (not direct property
  // access) and has an early-return that can skip the cross-store read on
  // first eval is still vulnerable if subscribe wasn't declared. This test
  // documents the boundary: WITH subscribe → cascades; WITHOUT subscribe
  // → the read-through-method early-return pattern would silently miss
  // cross-store mutations.
  //
  // We test the SUPPORTED contract (with subscribe declared) — this should
  // pass and serves as a regression guard for the fix landed today.
  // The unsupported case is documented in LIFECYCLE_INVARIANTS.md as a
  // known footgun requiring documentation.
  // =========================================================================
  it('I-CROSS-STORE-METHOD-CALL: method-read cross-store with subscribe declared cascades correctly', async () => {
    wildflower.store('xs-method-store', {
      state: { ready: false, value: 0 },
      // Method read — receiver inside method is bound raw context, NOT
      // tracking proxy. So tracking proxy can't auto-register the deps.
      getValue() {
        if (!this.ready) return -1
        return this.value
      }
    })

    wildflower.component('xs-method-reader', {
      // Subscribe declaration is the fallback path that makes this work.
      subscribe: { 'xs-method-store': ['ready', 'value'] },
      computed: {
        v() {
          return this.stores['xs-method-store'].getValue()
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="xs-method-reader">
        <span class="v" data-bind="v"></span>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const span = testContainer.querySelector('.v')
    expect(span.textContent).toBe('-1') // initial: ready=false → early return

    const store = wildflower.getStore('xs-method-store')
    store.value = 42
    store.ready = true
    await waitForCompleteRender()

    expect(span.textContent).toBe('42') // cascade fired via subscribe block
  })

  // =========================================================================
  // I-ACTION-QUEUE: actions dispatched before init() runs are replayed in order
  //
  // _bindComponentActions runs in features phase (phase 9). User init() runs
  // in the deferred macrotask (phase 14). Between phase 9 and 14, a click
  // can fire — _wrapMethod queues it against !_initReady. The queued action
  // must replay AFTER init() completes, in dispatch order, with init-set
  // state visible.
  //
  // This is the "actions before init are queued, not dropped" contract from
  // CLAUDE.md's Lifecycle and Action Constraints section.
  // =========================================================================
  it('I-ACTION-QUEUE: pre-init actions replay after init() with init state visible', async () => {
    const calls = []

    wildflower.component('action-queue-comp', {
      state: { prefix: '' },
      init() {
        this.state.prefix = 'INITED'
      },
      handleClick() {
        calls.push(this.state.prefix)
      }
    })

    testContainer.innerHTML = `
      <div data-component="action-queue-comp">
        <button id="btn" data-action="handleClick">click</button>
      </div>
    `
    ensureComponentScanning(wildflower)
    // Don't wait for init — fire the click immediately so it queues.
    await new Promise(r => setTimeout(r, 0))
    const btn = testContainer.querySelector('#btn')
    btn.click()
    btn.click()

    await waitForCompleteRender()

    // Both clicks must have run, and both must have observed the
    // post-init prefix value (not the pre-init empty string).
    expect(calls.length).toBe(2)
    expect(calls).toEqual(['INITED', 'INITED'])
  })
})
