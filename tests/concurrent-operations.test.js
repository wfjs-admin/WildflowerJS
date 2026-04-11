/**
 * WildflowerJS Concurrent Operations Test Suite - Vitest Browser Mode
 *
 * Tests for rapid component operations, simultaneous updates, and race conditions.
 * Migrated from unitTestSuite.js Concurrent Operations section.
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

describe('Concurrent Operations', () => {
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

  it('rapid component creation and destruction', async () => {
    testContainer.innerHTML = `<div id="rapid-container"></div>`
    const container = testContainer.querySelector('#rapid-container')

    wildflower.component('rapid-test', {
      state: { value: 0 }
    })

    // Create 10 components rapidly
    const componentIds = []
    for (let i = 0; i < 10; i++) {
      const div = document.createElement('div')
      div.setAttribute('data-component', 'rapid-test')
      div.id = `rapid-${i}`
      container.appendChild(div)
    }

    wildflower.scan()
    await waitForUpdate(50)

    // Collect component IDs
    for (let i = 0; i < 10; i++) {
      const el = container.querySelector(`#rapid-${i}`)
      if (el && el.dataset.componentId) {
        componentIds.push(el.dataset.componentId)
      }
    }

    expect(componentIds.length).toBe(10)

    // Destroy them all immediately
    componentIds.forEach(id => {
      wildflower.destroyComponent(id)
    })

    // Verify cleanup
    wildflower.garbageCollect()
    await waitForUpdate(50)

    // Verify components are removed
    let remainingCount = 0
    componentIds.forEach(id => {
      if (wildflower.componentInstances.has(id)) {
        remainingCount++
      }
    })

    expect(remainingCount).toBe(0)
  })

  it('simultaneous list updates', async () => {
    wildflower.component('sim-list-test', {
      state: {
        simListItems: []
      }
    })

    testContainer.innerHTML = `
      <div id="sim-list" data-component="sim-list-test">
        <ul data-list="simListItems">
          <template><li data-bind="value"></li></template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#sim-list')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Push multiple items in quick succession (same tick)
    instance.state.simListItems.push({ value: 'A' })
    instance.state.simListItems.push({ value: 'B' })
    instance.state.simListItems.push({ value: 'C' })

    await waitForCompleteRender()
    await waitForUpdate(100)

    const listItems = element.querySelectorAll('[data-list="simListItems"] li')
    expect(listItems.length).toBe(3)
    expect(listItems[0].textContent).toBe('A')
    expect(listItems[1].textContent).toBe('B')
    expect(listItems[2].textContent).toBe('C')
  })

  it('concurrent state changes on same property', async () => {
    wildflower.component('concurrent-state-test', {
      state: {
        counter: 0
      }
    })

    testContainer.innerHTML = `
      <div id="concurrent-state" data-component="concurrent-state-test">
        <span data-bind="counter" data-type="number">0</span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#concurrent-state')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Rapid state changes in same tick
    instance.state.counter = 1
    instance.state.counter = 2
    instance.state.counter = 3
    instance.state.counter = 4
    instance.state.counter = 5

    await waitForCompleteRender()
    await waitForUpdate(50)

    const counterSpan = element.querySelector('[data-bind="counter"]')
    expect(instance.state.counter).toBe(5)
    expect(counterSpan.textContent).toBe('5')
  })

  it('rapid event triggering', async () => {
    wildflower.component('rapid-events-test', {
      state: {
        clickCount: 0
      },
      handleClick() {
        this.state.clickCount++
      }
    })

    testContainer.innerHTML = `
      <div id="rapid-events" data-component="rapid-events-test">
        <span data-bind="clickCount" data-type="number">0</span>
        <button data-action="handleClick">Click</button>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#rapid-events')
    const button = element.querySelector('button')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Rapid clicks
    for (let i = 0; i < 10; i++) {
      button.click()
    }

    await waitForCompleteRender()
    await waitForUpdate(100)

    expect(instance.state.clickCount).toBe(10)
    const countSpan = element.querySelector('[data-bind="clickCount"]')
    expect(countSpan.textContent).toBe('10')
  })

  it('overlapping async state updates', async () => {
    wildflower.component('async-updates-test', {
      state: {
        result: 'initial'
      }
    })

    testContainer.innerHTML = `
      <div id="async-updates" data-component="async-updates-test">
        <span data-bind="result"></span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#async-updates')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Simulate overlapping async updates
    setTimeout(() => { instance.state.result = 'update1' }, 10)
    setTimeout(() => { instance.state.result = 'update2' }, 20)
    setTimeout(() => { instance.state.result = 'update3' }, 30)

    // Wait for all updates to complete
    await waitForUpdate(150)
    await waitForCompleteRender()

    const resultSpan = element.querySelector('[data-bind="result"]')
    expect(instance.state.result).toBe('update3')
    expect(resultSpan.textContent).toBe('update3')
  })

  it('multiple components updating simultaneously', async () => {
    wildflower.component('multi-comp-test', {
      state: {
        value: 0
      }
    })

    testContainer.innerHTML = `
      <div id="multi-comp-1" data-component="multi-comp-test">
        <span data-bind="value" data-type="number">0</span>
      </div>
      <div id="multi-comp-2" data-component="multi-comp-test">
        <span data-bind="value" data-type="number">0</span>
      </div>
      <div id="multi-comp-3" data-component="multi-comp-test">
        <span data-bind="value" data-type="number">0</span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const el1 = testContainer.querySelector('#multi-comp-1')
    const el2 = testContainer.querySelector('#multi-comp-2')
    const el3 = testContainer.querySelector('#multi-comp-3')

    const inst1 = wildflower.componentInstances.get(el1.dataset.componentId)
    const inst2 = wildflower.componentInstances.get(el2.dataset.componentId)
    const inst3 = wildflower.componentInstances.get(el3.dataset.componentId)

    // Update all three components simultaneously
    inst1.state.value = 10
    inst2.state.value = 20
    inst3.state.value = 30

    await waitForCompleteRender()
    await waitForUpdate(50)

    expect(el1.querySelector('[data-bind="value"]').textContent).toBe('10')
    expect(el2.querySelector('[data-bind="value"]').textContent).toBe('20')
    expect(el3.querySelector('[data-bind="value"]').textContent).toBe('30')
  })

  it('rapid list add and remove operations', async () => {
    wildflower.component('rapid-list-ops-test', {
      state: {
        rapidListItems: [
          { name: 'Item 1' },
          { name: 'Item 2' },
          { name: 'Item 3' },
          { name: 'Item 4' },
          { name: 'Item 5' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div id="rapid-list-ops" data-component="rapid-list-ops-test">
        <ul data-list="rapidListItems">
          <template><li data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#rapid-list-ops')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Rapid add and remove in same tick
    instance.state.rapidListItems.push({ name: 'Item 6' })
    instance.state.rapidListItems.shift() // Remove first
    instance.state.rapidListItems.push({ name: 'Item 7' })
    instance.state.rapidListItems.splice(2, 1) // Remove from middle

    await waitForCompleteRender()
    await waitForUpdate(100)

    const listItems = element.querySelectorAll('[data-list="rapidListItems"] li')
    expect(listItems.length).toBe(5)
    expect(instance.state.rapidListItems.length).toBe(5)
  })

  it('interleaved component init and state updates', async () => {
    testContainer.innerHTML = `<div id="interleaved-container"></div>`
    const container = testContainer.querySelector('#interleaved-container')

    let initCount = 0

    wildflower.component('interleaved-test', {
      state: {
        value: 0
      },
      init() {
        initCount++
        // Update state during init
        this.state.value = initCount * 10
      }
    })

    // Create components and trigger state updates interleaved
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div')
      div.setAttribute('data-component', 'interleaved-test')
      div.id = `interleaved-${i}`
      div.innerHTML = '<span data-bind="value" data-type="number">0</span>'
      container.appendChild(div)
    }

    wildflower.scan()
    await waitForUpdate(100)
    await waitForCompleteRender()

    expect(initCount).toBe(5)

    // Verify each component has correct value from init
    for (let i = 0; i < 5; i++) {
      const el = container.querySelector(`#interleaved-${i}`)
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      expect(instance).toBeDefined()
      expect(instance.state.value % 10).toBe(0)
    }
  })
})
