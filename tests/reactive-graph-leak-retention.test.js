/**
 * Reactive-graph retention tests.
 *
 * These assert that create/teardown is symmetric across mount -> mutate ->
 * unmount cycles. They are retention assertions, not behavioral ones: the
 * rendered output is correct either way, so only a size/identity check on the
 * framework's tracking collections catches a missed teardown.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

const makeItems = (gen, n) =>
  Array.from({ length: n }, (_, i) => ({ id: `${gen}-${i}`, name: `row ${gen}-${i}` }))

describe.skipIf(isMinifiedBuild())('Reactive-graph retention', () => {
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

  it('prunes dispatcher row registrations (rows/rawStamps) on row churn', async () => {
    // The expression text binding makes the template HEAVY (no sink-stampable
    // leaf), so rows register on the COMPUTED per-list dispatcher — the P4-S6
    // world's per-row bookkeeping. The retention contract is the same one the
    // old _listItemEffects registry pinned: create/teardown must be symmetric,
    // or every churned row's raw item (and its stamped graph nodes) stays
    // pinned in the dispatcher maps for the list's lifetime.
    testContainer.innerHTML = `
      <div data-component="retain-list">
        <div data-list="items">
          <template>
            <div class="row"><span data-bind="name"></span><span class="shout" data-bind="name + '!'"></span></div>
          </template>
        </div>
      </div>
    `

    wildflower.component('retain-list', {
      state: { items: makeItems(0, 5) }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="retain-list"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)
    const sm = instance.stateManager

    const listEl = component.querySelector('[data-list="items"]')
    const dispatcher = listEl._wfListSinkDispatcher
    expect(dispatcher).toBeDefined()
    expect(dispatcher.computedRows).toBe(true)
    expect(dispatcher.rows.size).toBeGreaterThan(0)
    // No per-row effects anywhere in the new world.
    expect(component.querySelector('.row')._wfDisposeEffect).toBeNull()

    const N = 5
    const CYCLES = 12

    // Each cycle uses brand-new keys, so every prior row is torn down and N new
    // rows are created. The component is never destroyed, so the dispatcher
    // lives across the whole churn.
    for (let gen = 1; gen <= CYCLES; gen++) {
      instance.state.items = makeItems(gen, N)
      await waitForCompleteRender()
    }

    const liveRows = component.querySelectorAll('.row').length
    expect(liveRows).toBe(N)

    // The maps must track roughly the LIVE rows, not every row ever created.
    // A missed removal/replace cleanup grows them to ~N*(CYCLES+1).
    const d = listEl._wfListSinkDispatcher
    expect(d.rows.size).toBeLessThanOrEqual(N * 2)
    expect(d.rawStamps.size).toBeLessThanOrEqual(N * 2)
  })

  it('disposes nested-list per-item effects when a parent row is removed', async () => {
    testContainer.innerHTML = `
      <div data-component="retain-nested">
        <div data-list="groups">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div data-list="items">
                <template>
                  <div class="item"><span data-bind="label"></span><span class="shout" data-bind="label + '!'"></span></div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    const makeGroups = (gen, nGroups, nItems) =>
      Array.from({ length: nGroups }, (_, g) => ({
        id: `${gen}-g${g}`,
        name: `group ${gen}-${g}`,
        items: Array.from({ length: nItems }, (_, i) => ({
          id: `${gen}-g${g}-i${i}`,
          label: `item ${gen}-${g}-${i}`
        }))
      }))

    const N_GROUPS = 2
    const N_ITEMS = 3

    wildflower.component('retain-nested', {
      state: { groups: makeGroups(0, N_GROUPS, N_ITEMS) }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="retain-nested"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)
    const sm = instance.stateManager

    // Nested rows rendered. Rows carry no per-row effects (P4-S6): each
    // nested list's HEAVY template (expression binding) registers its rows on
    // a per-nested-list COMPUTED dispatcher, which owns ONE stable shared-dep
    // effect tracked in sm._effects.
    expect(component.querySelectorAll('.item').length).toBe(N_GROUPS * N_ITEMS)
    const effectsAfterFirstRender = sm._effects.size
    expect(effectsAfterFirstRender).toBeGreaterThan(0)

    const CYCLES = 10
    // Each cycle replaces every group (new keys) with fresh nested items.
    // Removing a parent row must tear down the nested list inside it —
    // including disposing its dispatcher's stable per-list effect. A missed
    // teardown grows sm._effects by one per nested list per cycle.
    for (let gen = 1; gen <= CYCLES; gen++) {
      instance.state.groups = makeGroups(gen, N_GROUPS, N_ITEMS)
      await waitForCompleteRender()
    }

    // Live state: N_GROUPS group rows + N_GROUPS*N_ITEMS nested rows.
    expect(component.querySelectorAll('.group').length).toBe(N_GROUPS)
    expect(component.querySelectorAll('.item').length).toBe(N_GROUPS * N_ITEMS)

    // Effect count must track the LIVE structure, not every nested list ever
    // created across the churn.
    expect(sm._effects.size).toBeLessThanOrEqual(effectsAfterFirstRender + N_GROUPS)
  })

  it('prunes nested-list contexts from _listContexts when parent rows are removed', async () => {
    testContainer.innerHTML = `
      <div data-component="retain-ctx">
        <div data-list="groups">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div data-list="items">
                <template>
                  <div class="item"><span data-bind="label"></span></div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    const makeGroups = (gen, nGroups, nItems) =>
      Array.from({ length: nGroups }, (_, g) => ({
        id: `${gen}-g${g}`,
        name: `group ${gen}-${g}`,
        items: Array.from({ length: nItems }, (_, i) => ({
          id: `${gen}-g${g}-i${i}`,
          label: `item ${gen}-${g}-${i}`
        }))
      }))

    wildflower.component('retain-ctx', {
      state: { groups: makeGroups(0, 1, 2) }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="retain-ctx"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)

    // Grow to a high-water-mark of parent rows, each carrying a nested list.
    const N_BIG = 8
    instance.state.groups = makeGroups('big', N_BIG, 2)
    await waitForCompleteRender()
    expect(component.querySelectorAll('.group').length).toBe(N_BIG)
    // 1 top-level "groups" context + one nested "groups[i].items" per parent.
    expect(instance._listContexts.size).toBeGreaterThanOrEqual(N_BIG)

    // Shrink back to a single parent row. The removed rows' nested-list contexts
    // must be pruned. Before the fix the index-bearing keys persisted at the
    // high-water-mark (~N_BIG+1), pinning detached nested list elements.
    instance.state.groups = makeGroups('small', 1, 2)
    await waitForCompleteRender()
    expect(component.querySelectorAll('.group').length).toBe(1)

    // Live structure: top-level "groups" + a single "groups[0].items" = 2.
    expect(instance._listContexts.size).toBeLessThanOrEqual(3)
  })

  it('disposes the computed-notifier effect on destroy (no orphan store-driven pulse)', async () => {
    wildflower.store('h4store', { state: { n: 1 } })

    wildflower.component('h4comp', {
      computed: {
        // Reads an external, long-lived store: the store's reactive node ends up
        // with an observer back-edge into this entity's notifier effect.
        doubled() { return window.wildflower.getStore('h4store').n * 2 }
      },
      watch: {
        // A watcher on the computed is what installs the computed:NAME notifier.
        doubled() { /* observed only via the notifier pulse */ }
      }
    })

    testContainer.innerHTML = '<div data-component="h4comp"><span data-bind="doubled"></span></div>'
    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="h4comp"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)
    const sm = instance.stateManager

    // Count notifier pulses by wrapping onStateChange (the notifier's only output).
    const origOnStateChange = sm.onStateChange.bind(sm)
    let pulses = 0
    sm.onStateChange = (key, ...rest) => {
      if (key === 'computed:doubled') pulses++
      return origOnStateChange(key, ...rest)
    }

    // While alive: a store mutation drives the notifier.
    window.wildflower.getStore('h4store').n = 2
    await waitForCompleteRender()
    expect(pulses).toBeGreaterThan(0)

    // Destroy the component, then mutate the store again.
    wildflower.destroyComponent(instanceId)
    await waitForCompleteRender()

    const pulsesAtDestroy = pulses
    window.wildflower.getStore('h4store').n = 3
    await waitForCompleteRender()
    window.wildflower.getStore('h4store').n = 4
    await waitForCompleteRender()

    // Before the fix the orphan notifier (bare effect, untracked, never disposed)
    // keeps firing on every post-destroy store mutation; after the fix it is
    // disposed with the component and stays silent.
    expect(pulses).toBe(pulsesAtDestroy)
  })

  // RG-2 (review 2026-07-02): the TOP-LEVEL data-list structural effect is a raw
  // core effect stored only on element._disposeMapArray, so it is in no set the
  // destroy sweep iterates. For a list fed (via a computed) from a long-lived
  // store, the store nodes keep observer back-edges to it: after
  // destroyComponent every store mutation re-runs the reconcile against the
  // dead component, creating rows and registering fresh per-item effects into
  // the destroyed state manager, unboundedly. (H2 covered only NESTED lists on
  // parent-row removal; this is the same shape one level up.)
  it('disposes a store-backed top-level data-list on component destroy (RG-2)', async () => {
    window.wildflower.store('rg2store', {
      state: { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }
    })
    testContainer.innerHTML = `
      <div data-component="rg2-storelist">
        <ul data-list="cartItems">
          <template>
            <li><span class="l" data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('rg2-storelist', {
      state: {},
      subscribe: { rg2store: ['items'] },
      computed: {
        cartItems() { return window.wildflower.getStore('rg2store').items }
      }
    })
    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="rg2-storelist"]')
    const listEl = testContainer.querySelector('[data-list="cartItems"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const sm = instance.stateManager
    const rowCount = () => listEl.querySelectorAll('li').length
    expect(rowCount()).toBe(2)

    wildflower.destroyComponent(component.dataset.componentId)
    await waitForCompleteRender()
    const rowsAtDestroy = rowCount()
    const effectsAtDestroy = sm._effects.size

    // Mutate the long-lived store after destroy. An orphaned structural effect
    // reconciles the dead component's list: rows grow and new per-item effects
    // register into the destroyed state manager.
    const store = window.wildflower.getStore('rg2store')
    store.items = [...store.items, { id: 3, label: 'c' }]
    await waitForCompleteRender()
    store.items = [...store.items, { id: 4, label: 'd' }]
    await waitForCompleteRender()

    expect(rowCount()).toBe(rowsAtDestroy)
    expect(sm._effects.size).toBeLessThanOrEqual(effectsAtDestroy)
  })
})
