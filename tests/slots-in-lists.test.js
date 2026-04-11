/**
 * WildflowerJS Slots in List Items Test Suite - Vitest Browser Mode
 *
 * Tests for using slotted components inside data-list contexts.
 * This is a common pattern for reusable UI components in lists.
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

describe('Slots in List Items', () => {
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

  describe('Basic Slot in List Pattern', () => {
    it('should render component with slot inside list item', async () => {
      // Define a card component with a slot
      wildflower.component('list-card', {
        state: {},
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="card-list-parent">
          <ul data-list="items">
            <template>
              <li>
                <div data-component="list-card">
                  <div class="card-header" data-bind="title"></div>
                  <div class="card-body" data-slot-container="content"></div>
                </div>
                <div data-slot="content">
                  <span class="item-content" data-bind="description"></span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('card-list-parent', {
        state: {
          items: [
            { id: 1, title: 'Card 1', description: 'Description 1' },
            { id: 2, title: 'Card 2', description: 'Description 2' },
            { id: 3, title: 'Card 3', description: 'Description 3' }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const cards = testContainer.querySelectorAll('[data-component="list-card"]')
      expect(cards.length).toBe(3)

      // Verify slot content was projected
      const slotContainers = testContainer.querySelectorAll('.card-body')
      expect(slotContainers.length).toBe(3)
    })

    it('should bind data in slotted content within list items', async () => {
      wildflower.component('item-wrapper', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="binding-list-parent">
          <ul data-list="items">
            <template>
              <li>
                <div data-component="item-wrapper">
                  <div class="wrapper-container" data-slot-container="main"></div>
                </div>
                <div data-slot="main">
                  <span class="item-name" data-bind="name"></span>
                  <span class="item-value" data-bind="value"></span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('binding-list-parent', {
        state: {
          items: [
            { id: 1, name: 'Item A', value: 100 },
            { id: 2, name: 'Item B', value: 200 }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const names = testContainer.querySelectorAll('.item-name')
      const values = testContainer.querySelectorAll('.item-value')

      expect(names.length).toBe(2)
      expect(names[0].textContent).toBe('Item A')
      expect(names[1].textContent).toBe('Item B')
      expect(values[0].textContent).toBe('100')
      expect(values[1].textContent).toBe('200')
    })
  })

  describe('Dynamic List Updates with Slotted Components', () => {
    it('should handle adding items with slotted components', async () => {
      wildflower.component('expandable-item', {
        state: { expanded: false },
        toggle() { this.state.expanded = !this.state.expanded }
      })

      testContainer.innerHTML = `
        <div data-component="expandable-list">
          <ul data-list="items">
            <template>
              <li>
                <div data-component="expandable-item">
                  <div class="header" data-bind="title"></div>
                  <div class="details" data-slot-container="details" data-show="expanded"></div>
                </div>
                <div data-slot="details">
                  <p class="extra-info" data-bind="extraInfo"></p>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('expandable-list', {
        state: {
          items: [
            { id: 1, title: 'First', extraInfo: 'Extra 1' }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(1)

      // Add more items
      const component = testContainer.querySelector('[data-component="expandable-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.items.push(
        { id: 2, title: 'Second', extraInfo: 'Extra 2' },
        { id: 3, title: 'Third', extraInfo: 'Extra 3' }
      )
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(3)
      const headers = testContainer.querySelectorAll('.header')
      expect(headers[2].textContent).toBe('Third')
    })

    it('should handle removing items with slotted components', async () => {
      wildflower.component('removable-card', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="removable-list">
          <ul data-list="items">
            <template>
              <li class="list-item">
                <div data-component="removable-card">
                  <div class="card-content" data-slot-container="content"></div>
                </div>
                <div data-slot="content">
                  <span class="card-text" data-bind="text"></span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('removable-list', {
        state: {
          items: [
            { id: 1, text: 'Text A' },
            { id: 2, text: 'Text B' },
            { id: 3, text: 'Text C' }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('.list-item').length).toBe(3)

      const component = testContainer.querySelector('[data-component="removable-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Remove middle item
      instance.state.items.splice(1, 1)
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('.list-item').length).toBe(2)
      const texts = testContainer.querySelectorAll('.card-text')
      expect(texts[0].textContent).toBe('Text A')
      expect(texts[1].textContent).toBe('Text C')
    })
  })

  describe('Actions in Slotted List Items', () => {
    it('should handle actions in slotted content within lists', async () => {
      let clickedItems = []

      wildflower.component('action-card', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="action-list">
          <ul data-list="items">
            <template>
              <li>
                <div data-component="action-card">
                  <div class="card-actions" data-slot-container="actions"></div>
                </div>
                <div data-slot="actions">
                  <button class="action-btn" data-action="handleClick" data-bind-data-id="id">
                    Click <span data-bind="name"></span>
                  </button>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('action-list', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        },
        handleClick(event, element, detail) {
          clickedItems.push(detail?.item?.name || element?.dataset?.id)
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const buttons = testContainer.querySelectorAll('.action-btn')
      expect(buttons.length).toBe(2)

      // Click first button
      buttons[0].click()
      await waitForUpdate()

      expect(clickedItems.length).toBe(1)
    })
  })

  describe('Multiple Named Slots in List Items', () => {
    it('should handle multiple named slots per list item', async () => {
      wildflower.component('multi-slot-card', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="multi-slot-list">
          <ul data-list="items">
            <template>
              <li>
                <div data-component="multi-slot-card">
                  <div class="card-title" data-slot-container="title"></div>
                  <div class="card-body" data-slot-container="body"></div>
                  <div class="card-footer" data-slot-container="footer"></div>
                </div>
                <div data-slot="title">
                  <h3 class="title-text" data-bind="title"></h3>
                </div>
                <div data-slot="body">
                  <p class="body-text" data-bind="body"></p>
                </div>
                <div data-slot="footer">
                  <span class="footer-text" data-bind="footer"></span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('multi-slot-list', {
        state: {
          items: [
            { id: 1, title: 'Title 1', body: 'Body 1', footer: 'Footer 1' },
            { id: 2, title: 'Title 2', body: 'Body 2', footer: 'Footer 2' }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const titles = testContainer.querySelectorAll('.title-text')
      const bodies = testContainer.querySelectorAll('.body-text')
      const footers = testContainer.querySelectorAll('.footer-text')

      expect(titles.length).toBe(2)
      expect(bodies.length).toBe(2)
      expect(footers.length).toBe(2)

      expect(titles[0].textContent).toBe('Title 1')
      expect(bodies[0].textContent).toBe('Body 1')
      expect(footers[0].textContent).toBe('Footer 1')
    })
  })

  describe('Nested Lists with Slotted Components', () => {
    it('should handle slotted components in nested lists', async () => {
      wildflower.component('nested-card', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="nested-slot-list">
          <ul data-list="groups">
            <template>
              <li class="group">
                <h2 class="group-name" data-bind="name"></h2>
                <ul data-list="items">
                  <template>
                    <li class="group-item">
                      <div data-component="nested-card">
                        <div class="nested-content" data-slot-container="content"></div>
                      </div>
                      <div data-slot="content">
                        <span class="item-label" data-bind="label"></span>
                      </div>
                    </li>
                  </template>
                </ul>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('nested-slot-list', {
        state: {
          groups: [
            {
              id: 1,
              name: 'Group A',
              items: [
                { id: 1, label: 'A1' },
                { id: 2, label: 'A2' }
              ]
            },
            {
              id: 2,
              name: 'Group B',
              items: [
                { id: 3, label: 'B1' }
              ]
            }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const groups = testContainer.querySelectorAll('.group')
      expect(groups.length).toBe(2)

      const groupItems = testContainer.querySelectorAll('.group-item')
      expect(groupItems.length).toBe(3)

      const labels = testContainer.querySelectorAll('.item-label')
      expect(labels[0].textContent).toBe('A1')
      expect(labels[1].textContent).toBe('A2')
      expect(labels[2].textContent).toBe('B1')
    })
  })

  describe('Conditional Slots in List Items', () => {
    it('should handle slot containers with conditional content in list items', async () => {
      wildflower.component('toggle-card', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="conditional-slot-list">
          <ul data-list="items">
            <template>
              <li class="cond-item">
                <div data-component="toggle-card">
                  <div class="card-content" data-slot-container="content"></div>
                </div>
                <div data-slot="content">
                  <span class="item-summary" data-bind="summary"></span>
                  <span class="item-status" data-bind="active ? 'Active' : 'Inactive'"></span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('conditional-slot-list', {
        state: {
          items: [
            { id: 1, summary: 'Item 1', active: true },
            { id: 2, summary: 'Item 2', active: false }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.cond-item')
      expect(items.length).toBe(2)

      const summaries = testContainer.querySelectorAll('.item-summary')
      expect(summaries.length).toBe(2)
      expect(summaries[0].textContent).toBe('Item 1')

      const statuses = testContainer.querySelectorAll('.item-status')
      expect(statuses[0].textContent).toBe('Active')
      expect(statuses[1].textContent).toBe('Inactive')
    })
  })
})
