/**
 * WildflowerJS Delayed Action + Destroy Test Suite
 *
 * Tests that delayed action handlers do not fire on destroyed components.
 * Covers issue 2.5 from V1 RC1 Final Code Review.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Delayed Action on Destroyed Component', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

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

  it('does not call delayed action handler after component is destroyed', async () => {
    let actionCalled = false

    wildflower.component('delay-test', {
      state: { count: 0 },
      events: {
        actions: {
          click: {
            delay: 200,
            stopPropagation: true,
            preventDefault: false
          }
        }
      },
      increment() {
        actionCalled = true
        this.state.count++
      }
    })

    testContainer.innerHTML = `
      <div data-component="delay-test">
        <button data-action="click:increment">Click</button>
        <span data-bind="count"></span>
      </div>
    `

    wildflower._scanForComponents()
    await waitForCompleteRender()

    // Find the component instance
    const componentEl = testContainer.querySelector('[data-component="delay-test"]')
    const componentId = componentEl.dataset.componentId
    expect(componentId).toBeTruthy()
    const instance = wildflower.componentInstances.get(componentId)
    expect(instance).toBeTruthy()

    // Click the button (triggers delayed action with 200ms delay)
    const button = testContainer.querySelector('button')
    button.click()

    // Immediately destroy the component (before the 200ms delay fires)
    wildflower.destroyComponent(componentId)
    expect(wildflower.componentInstances.has(componentId)).toBe(false)

    // Wait for the delay to fire
    await new Promise(resolve => setTimeout(resolve, 350))

    // The action should NOT have been called on the destroyed instance
    expect(actionCalled).toBe(false)
  })
})
