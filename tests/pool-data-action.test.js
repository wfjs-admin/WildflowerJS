/**
 * data-action in pool templates — Event delegation via element index matching
 *
 * Pool templates support standard data-action syntax. Events are delegated
 * to the pool container with one listener per event type. First-match-wins:
 * walk from event.target up to entity root, fire the first data-action found.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() =>
    requestAnimationFrame(() => setTimeout(resolve, 20))
  ))
}

function getInstance(wildflower, el) {
  const id = el.getAttribute('data-component-id')
  return wildflower.componentInstances.get(id)
}

describe('data-action in Pool Templates', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }
    if (wildflower._tickableInstances) wildflower._tickableInstances.length = 0

    // Clean up context registry (may not exist in all builds)
    if (wildflower._contextRegistry && typeof wildflower._contextRegistry.clear === 'function') wildflower._contextRegistry.clear()
    if (wildflower._listRelationships && typeof wildflower._listRelationships.clear === 'function') wildflower._listRelationships.clear()

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    // Stop pool loop
    if (wildflower._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) cancelAnimationFrame(wildflower._poolLoopId)
    }
    if (wildflower._activePoolHandles) wildflower._activePoolHandles.length = 0

    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it.skipIf(isMinifiedBuild())('data-action on single element dispatches to correct method with (item, event)', async () => {
    let receivedItem = null
    let receivedEvent = null

    wildflower.component('pa-single', {
      state: {},
      pools: { items: {} },
      onItemClick(item, event) {
        receivedItem = item
        receivedEvent = event
      }
    })

    testContainer.innerHTML = `
      <div data-component="pa-single">
        <div data-pool="items" data-key="id">
          <template>
            <div>
              <span data-bind="name"></span>
              <button data-action="onItemClick">Click</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-single"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    // Click the button
    const btn = el.querySelector('button')
    btn.click()
    await waitForUpdate()

    expect(receivedItem).not.toBeNull()
    expect(receivedItem.id).toBe(1)
    expect(receivedItem.name).toBe('Alice')
    expect(receivedEvent).toBeInstanceOf(Event)
  })

  it.skipIf(isMinifiedBuild())('multiple data-action elements dispatch independently', async () => {
    const calls = []

    wildflower.component('pa-multi', {
      state: {},
      pools: { items: {} },
      onEdit(item) { calls.push({ method: 'edit', id: item.id }) },
      onDelete(item) { calls.push({ method: 'delete', id: item.id }) }
    })

    testContainer.innerHTML = `
      <div data-component="pa-multi">
        <div data-pool="items" data-key="id">
          <template>
            <div>
              <span data-bind="name"></span>
              <button class="edit-btn" data-action="onEdit">Edit</button>
              <button class="delete-btn" data-action="onDelete">Delete</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-multi"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    instance.pools.items.add({ id: 2, name: 'Bob' })
    await waitForRAF()

    // Click edit on first item
    const editBtn = el.querySelector('.edit-btn')
    editBtn.click()
    await waitForUpdate()

    // Click delete on second item
    const deleteBtns = el.querySelectorAll('.delete-btn')
    deleteBtns[1].click()
    await waitForUpdate()

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ method: 'edit', id: 1 })
    expect(calls[1]).toEqual({ method: 'delete', id: 2 })
  })

  it.skipIf(isMinifiedBuild())('data-action on template root acts as catch-all', async () => {
    let receivedItem = null

    wildflower.component('pa-root', {
      state: {},
      pools: { items: {} },
      onRowClick(item) { receivedItem = item }
    })

    testContainer.innerHTML = `
      <div data-component="pa-root">
        <div data-pool="items" data-key="id">
          <template>
            <div data-action="onRowClick">
              <span data-bind="name"></span>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-root"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    // Click the span (child of root) — should bubble to root's data-action
    const span = el.querySelector('span')
    span.click()
    await waitForUpdate()

    expect(receivedItem).not.toBeNull()
    expect(receivedItem.id).toBe(1)
  })

  it.skipIf(isMinifiedBuild())('first-match-wins: child action prevents root action from firing', async () => {
    const calls = []

    wildflower.component('pa-fmw', {
      state: {},
      pools: { items: {} },
      onRowClick(item) { calls.push('row') },
      onButtonClick(item) { calls.push('button') }
    })

    testContainer.innerHTML = `
      <div data-component="pa-fmw">
        <div data-pool="items" data-key="id">
          <template>
            <div data-action="onRowClick">
              <span data-bind="name"></span>
              <button data-action="onButtonClick">Click</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-fmw"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    // Click the button — should fire onButtonClick, NOT onRowClick
    const btn = el.querySelector('button')
    btn.click()
    await waitForUpdate()

    expect(calls).toEqual(['button'])

    // Click the span — should fire onRowClick (catch-all on root)
    calls.length = 0
    const span = el.querySelector('span')
    span.click()
    await waitForUpdate()

    expect(calls).toEqual(['row'])
  })

  it.skipIf(isMinifiedBuild())('nested element clicks (span inside button) resolve to button action', async () => {
    let receivedItem = null

    wildflower.component('pa-nested', {
      state: {},
      pools: { items: {} },
      onBtnClick(item) { receivedItem = item }
    })

    testContainer.innerHTML = `
      <div data-component="pa-nested">
        <div data-pool="items" data-key="id">
          <template>
            <div>
              <button data-action="onBtnClick"><span class="icon">X</span> Delete</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-nested"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    // Click the span inside the button
    const span = el.querySelector('.icon')
    span.click()
    await waitForUpdate()

    expect(receivedItem).not.toBeNull()
    expect(receivedItem.id).toBe(1)
  })

  it.skipIf(isMinifiedBuild())('data-action receives correct item after pool mutations', async () => {
    const clickedIds = []

    wildflower.component('pa-mutate', {
      state: {},
      pools: { items: {} },
      onClick(item) { clickedIds.push(item.id) }
    })

    testContainer.innerHTML = `
      <div data-component="pa-mutate">
        <div data-pool="items" data-key="id">
          <template>
            <div>
              <span data-bind="name"></span>
              <button data-action="onClick">Go</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-mutate"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    instance.pools.items.add({ id: 2, name: 'Bob' })
    instance.pools.items.add({ id: 3, name: 'Charlie' })
    await waitForRAF()

    // Remove item 2
    instance.pools.items.remove(2)
    await waitForRAF()

    // Click the button on item 3 (now the second element)
    const btns = el.querySelectorAll('button')
    btns[1].click()
    await waitForUpdate()

    expect(clickedIds).toEqual([3])
  })

  it.skipIf(isMinifiedBuild())('event types other than click', async () => {
    let changedItem = null

    wildflower.component('pa-change', {
      state: {},
      pools: { items: {} },
      onStatusChange(item, event) { changedItem = item }
    })

    testContainer.innerHTML = `
      <div data-component="pa-change">
        <div data-pool="items" data-key="id">
          <template>
            <div>
              <select data-action="change:onStatusChange">
                <option value="a">A</option>
                <option value="b">B</option>
              </select>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-change"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    // Trigger change event on select
    const select = el.querySelector('select')
    select.value = 'b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForUpdate()

    expect(changedItem).not.toBeNull()
    expect(changedItem.id).toBe(1)
  })

  it.skipIf(isMinifiedBuild())('data-action works with static pools', async () => {
    let receivedItem = null

    wildflower.component('pa-static', {
      state: {},
      pools: { items: {} },
      onClick(item) { receivedItem = item }
    })

    testContainer.innerHTML = `
      <div data-component="pa-static">
        <div data-pool="items" data-key="id" data-pool-static>
          <template>
            <div>
              <span data-bind="name"></span>
              <button data-action="onClick">Go</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-static"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    // Static pool — no need for rAF wait, bindings applied synchronously
    await waitForUpdate()

    const btn = el.querySelector('button')
    btn.click()
    await waitForUpdate()

    expect(receivedItem).not.toBeNull()
    expect(receivedItem.id).toBe(1)
  })

  it.skipIf(isMinifiedBuild())('data-action works with pool props', async () => {
    let receivedItem = null

    wildflower.component('pa-props', {
      state: {},
      pools: {
        items: {
          props: { theme: 'dark' }
        }
      },
      onClick(item) { receivedItem = item }
    })

    testContainer.innerHTML = `
      <div data-component="pa-props">
        <div data-pool="items" data-key="id">
          <template>
            <div data-bind-class="props.theme">
              <span data-bind="name"></span>
              <button data-action="onClick">Go</button>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="pa-props"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    const btn = el.querySelector('button')
    btn.click()
    await waitForUpdate()

    expect(receivedItem).not.toBeNull()
    expect(receivedItem.id).toBe(1)
  })
})

describe('pool.swap()', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }
    if (wildflower._tickableInstances) wildflower._tickableInstances.length = 0

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (wildflower._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) cancelAnimationFrame(wildflower._poolLoopId)
    }
    if (wildflower._activePoolHandles) wildflower._activePoolHandles.length = 0
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it.skipIf(isMinifiedBuild())('swap(key1, key2) swaps DOM positions', async () => {
    wildflower.component('ps-basic', {
      state: {},
      pools: { items: {} }
    })

    testContainer.innerHTML = `
      <div data-component="ps-basic">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="ps-basic"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add([
      { id: 1, name: 'First' },
      { id: 2, name: 'Second' },
      { id: 3, name: 'Third' }
    ])
    await waitForRAF()

    const pool = instance.pools.items
    const container = el.querySelector('[data-pool]') || el.querySelector('div > div')

    // Verify initial order
    const children = () => Array.from(container.children).map(c => c.textContent)
    expect(children()).toEqual(['First', 'Second', 'Third'])

    // Swap first and third
    const result = pool.swap(1, 3)
    expect(result).toBe(true)

    expect(children()).toEqual(['Third', 'Second', 'First'])
  })

  it.skipIf(isMinifiedBuild())('swap maintains correct item-to-element mapping', async () => {
    wildflower.component('ps-mapping', {
      state: {},
      pools: { items: {} }
    })

    testContainer.innerHTML = `
      <div data-component="ps-mapping">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="ps-mapping"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ])
    await waitForRAF()

    const pool = instance.pools.items
    pool.swap(1, 2)

    // getElement should still return the correct element for each key
    expect(pool.getElement(1).textContent).toBe('Alice')
    expect(pool.getElement(2).textContent).toBe('Bob')
  })

  it.skipIf(isMinifiedBuild())('swap with nonexistent key returns false', async () => {
    wildflower.component('ps-noexist', {
      state: {},
      pools: { items: {} }
    })

    testContainer.innerHTML = `
      <div data-component="ps-noexist">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="ps-noexist"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add({ id: 1, name: 'Alice' })
    await waitForRAF()

    expect(instance.pools.items.swap(1, 999)).toBe(false)
    expect(instance.pools.items.swap(999, 1)).toBe(false)
  })

  it.skipIf(isMinifiedBuild())('swap same key with itself is a no-op', async () => {
    wildflower.component('ps-self', {
      state: {},
      pools: { items: {} }
    })

    testContainer.innerHTML = `
      <div data-component="ps-self">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="ps-self"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add([
      { id: 1, name: 'First' },
      { id: 2, name: 'Second' }
    ])
    await waitForRAF()

    const result = instance.pools.items.swap(1, 1)
    expect(result).toBe(true)

    // Order unchanged
    const container = el.querySelector('[data-pool]') || el.querySelector('div > div')
    const children = Array.from(container.children).map(c => c.textContent)
    expect(children).toEqual(['First', 'Second'])
  })

  it.skipIf(isMinifiedBuild())('multiple sequential swaps maintain consistency', async () => {
    wildflower.component('ps-multi', {
      state: {},
      pools: { items: {} }
    })

    testContainer.innerHTML = `
      <div data-component="ps-multi">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="ps-multi"]')
    const instance = getInstance(wildflower, el)
    instance.pools.items.add([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
      { id: 4, name: 'D' }
    ])
    await waitForRAF()

    const pool = instance.pools.items
    const container = el.querySelector('[data-pool]') || el.querySelector('div > div')
    const children = () => Array.from(container.children).map(c => c.textContent)

    // Swap 1 and 4: A B C D → D B C A
    pool.swap(1, 4)
    expect(children()).toEqual(['D', 'B', 'C', 'A'])

    // Swap 2 and 3: D B C A → D C B A
    pool.swap(2, 3)
    expect(children()).toEqual(['D', 'C', 'B', 'A'])

    // Swap back 1 and 4: D C B A → A C B D
    pool.swap(1, 4)
    expect(children()).toEqual(['A', 'C', 'B', 'D'])
  })
})
