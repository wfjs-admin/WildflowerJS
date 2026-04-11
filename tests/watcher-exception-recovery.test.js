/**
 * Watcher Exception Recovery Test Suite
 *
 * Tests that the framework recovers correctly when a watcher throws an exception.
 * Specifically, _currentUpdatingInstance must be reset via try/finally so subsequent
 * state changes don't reference a stale instance.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Watcher Exception Recovery', () => {
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

  it('subsequent state changes work after a watcher throws', async () => {
    testContainer.innerHTML = `
      <div data-component="watcher-throw-test">
        <span data-bind="label"></span>
      </div>
    `

    wildflower.component('watcher-throw-test', {
      state: { count: 0, label: 'ok' },
      watch: {
        count(newVal) {
          if (newVal === 1) {
            throw new Error('Watcher intentional error')
          }
        }
      }
    })

    await waitForCompleteRender()

    const el = testContainer.querySelector('[data-component="watcher-throw-test"]')
    const instance = wildflower.componentInstances.get(el.dataset.componentId)

    // Trigger watcher throw
    try {
      instance.state.count = 1
    } catch (e) {
      // May or may not propagate
    }
    await waitForCompleteRender()

    // _currentUpdatingInstance must be null (reset by try/finally)
    expect(wildflower._currentUpdatingInstance).toBeNull()

    // Subsequent updates should still work
    instance.state.label = 'recovered'
    await waitForCompleteRender()

    const span = el.querySelector('[data-bind="label"]')
    expect(span.textContent).toBe('recovered')
  })
})
