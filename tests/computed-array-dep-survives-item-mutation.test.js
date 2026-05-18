/**
 * Locks in that a computed reading array.length / array.filter() keeps
 * re-evaluating after the array changes structurally (reassignment or
 * splice), even when an item-property mutation already triggered a prior
 * re-eval of that computed.
 *
 * Written while investigating docs/future/COMPUTED_DROPS_ARRAY_ROOT_DEP_ON_ITEM_RE_EVAL.md.
 * All cases here pass — the framework reactivity is correct. The PM
 * "Reset to demo data" bug that prompted the investigation turned out to
 * be a separate demo-side shared-reference issue in the seed handling
 * (shallow .slice() of PROJECT_MGMT_SEED), not a framework bug.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Computed array-root dependency survives item-property mutation', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // The literal PM-demo bug: a component computed reads a STORE array, an
  // item mutation re-evaluates it, then the store array is reassigned.
  it('component computed reading a store array re-evaluates after store-array reassignment, even after a prior item mutation', async () => {
    wildflower.store('itemStoreReassign', {
      state: { items: [{ id: 1, done: false }, { id: 2, done: false }, { id: 3, done: true }] },
      toggleFirst() { this.items[0].done = !this.items[0].done },
      replaceAll() { this.items = [{ id: 9, done: false }] }
    })
    testContainer.innerHTML = `
      <div data-component="store-arr-dep-reassign">
        <span id="total" data-bind="total"></span>
        <span id="done" data-bind="doneCount"></span>
      </div>
    `
    wildflower.component('store-arr-dep-reassign', {
      subscribe: { itemStoreReassign: ['items'] },
      computed: {
        total() { return this.stores.itemStoreReassign.items.length },
        doneCount() { return this.stores.itemStoreReassign.items.filter(i => i.done).length }
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="store-arr-dep-reassign"]')
    const totalEl = component.querySelector('#total')
    const doneEl = component.querySelector('#done')

    expect(totalEl.textContent).toBe('3')
    expect(doneEl.textContent).toBe('1')

    // Item-property mutation — triggers a re-eval of doneCount (and total).
    wildflower.getStore('itemStoreReassign').toggleFirst()
    await waitForUpdate(50)
    expect(doneEl.textContent).toBe('2')

    // Array reassignment — computeds must re-evaluate against the new array.
    wildflower.getStore('itemStoreReassign').replaceAll()
    await waitForUpdate(50)
    expect(totalEl.textContent).toBe('1')
    expect(doneEl.textContent).toBe('0')
  })

  // Same shape, splice instead of reassignment (the diagnosis doc's scenario).
  it('component computed reading a store array re-evaluates after store-array splice, even after a prior item mutation', async () => {
    wildflower.store('itemStoreSplice', {
      state: { items: [{ id: 1, done: false }, { id: 2, done: false }, { id: 3, done: true }] },
      toggleFirst() { this.items[0].done = !this.items[0].done },
      dropFirst() { this.items.splice(0, 1) }
    })
    testContainer.innerHTML = `
      <div data-component="store-arr-dep-splice">
        <span id="total" data-bind="total"></span>
        <span id="done" data-bind="doneCount"></span>
      </div>
    `
    wildflower.component('store-arr-dep-splice', {
      subscribe: { itemStoreSplice: ['items'] },
      computed: {
        total() { return this.stores.itemStoreSplice.items.length },
        doneCount() { return this.stores.itemStoreSplice.items.filter(i => i.done).length }
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="store-arr-dep-splice"]')
    const totalEl = component.querySelector('#total')
    const doneEl = component.querySelector('#done')

    expect(totalEl.textContent).toBe('3')

    wildflower.getStore('itemStoreSplice').toggleFirst()
    await waitForUpdate(50)
    expect(doneEl.textContent).toBe('2')

    // Splice removes item 1 (now done) → 2 items, 1 done.
    wildflower.getStore('itemStoreSplice').dropFirst()
    await waitForUpdate(50)
    expect(totalEl.textContent).toBe('2')
    expect(doneEl.textContent).toBe('1')
  })

  // The diagnosis doc's simpler shape: a component computed over the
  // component's OWN state array.
  it('component computed over own-state array re-evaluates after reassignment, even after a prior item mutation', async () => {
    testContainer.innerHTML = `
      <div data-component="own-arr-dep">
        <span id="total" data-bind="total"></span>
        <span id="done" data-bind="doneCount"></span>
        <button id="toggle" data-action="toggleFirst">toggle</button>
        <button id="replace" data-action="replaceAll">replace</button>
      </div>
    `
    wildflower.component('own-arr-dep', {
      state: { items: [{ id: 1, done: false }, { id: 2, done: false }, { id: 3, done: true }] },
      computed: {
        total() { return this.items.length },
        doneCount() { return this.items.filter(i => i.done).length }
      },
      toggleFirst() { this.items[0].done = !this.items[0].done },
      replaceAll() { this.items = [{ id: 9, done: false }] }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="own-arr-dep"]')
    const totalEl = component.querySelector('#total')
    const doneEl = component.querySelector('#done')

    expect(totalEl.textContent).toBe('3')
    expect(doneEl.textContent).toBe('1')

    component.querySelector('#toggle').click()
    await waitForUpdate(50)
    expect(doneEl.textContent).toBe('2')

    component.querySelector('#replace').click()
    await waitForUpdate(50)
    expect(totalEl.textContent).toBe('1')
    expect(doneEl.textContent).toBe('0')
  })
})
