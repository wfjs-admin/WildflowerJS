/**
 * WildflowerJS Operation Sequence Permutations Test Suite - Vitest Browser Mode
 *
 * Tests for various combinations of array operations in sequence.
 * Migrated from unitTestSuite.js Additional Operation Sequence Permutations section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Operation Sequence Permutations', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Re-initialize the context system
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Create test container
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

  it('swap then swap (consecutive swaps)', async () => {
    wildflower.component('seq-swap-swap', {
      state: {
        seqSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-swap-swap">
        <ul data-list="seqSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-swap-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // First swap: [1,2,3] → [2,1,3]
    const temp1 = instance.state.seqSwapItems[0]
    instance.state.seqSwapItems[0] = instance.state.seqSwapItems[1]
    instance.state.seqSwapItems[1] = temp1
    await waitForCompleteRender()

    // Second swap: [2,1,3] → [2,3,1]
    const temp2 = instance.state.seqSwapItems[1]
    instance.state.seqSwapItems[1] = instance.state.seqSwapItems[2]
    instance.state.seqSwapItems[2] = temp2
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="seqSwapItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('third')
    expect(listItems[2].textContent).toBe('first')
  })

  it('append then swap', async () => {
    wildflower.component('seq-append-swap', {
      state: {
        appendSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-append-swap">
        <ul data-list="appendSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-append-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Append
    instance.state.appendSwapItems.push({ id: 3, name: 'third' })
    await waitForCompleteRender()

    // Swap first two
    const temp = instance.state.appendSwapItems[0]
    instance.state.appendSwapItems[0] = instance.state.appendSwapItems[1]
    instance.state.appendSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="appendSwapItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
    expect(listItems[2].textContent).toBe('third')
  })

  it('spread then swap', async () => {
    wildflower.component('seq-spread-swap', {
      state: {
        spreadSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-spread-swap">
        <ul data-list="spreadSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-spread-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Spread (create new array)
    instance.state.spreadSwapItems = [...instance.state.spreadSwapItems]
    await waitForCompleteRender()

    // Swap
    const temp = instance.state.spreadSwapItems[0]
    instance.state.spreadSwapItems[0] = instance.state.spreadSwapItems[1]
    instance.state.spreadSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="spreadSwapItems"] li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
  })

  it('filter then swap', async () => {
    wildflower.component('seq-filter-swap', {
      state: {
        filterSwapItems: [
          { id: 1, name: 'first', keep: true },
          { id: 2, name: 'second', keep: false },
          { id: 3, name: 'third', keep: true }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-filter-swap">
        <ul data-list="filterSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-filter-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Filter (removes 'second')
    instance.state.filterSwapItems = instance.state.filterSwapItems.filter(item => item.keep)
    await waitForCompleteRender()

    // Swap remaining items
    const temp = instance.state.filterSwapItems[0]
    instance.state.filterSwapItems[0] = instance.state.filterSwapItems[1]
    instance.state.filterSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="filterSwapItems"] li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('third')
    expect(listItems[1].textContent).toBe('first')
  })

  it('sort then append', async () => {
    wildflower.component('seq-sort-append', {
      state: {
        sortAppendItems: [
          { id: 3, name: 'third' },
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-sort-append">
        <ul data-list="sortAppendItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-sort-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Sort by id
    instance.state.sortAppendItems.sort((a, b) => a.id - b.id)
    await waitForCompleteRender()

    // Append
    instance.state.sortAppendItems.push({ id: 4, name: 'fourth' })
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="sortAppendItems"] li')
    expect(listItems.length).toBe(4)
    expect(listItems[0].textContent).toBe('first')
    expect(listItems[1].textContent).toBe('second')
    expect(listItems[2].textContent).toBe('third')
    expect(listItems[3].textContent).toBe('fourth')
  })

  it('reverse then swap', async () => {
    wildflower.component('seq-reverse-swap', {
      state: {
        reverseSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-reverse-swap">
        <ul data-list="reverseSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-reverse-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Reverse: [1,2,3] → [3,2,1]
    instance.state.reverseSwapItems.reverse()
    await waitForCompleteRender()

    // Swap first two: [3,2,1] → [2,3,1]
    const temp = instance.state.reverseSwapItems[0]
    instance.state.reverseSwapItems[0] = instance.state.reverseSwapItems[1]
    instance.state.reverseSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="reverseSwapItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('third')
    expect(listItems[2].textContent).toBe('first')
  })

  it('splice then swap', async () => {
    wildflower.component('seq-splice-swap', {
      state: {
        spliceSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' },
          { id: 4, name: 'fourth' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-splice-swap">
        <ul data-list="spliceSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-splice-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Splice removes middle two items: [1,2,3,4] → [1,4]
    instance.state.spliceSwapItems.splice(1, 2)
    await waitForCompleteRender()

    // Swap remaining items: [1,4] → [4,1]
    const temp = instance.state.spliceSwapItems[0]
    instance.state.spliceSwapItems[0] = instance.state.spliceSwapItems[1]
    instance.state.spliceSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="spliceSwapItems"] li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('fourth')
    expect(listItems[1].textContent).toBe('first')
  })

  it('map then append', async () => {
    wildflower.component('seq-map-append', {
      state: {
        mapAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-map-append">
        <ul data-list="mapAppendItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-map-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Map (add prefix)
    instance.state.mapAppendItems = instance.state.mapAppendItems.map(item => ({
      ...item,
      name: 'item-' + item.name
    }))
    await waitForCompleteRender()

    // Append
    instance.state.mapAppendItems.push({ id: 3, name: 'item-third' })
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="mapAppendItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('item-first')
    expect(listItems[1].textContent).toBe('item-second')
    expect(listItems[2].textContent).toBe('item-third')
  })

  it('swap then filter', async () => {
    wildflower.component('seq-swap-filter', {
      state: {
        swapFilterItems: [
          { id: 1, name: 'first', keep: true },
          { id: 2, name: 'second', keep: false },
          { id: 3, name: 'third', keep: true }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-swap-filter">
        <ul data-list="swapFilterItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-swap-filter"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Swap first two items: [1,2,3] → [2,1,3]
    const temp = instance.state.swapFilterItems[0]
    instance.state.swapFilterItems[0] = instance.state.swapFilterItems[1]
    instance.state.swapFilterItems[1] = temp
    await waitForCompleteRender()

    // Filter (removes 'second' which is now first): [2,1,3] → [1,3]
    instance.state.swapFilterItems = instance.state.swapFilterItems.filter(item => item.keep)
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="swapFilterItems"] li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('first')
    expect(listItems[1].textContent).toBe('third')
  })

  it('append then append then swap (triple)', async () => {
    wildflower.component('seq-append-append-swap', {
      state: {
        tripleItems: [
          { id: 1, name: 'first' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-append-append-swap">
        <ul data-list="tripleItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-append-append-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // First append
    instance.state.tripleItems.push({ id: 2, name: 'second' })
    await waitForCompleteRender()

    // Second append
    instance.state.tripleItems.push({ id: 3, name: 'third' })
    await waitForCompleteRender()

    // Swap first two
    const temp = instance.state.tripleItems[0]
    instance.state.tripleItems[0] = instance.state.tripleItems[1]
    instance.state.tripleItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="tripleItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
    expect(listItems[2].textContent).toBe('third')
  })

  it('concat then swap', async () => {
    wildflower.component('seq-concat-swap', {
      state: {
        concatSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-concat-swap">
        <ul data-list="concatSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-concat-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Concat (creates new array)
    instance.state.concatSwapItems = instance.state.concatSwapItems.concat([{ id: 3, name: 'third' }])
    await waitForCompleteRender()

    // Swap first two
    const temp = instance.state.concatSwapItems[0]
    instance.state.concatSwapItems[0] = instance.state.concatSwapItems[1]
    instance.state.concatSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="concatSwapItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
    expect(listItems[2].textContent).toBe('third')
  })

  it('slice then swap', async () => {
    wildflower.component('seq-slice-swap', {
      state: {
        sliceSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' },
          { id: 4, name: 'fourth' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-slice-swap">
        <ul data-list="sliceSwapItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-slice-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Slice (keep middle two): [1,2,3,4] → [2,3]
    instance.state.sliceSwapItems = instance.state.sliceSwapItems.slice(1, 3)
    await waitForCompleteRender()

    // Swap: [2,3] → [3,2]
    const temp = instance.state.sliceSwapItems[0]
    instance.state.sliceSwapItems[0] = instance.state.sliceSwapItems[1]
    instance.state.sliceSwapItems[1] = temp
    await waitForCompleteRender()

    const listItems = component.querySelectorAll('[data-list="sliceSwapItems"] li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('third')
    expect(listItems[1].textContent).toBe('second')
  })

  it('splice then update properties past splice point (regression)', async () => {
    wildflower.component('seq-splice-update', {
      state: {
        spliceUpdateItems: [
          { id: 1, label: 'Item 1' },
          { id: 2, label: 'Item 2' },
          { id: 3, label: 'Item 3' },
          { id: 4, label: 'Item 4' },
          { id: 5, label: 'Item 5' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="seq-splice-update">
        <ul data-list="spliceUpdateItems">
          <template>
            <li data-bind="label"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="seq-splice-update"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Remove item at index 2 ("Item 3"): [1,2,3,4,5] → [1,2,4,5]
    instance.state.spliceUpdateItems.splice(2, 1)
    await waitForCompleteRender()

    let listItems = component.querySelectorAll('[data-list="spliceUpdateItems"] li')
    expect(listItems.length).toBe(4)

    // Update labels on items PAST the splice point (indices 2 and 3, formerly 3 and 4)
    instance.state.spliceUpdateItems[2].label = 'Updated 4'
    instance.state.spliceUpdateItems[3].label = 'Updated 5'
    await waitForCompleteRender()

    listItems = component.querySelectorAll('[data-list="spliceUpdateItems"] li')
    expect(listItems[0].textContent).toBe('Item 1')
    expect(listItems[1].textContent).toBe('Item 2')
    expect(listItems[2].textContent).toBe('Updated 4')
    expect(listItems[3].textContent).toBe('Updated 5')
  })
})
