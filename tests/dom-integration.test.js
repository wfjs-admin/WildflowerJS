/**
 * WildflowerJS DOM Integration Test Suite - Vitest Browser Mode
 *
 * Tests for element context association and template relationship detection.
 * Migrated from unitTestSuite.js DOM INTEGRATION section.
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

describe('DOM Integration', () => {
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

  it.skipIf(isMinifiedBuild())('Element context association', async () => {
    testContainer.innerHTML = `
      <div data-component="element-assoc-test">
        <div id="elem-assoc-list" data-list="elemAssocItems">
          <template>
            <span class="elem-assoc-item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component('element-assoc-test', {
      state: {
        elemAssocItems: [{ id: 1, name: 'Test Item' }]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Get the list element
    const listElement = testContainer.querySelector('#elem-assoc-list')

    // Test element lookup
    const contextFromElement = wildflower._contextRegistry.getContextForElement(listElement)

    expect(contextFromElement).toBeDefined()
    expect(contextFromElement.type).toBe('list')
    expect(contextFromElement.path).toBe('elemAssocItems')

    // Verify element reference is correct
    expect(contextFromElement.element).toBe(listElement)

    // Verify data resolution
    const resolvedData = contextFromElement.resolveData()
    expect(resolvedData.length).toBe(1)
    expect(resolvedData[0].name).toBe('Test Item')

    // Verify binding context in list item
    const itemSpan = testContainer.querySelector('.elem-assoc-item')
    expect(itemSpan).toBeDefined()
    expect(itemSpan.textContent).toBe('Test Item')
  })

  it('Template relationship detection', async () => {
    testContainer.innerHTML = `
      <div data-component="template-rel-test">
        <div id="template-parent-list" data-list="templateRelItems">
          <template>
            <div class="parent-item">
              <span data-bind="name"></span>
              <div data-list="subItems">
                <template>
                  <span class="sub-item" data-bind="label"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component('template-rel-test', {
      state: {
        templateRelItems: [
          { name: 'Parent 1', subItems: [{ label: 'Sub A' }, { label: 'Sub B' }] },
          { name: 'Parent 2', subItems: [{ label: 'Sub C' }] }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Verify parent items rendered
    const parentItems = testContainer.querySelectorAll('.parent-item')
    expect(parentItems.length).toBe(2)

    // Verify sub items rendered
    const subItems = testContainer.querySelectorAll('.sub-item')
    expect(subItems.length).toBe(3) // 2 + 1 = 3 total sub items

    // Verify first parent's text
    expect(parentItems[0].querySelector('[data-bind="name"]').textContent).toBe('Parent 1')

    // Verify sub item content
    expect(subItems[0].textContent).toBe('Sub A')
    expect(subItems[1].textContent).toBe('Sub B')
    expect(subItems[2].textContent).toBe('Sub C')
  })

  it('Complex relationship detection (3 levels)', async () => {
    testContainer.innerHTML = `
      <div data-component="complex-rel-test">
        <div data-list="categories">
          <template>
            <div class="category">
              <h3 data-bind="name"></h3>
              <div data-list="categoryItems">
                <template>
                  <div class="item">
                    <span data-bind="title"></span>
                    <div data-list="tags">
                      <template>
                        <span class="tag" data-bind="label"></span>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component('complex-rel-test', {
      state: {
        categories: [
          {
            name: 'Category A',
            categoryItems: [
              { title: 'Item 1', tags: [{ label: 'Tag 1' }, { label: 'Tag 2' }] }
            ]
          },
          {
            name: 'Category B',
            categoryItems: [
              { title: 'Item 2', tags: [{ label: 'Tag 3' }] },
              { title: 'Item 3', tags: [] }
            ]
          }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Verify all 3 levels rendered correctly
    const categories = testContainer.querySelectorAll('.category')
    expect(categories.length).toBe(2)

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3) // 1 + 2 = 3 items total

    const tags = testContainer.querySelectorAll('.tag')
    expect(tags.length).toBe(3) // 2 + 1 + 0 = 3 tags total

    // Verify category names
    expect(categories[0].querySelector('[data-bind="name"]').textContent).toBe('Category A')
    expect(categories[1].querySelector('[data-bind="name"]').textContent).toBe('Category B')

    // Verify tags content
    expect(tags[0].textContent).toBe('Tag 1')
    expect(tags[1].textContent).toBe('Tag 2')
    expect(tags[2].textContent).toBe('Tag 3')
  })

  it.skipIf(isMinifiedBuild())('Context maintains integrity when DOM elements are moved', async () => {
    testContainer.innerHTML = `
      <div data-component="move-test">
        <div id="original-container">
          <div id="move-list" data-list="moveItems">
            <template>
              <span class="move-item" data-bind="name"></span>
            </template>
          </div>
        </div>
        <div id="new-container"></div>
      </div>
    `

    wildflower.component('move-test', {
      state: {
        moveItems: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="move-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const listElement = testContainer.querySelector('#move-list')
    const newContainer = testContainer.querySelector('#new-container')

    // Verify initial context association
    const initialContext = wildflower._contextRegistry.getContextForElement(listElement)
    expect(initialContext).toBeDefined()

    // Move the list element to a different container
    newContainer.appendChild(listElement)

    // Verify context association is maintained after move
    const movedContext = wildflower._contextRegistry.getContextForElement(listElement)
    expect(movedContext).toBeDefined()
    expect(movedContext.id).toBe(initialContext.id)

    // Verify the list still renders items
    const items = testContainer.querySelectorAll('.move-item')
    expect(items.length).toBe(2)

    // Update state and verify it still works
    instance.state.moveItems = [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' }
    ]

    await waitForCompleteRender()

    const updatedItems = testContainer.querySelectorAll('.move-item')
    expect(updatedItems.length).toBe(3)
  })
})
