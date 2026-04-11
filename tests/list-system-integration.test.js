/**
 * WildflowerJS List System Integration Test Suite - Vitest Browser Mode
 *
 * Tests for complex list operations, nested lists, context relationships,
 * and edge cases. Migrated from unitTestSuite.js LIST SYSTEM INTEGRATION sections.
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

describe('List System Integration', () => {
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

  it('renders nested parent-child list structure', async () => {
    wildflower.component('nested-list-structure', {
      state: {
        nestedCategories: [
          {
            id: 1,
            name: 'Category 1',
            nestedItems: [
              { id: 101, name: 'Item 1-1', price: '$10' },
              { id: 102, name: 'Item 1-2', price: '$15' }
            ]
          },
          {
            id: 2,
            name: 'Category 2',
            nestedItems: [
              { id: 201, name: 'Item 2-1', price: '$20' },
              { id: 202, name: 'Item 2-2', price: '$25' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-list-structure">
        <div data-list="nestedCategories" class="categories">
          <template>
            <div class="category">
              <h3 class="cat-name" data-bind="name"></h3>
              <ul data-list="nestedItems" class="items">
                <template>
                  <li class="item">
                    <span class="item-name" data-bind="name"></span>
                    <span class="item-price" data-bind="price"></span>
                  </li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="nested-list-structure"]')

    // Verify categories rendered
    const categoryElements = component.querySelectorAll('.categories > .category')
    expect(categoryElements.length).toBe(2)
    expect(categoryElements[0].querySelector('.cat-name').textContent).toBe('Category 1')

    // Verify nested items in first category
    const firstCategoryItems = categoryElements[0].querySelectorAll('.items > .item')
    expect(firstCategoryItems.length).toBe(2)
    expect(firstCategoryItems[0].querySelector('.item-name').textContent).toBe('Item 1-1')
    expect(firstCategoryItems[0].querySelector('.item-price').textContent).toBe('$10')
  })

  it('updates nested list when parent item changes', async () => {
    wildflower.component('nested-update-parent', {
      state: {
        parentItems: [
          {
            id: 1,
            name: 'Parent A',
            children: [
              { id: 11, name: 'Child A1' },
              { id: 12, name: 'Child A2' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-update-parent">
        <div data-list="parentItems" class="parents">
          <template>
            <div class="parent">
              <span class="parent-name" data-bind="name"></span>
              <ul data-list="children" class="children">
                <template>
                  <li class="child" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="nested-update-parent"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Update parent name
    instance.state.parentItems[0].name = 'Updated Parent A'
    await waitForUpdate(100)

    const parentName = component.querySelector('.parent-name')
    expect(parentName.textContent).toBe('Updated Parent A')

    // Children should still be there
    const children = component.querySelectorAll('.children > .child')
    expect(children.length).toBe(2)
  })

  it('adds items to nested list', async () => {
    wildflower.component('nested-add-child', {
      state: {
        nestedAddParent: [
          {
            id: 1,
            name: 'Parent',
            addChildItems: [{ id: 11, name: 'Initial Child' }]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-add-child">
        <div data-list="nestedAddParent" class="parents">
          <template>
            <div class="parent">
              <ul data-list="addChildItems" class="children">
                <template>
                  <li class="child" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="nested-add-child"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    let children = component.querySelectorAll('.children > .child')
    expect(children.length).toBe(1)

    // Add new child
    instance.state.nestedAddParent[0].addChildItems.push({ id: 12, name: 'New Child' })
    await waitForCompleteRender()

    children = component.querySelectorAll('.children > .child')
    expect(children.length).toBe(2)
    expect(children[1].textContent).toBe('New Child')
  })

  it('removes items from nested list', async () => {
    wildflower.component('nested-remove-child', {
      state: {
        nestedRemoveParent: [
          {
            id: 1,
            name: 'Parent',
            removeChildItems: [
              { id: 11, name: 'Child 1' },
              { id: 12, name: 'Child 2' },
              { id: 13, name: 'Child 3' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-remove-child">
        <div data-list="nestedRemoveParent" class="parents">
          <template>
            <div class="parent">
              <ul data-list="removeChildItems" class="children">
                <template>
                  <li class="child" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="nested-remove-child"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    let children = component.querySelectorAll('.children > .child')
    expect(children.length).toBe(3)

    // Remove middle child
    instance.state.nestedRemoveParent[0].removeChildItems.splice(1, 1)
    await waitForCompleteRender()

    children = component.querySelectorAll('.children > .child')
    expect(children.length).toBe(2)
    expect(children[0].textContent).toBe('Child 1')
    expect(children[1].textContent).toBe('Child 3')
  })

  it('handles three levels of nesting', async () => {
    wildflower.component('three-level-nesting', {
      state: {
        level1: [
          {
            name: 'L1',
            level2: [
              {
                name: 'L2',
                level3: [
                  { name: 'L3-A' },
                  { name: 'L3-B' }
                ]
              }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="three-level-nesting">
        <div data-list="level1" class="l1-list">
          <template>
            <div class="l1-item">
              <span class="l1-name" data-bind="name"></span>
              <div data-list="level2" class="l2-list">
                <template>
                  <div class="l2-item">
                    <span class="l2-name" data-bind="name"></span>
                    <div data-list="level3" class="l3-list">
                      <template>
                        <div class="l3-item" data-bind="name"></div>
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
    await waitForUpdate(150)

    const component = testContainer.querySelector('[data-component="three-level-nesting"]')

    const l1Items = component.querySelectorAll('.l1-list > .l1-item')
    expect(l1Items.length).toBe(1)

    const l2Items = l1Items[0].querySelectorAll('.l2-list > .l2-item')
    expect(l2Items.length).toBe(1)

    const l3Items = l2Items[0].querySelectorAll('.l3-list > .l3-item')
    expect(l3Items.length).toBe(2)
    expect(l3Items[0].textContent).toBe('L3-A')
    expect(l3Items[1].textContent).toBe('L3-B')
  })

  it('list with multiple sibling child lists', async () => {
    wildflower.component('sibling-child-lists', {
      state: {
        siblingParents: [
          {
            name: 'Department',
            employees: [{ name: 'Alice' }, { name: 'Bob' }],
            projects: [{ name: 'Project X' }, { name: 'Project Y' }]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="sibling-child-lists">
        <div data-list="siblingParents" class="parent-list">
          <template>
            <div class="parent-item">
              <span class="parent-name" data-bind="name"></span>
              <ul data-list="employees" class="emp-list">
                <template>
                  <li class="emp-item" data-bind="name"></li>
                </template>
              </ul>
              <ul data-list="projects" class="proj-list">
                <template>
                  <li class="proj-item" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="sibling-child-lists"]')

    const employees = component.querySelectorAll('.emp-list > .emp-item')
    expect(employees.length).toBe(2)
    expect(employees[0].textContent).toBe('Alice')

    const projects = component.querySelectorAll('.proj-list > .proj-item')
    expect(projects.length).toBe(2)
    expect(projects[0].textContent).toBe('Project X')
  })

  it('list append operation updates DOM correctly', async () => {
    wildflower.component('list-append-test', {
      state: {
        appendItems: [
          { id: 1, name: 'Initial 1', value: 10 },
          { id: 2, name: 'Initial 2', value: 20 }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="list-append-test">
        <ul data-list="appendItems" class="items">
          <template>
            <li class="item">
              <span class="name" data-bind="name"></span>
              <span class="value" data-bind="value"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-append-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial
    let items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(2)

    // Append
    instance.state.appendItems.push({ id: 3, name: 'Appended', value: 30 })
    await waitForCompleteRender()

    items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[2].querySelector('.name').textContent).toBe('Appended')
  })

  it('list prepend operation updates DOM correctly', async () => {
    wildflower.component('list-prepend-test', {
      state: {
        prependItems: [
          { id: 1, name: 'Initial 1' },
          { id: 2, name: 'Initial 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="list-prepend-test">
        <ul data-list="prependItems" class="items">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-prepend-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Prepend
    instance.state.prependItems = [{ id: 0, name: 'Prepended' }, ...instance.state.prependItems]
    await waitForCompleteRender()

    const items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('Prepended')
  })

  it('list replace all operation updates DOM correctly', async () => {
    wildflower.component('list-replace-test', {
      state: {
        replaceItems: [
          { id: 1, name: 'Old 1' },
          { id: 2, name: 'Old 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="list-replace-test">
        <ul data-list="replaceItems" class="items">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-replace-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Replace all
    instance.state.replaceItems = [
      { id: 3, name: 'New 1' },
      { id: 4, name: 'New 2' },
      { id: 5, name: 'New 3' }
    ]
    await waitForCompleteRender()

    const items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('New 1')
    expect(items[1].textContent).toBe('New 2')
    expect(items[2].textContent).toBe('New 3')
  })

  it('list clear operation updates DOM correctly', async () => {
    wildflower.component('list-clear-test', {
      state: {
        clearItems: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="list-clear-test">
        <ul data-list="clearItems" class="items">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-clear-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Clear
    instance.state.clearItems = []
    await waitForCompleteRender()

    const items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(0)

    // Re-add items
    instance.state.clearItems.push({ id: 3, name: 'New Item' })
    await waitForCompleteRender()

    const newItems = component.querySelectorAll('.items > .item')
    expect(newItems.length).toBe(1)
    expect(newItems[0].textContent).toBe('New Item')
  })

  it('list context tracks items through multiple operations', async () => {
    wildflower.component('multi-op-list', {
      state: {
        multiOpItems: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="multi-op-list">
        <ul data-list="multiOpItems" class="items">
          <template>
            <li class="item" data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="multi-op-list"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Operation 1: Remove middle
    instance.state.multiOpItems.splice(1, 1)
    await waitForCompleteRender()

    let items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toBe('A')
    expect(items[1].textContent).toBe('C')

    // Operation 2: Add new at beginning
    instance.state.multiOpItems.unshift({ id: 4, name: 'D' })
    await waitForCompleteRender()

    items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('D')
    expect(items[1].textContent).toBe('A')
    expect(items[2].textContent).toBe('C')

    // Operation 3: Reverse
    instance.state.multiOpItems.reverse()
    await waitForCompleteRender()

    items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('C')
    expect(items[1].textContent).toBe('A')
    expect(items[2].textContent).toBe('D')
  })

  it('list with data-model maintains two-way binding', async () => {
    wildflower.component('list-model-test', {
      state: {
        modelItems: [
          { id: 1, name: 'Item 1', value: 10 },
          { id: 2, name: 'Item 2', value: 20 }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="list-model-test">
        <ul data-list="modelItems" class="items">
          <template>
            <li class="item">
              <span class="name" data-bind="name"></span>
              <input type="number" class="value-input" data-model="value">
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-model-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial input values
    const inputs = component.querySelectorAll('.value-input')
    expect(inputs[0].value).toBe('10')
    expect(inputs[1].value).toBe('20')

    // Update via input
    inputs[0].value = '50'
    inputs[0].dispatchEvent(new Event('input'))
    await waitForUpdate()

    // Verify state updated
    expect(instance.state.modelItems[0].value).toBe(50)
  })

  it('complex nested structure with ID changes', async () => {
    wildflower.component('id-tracking-list', {
      state: {
        trackedObjects: [
          { id: 1, desc: 'First' },
          { id: 2, desc: 'Second' },
          { id: 3, desc: 'Third' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="id-tracking-list">
        <ul data-list="trackedObjects" class="items">
          <template>
            <li class="item">
              <span class="id" data-bind="id"></span>
              <span class="desc" data-bind="desc"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="id-tracking-list"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Replace with different IDs but similar content
    instance.state.trackedObjects = [
      { id: 5, desc: 'First' },    // ID changed, content same
      { id: 2, desc: 'Modified' }, // ID same, content changed
      { id: 7, desc: 'New' }       // Both changed
    ]
    await waitForCompleteRender()

    const items = component.querySelectorAll('.items > .item')
    expect(items.length).toBe(3)
    expect(items[0].querySelector('.id').textContent).toBe('5')
    expect(items[1].querySelector('.desc').textContent).toBe('Modified')
    expect(items[2].querySelector('.id').textContent).toBe('7')
  })
})
