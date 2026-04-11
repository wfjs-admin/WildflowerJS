/**
 * WildflowerJS Template System Test Suite - Vitest Browser Mode
 *
 * Tests for HTML5 template elements.
 * Migrated from unitTestSuite.js Template System section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Template System', () => {
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

  it.skipIf(isMinifiedBuild())('HTML5 template element renders list items correctly', async () => {
    wildflower.component('html5-template-comp', {
      state: {
        items: [
          { name: 'First' },
          { name: 'Second' },
          { name: 'Third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div id="html5-template-test" data-component="html5-template-comp">
        <div data-list="items">
          <template>
            <div class="item"><span data-bind="name"></span></div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    const items = document.querySelectorAll('#html5-template-test .item')
    expect(items.length).toBe(3)

    const firstItem = items[0].querySelector('span')
    expect(firstItem.textContent).toBe('First')

    // Verify list context was created for template-based list
    const registry = wildflower._contextRegistry
    const listElement = testContainer.querySelector('[data-list="items"]')
    const listContext = registry.getContextForElement(listElement)
    expect(listContext).toBeDefined()
    expect(listContext.type).toBe('list')
    expect(listContext.path).toBe('items')

    // Verify binding contexts were created for list items
    const bindingContext = registry.getContextForElement(firstItem)
    expect(bindingContext).toBeDefined()
    expect(bindingContext.type).toBe('binding')
    expect(bindingContext.path).toBe('name')
    expect(bindingContext.parent).toBeDefined()
    expect(bindingContext.parent.type).toBe('list')
  })

  it('template content is cloned not moved', async () => {
    wildflower.component('clone-test-comp', {
      state: {
        items: [{ value: 'A' }, { value: 'B' }]
      }
    })

    testContainer.innerHTML = `
      <div id="clone-test" data-component="clone-test-comp">
        <div data-list="items" id="clone-list">
          <template id="clone-template">
            <div class="cloned"><span data-bind="value"></span></div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    // Template element should still exist
    const templateEl = document.getElementById('clone-template')
    expect(templateEl).toBeDefined()

    // Items should be rendered
    const items = document.querySelectorAll('#clone-list .cloned')
    expect(items.length).toBe(2)
  })

  it.skipIf(isMinifiedBuild())('nested templates work correctly', async () => {
    wildflower.component('nested-template-comp', {
      state: {
        categories: [
          {
            name: 'Category 1',
            items: [{ label: 'Item 1A' }, { label: 'Item 1B' }]
          },
          {
            name: 'Category 2',
            items: [{ label: 'Item 2A' }]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div id="nested-template-test" data-component="nested-template-comp">
        <div data-list="categories">
          <template>
            <div class="category">
              <h3 data-bind="name"></h3>
              <div data-list="items">
                <template>
                  <span class="nested-item" data-bind="label"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate(150)

    const categories = document.querySelectorAll('#nested-template-test .category')
    expect(categories.length).toBe(2)

    const allNestedItems = document.querySelectorAll('#nested-template-test .nested-item')
    expect(allNestedItems.length).toBe(3)

    // Verify nested list context hierarchy
    const registry = wildflower._contextRegistry
    const outerList = testContainer.querySelector('[data-list="categories"]')
    const outerContext = registry.getContextForElement(outerList)
    expect(outerContext).toBeDefined()
    expect(outerContext.type).toBe('list')
    expect(outerContext.path).toBe('categories')

    // Verify inner list has correct parent
    const innerList = categories[0].querySelector('[data-list="items"]')
    const innerContext = registry.getContextForElement(innerList)
    expect(innerContext).toBeDefined()
    expect(innerContext.type).toBe('list')
    expect(innerContext.path).toBe('items')
    expect(innerContext.parent).toBeDefined()
    expect(innerContext.parent.type).toBe('list')

    // Verify full path construction for nested template list
    expect(innerContext.getFullPath()).toBe('categories[0].items')
  })

  it('empty list with template handles gracefully', async () => {
    wildflower.component('empty-template-comp', {
      state: {
        emptyListItems: []
      },
      addItem() {
        this.state.emptyListItems.push({ name: 'New Item' })
      }
    })

    testContainer.innerHTML = `
      <div id="empty-template-test" data-component="empty-template-comp">
        <div data-list="emptyListItems" id="empty-list">
          <template>
            <div class="empty-item"><span data-bind="name"></span></div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
    await waitForUpdate()

    // Initially empty
    let items = document.querySelectorAll('#empty-list .empty-item')
    expect(items.length).toBe(0)

    // Add an item via direct state manipulation
    const element = document.getElementById('empty-template-test')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    instance.state.emptyListItems.push({ name: 'New Item' })
    await waitForUpdate()

    items = document.querySelectorAll('#empty-list .empty-item')
    expect(items.length).toBe(1)
  })
})
