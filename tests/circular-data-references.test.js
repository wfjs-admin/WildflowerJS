/**
 * WildflowerJS Circular Data Reference Test Suite - Vitest Browser Mode
 *
 * Tests for ContextManager's _detectCircularReferences() — handling of
 * circular data structures in component state (array items referencing
 * their parent array, self-referencing objects, etc.)
 *
 * NOTE: This is distinct from circular COMPUTED dependency detection
 * (tested in circular-dependency.test.js), which lives in ReactiveStateManager.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Circular Data References', () => {
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

  describe('Array items referencing parent array', () => {
    it('should render list without crashing when items reference the parent array', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-array-parent">
          <div data-list="items">
            <template>
              <span class="item-name" data-bind="name"></span>
            </template>
          </div>
        </div>
      `

      const items = [
        { name: 'Item 1', parent: null },
        { name: 'Item 2', parent: null }
      ]
      // Create actual circular reference: each item.parent points to the array
      items[0].parent = items
      items[1].parent = items

      wildflower.component('circ-array-parent', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const rendered = testContainer.querySelectorAll('.item-name')
      expect(rendered.length).toBe(2)
      expect(rendered[0].textContent).toBe('Item 1')
      expect(rendered[1].textContent).toBe('Item 2')
    })

    it('should handle updates to list with circular parent references', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-array-update">
          <div data-list="items">
            <template>
              <span class="item-name" data-bind="name"></span>
            </template>
          </div>
        </div>
      `

      const items = [{ name: 'Original', parent: null }]
      items[0].parent = items

      wildflower.component('circ-array-update', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      let rendered = testContainer.querySelectorAll('.item-name')
      expect(rendered.length).toBe(1)
      expect(rendered[0].textContent).toBe('Original')

      // Add a new item with circular reference
      const instance = wildflower.getComponentInstance(
        testContainer.querySelector('[data-component-id]').dataset.componentId
      )
      const newItems = [...instance.state.items, { name: 'Added', parent: null }]
      newItems[1].parent = newItems
      instance.state.items = newItems
      await waitForCompleteRender()

      rendered = testContainer.querySelectorAll('.item-name')
      expect(rendered.length).toBe(2)
      expect(rendered[1].textContent).toBe('Added')
    })
  })

  describe('Self-referencing objects', () => {
    it('should handle object with property referencing itself', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-self-ref">
          <span class="name-display" data-bind="item.name"></span>
        </div>
      `

      const item = { name: 'Self Ref', self: null }
      item.self = item

      wildflower.component('circ-self-ref', {
        state: { item }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const display = testContainer.querySelector('.name-display')
      // Should render without infinite loop — name should resolve
      expect(display).toBeTruthy()
    })

    it('should not crash when state contains deeply nested circular reference', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-deep-nested">
          <span class="value" data-bind="a.name"></span>
        </div>
      `

      const a = { name: 'Node A', child: null }
      const b = { name: 'Node B', child: null }
      a.child = b
      b.child = a // circular: a -> b -> a

      wildflower.component('circ-deep-nested', {
        state: { a }
      })

      let errorThrown = false
      try {
        wildflower.scan()
        await waitForCompleteRender()
      } catch (e) {
        errorThrown = true
      }

      expect(errorThrown).toBe(false)
      const display = testContainer.querySelector('.value')
      expect(display.textContent).toBe('Node A')
    })
  })

  describe('Circular references in list item data', () => {
    it('should handle tree-like data where children reference their parent', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-tree-data">
          <div data-list="nodes">
            <template>
              <span class="node-name" data-bind="name"></span>
            </template>
          </div>
        </div>
      `

      // Tree structure: parent has children, children point back to parent
      const parent = { name: 'Root', children: [] }
      const child1 = { name: 'Child 1', parent: parent }
      const child2 = { name: 'Child 2', parent: parent }
      parent.children.push(child1, child2)

      // The nodes array contains items with circular refs via parent/children
      wildflower.component('circ-tree-data', {
        state: { nodes: [parent, child1, child2] }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const rendered = testContainer.querySelectorAll('.node-name')
      expect(rendered.length).toBe(3)
      expect(rendered[0].textContent).toBe('Root')
      expect(rendered[1].textContent).toBe('Child 1')
      expect(rendered[2].textContent).toBe('Child 2')
    })

    it('should handle replacing list data that contains circular references', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-replace-list">
          <div data-list="items">
            <template>
              <span class="item" data-bind="name"></span>
            </template>
          </div>
        </div>
      `

      const items1 = [{ name: 'A', ref: null }]
      items1[0].ref = items1

      wildflower.component('circ-replace-list', {
        state: { items: items1 }
      })

      wildflower.scan()
      await waitForCompleteRender()

      let rendered = testContainer.querySelectorAll('.item')
      expect(rendered.length).toBe(1)
      expect(rendered[0].textContent).toBe('A')

      // Replace with different circular data
      const instance = wildflower.getComponentInstance(
        testContainer.querySelector('[data-component-id]').dataset.componentId
      )
      const items2 = [{ name: 'X', ref: null }, { name: 'Y', ref: null }]
      items2[0].ref = items2
      items2[1].ref = items2
      instance.state.items = items2
      await waitForCompleteRender()

      rendered = testContainer.querySelectorAll('.item')
      expect(rendered.length).toBe(2)
      expect(rendered[0].textContent).toBe('X')
      expect(rendered[1].textContent).toBe('Y')
    })
  })

  describe('Edge cases', () => {
    it('should handle array where multiple items reference the same object', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-shared-ref">
          <div data-list="items">
            <template>
              <span class="shared-item" data-bind="name"></span>
            </template>
          </div>
        </div>
      `

      const shared = { label: 'shared' }
      const items = [
        { name: 'First', metadata: shared },
        { name: 'Second', metadata: shared },
        { name: 'Third', metadata: shared }
      ]

      wildflower.component('circ-shared-ref', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const rendered = testContainer.querySelectorAll('.shared-item')
      expect(rendered.length).toBe(3)
      expect(rendered[0].textContent).toBe('First')
      expect(rendered[2].textContent).toBe('Third')
    })

    it('should handle data-bind on non-list component with circular state', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-bind-state">
          <span class="title" data-bind="config.title"></span>
          <span class="count" data-bind="config.count"></span>
        </div>
      `

      const config = { title: 'Test', count: 42, self: null }
      config.self = config

      wildflower.component('circ-bind-state', {
        state: { config }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('.title').textContent).toBe('Test')
      expect(testContainer.querySelector('.count').textContent).toBe('42')
    })

    it('should survive updating a property on a self-referencing object', async () => {
      testContainer.innerHTML = `
        <div data-component="circ-update-self">
          <span class="label" data-bind="node.name"></span>
        </div>
      `

      const node = { name: 'Before', self: null }
      node.self = node

      wildflower.component('circ-update-self', {
        state: { node }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('.label').textContent).toBe('Before')

      // Update the circular object's property
      const instance = wildflower.getComponentInstance(
        testContainer.querySelector('[data-component-id]').dataset.componentId
      )
      instance.state.node.name = 'After'
      await waitForCompleteRender()

      expect(testContainer.querySelector('.label').textContent).toBe('After')
    })
  })
})
