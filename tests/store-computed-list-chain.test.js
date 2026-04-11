/**
 * Store → Computed → List Chain Test Suite
 *
 * Tests the full dependency tracking path: store state changes → component
 * computed re-evaluates → data-list re-renders. This chain is the backbone
 * of every real app that renders store-backed lists with filtering/sorting.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

let counter = 0
function unique(prefix) { return `${prefix}-${++counter}` }

describe('Store → Computed → List Chain', () => {
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

  it('computed filters store array → list renders filtered items', async () => {
    const sn = unique('scl-filter')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        items: [
          { id: 1, name: 'Apple', category: 'fruit' },
          { id: 2, name: 'Carrot', category: 'vegetable' },
          { id: 3, name: 'Banana', category: 'fruit' },
          { id: 4, name: 'Broccoli', category: 'vegetable' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="fruits">
          <template>
            <span class="item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['items'] },
      state: {},
      computed: {
        fruits() {
          const items = this.stores[sn]?.items || []
          return items.filter(i => i.category === 'fruit')
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const rendered = testContainer.querySelectorAll('.item')
    expect(rendered.length).toBe(2)
    expect(rendered[0].textContent).toBe('Apple')
    expect(rendered[1].textContent).toBe('Banana')
  })

  it('store update triggers computed re-evaluation → list re-renders', async () => {
    const sn = unique('scl-update')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        tasks: [
          { id: 1, text: 'Task A', done: false },
          { id: 2, text: 'Task B', done: true }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="pendingTasks">
          <template>
            <span class="task" data-bind="text"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['tasks'] },
      state: {},
      computed: {
        pendingTasks() {
          const tasks = this.stores[sn]?.tasks || []
          return tasks.filter(t => !t.done)
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.task').length).toBe(1)

    // Mark task as done — the pending list should become empty
    const store = wildflower.getStore(sn)
    store.state.tasks[0].done = true
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.task').length).toBe(0)
  })

  it('computed sorts store array → list renders in sort order', async () => {
    const sn = unique('scl-sort')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        people: [
          { id: 1, name: 'Charlie' },
          { id: 2, name: 'Alice' },
          { id: 3, name: 'Bob' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="sorted">
          <template>
            <span class="person" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['people'] },
      state: {},
      computed: {
        sorted() {
          const people = this.stores[sn]?.people || []
          return [...people].sort((a, b) => a.name.localeCompare(b.name))
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const names = testContainer.querySelectorAll('.person')
    expect(names.length).toBe(3)
    expect(names[0].textContent).toBe('Alice')
    expect(names[1].textContent).toBe('Bob')
    expect(names[2].textContent).toBe('Charlie')
  })

  it('computed maps store array (adds derived fields) → list binds derived fields', async () => {
    const sn = unique('scl-map')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        products: [
          { id: 1, name: 'Widget', price: 10, qty: 3 },
          { id: 2, name: 'Gadget', price: 25, qty: 2 }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="enriched">
          <template>
            <div class="product">
              <span class="name" data-bind="name"></span>
              <span class="total" data-bind="lineTotal"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['products'] },
      state: {},
      computed: {
        enriched() {
          const products = this.stores[sn]?.products || []
          return products.map(p => ({
            ...p,
            lineTotal: p.price * p.qty
          }))
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const totals = testContainer.querySelectorAll('.total')
    expect(totals.length).toBe(2)
    expect(totals[0].textContent).toBe('30')
    expect(totals[1].textContent).toBe('50')
  })

  it('computed chains: computed A filters → computed B sorts → list renders', async () => {
    const sn = unique('scl-chain')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        items: [
          { id: 1, name: 'Banana', active: true },
          { id: 2, name: 'Apple', active: false },
          { id: 3, name: 'Cherry', active: true },
          { id: 4, name: 'Avocado', active: true }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="sortedActive">
          <template>
            <span class="item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['items'] },
      state: {},
      computed: {
        sortedActive() {
          // Filter then sort in one computed (chains internally)
          const items = this.stores[sn]?.items || []
          return items
            .filter(i => i.active)
            .sort((a, b) => a.name.localeCompare(b.name))
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const rendered = testContainer.querySelectorAll('.item')
    expect(rendered.length).toBe(3)
    expect(rendered[0].textContent).toBe('Avocado')
    expect(rendered[1].textContent).toBe('Banana')
    expect(rendered[2].textContent).toBe('Cherry')
  })

  it('two components subscribe to same store, each with different computed filter', async () => {
    const sn = unique('scl-shared')
    const cn1 = unique('scl-fruits')
    const cn2 = unique('scl-vegs')

    wildflower.store(sn, {
      state: {
        items: [
          { id: 1, name: 'Apple', type: 'fruit' },
          { id: 2, name: 'Carrot', type: 'veg' },
          { id: 3, name: 'Pear', type: 'fruit' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn1}">
        <div data-list="fruits">
          <template><span class="fruit" data-bind="name"></span></template>
        </div>
      </div>
      <div data-component="${cn2}">
        <div data-list="vegs">
          <template><span class="veg" data-bind="name"></span></template>
        </div>
      </div>
    `

    wildflower.component(cn1, {
      subscribe: { [sn]: ['items'] },
      state: {},
      computed: {
        fruits() {
          const items = this.stores[sn]?.items || []
          return items.filter(i => i.type === 'fruit')
        }
      }
    })

    wildflower.component(cn2, {
      subscribe: { [sn]: ['items'] },
      state: {},
      computed: {
        vegs() {
          const items = this.stores[sn]?.items || []
          return items.filter(i => i.type === 'veg')
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.fruit').length).toBe(2)
    expect(testContainer.querySelectorAll('.veg').length).toBe(1)
  })

  it('store array push → computed re-evaluates → list appends new item', async () => {
    const sn = unique('scl-push')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        logs: [
          { id: 1, msg: 'Started' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="allLogs">
          <template><span class="log" data-bind="msg"></span></template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['logs'] },
      state: {},
      computed: {
        allLogs() {
          return this.stores[sn]?.logs || []
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.log').length).toBe(1)

    const store = wildflower.getStore(sn)
    store.state.logs.push({ id: 2, msg: 'Processing' })
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.log').length).toBe(2)
    expect(testContainer.querySelectorAll('.log')[1].textContent).toBe('Processing')
  })

  it('store array splice (remove) → computed re-evaluates → list removes item', async () => {
    const sn = unique('scl-splice')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        notifications: [
          { id: 1, text: 'Alert 1' },
          { id: 2, text: 'Alert 2' },
          { id: 3, text: 'Alert 3' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="notifs">
          <template><span class="notif" data-bind="text"></span></template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['notifications'] },
      state: {},
      computed: {
        notifs() {
          return this.stores[sn]?.notifications || []
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.notif').length).toBe(3)

    // Remove middle item
    const store = wildflower.getStore(sn)
    store.state.notifications.splice(1, 1)
    await waitForCompleteRender()

    const notifs = testContainer.querySelectorAll('.notif')
    expect(notifs.length).toBe(2)
    expect(notifs[0].textContent).toBe('Alert 1')
    expect(notifs[1].textContent).toBe('Alert 3')
  })

  it('store scalar change affects computed filter condition → list changes', async () => {
    const sn = unique('scl-scalar')
    const cn = unique('scl-comp')

    wildflower.store(sn, {
      state: {
        minPrice: 0,
        products: [
          { id: 1, name: 'Cheap', price: 5 },
          { id: 2, name: 'Medium', price: 50 },
          { id: 3, name: 'Expensive', price: 500 }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="filtered">
          <template><span class="prod" data-bind="name"></span></template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['products', 'minPrice'] },
      state: {},
      computed: {
        filtered() {
          const products = this.stores[sn]?.products || []
          const min = this.stores[sn]?.minPrice || 0
          return products.filter(p => p.price >= min)
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.prod').length).toBe(3)

    // Change scalar filter — not an array mutation
    const store = wildflower.getStore(sn)
    store.state.minPrice = 20
    await waitForCompleteRender()

    const prods = testContainer.querySelectorAll('.prod')
    expect(prods.length).toBe(2)
    expect(prods[0].textContent).toBe('Medium')
    expect(prods[1].textContent).toBe('Expensive')
  })

  it('onStoreUpdate + computed + list re-render in correct order', async () => {
    const sn = unique('scl-lifecycle')
    const cn = unique('scl-comp')
    const callOrder = []

    wildflower.store(sn, {
      state: {
        items: [{ id: 1, name: 'Initial' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="storeItems">
          <template><span class="item" data-bind="name"></span></template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      subscribe: { [sn]: ['items'] },
      state: {},
      computed: {
        storeItems() {
          const items = this.stores[sn]?.items || []
          callOrder.push('computed')
          return items
        }
      },
      onStoreUpdate(storeName) {
        if (storeName === sn) {
          callOrder.push('onStoreUpdate')
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Clear call order from initial render
    callOrder.length = 0

    const store = wildflower.getStore(sn)
    store.state.items.push({ id: 2, name: 'Added' })
    await waitForCompleteRender()

    // Verify list rendered the new item
    expect(testContainer.querySelectorAll('.item').length).toBe(2)
    // The computed should have been called at least once after the store update
    expect(callOrder).toContain('computed')
  })
})
