/**
 * data-cloak tests
 *
 * Tests the data-cloak anti-FOUC system:
 * - Users add [data-cloak] { display: none; } in <head> CSS
 * - Users add data-cloak to elements that should not flash
 * - Framework removes data-cloak after initialization
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-cloak', () => {
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
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('removes data-cloak from component element after scan', async () => {
    wildflower.component('cloak-test', {
      state: { visible: true }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-test" data-cloak>
        <div data-show="visible">Content</div>
      </div>
    `

    // data-cloak should be present before scan
    const el = testContainer.querySelector('[data-component="cloak-test"]')
    expect(el.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    // data-cloak should be removed after framework processes it
    expect(el.hasAttribute('data-cloak')).toBe(false)
  })

  it('removes data-cloak from inner elements after scan', async () => {
    wildflower.component('cloak-inner-test', {
      state: { isOpen: false }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-inner-test">
        <div data-show="isOpen" data-cloak id="cloaked-inner">Modal</div>
      </div>
    `

    const inner = document.getElementById('cloaked-inner')
    expect(inner.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    // data-cloak removed, but element should still be hidden by data-show
    expect(inner.hasAttribute('data-cloak')).toBe(false)
    expect(inner.style.display).toBe('none')
  })

  it('removes data-cloak from multiple elements in same component', async () => {
    wildflower.component('cloak-multi-test', {
      state: { showA: false, showB: false }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-multi-test">
        <div data-show="showA" data-cloak class="panel-a">Panel A</div>
        <div data-show="showB" data-cloak class="panel-b">Panel B</div>
        <div>Always visible</div>
      </div>
    `

    const panelA = testContainer.querySelector('.panel-a')
    const panelB = testContainer.querySelector('.panel-b')
    expect(panelA.hasAttribute('data-cloak')).toBe(true)
    expect(panelB.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    expect(panelA.hasAttribute('data-cloak')).toBe(false)
    expect(panelB.hasAttribute('data-cloak')).toBe(false)
  })
})
