/**
 * WildflowerJS Same-Tick Operation Collisions Test Suite - Vitest Browser Mode
 *
 * Tests for multiple array operations within the same tick (no await between).
 * Migrated from unitTestSuite.js Same-Tick Operation Collisions section.
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

describe('Same-Tick Operation Collisions', () => {
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

  it('same-tick: append + append (no await between)', async () => {
    wildflower.component('tick-append-append', {
      state: {
        tickAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-append-append">
        <ul data-list="tickAppendItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-append-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Two appends without await
    instance.state.tickAppendItems.push({ id: 3, name: 'third' })
    instance.state.tickAppendItems.push({ id: 4, name: 'fourth' })

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickAppendItems"] li')
    expect(listItems.length).toBe(4)
    expect(listItems[2].textContent).toBe('third')
    expect(listItems[3].textContent).toBe('fourth')
  })

  it('same-tick: swap + append (no await between)', async () => {
    wildflower.component('tick-swap-append', {
      state: {
        tickSwapAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-swap-append">
        <ul data-list="tickSwapAppendItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-swap-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Swap then append without await
    const temp = instance.state.tickSwapAppendItems[0]
    instance.state.tickSwapAppendItems[0] = instance.state.tickSwapAppendItems[1]
    instance.state.tickSwapAppendItems[1] = temp
    instance.state.tickSwapAppendItems.push({ id: 3, name: 'third' })

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickSwapAppendItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
    expect(listItems[2].textContent).toBe('third')
  })

  it('same-tick: append + swap (no await between)', async () => {
    wildflower.component('tick-append-swap', {
      state: {
        tickAppendSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-append-swap">
        <ul data-list="tickAppendSwapItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-append-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Append then swap without await
    instance.state.tickAppendSwapItems.push({ id: 3, name: 'third' })
    const temp = instance.state.tickAppendSwapItems[0]
    instance.state.tickAppendSwapItems[0] = instance.state.tickAppendSwapItems[1]
    instance.state.tickAppendSwapItems[1] = temp

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickAppendSwapItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('first')
    expect(listItems[2].textContent).toBe('third')
  })

  it('same-tick: splice + append (no await between)', async () => {
    wildflower.component('tick-splice-append', {
      state: {
        tickSpliceAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-splice-append">
        <ul data-list="tickSpliceAppendItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-splice-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Splice (remove middle) then append without await
    instance.state.tickSpliceAppendItems.splice(1, 1) // Remove 'second'
    instance.state.tickSpliceAppendItems.push({ id: 4, name: 'fourth' })

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickSpliceAppendItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('first')
    expect(listItems[1].textContent).toBe('third')
    expect(listItems[2].textContent).toBe('fourth')
  })

  it('same-tick: swap + swap (no await between)', async () => {
    wildflower.component('tick-swap-swap', {
      state: {
        tickSwapSwapItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-swap-swap">
        <ul data-list="tickSwapSwapItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-swap-swap"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Two swaps without await
    // First swap: [0,1] → [1,0]
    let temp = instance.state.tickSwapSwapItems[0]
    instance.state.tickSwapSwapItems[0] = instance.state.tickSwapSwapItems[1]
    instance.state.tickSwapSwapItems[1] = temp

    // Second swap: [1,2] → [2,1]
    temp = instance.state.tickSwapSwapItems[1]
    instance.state.tickSwapSwapItems[1] = instance.state.tickSwapSwapItems[2]
    instance.state.tickSwapSwapItems[2] = temp

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickSwapSwapItems"] li')
    expect(listItems.length).toBe(3)
    // [first, second, third] → [second, first, third] → [second, third, first]
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('third')
    expect(listItems[2].textContent).toBe('first')
  })

  it('same-tick: triple append (no await between)', async () => {
    wildflower.component('tick-triple-append', {
      state: {
        tickTripleAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-triple-append">
        <ul data-list="tickTripleAppendItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-triple-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Three appends without await
    instance.state.tickTripleAppendItems.push({ id: 3, name: 'third' })
    instance.state.tickTripleAppendItems.push({ id: 4, name: 'fourth' })
    instance.state.tickTripleAppendItems.push({ id: 5, name: 'fifth' })

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickTripleAppendItems"] li')
    expect(listItems.length).toBe(5)
    expect(listItems[2].textContent).toBe('third')
    expect(listItems[3].textContent).toBe('fourth')
    expect(listItems[4].textContent).toBe('fifth')
  })

  it('same-tick: append + sort (realistic pattern)', async () => {
    wildflower.component('tick-append-sort', {
      state: {
        tickAppendSortItems: [
          { id: 1, name: 'bob' },
          { id: 2, name: 'alice' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-append-sort">
        <ul data-list="tickAppendSortItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-append-sort"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Append then sort (common user pattern)
    instance.state.tickAppendSortItems.push({ id: 3, name: 'charlie' })
    instance.state.tickAppendSortItems.sort((a, b) => a.name.localeCompare(b.name))

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickAppendSortItems"] li')
    expect(listItems.length).toBe(3)
    // After sort: [alice, bob, charlie]
    expect(listItems[0].textContent).toBe('alice')
    expect(listItems[1].textContent).toBe('bob')
    expect(listItems[2].textContent).toBe('charlie')
  })

  it('same-tick: filter + append (structural change)', async () => {
    wildflower.component('tick-filter-append', {
      state: {
        tickFilterAppendItems: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
          { id: 3, name: 'third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="tick-filter-append">
        <ul data-list="tickFilterAppendItems">
          <template>
            <li><span data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="tick-filter-append"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    await waitForCompleteRender()

    // SAME TICK: Filter (structural change) then append
    instance.state.tickFilterAppendItems = instance.state.tickFilterAppendItems.filter(item => item.id > 1) // Remove first
    instance.state.tickFilterAppendItems.push({ id: 4, name: 'fourth' })

    // Now wait for render
    await waitForCompleteRender()
    await waitForUpdate(50)

    const listItems = component.querySelectorAll('[data-list="tickFilterAppendItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('second')
    expect(listItems[1].textContent).toBe('third')
    expect(listItems[2].textContent).toBe('fourth')
  })
})
