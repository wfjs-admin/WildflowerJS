/**
 * Keyed List Cross-Array Moves Test Suite
 *
 * Tests data-key reconciliation during cross-array splice operations.
 * Keyed reconciliation uses a different code path than sequential (non-keyed)
 * reconciliation — DOM nodes are moved rather than recreated. This suite
 * ensures that cross-array moves (the isSpliceInProgress bug pattern)
 * work correctly with keyed lists, preserving DOM identity and metadata.
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

describe('Keyed List Cross-Array Moves', () => {
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

  it('keyed list renders correctly with data-key attribute', async () => {
    const cn = unique('kca-basic')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('Alpha')
    expect(items[1].textContent).toBe('Beta')
    expect(items[2].textContent).toBe('Gamma')
  })

  it('keyed reorder preserves DOM nodes (move, not recreate)', async () => {
    const cn = unique('kca-reorder')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Capture original DOM references
    const originalNodes = Array.from(testContainer.querySelectorAll('.item'))
    expect(originalNodes.length).toBe(3)

    // Reverse the order
    componentRef.state.items = [
      { id: 3, name: 'Gamma' },
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' }
    ]
    await waitForCompleteRender()

    const newNodes = testContainer.querySelectorAll('.item')
    expect(newNodes.length).toBe(3)
    expect(newNodes[0].textContent).toBe('Gamma')
    expect(newNodes[1].textContent).toBe('Alpha')
    expect(newNodes[2].textContent).toBe('Beta')

    // With keyed reconciliation, DOM nodes should be the same objects (moved)
    expect(newNodes[0]).toBe(originalNodes[2]) // Gamma was at index 2
    expect(newNodes[1]).toBe(originalNodes[0]) // Alpha was at index 0
    expect(newNodes[2]).toBe(originalNodes[1]) // Beta was at index 1
  })

  it('cross-array move with keyed lists in same store', async () => {
    const sn = unique('kca-store')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        listA: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' }
        ],
        listB: [
          { id: 4, name: 'Delta' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul id="list-a" data-list="itemsA" data-key="id">
          <template>
            <li class="item-a" data-bind="name"></li>
          </template>
        </ul>
        <ul id="list-b" data-list="itemsB" data-key="id">
          <template>
            <li class="item-b" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['listA', 'listB'] },
      computed: {
        itemsA() {
          return this.stores[sn].listA || []
        },
        itemsB() {
          return this.stores[sn].listB || []
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.item-a').length).toBe(3)
    expect(testContainer.querySelectorAll('.item-b').length).toBe(1)

    // Move Beta from listA to listB via splice
    const store = wildflower.getStore(sn)
    const item = store.state.listA.splice(1, 1)[0]
    store.state.listB.splice(1, 0, item)
    await waitForCompleteRender()

    const aItems = testContainer.querySelectorAll('.item-a')
    const bItems = testContainer.querySelectorAll('.item-b')
    expect(aItems.length).toBe(2)
    expect(aItems[0].textContent).toBe('Alpha')
    expect(aItems[1].textContent).toBe('Gamma')
    expect(bItems.length).toBe(2)
    expect(bItems[0].textContent).toBe('Delta')
    expect(bItems[1].textContent).toBe('Beta')
  })

  it('swap items between two keyed lists', async () => {
    const sn = unique('kca-swap')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        left: [{ id: 1, name: 'L1' }, { id: 2, name: 'L2' }],
        right: [{ id: 3, name: 'R1' }, { id: 4, name: 'R2' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="leftItems" data-key="id">
          <template><li class="left" data-bind="name"></li></template>
        </ul>
        <ul data-list="rightItems" data-key="id">
          <template><li class="right" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['left', 'right'] },
      computed: {
        leftItems() { return this.stores[sn].left || [] },
        rightItems() { return this.stores[sn].right || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Swap: remove from each, insert into the other
    const store = wildflower.getStore(sn)
    const fromLeft = store.state.left.splice(0, 1)[0]
    const fromRight = store.state.right.splice(0, 1)[0]
    store.state.left.splice(0, 0, fromRight)
    store.state.right.splice(0, 0, fromLeft)
    await waitForCompleteRender()

    const leftEls = testContainer.querySelectorAll('.left')
    const rightEls = testContainer.querySelectorAll('.right')
    expect(leftEls.length).toBe(2)
    expect(leftEls[0].textContent).toBe('R1')
    expect(leftEls[1].textContent).toBe('L2')
    expect(rightEls.length).toBe(2)
    expect(rightEls[0].textContent).toBe('L1')
    expect(rightEls[1].textContent).toBe('R2')
  })

  it('move item to empty keyed list', async () => {
    const sn = unique('kca-empty')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        source: [{ id: 1, name: 'Item1' }, { id: 2, name: 'Item2' }],
        target: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="srcItems" data-key="id">
          <template><li class="src" data-bind="name"></li></template>
        </ul>
        <ul data-list="tgtItems" data-key="id">
          <template><li class="tgt" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['source', 'target'] },
      computed: {
        srcItems() { return this.stores[sn].source || [] },
        tgtItems() { return this.stores[sn].target || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.src').length).toBe(2)
    expect(testContainer.querySelectorAll('.tgt').length).toBe(0)

    const store = wildflower.getStore(sn)
    const item = store.state.source.splice(0, 1)[0]
    store.state.target.splice(0, 0, item)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.src').length).toBe(1)
    expect(testContainer.querySelectorAll('.src')[0].textContent).toBe('Item2')
    expect(testContainer.querySelectorAll('.tgt').length).toBe(1)
    expect(testContainer.querySelectorAll('.tgt')[0].textContent).toBe('Item1')
  })

  it('move all items out of keyed list (empties it)', async () => {
    const sn = unique('kca-drain')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        source: [{ id: 1, name: 'Only' }],
        target: [{ id: 2, name: 'Existing' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="srcItems" data-key="id">
          <template><li class="src" data-bind="name"></li></template>
        </ul>
        <ul data-list="tgtItems" data-key="id">
          <template><li class="tgt" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['source', 'target'] },
      computed: {
        srcItems() { return this.stores[sn].source || [] },
        tgtItems() { return this.stores[sn].target || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const store = wildflower.getStore(sn)
    const item = store.state.source.splice(0, 1)[0]
    store.state.target.splice(1, 0, item)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.src').length).toBe(0)
    const tgts = testContainer.querySelectorAll('.tgt')
    expect(tgts.length).toBe(2)
    expect(tgts[0].textContent).toBe('Existing')
    expect(tgts[1].textContent).toBe('Only')
  })

  it('multiple moves between keyed lists in same tick', async () => {
    const sn = unique('kca-batch')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        pool: [
          { id: 1, name: 'P1' },
          { id: 2, name: 'P2' },
          { id: 3, name: 'P3' }
        ],
        bucket: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="poolItems" data-key="id">
          <template><li class="pool" data-bind="name"></li></template>
        </ul>
        <ul data-list="bucketItems" data-key="id">
          <template><li class="bucket" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['pool', 'bucket'] },
      computed: {
        poolItems() { return this.stores[sn].pool || [] },
        bucketItems() { return this.stores[sn].bucket || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const store = wildflower.getStore(sn)

    // Move 2 items in same tick
    const m1 = store.state.pool.splice(0, 1)[0] // P1
    store.state.bucket.splice(0, 0, m1)
    const m2 = store.state.pool.splice(0, 1)[0] // P2 (now at index 0)
    store.state.bucket.splice(1, 0, m2)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.pool').length).toBe(1)
    expect(testContainer.querySelectorAll('.pool')[0].textContent).toBe('P3')
    const buckets = testContainer.querySelectorAll('.bucket')
    expect(buckets.length).toBe(2)
    expect(buckets[0].textContent).toBe('P1')
    expect(buckets[1].textContent).toBe('P2')
  })

  it('keyed list reorder within same array', async () => {
    const cn = unique('kca-reorder-same')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' },
          { id: 4, name: 'Delta' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Capture DOM refs
    const origNodes = Array.from(testContainer.querySelectorAll('.item'))

    // Move item from index 0 to index 2 (within same array)
    const removed = componentRef.state.items.splice(0, 1)[0]
    componentRef.state.items.splice(2, 0, removed)
    await waitForCompleteRender()

    const newNodes = testContainer.querySelectorAll('.item')
    expect(newNodes.length).toBe(4)
    expect(newNodes[0].textContent).toBe('Beta')
    expect(newNodes[1].textContent).toBe('Gamma')
    expect(newNodes[2].textContent).toBe('Alpha')
    expect(newNodes[3].textContent).toBe('Delta')
  })

  it('keyed list with computed filter + cross-array move', async () => {
    const sn = unique('kca-filter')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        pending: [
          { id: 1, name: 'Task1', priority: 'high' },
          { id: 2, name: 'Task2', priority: 'low' },
          { id: 3, name: 'Task3', priority: 'high' }
        ],
        done: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="highPriority" data-key="id">
          <template><li class="hp" data-bind="name"></li></template>
        </ul>
        <ul data-list="doneItems" data-key="id">
          <template><li class="done" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['pending', 'done'] },
      computed: {
        highPriority() {
          const pending = this.stores[sn].pending || []
          return pending.filter(t => t.priority === 'high')
        },
        doneItems() {
          return this.stores[sn].done || []
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.hp').length).toBe(2)
    expect(testContainer.querySelectorAll('.done').length).toBe(0)

    // Move a high-priority item to done
    const store = wildflower.getStore(sn)
    const item = store.state.pending.splice(0, 1)[0]
    store.state.done.splice(0, 0, item)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.hp').length).toBe(1)
    expect(testContainer.querySelectorAll('.hp')[0].textContent).toBe('Task3')
    expect(testContainer.querySelectorAll('.done').length).toBe(1)
    expect(testContainer.querySelectorAll('.done')[0].textContent).toBe('Task1')
  })

  it('keyed list with data-bind-class on list items', async () => {
    const cn = unique('kca-class')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name" data-bind-class="({ 'active': isActive })"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha', isActive: true },
          { id: 2, name: 'Beta', isActive: false },
          { id: 3, name: 'Gamma', isActive: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    let items = testContainer.querySelectorAll('.item')
    expect(items[0].classList.contains('active')).toBe(true)
    expect(items[1].classList.contains('active')).toBe(false)
    expect(items[2].classList.contains('active')).toBe(true)

    // Reorder — class bindings should follow the data, not the DOM position
    componentRef.state.items = [
      { id: 3, name: 'Gamma', isActive: true },
      { id: 1, name: 'Alpha', isActive: true },
      { id: 2, name: 'Beta', isActive: false }
    ]
    await waitForCompleteRender()

    items = testContainer.querySelectorAll('.item')
    expect(items[0].textContent).toBe('Gamma')
    expect(items[0].classList.contains('active')).toBe(true)
    expect(items[1].textContent).toBe('Alpha')
    expect(items[1].classList.contains('active')).toBe(true)
    expect(items[2].textContent).toBe('Beta')
    expect(items[2].classList.contains('active')).toBe(false)
  })

  it('keyed list splice + push in same tick', async () => {
    const cn = unique('kca-splice-push')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Remove middle item and push a new one in same tick
    componentRef.state.items.splice(1, 1) // remove Beta
    componentRef.state.items.push({ id: 4, name: 'Delta' })
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('Alpha')
    expect(items[1].textContent).toBe('Gamma')
    expect(items[2].textContent).toBe('Delta')
  })

  it('keyed kanban: move card between columns rendered as keyed lists', async () => {
    const sn = unique('kca-kanban')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        todo: [
          { id: 1, title: 'Task A' },
          { id: 2, title: 'Task B' }
        ],
        inProgress: [
          { id: 3, title: 'Task C' }
        ],
        done: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div id="col-todo">
          <ul data-list="todoCards" data-key="id">
            <template><li class="todo-card" data-bind="title"></li></template>
          </ul>
        </div>
        <div id="col-wip">
          <ul data-list="wipCards" data-key="id">
            <template><li class="wip-card" data-bind="title"></li></template>
          </ul>
        </div>
        <div id="col-done">
          <ul data-list="doneCards" data-key="id">
            <template><li class="done-card" data-bind="title"></li></template>
          </ul>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['todo', 'inProgress', 'done'] },
      computed: {
        todoCards() { return this.stores[sn].todo || [] },
        wipCards() { return this.stores[sn].inProgress || [] },
        doneCards() { return this.stores[sn].done || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.todo-card').length).toBe(2)
    expect(testContainer.querySelectorAll('.wip-card').length).toBe(1)
    expect(testContainer.querySelectorAll('.done-card').length).toBe(0)

    // Move Task B from todo to inProgress
    const store = wildflower.getStore(sn)
    const card = store.state.todo.splice(1, 1)[0]
    store.state.inProgress.splice(1, 0, card)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.todo-card').length).toBe(1)
    expect(testContainer.querySelectorAll('.todo-card')[0].textContent).toBe('Task A')
    const wipCards = testContainer.querySelectorAll('.wip-card')
    expect(wipCards.length).toBe(2)
    expect(wipCards[0].textContent).toBe('Task C')
    expect(wipCards[1].textContent).toBe('Task B')

    // Move Task C from inProgress to done
    const card2 = store.state.inProgress.splice(0, 1)[0]
    store.state.done.splice(0, 0, card2)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.wip-card').length).toBe(1)
    expect(testContainer.querySelectorAll('.wip-card')[0].textContent).toBe('Task B')
    expect(testContainer.querySelectorAll('.done-card').length).toBe(1)
    expect(testContainer.querySelectorAll('.done-card')[0].textContent).toBe('Task C')
  })

  it('keyed list with data-show on items preserves visibility after reorder', async () => {
    const cn = unique('kca-show')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name" data-show="visible"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Shown', visible: true },
          { id: 2, name: 'Hidden', visible: false },
          { id: 3, name: 'AlsoShown', visible: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    let items = testContainer.querySelectorAll('.item')
    expect(items[0].classList.contains('wf-show')).toBe(true)
    expect(items[1].classList.contains('wf-show')).toBe(false)
    expect(items[2].classList.contains('wf-show')).toBe(true)

    // Reverse the list — visibility should follow the data
    componentRef.state.items = [
      { id: 3, name: 'AlsoShown', visible: true },
      { id: 2, name: 'Hidden', visible: false },
      { id: 1, name: 'Shown', visible: true }
    ]
    await waitForCompleteRender()

    items = testContainer.querySelectorAll('.item')
    expect(items[0].textContent).toBe('AlsoShown')
    expect(items[0].classList.contains('wf-show')).toBe(true)
    expect(items[1].textContent).toBe('Hidden')
    expect(items[1].classList.contains('wf-show')).toBe(false)
    expect(items[2].textContent).toBe('Shown')
    expect(items[2].classList.contains('wf-show')).toBe(true)
  })

  it('keyed list add + remove + reorder in single mutation', async () => {
    const cn = unique('kca-complex')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 3, name: 'Gamma' },
          { id: 4, name: 'Delta' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Replace entire array: remove id:2, reorder remaining, add id:5
    componentRef.state.items = [
      { id: 4, name: 'Delta' },
      { id: 5, name: 'Epsilon' },
      { id: 1, name: 'Alpha' },
      { id: 3, name: 'Gamma' }
    ]
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(4)
    expect(items[0].textContent).toBe('Delta')
    expect(items[1].textContent).toBe('Epsilon')
    expect(items[2].textContent).toBe('Alpha')
    expect(items[3].textContent).toBe('Gamma')
  })

  it('keyed list with data-bind-attr preserves attributes after reorder', async () => {
    const cn = unique('kca-attr')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="links" data-key="id">
          <template>
            <a class="link" data-bind="label" data-bind-attr="({ href: url })"></a>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        links: [
          { id: 1, label: 'First', url: '#first' },
          { id: 2, label: 'Second', url: '#second' },
          { id: 3, label: 'Third', url: '#third' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    let anchors = testContainer.querySelectorAll('.link')
    expect(anchors[0].getAttribute('href')).toBe('#first')
    expect(anchors[1].getAttribute('href')).toBe('#second')

    // Reorder
    componentRef.state.links = [
      { id: 3, label: 'Third', url: '#third' },
      { id: 1, label: 'First', url: '#first' }
    ]
    await waitForCompleteRender()

    anchors = testContainer.querySelectorAll('.link')
    expect(anchors.length).toBe(2)
    expect(anchors[0].textContent).toBe('Third')
    expect(anchors[0].getAttribute('href')).toBe('#third')
    expect(anchors[1].textContent).toBe('First')
    expect(anchors[1].getAttribute('href')).toBe('#first')
  })

  it('keyed cross-array move: computed counts update for both lists', async () => {
    const sn = unique('kca-counts')
    const cn = unique('kca-comp')

    wildflower.store(sn, {
      state: {
        available: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' }
        ],
        selected: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="avail-count" data-bind="computed:availCount"></span>
        <span id="sel-count" data-bind="computed:selCount"></span>
        <ul data-list="availItems" data-key="id">
          <template><li class="avail" data-bind="name"></li></template>
        </ul>
        <ul data-list="selItems" data-key="id">
          <template><li class="sel" data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['available', 'selected'] },
      computed: {
        availItems() { return this.stores[sn].available || [] },
        selItems() { return this.stores[sn].selected || [] },
        availCount() {
          const arr = this.stores[sn].available
          return arr ? arr.length : 0
        },
        selCount() {
          const arr = this.stores[sn].selected
          return arr ? arr.length : 0
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#avail-count').textContent).toBe('3')
    expect(testContainer.querySelector('#sel-count').textContent).toBe('0')

    // Move 2 items
    const store = wildflower.getStore(sn)
    const item1 = store.state.available.splice(0, 1)[0]
    store.state.selected.splice(0, 0, item1)
    const item2 = store.state.available.splice(0, 1)[0]
    store.state.selected.splice(1, 0, item2)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#avail-count').textContent).toBe('1')
    expect(testContainer.querySelector('#sel-count').textContent).toBe('2')
    expect(testContainer.querySelectorAll('.avail').length).toBe(1)
    expect(testContainer.querySelectorAll('.sel').length).toBe(2)
  })
})
