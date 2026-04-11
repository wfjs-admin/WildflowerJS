/**
 * String ID List Operations Test Suite
 *
 * Tests that list operations (reorder, update) work correctly with string IDs.
 * Covers a bug where the hash-based reorder detection coerced string IDs to 0,
 * making all string-ID arrays falsely match.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getListItems } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('String ID List Operations', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('detects reorder of items with string IDs', async () => {
    testContainer.innerHTML = `
      <div data-component="string-id-list">
        <ul data-list="items">
          <template>
            <li><span class="name" data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component('string-id-list', {
      state: {
        items: [
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' },
          { id: 'gamma', name: 'Gamma' }
        ]
      }
    })

    await waitForCompleteRender()

    const el = testContainer.querySelector('[data-component="string-id-list"]')
    const instance = wildflower.componentInstances.get(el.dataset.componentId)
    const listEl = el.querySelector('[data-list="items"]')

    const items = getListItems(listEl)
    expect(items.length).toBe(3)
    expect(items[0].querySelector('.name').textContent).toBe('Alpha')
    expect(items[2].querySelector('.name').textContent).toBe('Gamma')

    // Reverse the array — IDs at each index change
    instance.state.items = [
      { id: 'gamma', name: 'Gamma' },
      { id: 'beta', name: 'Beta' },
      { id: 'alpha', name: 'Alpha' }
    ]
    await waitForCompleteRender()

    const updatedItems = getListItems(listEl)
    expect(updatedItems[0].querySelector('.name').textContent).toBe('Gamma')
    expect(updatedItems[2].querySelector('.name').textContent).toBe('Alpha')
  })

  it('detects property change on items with string IDs', async () => {
    testContainer.innerHTML = `
      <div data-component="string-id-update">
        <ul data-list="items">
          <template>
            <li><span class="label" data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component('string-id-update', {
      state: {
        items: [
          { id: 'abc-123', label: 'First' },
          { id: 'def-456', label: 'Second' }
        ]
      }
    })

    await waitForCompleteRender()

    const el = testContainer.querySelector('[data-component="string-id-update"]')
    const instance = wildflower.componentInstances.get(el.dataset.componentId)

    instance.state.items = [
      { id: 'abc-123', label: 'Updated' },
      { id: 'def-456', label: 'Second' }
    ]
    await waitForCompleteRender()

    const listEl = el.querySelector('[data-list="items"]')
    const items = getListItems(listEl)
    expect(items[0].querySelector('.label').textContent).toBe('Updated')
    expect(items[1].querySelector('.label').textContent).toBe('Second')
  })
})
