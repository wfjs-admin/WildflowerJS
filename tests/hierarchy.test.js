/**
 * WildflowerJS Hierarchy Test Suite - Vitest Browser Mode
 *
 * Tests for parent-child context relationships through nested DOM structures.
 * Migrated from unitTestSuite.js HIERARCHY section.
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

describe('HIERARCHY - Context Relationships', () => {
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

  it.skipIf(isMinifiedBuild())('parent-child relationship through nested lists', async () => {
    wildflower.component('parent-child-test', {
      state: {
        parentHierarchyItems: [
          {
            id: 1,
            name: 'Parent 1',
            children: [
              { id: 11, name: 'Child 1A' },
              { id: 12, name: 'Child 1B' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="parent-child-test">
        <ul data-list="parentHierarchyItems" class="parent-list">
          <template>
            <li class="parent-item">
              <span class="parent-name" data-bind="name"></span>
              <ul data-list="children" class="child-list">
                <template>
                  <li class="child-item">
                    <span class="child-name" data-bind="name"></span>
                  </li>
                </template>
              </ul>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    // Verify parent rendered
    const parentItems = testContainer.querySelectorAll('.parent-list > .parent-item')
    expect(parentItems.length).toBe(1)
    expect(parentItems[0].querySelector('.parent-name').textContent).toBe('Parent 1')

    // Verify children rendered within parent
    const childItems = parentItems[0].querySelectorAll('.child-list > .child-item')
    expect(childItems.length).toBe(2)
    expect(childItems[0].querySelector('.child-name').textContent).toBe('Child 1A')
    expect(childItems[1].querySelector('.child-name').textContent).toBe('Child 1B')

    // Verify context hierarchy
    const registry = wildflower._contextRegistry
    const parentListElement = testContainer.querySelector('.parent-list')
    const parentContext = registry.getContextForElement(parentListElement)
    expect(parentContext).toBeDefined()
    expect(parentContext.type).toBe('list')
    expect(parentContext.path).toBe('parentHierarchyItems')

    // Verify child list context has correct parent
    const childListElement = parentItems[0].querySelector('.child-list')
    const childContext = registry.getContextForElement(childListElement)
    expect(childContext).toBeDefined()
    expect(childContext.type).toBe('list')
    expect(childContext.path).toBe('children')
    expect(childContext.parent).toBeDefined()
    expect(childContext.parent.type).toBe('list')

    // Verify full path for child list
    expect(childContext.getFullPath()).toBe('parentHierarchyItems[0].children')
  })

  it('multiple child contexts within parent through HTML', async () => {
    wildflower.component('multiple-children-test', {
      state: {
        hierarchyParents: [
          {
            name: 'Department A',
            employees: [
              { name: 'Alice' },
              { name: 'Bob' }
            ],
            projects: [
              { name: 'Project X' },
              { name: 'Project Y' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="multiple-children-test">
        <div data-list="hierarchyParents" class="parent-list">
          <template>
            <div class="parent-item">
              <span class="parent-name" data-bind="name"></span>
              <div data-list="employees" class="employees-list">
                <template>
                  <div class="employee-item">
                    <span class="employee-name" data-bind="name"></span>
                  </div>
                </template>
              </div>
              <div data-list="projects" class="projects-list">
                <template>
                  <div class="project-item">
                    <span class="project-name" data-bind="name"></span>
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

    // Verify parent rendered
    const parentItems = testContainer.querySelectorAll('.parent-list > .parent-item')
    expect(parentItems.length).toBe(1)

    const parentItem = parentItems[0]

    // Verify first child list (employees) rendered correctly
    const employeeItems = parentItem.querySelectorAll('.employees-list .employee-item')
    expect(employeeItems.length).toBe(2)
    expect(employeeItems[0].querySelector('.employee-name').textContent).toBe('Alice')
    expect(employeeItems[1].querySelector('.employee-name').textContent).toBe('Bob')

    // Verify second child list (projects) rendered correctly
    const projectItems = parentItem.querySelectorAll('.projects-list .project-item')
    expect(projectItems.length).toBe(2)
    expect(projectItems[0].querySelector('.project-name').textContent).toBe('Project X')
    expect(projectItems[1].querySelector('.project-name').textContent).toBe('Project Y')

    // Verify both child contexts coexist within the same parent
    expect(employeeItems.length > 0 && projectItems.length > 0).toBe(true)
  })

  it('multiple levels of nesting (3 levels deep)', async () => {
    wildflower.component('deep-nesting-test', {
      state: {
        level1Items: [
          {
            name: 'Level 1',
            level2Items: [
              {
                name: 'Level 2',
                level3Items: [
                  { name: 'Level 3A' },
                  { name: 'Level 3B' }
                ]
              }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="deep-nesting-test">
        <div data-list="level1Items" class="level1-list">
          <template>
            <div class="level1-item">
              <span class="level1-name" data-bind="name"></span>
              <div data-list="level2Items" class="level2-list">
                <template>
                  <div class="level2-item">
                    <span class="level2-name" data-bind="name"></span>
                    <div data-list="level3Items" class="level3-list">
                      <template>
                        <div class="level3-item">
                          <span class="level3-name" data-bind="name"></span>
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
    await waitForUpdate(150)

    // Verify level 1
    const level1Items = testContainer.querySelectorAll('.level1-list > .level1-item')
    expect(level1Items.length).toBe(1)
    expect(level1Items[0].querySelector('.level1-name').textContent).toBe('Level 1')

    // Verify level 2
    const level2Items = level1Items[0].querySelectorAll('.level2-list > .level2-item')
    expect(level2Items.length).toBe(1)
    expect(level2Items[0].querySelector('.level2-name').textContent).toBe('Level 2')

    // Verify level 3
    const level3Items = level2Items[0].querySelectorAll('.level3-list > .level3-item')
    expect(level3Items.length).toBe(2)
    expect(level3Items[0].querySelector('.level3-name').textContent).toBe('Level 3A')
    expect(level3Items[1].querySelector('.level3-name').textContent).toBe('Level 3B')
  })

  it('parent list items update independently from nested children', async () => {
    wildflower.component('nested-update-test', {
      state: {
        nestedUpdateParents: [
          {
            name: 'Parent A',
            nestedChildren: [
              { name: 'Child A1' },
              { name: 'Child A2' }
            ]
          },
          {
            name: 'Parent B',
            nestedChildren: [
              { name: 'Child B1' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-update-test">
        <ul data-list="nestedUpdateParents" class="parent-list">
          <template>
            <li class="parent-item">
              <span class="parent-name" data-bind="name"></span>
              <ul data-list="nestedChildren" class="child-list">
                <template>
                  <li class="child-item">
                    <span class="child-name" data-bind="name"></span>
                  </li>
                </template>
              </ul>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="nested-update-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    let parentItems = testContainer.querySelectorAll('.parent-list > .parent-item')
    expect(parentItems.length).toBe(2)

    // Verify children rendered
    const childrenA = parentItems[0].querySelectorAll('.child-list > .child-item')
    expect(childrenA.length).toBe(2)
    expect(childrenA[0].querySelector('.child-name').textContent).toBe('Child A1')

    const childrenB = parentItems[1].querySelectorAll('.child-list > .child-item')
    expect(childrenB.length).toBe(1)
    expect(childrenB[0].querySelector('.child-name').textContent).toBe('Child B1')

    // Update parent name (first level) - should work
    instance.state.nestedUpdateParents[0].name = 'Updated Parent A'
    await waitForUpdate(100)

    const updatedParentName = parentItems[0].querySelector('.parent-name')
    expect(updatedParentName.textContent).toBe('Updated Parent A')

    // Verify second parent unchanged
    const parentBName = parentItems[1].querySelector('.parent-name')
    expect(parentBName.textContent).toBe('Parent B')
  })

  it('adding items to nested list', async () => {
    wildflower.component('nested-add-test', {
      state: {
        nestedAddParents: [
          {
            name: 'Parent',
            addChildren: [
              { name: 'Initial Child' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-add-test">
        <div data-list="nestedAddParents" class="parent-list">
          <template>
            <div class="parent-item">
              <span class="parent-name" data-bind="name"></span>
              <ul data-list="addChildren" class="child-list">
                <template>
                  <li class="child-item" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="nested-add-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    let childItems = testContainer.querySelectorAll('.child-list > .child-item')
    expect(childItems.length).toBe(1)

    // Add new child to nested list
    instance.state.nestedAddParents[0].addChildren.push({ name: 'New Child' })
    await waitForCompleteRender()

    // Verify new child added
    childItems = testContainer.querySelectorAll('.child-list > .child-item')
    expect(childItems.length).toBe(2)
    expect(childItems[1].textContent).toBe('New Child')
  })

  it('removing items from nested list', async () => {
    wildflower.component('nested-remove-test', {
      state: {
        nestedRemoveParents: [
          {
            name: 'Parent',
            removeChildren: [
              { name: 'Child 1' },
              { name: 'Child 2' },
              { name: 'Child 3' }
            ]
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-remove-test">
        <div data-list="nestedRemoveParents" class="parent-list">
          <template>
            <div class="parent-item">
              <ul data-list="removeChildren" class="child-list">
                <template>
                  <li class="child-item" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="nested-remove-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial state
    let childItems = testContainer.querySelectorAll('.child-list > .child-item')
    expect(childItems.length).toBe(3)

    // Remove middle child
    instance.state.nestedRemoveParents[0].removeChildren.splice(1, 1)
    await waitForCompleteRender()

    // Verify child removed
    childItems = testContainer.querySelectorAll('.child-list > .child-item')
    expect(childItems.length).toBe(2)
    expect(childItems[0].textContent).toBe('Child 1')
    expect(childItems[1].textContent).toBe('Child 3')
  })
})
