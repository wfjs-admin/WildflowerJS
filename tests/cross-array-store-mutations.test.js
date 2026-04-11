/**
 * Cross-Array Store Mutations Test Suite
 *
 * Direct regression coverage for the isSpliceInProgress flag-bleeding bug
 * (commit 9014a6a) and related per-RSM shared state issues.
 *
 * The core bug: splicing array A in a store set isSpliceInProgress on the
 * store's RSM, and that flag bled into array B when it was spliced in the
 * same synchronous block. This pattern occurs in every kanban board,
 * task manager, and drag-and-drop app.
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

let storeCounter = 0
function uniqueStore(prefix) { return `${prefix}-${++storeCounter}` }

describe('Cross-Array Store Mutations', () => {
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

  it('moves item between two arrays in same store via splice', async () => {
    const storeName = uniqueStore('cross-splice')
    wildflower.store(storeName, {
      state: {
        listA: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }, { id: 3, name: 'Gamma' }],
        listB: [{ id: 4, name: 'Delta' }]
      }
    })

    const store = wildflower.getStore(storeName)

    // Move item from listA to listB via splice (the exact bug pattern)
    const item = store.state.listA.splice(1, 1)[0] // remove Beta
    store.state.listB.splice(1, 0, item) // insert Beta at end of listB
    await waitForUpdate()

    expect(store.state.listA.length).toBe(2)
    expect(store.state.listA[0].name).toBe('Alpha')
    expect(store.state.listA[1].name).toBe('Gamma')
    expect(store.state.listB.length).toBe(2)
    expect(store.state.listB[0].name).toBe('Delta')
    expect(store.state.listB[1].name).toBe('Beta')
  })

  it('moves item between three arrays in rapid succession', async () => {
    const storeName = uniqueStore('triple-move')
    wildflower.store(storeName, {
      state: {
        colA: [{ id: 1, name: 'Traveler' }],
        colB: [],
        colC: []
      }
    })

    const store = wildflower.getStore(storeName)

    // Move A→B→C in one synchronous block
    const item1 = store.state.colA.splice(0, 1)[0]
    store.state.colB.splice(0, 0, item1)
    const item2 = store.state.colB.splice(0, 1)[0]
    store.state.colC.splice(0, 0, item2)
    await waitForUpdate()

    expect(store.state.colA.length).toBe(0)
    expect(store.state.colB.length).toBe(0)
    expect(store.state.colC.length).toBe(1)
    expect(store.state.colC[0].name).toBe('Traveler')
  })

  it('simultaneous remove from A + push to B', async () => {
    const storeName = uniqueStore('splice-push')
    wildflower.store(storeName, {
      state: {
        source: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }],
        target: [{ id: 3, name: 'Z' }]
      }
    })

    const store = wildflower.getStore(storeName)

    // Remove via splice, insert via push (non-splice)
    const removed = store.state.source.splice(0, 1)[0]
    store.state.target.push(removed)
    await waitForUpdate()

    expect(store.state.source.length).toBe(1)
    expect(store.state.source[0].name).toBe('Y')
    expect(store.state.target.length).toBe(2)
    expect(store.state.target[1].name).toBe('X')
  })

  it('swaps items between two arrays (bidirectional)', async () => {
    const storeName = uniqueStore('swap')
    wildflower.store(storeName, {
      state: {
        left: [{ id: 1, name: 'L1' }, { id: 2, name: 'L2' }],
        right: [{ id: 3, name: 'R1' }, { id: 4, name: 'R2' }]
      }
    })

    const store = wildflower.getStore(storeName)

    // Swap: remove from left, remove from right, insert each into the other
    const fromLeft = store.state.left.splice(0, 1)[0]
    const fromRight = store.state.right.splice(0, 1)[0]
    store.state.left.splice(0, 0, fromRight)
    store.state.right.splice(0, 0, fromLeft)
    await waitForUpdate()

    expect(store.state.left.length).toBe(2)
    expect(store.state.left[0].name).toBe('R1')
    expect(store.state.left[1].name).toBe('L2')
    expect(store.state.right.length).toBe(2)
    expect(store.state.right[0].name).toBe('L1')
    expect(store.state.right[1].name).toBe('R2')
  })

  it('moves last item from source array (empties it)', async () => {
    const storeName = uniqueStore('empty-source')
    wildflower.store(storeName, {
      state: {
        source: [{ id: 1, name: 'Only' }],
        target: [{ id: 2, name: 'Existing' }]
      }
    })

    const store = wildflower.getStore(storeName)
    const item = store.state.source.splice(0, 1)[0]
    store.state.target.splice(1, 0, item)
    await waitForUpdate()

    expect(store.state.source.length).toBe(0)
    expect(store.state.target.length).toBe(2)
    expect(store.state.target[0].name).toBe('Existing')
    expect(store.state.target[1].name).toBe('Only')
  })

  it('moves item into empty target array', async () => {
    const storeName = uniqueStore('empty-target')
    wildflower.store(storeName, {
      state: {
        source: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
        target: []
      }
    })

    const store = wildflower.getStore(storeName)
    const item = store.state.source.splice(1, 1)[0]
    store.state.target.splice(0, 0, item)
    await waitForUpdate()

    expect(store.state.source.length).toBe(1)
    expect(store.state.target.length).toBe(1)
    expect(store.state.target[0].name).toBe('B')
  })

  it('handles multiple moves in same microtask batch', async () => {
    const storeName = uniqueStore('batch-moves')
    wildflower.store(storeName, {
      state: {
        pool: [
          { id: 1, name: 'P1' },
          { id: 2, name: 'P2' },
          { id: 3, name: 'P3' },
          { id: 4, name: 'P4' }
        ],
        bucketA: [],
        bucketB: []
      }
    })

    const store = wildflower.getStore(storeName)

    // 3 moves before any render
    const m1 = store.state.pool.splice(0, 1)[0] // P1
    store.state.bucketA.splice(0, 0, m1)

    const m2 = store.state.pool.splice(0, 1)[0] // P2 (now at index 0)
    store.state.bucketB.splice(0, 0, m2)

    const m3 = store.state.pool.splice(0, 1)[0] // P3 (now at index 0)
    store.state.bucketA.splice(1, 0, m3)

    await waitForUpdate()

    expect(store.state.pool.length).toBe(1)
    expect(store.state.pool[0].name).toBe('P4')
    expect(store.state.bucketA.length).toBe(2)
    expect(store.state.bucketA[0].name).toBe('P1')
    expect(store.state.bucketA[1].name).toBe('P3')
    expect(store.state.bucketB.length).toBe(1)
    expect(store.state.bucketB[0].name).toBe('P2')
  })

  it('store method moves item + updates scalar property', async () => {
    const storeName = uniqueStore('move-scalar')
    wildflower.store(storeName, {
      state: {
        inbox: [{ id: 1, name: 'Task' }],
        done: [],
        lastMoveTime: null
      }
    })

    const store = wildflower.getStore(storeName)

    // Array mutation + scalar mutation in same tick
    const item = store.state.inbox.splice(0, 1)[0]
    store.state.done.splice(0, 0, item)
    store.state.lastMoveTime = '2026-02-16T12:00:00'
    await waitForUpdate()

    expect(store.state.inbox.length).toBe(0)
    expect(store.state.done.length).toBe(1)
    expect(store.state.done[0].name).toBe('Task')
    expect(store.state.lastMoveTime).toBe('2026-02-16T12:00:00')
  })

  it('moves item then reads computed that depends on both arrays', async () => {
    const storeName = uniqueStore('move-computed')
    const compName = `move-computed-display-${storeCounter}`

    wildflower.store(storeName, {
      state: {
        todo: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }],
        completed: [{ id: 3, text: 'C' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${compName}">
        <span id="total" data-bind="computed:totalItems"></span>
        <span id="ratio" data-bind="computed:completedRatio"></span>
      </div>
    `

    wildflower.component(compName, {
      subscribe: { [storeName]: ['todo', 'completed'] },
      state: {},
      computed: {
        totalItems() {
          const todo = this.stores[storeName]?.todo || []
          const completed = this.stores[storeName]?.completed || []
          return todo.length + completed.length
        },
        completedRatio() {
          const todo = this.stores[storeName]?.todo || []
          const completed = this.stores[storeName]?.completed || []
          const total = todo.length + completed.length
          return total === 0 ? 0 : completed.length / total
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#total').textContent).toBe('3')

    // Move item from todo to completed
    const store = wildflower.getStore(storeName)
    const item = store.state.todo.splice(0, 1)[0]
    store.state.completed.splice(store.state.completed.length, 0, item)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#total').textContent).toBe('3')
    // 2/3 ≈ 0.6667 — check the rendered string
    const ratio = parseFloat(testContainer.querySelector('#ratio').textContent)
    expect(ratio).toBeCloseTo(2 / 3, 2)
  })

  it('handles concurrent splice on same array (remove index 0 and index 2)', async () => {
    const storeName = uniqueStore('concurrent-splice')
    wildflower.store(storeName, {
      state: {
        items: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
          { id: 4, name: 'D' }
        ]
      }
    })

    const store = wildflower.getStore(storeName)

    // Remove index 0, then index 2 (which is now index 1 of the shifted array)
    store.state.items.splice(0, 1)  // remove A -> [B, C, D]
    store.state.items.splice(1, 1)  // remove C -> [B, D]
    await waitForUpdate()

    expect(store.state.items.length).toBe(2)
    expect(store.state.items[0].name).toBe('B')
    expect(store.state.items[1].name).toBe('D')
  })

  it('cross-array move + computed that filters the target', async () => {
    const storeName = uniqueStore('move-filter')
    const compName = `move-filter-display-${storeCounter}`

    wildflower.store(storeName, {
      state: {
        pending: [
          { id: 1, name: 'Task1', priority: 'high' },
          { id: 2, name: 'Task2', priority: 'low' }
        ],
        active: [
          { id: 3, name: 'Task3', priority: 'high' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${compName}">
        <div data-list="highPriority">
          <template><span class="hp-item" data-bind="name"></span></template>
        </div>
        <span id="pending-count" data-bind="computed:pendingCount"></span>
      </div>
    `

    wildflower.component(compName, {
      subscribe: { [storeName]: ['active', 'pending'] },
      state: {},
      computed: {
        highPriority() {
          const active = this.stores[storeName]?.active || []
          return active.filter(t => t.priority === 'high')
        },
        pendingCount() {
          const pending = this.stores[storeName]?.pending || []
          return pending.length
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.hp-item').length).toBe(1)

    // Move high-priority item from pending to active
    const store = wildflower.getStore(storeName)
    const item = store.state.pending.splice(0, 1)[0]
    store.state.active.splice(store.state.active.length, 0, item)
    await waitForCompleteRender()

    const hpItems = testContainer.querySelectorAll('.hp-item')
    expect(hpItems.length).toBe(2)
    expect(hpItems[0].textContent).toBe('Task3')
    expect(hpItems[1].textContent).toBe('Task1')
    expect(testContainer.querySelector('#pending-count').textContent).toBe('1')
  })

  it('verifies effects fire for BOTH source and target arrays after cross-array move', async () => {
    const storeName = uniqueStore('effect-both')
    const compName = `effect-display-${storeCounter}`

    wildflower.store(storeName, {
      state: {
        from: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }],
        to: [{ id: 3, name: 'Z' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${compName}">
        <span id="from-count" data-bind="computed:fromCount"></span>
        <span id="to-count" data-bind="computed:toCount"></span>
      </div>
    `

    wildflower.component(compName, {
      subscribe: { [storeName]: ['from', 'to'] },
      state: {},
      computed: {
        fromCount() {
          const arr = this.stores[storeName]?.from
          return arr ? arr.length : 0
        },
        toCount() {
          const arr = this.stores[storeName]?.to
          return arr ? arr.length : 0
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Verify initial render
    expect(testContainer.querySelector('#from-count').textContent).toBe('2')
    expect(testContainer.querySelector('#to-count').textContent).toBe('1')

    // Cross-array move
    const store = wildflower.getStore(storeName)
    const item = store.state.from.splice(0, 1)[0]
    store.state.to.splice(store.state.to.length, 0, item)
    await waitForCompleteRender()

    // Both arrays should have re-rendered
    expect(testContainer.querySelector('#from-count').textContent).toBe('1')
    expect(testContainer.querySelector('#to-count').textContent).toBe('2')
  })
})
