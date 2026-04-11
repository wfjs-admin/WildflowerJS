/**
 * WildflowerJS Slots (data-slot) Test Suite - Vitest Browser Mode
 *
 * Tests for content projection using data-slot and data-slot-container.
 * Migrated from unitTestSuite.js Slots section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Slots (data-slot)', () => {
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

  it('data-slot content moves to data-slot-container', async () => {
    wildflower.component('slot-container-1', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="slot-container-1">
        <div data-slot-container="main" id="slot-target"></div>
        <div data-slot="main" id="slot-content">
          <p>Projected Content</p>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const container = testContainer.querySelector('#slot-target')
    const projectedContent = container.querySelector('p')

    expect(projectedContent).not.toBeNull()
    expect(projectedContent.textContent).toBe('Projected Content')
  })

  it('multiple named slots project to correct containers', async () => {
    wildflower.component('slot-multi', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="slot-multi">
        <header data-slot-container="header" id="header-container"></header>
        <main data-slot-container="body" id="body-container"></main>
        <footer data-slot-container="footer" id="footer-container"></footer>

        <div data-slot="header" id="header-content">Header Content</div>
        <div data-slot="body" id="body-content">Body Content</div>
        <div data-slot="footer" id="footer-content">Footer Content</div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const headerContainer = testContainer.querySelector('#header-container')
    const bodyContainer = testContainer.querySelector('#body-container')
    const footerContainer = testContainer.querySelector('#footer-container')

    expect(headerContainer.textContent).toContain('Header Content')
    expect(bodyContainer.textContent).toContain('Body Content')
    expect(footerContainer.textContent).toContain('Footer Content')
  })

  it('slot content with data bindings still works', async () => {
    wildflower.component('slot-binding', {
      state: {
        message: 'Dynamic Message'
      }
    })

    testContainer.innerHTML = `
      <div data-component="slot-binding">
        <div data-slot-container="content" id="binding-container"></div>
        <div data-slot="content">
          <span id="slot-bound-text" data-bind="message"></span>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const boundText = testContainer.querySelector('#slot-bound-text')
    expect(boundText.textContent).toBe('Dynamic Message')
  })

  it('slot content with actions still works', async () => {
    let actionCalled = false

    wildflower.component('slot-action', {
      state: {},
      slotButtonClick() {
        actionCalled = true
      }
    })

    testContainer.innerHTML = `
      <div data-component="slot-action">
        <div data-slot-container="buttons" id="action-container"></div>
        <div data-slot="buttons">
          <button id="slot-action-btn" data-action="slotButtonClick">Click Me</button>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    testContainer.querySelector('#slot-action-btn').click()
    await waitForUpdate(100)

    expect(actionCalled).toBe(true)
  })

  it('empty slot container when no matching slot content', async () => {
    wildflower.component('slot-empty', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="slot-empty">
        <div data-slot-container="missing" id="empty-slot-container">
          <span id="default-content">Default Content</span>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const container = testContainer.querySelector('#empty-slot-container')
    const defaultContent = testContainer.querySelector('#default-content')

    // When no slot content exists, container should keep its original content
    expect(defaultContent).not.toBeNull()
    expect(defaultContent.textContent).toBe('Default Content')
  })
})
