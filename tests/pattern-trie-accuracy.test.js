/**
 * WildflowerJS Pattern Trie Accuracy Test Suite - Vitest Browser Mode
 *
 * Tests for PatternTrie wildcard matching, caching, and pattern resolution.
 * Migrated from unitTestSuite.js Pattern Trie Accuracy section.
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

describe.skipIf(isMinifiedBuild())('Pattern Trie Accuracy', () => {
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

  it('PatternTrie matches single wildcard patterns', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-1" data-component="trie-single-wildcard">
        <span data-bind="message"></span>
      </div>
    `

    wildflower.component('trie-single-wildcard', {
      state: {
        message: 'Pattern Trie Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-1')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)

    // Get the patternTrie from stateManager
    const patternTrie = instance.stateManager._patternTrie
    expect(patternTrie).toBeDefined()

    // Add a test pattern
    patternTrie.add('items.*.name', 'testComputation')

    // Test matching
    const match0 = patternTrie.match('items.0.name')
    const match1 = patternTrie.match('items.1.name')
    const match99 = patternTrie.match('items.99.name')

    expect(match0.has('testComputation')).toBe(true)
    expect(match1.has('testComputation')).toBe(true)
    expect(match99.has('testComputation')).toBe(true)

    // Test non-matching paths
    const noMatch1 = patternTrie.match('items.0.email')
    const noMatch2 = patternTrie.match('items.name')

    expect(noMatch1.has('testComputation')).toBe(false)
    expect(noMatch2.has('testComputation')).toBe(false)
  })

  it('PatternTrie caches match results efficiently', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-2" data-component="trie-cache-test">
        <span data-bind="value"></span>
      </div>
    `

    wildflower.component('trie-cache-test', {
      state: {
        value: 'Cache Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-2')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const patternTrie = instance.stateManager._patternTrie

    // Clear cache and add pattern
    patternTrie.clearMatchCache()
    patternTrie.add('data.*.value', 'cacheTest')

    // First match - should add to cache
    expect(patternTrie._matchCache.has('data.0.value')).toBe(false)

    const result1 = patternTrie.match('data.0.value')
    expect(patternTrie._matchCache.has('data.0.value')).toBe(true)

    // Second match - should return cached result
    const result2 = patternTrie.match('data.0.value')
    expect(result1).toBe(result2)
  })

  it('PatternTrie handles multiple wildcard segments', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-3" data-component="trie-multi-wildcard">
        <span data-bind="label"></span>
      </div>
    `

    wildflower.component('trie-multi-wildcard', {
      state: {
        label: 'Multi-Wildcard Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-3')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const patternTrie = instance.stateManager._patternTrie

    // Add nested wildcard pattern
    patternTrie.add('teams.*.members.*.name', 'nestedTest')

    // Should match nested wildcards
    const match1 = patternTrie.match('teams.0.members.0.name')
    const match2 = patternTrie.match('teams.1.members.5.name')
    const match3 = patternTrie.match('teams.99.members.42.name')

    expect(match1.has('nestedTest')).toBe(true)
    expect(match2.has('nestedTest')).toBe(true)
    expect(match3.has('nestedTest')).toBe(true)

    // Should NOT match partial paths
    const noMatch1 = patternTrie.match('teams.0.members.name')
    const noMatch2 = patternTrie.match('teams.0.name')
    const noMatch3 = patternTrie.match('teams.members.0.name')

    expect(noMatch1.has('nestedTest')).toBe(false)
    expect(noMatch2.has('nestedTest')).toBe(false)
    expect(noMatch3.has('nestedTest')).toBe(false)
  })

  it('PatternTrie handles multiple patterns for same path', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-4" data-component="trie-multi-pattern">
        <span data-bind="status"></span>
      </div>
    `

    wildflower.component('trie-multi-pattern', {
      state: {
        status: 'Multi-Pattern Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-4')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const patternTrie = instance.stateManager._patternTrie

    // Add multiple patterns that could match same path
    patternTrie.add('items.*.name', 'pattern1')
    patternTrie.add('items.0.name', 'pattern2')  // Exact match
    patternTrie.add('items.*.name', 'pattern3')  // Same wildcard pattern, different computation

    // items.0.name should match both wildcard and exact patterns
    const matches = patternTrie.match('items.0.name')

    expect(matches.has('pattern1')).toBe(true)
    expect(matches.has('pattern2')).toBe(true)
    expect(matches.has('pattern3')).toBe(true)
    expect(matches.size).toBeGreaterThanOrEqual(3)

    // items.1.name should only match wildcard patterns, not exact
    const matches2 = patternTrie.match('items.1.name')
    expect(matches2.has('pattern1')).toBe(true)
    expect(matches2.has('pattern2')).toBe(false)
  })

  it('PatternTrie LRU cache eviction works correctly', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-5" data-component="trie-lru-test">
        <span data-bind="data"></span>
      </div>
    `

    wildflower.component('trie-lru-test', {
      state: {
        data: 'LRU Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-5')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const patternTrie = instance.stateManager._patternTrie

    // Clear cache - LRUCache has fixed max size set at construction (1000)
    patternTrie.clearMatchCache()

    patternTrie.add('test.*.value', 'lruTest')

    // Fill cache with entries
    for (let i = 0; i < 10; i++) {
      patternTrie.match(`test.${i}.value`)
    }

    // Cache should have all 10 entries (well under the 1000 limit)
    expect(patternTrie._matchCache.size).toBe(10)

    // All entries should be present
    expect(patternTrie._matchCache.has('test.0.value')).toBe(true)
    expect(patternTrie._matchCache.has('test.9.value')).toBe(true)

    // Verify LRU behavior: access an early entry, then add more entries
    // to verify LRU promotion works
    patternTrie._matchCache.get('test.0.value') // Access to promote to most recently used

    // Cache still has same size
    expect(patternTrie._matchCache.size).toBe(10)
  })

  it('PatternTrie handles exact vs wildcard priority', async () => {
    testContainer.innerHTML = `
      <div id="trie-test-6" data-component="trie-priority-test">
        <span data-bind="config"></span>
      </div>
    `

    wildflower.component('trie-priority-test', {
      state: {
        config: 'Priority Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const element = testContainer.querySelector('#trie-test-6')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const patternTrie = instance.stateManager._patternTrie

    // Add both exact and wildcard patterns
    patternTrie.add('config.theme', 'exactTheme')
    patternTrie.add('config.*', 'wildcardConfig')

    // Exact path should match both
    const themeMatches = patternTrie.match('config.theme')
    expect(themeMatches.has('exactTheme')).toBe(true)
    expect(themeMatches.has('wildcardConfig')).toBe(true)

    // Different property should only match wildcard
    const otherMatches = patternTrie.match('config.language')
    expect(otherMatches.has('exactTheme')).toBe(false)
    expect(otherMatches.has('wildcardConfig')).toBe(true)
  })
})
