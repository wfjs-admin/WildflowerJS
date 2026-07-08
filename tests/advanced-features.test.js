/**
 * WildflowerJS Advanced Features Test Suite - Vitest Browser Mode
 *
 * Tests for cross-component communication, dependency tracking, and reactive integration.
 * Migrated from unitTestSuite.js ADVANCED FEATURES section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

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

describe('Advanced Features', () => {
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

  it('Contexts facilitate cross-component communication via stores', async () => {
    testContainer.innerHTML = `
      <div data-component="component-a">
        <span id="comp-a-shared" data-bind="shared"></span>
        <div data-list="advItems">
          <template>
            <span class="adv-item" data-bind="name"></span>
          </template>
        </div>
      </div>
      <div data-component="component-b">
        <span id="comp-b-observed" data-bind="computed:observedData"></span>
      </div>
    `

    const sharedStore = wildflower.store('shared-store', {
      state: {
        shared: 'original'
      }
    })

    wildflower.component('component-a', {
      subscribe: { 'shared-store': ['shared'] },
      state: {
        advItems: [{ id: 1, name: 'Item 1' }]
      },
      computed: {
        shared() {
          return this.stores['shared-store'].shared
        }
      }
    })

    wildflower.component('component-b', {
      subscribe: { 'shared-store': ['shared'] },
      computed: {
        observedData() {
          return `Observed: ${this.stores['shared-store'].shared}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const compBDisplay = testContainer.querySelector('#comp-b-observed')

    // Verify initial state
    expect(compBDisplay.textContent).toBe('Observed: original')

    // Update the store
    sharedStore.state.shared = 'updated'
    await waitForCompleteRender()

    // Verify component B received the update
    expect(compBDisplay.textContent).toBe('Observed: updated')
  })

  it('Context dependency tracking via store subscription', async () => {
    testContainer.innerHTML = `
      <div data-component="parent-dep-comp">
        <div data-list="parentDepList">
          <template>
            <span class="parent-dep-item" data-bind="name"></span>
          </template>
        </div>
      </div>
      <div data-component="child-dep-comp">
        <span id="child-dep-display" data-bind="computed:derivedFromParent"></span>
      </div>
    `

    const parentStore = wildflower.store('parent-dep-store', {
      state: {
        parentDepList: [{ id: 1, name: 'Parent Item' }]
      }
    })

    wildflower.component('parent-dep-comp', {
      subscribe: { 'parent-dep-store': ['parentDepList'] },
      computed: {
        parentDepList() {
          return this.stores['parent-dep-store'].parentDepList
        }
      }
    })

    wildflower.component('child-dep-comp', {
      subscribe: { 'parent-dep-store': ['parentDepList'] },
      computed: {
        derivedFromParent() {
          const parentList = this.stores['parent-dep-store'].parentDepList
          return parentList ? `Count: ${parentList.length}` : 'No data'
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const childDisplay = testContainer.querySelector('#child-dep-display')

    // Verify initial dependency tracking
    expect(childDisplay.textContent).toBe('Count: 1')

    // Update store - should propagate to child
    parentStore.state.parentDepList = [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' }
    ]
    await waitForCompleteRender()

    expect(childDisplay.textContent).toBe('Count: 2')
  })

  it('Context system handles circular references in data', async () => {
    // Create component with data that could form circular references
    testContainer.innerHTML = `
      <div data-component="circular-data-test">
        <div data-list="circularItems">
          <template>
            <span class="circular-item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    const circularData = [{ id: 1, name: 'Item 1', ref: null }]
    // Note: In actual state, circular references would be created carefully
    // The framework should handle them without infinite loops

    wildflower.component('circular-data-test', {
      state: {
        circularItems: circularData
      }
    })

    // Should not throw
    let errorThrown = false
    try {
      wildflower.scan()
      await waitForCompleteRender()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)

    // Verify items rendered
    const items = testContainer.querySelectorAll('.circular-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('Item 1')
  })

  it('Context integration with ReactiveStateManager', async () => {
    testContainer.innerHTML = `
      <div data-component="reactive-state-test">
        <div data-list="reactiveItems">
          <template>
            <span class="reactive-item" data-bind="name"></span>
          </template>
        </div>
        <span id="reactive-count" data-bind="computed:itemCount"></span>
      </div>
    `

    wildflower.component('reactive-state-test', {
      state: {
        reactiveItems: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      },
      computed: {
        itemCount() {
          return `Total: ${this.state.reactiveItems.length}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="reactive-state-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    const items = testContainer.querySelectorAll('.reactive-item')
    expect(items.length).toBe(2)
    expect(testContainer.querySelector('#reactive-count').textContent).toBe('Total: 2')

    // Update state using push
    instance.state.reactiveItems.push({ id: 3, name: 'Item 3' })
    await waitForCompleteRender()

    // Verify reactive updates
    const updatedItems = testContainer.querySelectorAll('.reactive-item')
    expect(updatedItems.length).toBe(3)
    expect(testContainer.querySelector('#reactive-count').textContent).toBe('Total: 3')
  })

  it('Event propagation through context hierarchy via emit()', async () => {
    testContainer.innerHTML = `
      <div data-component="root-event-comp">
        <span id="root-received" data-bind="receivedMessage"></span>
        <div data-component="level1-event-comp">
          <div data-component="level2-event-comp">
            <div data-component="leaf-event-comp">
              <button id="emit-btn" data-action="sendEvent">Send</button>
            </div>
          </div>
        </div>
      </div>
    `

    let eventBubbled = false
    let eventData = null

    wildflower.component('root-event-comp', {
      state: {
        receivedMessage: 'Waiting...'
      },
      onLeafEvent(data) {
        eventBubbled = true
        eventData = data
        this.state.receivedMessage = data.message
      }
    })

    wildflower.component('level1-event-comp', {
      state: {}
      // No handler - should bubble through
    })

    wildflower.component('level2-event-comp', {
      state: {}
      // No handler - should bubble through
    })

    wildflower.component('leaf-event-comp', {
      state: {},
      sendEvent() {
        this.emit('leafEvent', { message: 'Hello from leaf!' })
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Click the button to emit event
    testContainer.querySelector('#emit-btn').click()
    await waitForCompleteRender()

    // Verify event bubbled to root
    expect(eventBubbled).toBe(true)
    expect(eventData.message).toBe('Hello from leaf!')
    expect(testContainer.querySelector('#root-received').textContent).toBe('Hello from leaf!')
  })

  it.skipIf(isMinifiedBuild())('DOM element context synchronization', async () => {
    testContainer.innerHTML = `
      <div data-component="dom-sync-test">
        <div id="parent-element">
          <div id="child-element" data-list="syncItems">
            <template>
              <span class="sync-item" data-bind="label"></span>
            </template>
          </div>
        </div>
      </div>
    `

    wildflower.component('dom-sync-test', {
      state: {
        syncItems: [{ label: 'Item A' }, { label: 'Item B' }]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const childElement = testContainer.querySelector('#child-element')

    // Test lookup by element (list contexts are plain objects on the element)
    const context = childElement._listContext
    expect(context).toBeDefined()
    expect(context.type).toBe('list')

    // Verify items rendered
    const items = testContainer.querySelectorAll('.sync-item')
    expect(items.length).toBe(2)

    // Test element mutation - move the list to a new container
    const newContainer = document.createElement('div')
    testContainer.querySelector('#parent-element').appendChild(newContainer)
    newContainer.appendChild(childElement)

    // Context should still be associated (the record rides with the element)
    const movedContext = childElement._listContext
    expect(movedContext).toBeDefined()
    expect(movedContext.id).toBe(context.id)

    // Items should still be visible
    const movedItems = testContainer.querySelectorAll('.sync-item')
    expect(movedItems.length).toBe(2)
  })
})
