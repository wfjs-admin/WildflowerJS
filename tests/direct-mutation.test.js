/**
 * WildflowerJS Direct Mutation Property Updates Test Suite - Vitest Browser Mode
 *
 * Tests for direct array/object mutations updating the DOM correctly.
 * Migrated from unitTestSuite.js Direct Mutation Property Updates section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForDOM, waitForUpdate } from './helpers/load-framework.js'

describe('Direct Mutation Property Updates', { sequential: true, retry: 2 }, () => {
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

  it('flat array item property update', async () => {
    wildflower.component('direct-mutation-test', {
      state: {
        mutationItems: [
          { id: 1, label: 'Item 1' },
          { id: 2, label: 'Item 2' },
          { id: 3, label: 'Item 3' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="direct-mutation-test">
        <ul data-list="mutationItems">
          <template>
            <li data-bind="label"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()

    const component = testContainer.querySelector('[data-component="direct-mutation-test"]')

    // Wait for initial render
    await waitForDOM(
      () => component.querySelectorAll('[data-list="mutationItems"] > li').length,
      3
    )

    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    let listItems = component.querySelectorAll('[data-list="mutationItems"] > li')
    expect(listItems[0].textContent.trim()).toBe('Item 1')
    expect(listItems[1].textContent.trim()).toBe('Item 2')

    // DIRECT MUTATION: Update property in place
    instance.state.mutationItems[0].label = 'Updated Item 1'

    // Wait for DOM to reflect the mutation
    await waitForDOM(
      () => component.querySelector('[data-list="mutationItems"] > li')?.textContent.trim(),
      'Updated Item 1'
    )

    // Verify other items unchanged
    listItems = component.querySelectorAll('[data-list="mutationItems"] > li')
    expect(listItems[1].textContent.trim()).toBe('Item 2')
  })

  it('update multiple item properties', async () => {
    wildflower.component('multi-mutation-test', {
      state: {
        rows: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="multi-mutation-test">
        <ul data-list="rows">
          <template>
            <li>
              <span class="label" data-bind="label"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()

    const component = testContainer.querySelector('[data-component="multi-mutation-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Create 10 rows
    instance.state.rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      label: `Row ${i + 1}`
    }))

    // Wait for all rows to render
    await waitForDOM(
      () => component.querySelectorAll('[data-list="rows"] > li').length,
      10
    )

    // DIRECT MUTATION: Update every other row
    for (let i = 0; i < instance.state.rows.length; i += 2) {
      instance.state.rows[i].label = `${instance.state.rows[i].label} !!!`
    }

    // Wait for first mutated row to update
    await waitForDOM(
      () => component.querySelector('[data-list="rows"] > li .label')?.textContent.trim(),
      'Row 1 !!!'
    )

    // Verify DOM updated correctly
    const listItems = component.querySelectorAll('[data-list="rows"] > li')
    expect(listItems[1].querySelector('.label').textContent.trim()).toBe('Row 2')
    expect(listItems[2].querySelector('.label').textContent.trim()).toBe('Row 3 !!!')
    expect(listItems[3].querySelector('.label').textContent.trim()).toBe('Row 4')
  })

  it('nested object property update', async () => {
    wildflower.component('nested-mutation-test', {
      state: {
        nestedItems: [
          {
            id: 1,
            user: {
              profile: {
                name: 'John Doe',
                email: 'john@example.com'
              }
            }
          },
          {
            id: 2,
            user: {
              profile: {
                name: 'Jane Smith',
                email: 'jane@example.com'
              }
            }
          }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-mutation-test">
        <ul data-list="nestedItems">
          <template>
            <li>
              <span class="name" data-bind="user.profile.name"></span>
              <span class="email" data-bind="user.profile.email"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()

    const component = testContainer.querySelector('[data-component="nested-mutation-test"]')

    // Wait for initial render
    await waitForDOM(
      () => component.querySelectorAll('[data-list="nestedItems"] > li').length,
      2
    )

    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    expect(component.querySelector('.name').textContent.trim()).toBe('John Doe')

    // DIRECT MUTATION: Update deeply nested property
    instance.state.nestedItems[0].user.profile.name = 'Updated John'

    // Wait for DOM to reflect the deeply nested mutation
    await waitForDOM(
      () => component.querySelector('.name')?.textContent.trim(),
      'Updated John'
    )

    // Verify other properties unchanged
    const listItems = component.querySelectorAll('[data-list="nestedItems"] > li')
    expect(listItems[0].querySelector('.email').textContent.trim()).toBe('john@example.com')
    expect(listItems[1].querySelector('.name').textContent.trim()).toBe('Jane Smith')
  })

  it('external state assignment triggers DOM update', async () => {
    wildflower.component('external-mutation-test', {
      state: {
        message: 'initial',
        count: 0
      },
      computed: {
        display() { return this.message + ' (' + this.count + ')' }
      }
    })

    testContainer.innerHTML = `
      <div data-component="external-mutation-test">
        <span class="message" data-bind="message"></span>
        <span class="count" data-bind="count"></span>
        <span class="display" data-bind="display"></span>
      </div>
    `

    wildflower.scan()

    const component = testContainer.querySelector('[data-component="external-mutation-test"]')

    await waitForDOM(
      () => component.querySelector('.message')?.textContent.trim(),
      'initial'
    )

    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // External assignment — no component method, just direct state write
    instance.state.message = 'updated externally'

    await waitForDOM(
      () => component.querySelector('.message')?.textContent.trim(),
      'updated externally'
    )

    // Verify computed also updated
    expect(component.querySelector('.display').textContent.trim()).toBe('updated externally (0)')

    // External numeric assignment
    instance.state.count = 42

    await waitForDOM(
      () => component.querySelector('.count')?.textContent.trim(),
      '42'
    )

    expect(component.querySelector('.display').textContent.trim()).toBe('updated externally (42)')
  })

  it('mixed with immutable operations', async () => {
    wildflower.component('mixed-mutation-test', {
      state: {
        tasks: [
          { id: 1, title: 'Task 1' },
          { id: 2, title: 'Task 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="mixed-mutation-test">
        <ul data-list="tasks">
          <template>
            <li data-bind="title"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()

    const component = testContainer.querySelector('[data-component="mixed-mutation-test"]')

    // Wait for initial render
    await waitForDOM(
      () => component.querySelectorAll('[data-list="tasks"] > li').length,
      2
    )

    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // DIRECT MUTATION: Update first task
    instance.state.tasks[0].title = 'Updated Task 1'

    // Wait for mutation to reflect
    await waitForDOM(
      () => component.querySelector('[data-list="tasks"] > li')?.textContent.trim(),
      'Updated Task 1'
    )

    // IMMUTABLE: Add new task
    instance.state.tasks = [...instance.state.tasks, { id: 3, title: 'Task 3' }]

    // Wait for new item to appear
    await waitForDOM(
      () => component.querySelectorAll('[data-list="tasks"] > li').length,
      3
    )

    const listItems = component.querySelectorAll('[data-list="tasks"] > li')
    expect(listItems[0].textContent.trim()).toBe('Updated Task 1')
    expect(listItems[2].textContent.trim()).toBe('Task 3')
  })
})
