/**
 * Go-live correctness tests for the reactive-graph cutover (framework level).
 *
 * Covers lifecycle/teardown and batch-cancel behaviors that a green behavioral
 * suite doesn't exercise: listener teardown on destroy, pre-init action replay
 * after a self-destroy, and cancelBatch not dropping unrelated pre-batch renders.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe.skipIf(isMinifiedBuild())('Reactive-graph correctness (go-live)', () => {
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
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('removes a direct-bound action listener from the DOM on destroy (M1)', async () => {
    testContainer.innerHTML = `
      <div data-component="m1-comp">
        <button id="m1-btn" data-action="click:handleClick">Click</button>
      </div>
    `
    let clicks = 0
    wildflower.component('m1-comp', {
      handleClick() { clicks++ }
    })
    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="m1-comp"]')
    const instanceId = component.dataset.componentId
    const btn = testContainer.querySelector('#m1-btn')

    btn.click()
    expect(clicks).toBe(1) // sanity: action wired via direct binding

    // Spy on the button's removeEventListener.
    const removedTypes = []
    const origRemove = btn.removeEventListener.bind(btn)
    btn.removeEventListener = (type, fn, opts) => {
      removedTypes.push(type)
      return origRemove(type, fn, opts)
    }

    // Destroy the component but leave the element attached, so a leaked listener
    // would NOT be GC'd. Before the fix the bare-function handler entry was
    // deleted from the map but the DOM listener was never removed.
    wildflower.destroyComponent(instanceId)

    expect(removedTypes).toContain('click')
  })

  it('does not replay a queued pre-init action after init() self-destroys (M2)', async () => {
    let actionRan = 0
    let capturedId = null

    wildflower.component('m2-comp', {
      state: { count: 0 },
      init() {
        // Synchronously self-destroy during init.
        if (capturedId) window.wildflower.destroyComponent(capturedId)
      },
      bump() { actionRan++ }
    })

    testContainer.innerHTML = `
      <div data-component="m2-comp">
        <button id="m2-btn" data-action="click:bump">Bump</button>
      </div>
    `
    wildflower.scan()

    const component = testContainer.querySelector('[data-component="m2-comp"]')
    capturedId = component.dataset.componentId
    const btn = testContainer.querySelector('#m2-btn')

    // Fire before the deferred init() runs -> the call is queued.
    btn.click()
    expect(actionRan).toBe(0) // queued, not yet executed

    await waitForCompleteRender() // init() runs, self-destroys, then replay

    // Before the fix the replay loop drained without rechecking destruction, so
    // bump() ran against the torn-down instance; after the fix it is skipped.
    expect(actionRan).toBe(0)
  })

  it('cancelBatch does not drop an unrelated render queued before the batch (M4)', async () => {
    wildflower.store('m4A', { state: { v: 'A1' } })
    wildflower.store('m4B', { state: { v: 'B1' } })

    wildflower.component('m4-a', {
      computed: { aVal() { return window.wildflower.getStore('m4A').v } }
    })
    wildflower.component('m4-b', {
      computed: { bVal() { return window.wildflower.getStore('m4B').v } }
    })

    testContainer.innerHTML = `
      <div data-component="m4-a"><span id="m4-a-out" data-bind="aVal"></span></div>
      <div data-component="m4-b"><span id="m4-b-out" data-bind="bVal"></span></div>
    `
    wildflower.scan()
    await waitForCompleteRender()

    const aOut = testContainer.querySelector('#m4-a-out')
    const bOut = testContainer.querySelector('#m4-b-out')
    expect(aOut.textContent).toBe('A1')
    expect(bOut.textContent).toBe('B1')

    // Unrelated render scheduled BEFORE the batch opens.
    window.wildflower.getStore('m4B').v = 'B2'

    // Open a batch, mutate A inside it, then cancel.
    const ctx = window.wildflower.startBatch()
    window.wildflower.getStore('m4A').v = 'A2'
    ctx.cancel()

    await waitForCompleteRender()

    // A's in-batch render is cancelled (DOM stays at the pre-batch value, though
    // state persists). B's pre-batch render must survive the cancel.
    expect(bOut.textContent).toBe('B2')
    expect(aOut.textContent).toBe('A1')
  })

  it('drops outside-click registrations on destroy (L3)', async () => {
    testContainer.innerHTML = `
      <div data-component="l3-comp">
        <div id="l3-menu" data-action="click:close" data-event-outside>Menu</div>
      </div>
    `
    wildflower.component('l3-comp', { close() {} })
    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="l3-comp"]')
    const instanceId = component.dataset.componentId

    // The component registered an outside-click handler.
    expect(wildflower._outsideClickRegistry && wildflower._outsideClickRegistry.size).toBeGreaterThan(0)

    wildflower.destroyComponent(instanceId)

    // Before the fix the entry lingered until the next document click ran the
    // lazy isConnected sweep; now it is pruned on destroy.
    const remaining = wildflower._outsideClickRegistry ? wildflower._outsideClickRegistry.size : 0
    expect(remaining).toBe(0)
  })

  // RG-1 (review 2026-07-02): the pure-single-text direct-writer retirement
  // suppresses the graph wake AND the onStateChange dispatch (DIRECT_HANDLED).
  // A component computed that reads the same item leaves through the graph
  // (an aggregate) must therefore block the retirement; otherwise it goes
  // permanently stale after the field's first change stamps the writer.
  it('keeps an aggregate computed fresh across repeated writes to a pure-single-text list field (RG-1)', async () => {
    testContainer.innerHTML = `
      <div data-component="rg1-total">
        <span id="rg1-out" data-bind="total"></span>
        <ul data-list="items">
          <template>
            <li><span class="qty" data-bind="qty"></span></li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('rg1-total', {
      state: {
        items: [
          { id: 1, qty: 1 },
          { id: 2, qty: 2 },
        ]
      },
      computed: {
        total() { return this.state.items.reduce((s, i) => s + i.qty, 0) }
      }
    })
    wildflower.scan()
    await waitForCompleteRender()

    const out = () => testContainer.querySelector('#rg1-out').textContent
    const qty0 = () => testContainer.querySelector('[data-list="items"] .qty').textContent
    expect(out()).toBe('3')

    const component = testContainer.querySelector('[data-component="rg1-total"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // First write wakes the per-item effect normally (this is where the stamp
    // would happen); second and third writes are where a stamped writer starves
    // the computed.
    instance.state.items[0].qty = 10
    await waitForCompleteRender()
    expect(qty0()).toBe('10')
    expect(out()).toBe('12')

    instance.state.items[0].qty = 100
    await waitForCompleteRender()
    expect(qty0()).toBe('100')
    expect(out()).toBe('102')

    instance.state.items[0].qty = 1000
    await waitForCompleteRender()
    expect(qty0()).toBe('1000')
    expect(out()).toBe('1002')
  })

  // RG-1 companion: watchers ride onStateChange, which DIRECT_HANDLED also
  // suppresses. A watcher on the field must keep firing for every write.
  it('keeps a watcher firing across repeated writes to a pure-single-text list field (RG-1)', async () => {
    const fired = []
    testContainer.innerHTML = `
      <div data-component="rg1-watch">
        <ul data-list="items">
          <template>
            <li><span class="qty" data-bind="qty"></span></li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('rg1-watch', {
      state: {
        items: [{ id: 1, qty: 1 }]
      },
      watch: {
        'items.0.qty'(nv, ov) { fired.push([nv, ov]) }
      }
    })
    wildflower.scan()
    await waitForCompleteRender()
    const component = testContainer.querySelector('[data-component="rg1-watch"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    instance.state.items[0].qty = 2
    await waitForCompleteRender()
    const afterFirst = fired.length
    expect(afterFirst).toBeGreaterThan(0)

    instance.state.items[0].qty = 3
    await waitForCompleteRender()
    expect(fired.length).toBeGreaterThan(afterFirst)
  })

  // RG-5 (Chris decision: option 1): watching/subscribing to list items by
  // numeric index is an anti-pattern. onStateChange paths reflect the item's
  // position when first observed and go stale after splice/reorder, so the
  // dev build warns at registration.
  it('warns in dev when a watch path targets a list item by numeric index (RG-5)', async () => {
    const warnings = []
    const origWarn = console.warn
    console.warn = (...args) => { warnings.push(args.join(' ')); origWarn.apply(console, args) }
    try {
      testContainer.innerHTML = `<div data-component="rg5-indexed-watch"></div>`
      wildflower.component('rg5-indexed-watch', {
        state: { items: [{ qty: 1 }] },
        watch: {
          'items.0.qty'() {}
        }
      })
      wildflower.scan()
      await waitForCompleteRender()
    } finally {
      console.warn = origWarn
    }
    expect(warnings.some(w => w.includes('WF-213') && w.includes('items.0.qty'))).toBe(true)
  })
})
