/**
 * WildflowerJS Data Resolution Test Suite - Vitest Browser Mode
 *
 * Tests for data resolution through nested structures, missing data handling,
 * and complex path resolution. Migrated from unitTestSuite.js DATA RESOLUTION section.
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

describe('Data Resolution', () => {
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

  it.skipIf(isMinifiedBuild())('resolves nested data through parent lists', async () => {
    wildflower.component('nested-data-resolve', {
      state: {
        nestedResolveItems: [
          { id: 1, name: 'Item 1', subItems: [{ id: 11, name: 'Sub 1' }] },
          { id: 2, name: 'Item 2', subItems: [{ id: 21, name: 'Sub 2' }] }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-data-resolve">
        <div data-list="nestedResolveItems" class="parent-list">
          <template>
            <div class="item">
              <span class="item-name" data-bind="name"></span>
              <div data-list="subItems" class="sub-items">
                <template>
                  <div class="sub-item">
                    <span class="sub-name" data-bind="name"></span>
                    <span class="sub-id" data-bind="id"></span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    // Verify parent list rendered
    const parentItems = testContainer.querySelectorAll('.parent-list > .item')
    expect(parentItems.length).toBe(2)

    // Verify first parent item's nested list
    const firstItem = parentItems[0]
    const firstItemName = firstItem.querySelector('.item-name')
    expect(firstItemName.textContent).toBe('Item 1')

    // Verify nested sub-items in first item
    const firstItemSubItems = firstItem.querySelectorAll('.sub-items .sub-item')
    expect(firstItemSubItems.length).toBe(1)

    const firstSubItem = firstItemSubItems[0]
    const subName = firstSubItem.querySelector('.sub-name')
    const subId = firstSubItem.querySelector('.sub-id')

    expect(subName.textContent).toBe('Sub 1')
    expect(subId.textContent).toBe('11')

    // Verify second parent item's nested list
    const secondItem = parentItems[1]
    const secondItemSubItems = secondItem.querySelectorAll('.sub-items .sub-item')
    expect(secondItemSubItems.length).toBe(1)

    const secondSubItem = secondItemSubItems[0]
    const secondSubId = secondSubItem.querySelector('.sub-id')
    expect(secondSubId.textContent).toBe('21')

    // Verify context data resolution through nested hierarchy
    const registry = wildflower._contextRegistry
    const parentList = testContainer.querySelector('.parent-list')
    const parentListContext = registry.getContextForElement(parentList)
    expect(parentListContext).toBeDefined()
    expect(parentListContext.type).toBe('list')
    expect(parentListContext.path).toBe('nestedResolveItems')

    // Verify parent list resolves correct data
    const resolvedData = parentListContext.resolveData()
    expect(resolvedData.length).toBe(2)
    expect(resolvedData[0].name).toBe('Item 1')

    // Verify nested list context has correct parent relationship
    const nestedList = firstItem.querySelector('.sub-items')
    const nestedListContext = registry.getContextForElement(nestedList)
    expect(nestedListContext).toBeDefined()
    expect(nestedListContext.type).toBe('list')
    expect(nestedListContext.path).toBe('subItems')
    expect(nestedListContext.parent).toBeDefined()
    expect(nestedListContext.parent.type).toBe('list')

    // Verify full path construction
    expect(parentListContext.getFullPath()).toBe('nestedResolveItems')
    expect(nestedListContext.getFullPath()).toBe('nestedResolveItems[0].subItems')
  })

  it('handles missing nested data gracefully', async () => {
    wildflower.component('missing-data-resolve', {
      state: {
        missingDataItems: [
          { id: 1, nested: null },        // null nested data
          { id: 2 },                       // missing nested property
          { id: 3, nested: [] }            // empty nested array
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="missing-data-resolve">
        <div data-list="missingDataItems" class="parent-list">
          <template>
            <div class="item">
              <span class="item-id" data-bind="id"></span>
              <div data-list="nested" class="nested-list">
                <template>
                  <div class="nested-item">
                    <span class="nested-id" data-bind="id"></span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    // Verify all 3 parent items rendered despite nested data issues
    const parentItems = testContainer.querySelectorAll('.parent-list > .item')
    expect(parentItems.length).toBe(3)

    // Test item 1 (nested: null)
    const item1 = parentItems[0]
    const item1Id = item1.querySelector('.item-id')
    expect(item1Id.textContent).toBe('1')
    const item1NestedItems = item1.querySelectorAll('.nested-list .nested-item')
    expect(item1NestedItems.length).toBe(0)

    // Test item 2 (missing nested property)
    const item2 = parentItems[1]
    const item2Id = item2.querySelector('.item-id')
    expect(item2Id.textContent).toBe('2')
    const item2NestedItems = item2.querySelectorAll('.nested-list .nested-item')
    expect(item2NestedItems.length).toBe(0)

    // Test item 3 (nested: [])
    const item3 = parentItems[2]
    const item3Id = item3.querySelector('.item-id')
    expect(item3Id.textContent).toBe('3')
    const item3NestedItems = item3.querySelectorAll('.nested-list .nested-item')
    expect(item3NestedItems.length).toBe(0)
  })

  it('resolves deeply nested context data (3 levels)', async () => {
    wildflower.component('deep-resolve-test', {
      state: {
        deepLevel1: [
          { id: 1, deepLevel2: [{ id: 11, deepLevel3: [{ id: 111, value: 'Deep value' }] }] }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="deep-resolve-test">
        <div data-list="deepLevel1" class="level1-list">
          <template>
            <div class="level1-item">
              <span class="level1-id" data-bind="id"></span>
              <div data-list="deepLevel2" class="level2-list">
                <template>
                  <div class="level2-item">
                    <span class="level2-id" data-bind="id"></span>
                    <div data-list="deepLevel3" class="level3-list">
                      <template>
                        <div class="level3-item">
                          <span class="level3-id" data-bind="id"></span>
                          <span class="level3-value" data-bind="value"></span>
                        </div>
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

    wildflower.scan()
    await waitForUpdate(100)

    // Verify level 1 rendered
    const level1Items = testContainer.querySelectorAll('.level1-list > .level1-item')
    expect(level1Items.length).toBe(1)

    const level1Item = level1Items[0]
    const level1Id = level1Item.querySelector('.level1-id')
    expect(level1Id.textContent).toBe('1')

    // Verify level 2 rendered inside level 1
    const level2Items = level1Item.querySelectorAll('.level2-list > .level2-item')
    expect(level2Items.length).toBe(1)

    const level2Item = level2Items[0]
    const level2Id = level2Item.querySelector('.level2-id')
    expect(level2Id.textContent).toBe('11')

    // Verify level 3 rendered inside level 2 (deepest level)
    const level3Items = level2Item.querySelectorAll('.level3-list > .level3-item')
    expect(level3Items.length).toBe(1)

    const level3Item = level3Items[0]
    const level3Id = level3Item.querySelector('.level3-id')
    const level3Value = level3Item.querySelector('.level3-value')

    expect(level3Id.textContent).toBe('111')
    expect(level3Value.textContent).toBe('Deep value')
  })

  it('propagates data updates through nested levels', async () => {
    wildflower.component('propagate-update-test', {
      state: {
        propLevel1: [
          { id: 1, propLevel2: [{ id: 11, propLevel3: [{ id: 111, value: 'initial' }] }] }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="propagate-update-test">
        <div data-list="propLevel1" class="level1-list">
          <template>
            <div class="level1-item">
              <span class="level1-id" data-bind="id"></span>
              <div data-list="propLevel2" class="level2-list">
                <template>
                  <div class="level2-item">
                    <span class="level2-id" data-bind="id"></span>
                    <div data-list="propLevel3" class="level3-list">
                      <template>
                        <div class="level3-item">
                          <span class="level3-id" data-bind="id"></span>
                          <span class="level3-value" data-bind="value"></span>
                        </div>
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

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="propagate-update-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial data resolution
    const level3Item = testContainer.querySelector('.level3-item')
    const level3Value = level3Item.querySelector('.level3-value')
    expect(level3Value.textContent).toBe('initial')

    // Update nested value at deepest level
    instance.state.propLevel1[0].propLevel2[0].propLevel3[0].value = 'updated'
    await waitForUpdate(100)

    // Verify update propagated to DOM
    const updatedLevel3Value = level3Item.querySelector('.level3-value')
    expect(updatedLevel3Value.textContent).toBe('updated')
  })

  it('resolves computed property in list context', async () => {
    wildflower.component('computed-list-resolve', {
      state: {
        computedListItems: [
          { id: 1, name: 'Item 1', active: true },
          { id: 2, name: 'Item 2', active: false },
          { id: 3, name: 'Item 3', active: true }
        ]
      },
      computed: {
        filteredItems() {
          return this.state.computedListItems.filter(item => item.active)
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="computed-list-resolve">
        <div data-list="computed:filteredItems" class="filtered-list">
          <template>
            <div class="filtered-item">
              <span class="item-name" data-bind="name"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    // Verify only active items rendered
    const filteredItems = testContainer.querySelectorAll('.filtered-list > .filtered-item')
    expect(filteredItems.length).toBe(2)
    expect(filteredItems[0].querySelector('.item-name').textContent).toBe('Item 1')
    expect(filteredItems[1].querySelector('.item-name').textContent).toBe('Item 3')
  })

  it('resolves dot-notation paths in bindings', async () => {
    wildflower.component('dot-notation-resolve', {
      state: {
        user: {
          profile: {
            name: 'John',
            details: {
              age: 30,
              city: 'NYC'
            }
          }
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="dot-notation-resolve">
        <span class="user-name" data-bind="user.profile.name"></span>
        <span class="user-age" data-bind="user.profile.details.age"></span>
        <span class="user-city" data-bind="user.profile.details.city"></span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    expect(testContainer.querySelector('.user-name').textContent).toBe('John')
    expect(testContainer.querySelector('.user-age').textContent).toBe('30')
    expect(testContainer.querySelector('.user-city').textContent).toBe('NYC')
  })

  it('handles undefined nested paths gracefully', async () => {
    wildflower.component('undefined-path-resolve', {
      state: {
        data: {
          existing: 'value'
          // missing: deep.nested.path
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="undefined-path-resolve">
        <span class="existing" data-bind="data.existing"></span>
        <span class="missing" data-bind="data.deep.nested.path"></span>
      </div>
    `

    // Should not throw
    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
    expect(testContainer.querySelector('.existing').textContent).toBe('value')
  })

  it('resolves array index in list item binding', async () => {
    wildflower.component('array-index-resolve', {
      state: {
        indexItems: [
          { name: 'First', values: [10, 20, 30] },
          { name: 'Second', values: [40, 50, 60] }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="array-index-resolve">
        <div data-list="indexItems" class="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="first-value" data-bind="values.0"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const items = testContainer.querySelectorAll('.items > .item')
    expect(items.length).toBe(2)
    expect(items[0].querySelector('.first-value').textContent).toBe('10')
    expect(items[1].querySelector('.first-value').textContent).toBe('40')
  })
})
