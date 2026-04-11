/**
 * Smoke Test - Vitest Browser Mode
 *
 * This test verifies that WildflowerJS works correctly in a real browser
 * environment using Vitest Browser Mode with Playwright.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('WildflowerJS Browser Mode Smoke Test', () => {
  let testContainer

  beforeEach(() => {
    // Create a fresh test container
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    // Cleanup
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }

    // Reset framework if available
    if (window.wildflower) {
      window.wildflower.componentDefinitions?.clear()
      window.wildflower.componentInstances?.clear()
      // Clear template cache to prevent cross-test contamination
      if (window.wildflower._templateCache) {
        window.wildflower._templateCache.general?.clear()
        window.wildflower._templateCache.lists?.clear()
        window.wildflower._templateCache.compiled?.clear()
        window.wildflower._templateCache.extracted?.clear()
        window.wildflower._templateCache.fragmentPools?.clear()
        window.wildflower._templateCache.stats?.clear()
      }
    }
  })

  it('should have access to real browser APIs', () => {
    // Verify we're in a real browser, not jsdom
    expect(window).toBeDefined()
    expect(document).toBeDefined()
    expect(document.body).toBeDefined()

    // These should work in real browsers
    expect(typeof window.requestAnimationFrame).toBe('function')
    expect(typeof window.MutationObserver).toBe('function')
    expect(typeof window.customElements).toBe('object')
  })

  it('should be able to manipulate DOM', () => {
    const div = document.createElement('div')
    div.textContent = 'Hello Browser Mode'
    div.id = 'test-element'
    testContainer.appendChild(div)

    const found = document.getElementById('test-element')
    expect(found).toBeTruthy()
    expect(found.textContent).toBe('Hello Browser Mode')
  })

  it('should handle async DOM operations', async () => {
    // Test that async operations work properly
    const div = document.createElement('div')
    div.id = 'async-test'
    testContainer.appendChild(div)

    // Use requestAnimationFrame (this fails in jsdom sometimes)
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        div.textContent = 'Updated via RAF'
        resolve()
      })
    })

    expect(div.textContent).toBe('Updated via RAF')
  })

  it('should handle MutationObserver', async () => {
    const div = document.createElement('div')
    div.id = 'mutation-test'
    testContainer.appendChild(div)

    let mutationDetected = false

    const observer = new MutationObserver((mutations) => {
      mutationDetected = true
    })

    observer.observe(div, { childList: true, subtree: true })

    // Trigger a mutation
    div.innerHTML = '<span>Changed</span>'

    // Wait for mutation to be detected
    await new Promise(resolve => setTimeout(resolve, 50))

    observer.disconnect()
    expect(mutationDetected).toBe(true)
  })
})
