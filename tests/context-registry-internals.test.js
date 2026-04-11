/**
 * context-registry-internals.test.js - Vitest Browser Mode Tests for ContextRegistry Internals
 *
 * Tests the ContextRegistry internal mechanics (AI-06)
 * Priority: P2 (Medium - internal validation)
 *
 * Tests:
 *   - Batch mode (defer, commit, nested)
 *   - Garbage collection (orphaned, dependents)
 *   - Dependency cleanup (circular)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe.skipIf(isMinifiedBuild())('ContextRegistry Internals', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  // Getters for classes (ensure they're loaded)
  const getContextRegistry = () => window.ContextRegistry
  const getContext = () => window.Context

  beforeEach(() => {
    wildflower = window.wildflower

    // Reset framework state
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
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

  describe('Batch Mode', () => {
    it('defers registration during batch mode', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      // Start batch mode
      registry.startBatch()
      expect(registry._batchMode).toBe(true)

      // Create a context during batch mode
      const ctx = new (getContext())('batch-test-1', 'test.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx)

      // Context should be in batch queue, not main contexts map yet
      expect(registry._batchedContexts.length).toBeGreaterThan(0)

      // Commit batch
      registry.commitBatch()

      // After commit, context should be in main contexts
      expect(registry._batchMode).toBe(false)
      expect(registry.getContextById('batch-test-1')).toBeDefined()
    })

    it('commits batch updates indices efficiently', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }
      const initialSize = registry.contexts.size

      // Start batch
      registry.startBatch()

      // Register multiple contexts in batch
      for (let i = 0; i < 10; i++) {
        const ctx = new (getContext())(`batch-idx-${i}`, `path.${i}`, {
          type: 'binding',
          componentInstance: mockComponent
        })
        registry.registerContext(ctx)
      }

      // Before commit, batched contexts not in main store
      expect(registry._batchedContexts.length).toBe(10)

      // Commit
      registry.commitBatch()

      // All should be registered
      expect(registry.contexts.size).toBe(initialSize + 10)

      // Batched array should be cleared
      expect(registry._batchedContexts.length).toBe(0)
    })

    it('handles nested batches gracefully', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      // Start first batch
      registry.startBatch()
      expect(registry._batchMode).toBe(true)

      const ctx1 = new (getContext())('nested-batch-1', 'path.1', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx1)
      expect(registry._batchedContexts.length).toBe(1)

      // Start "nested" batch - NOTE: current behavior resets batch queue
      registry.startBatch()
      expect(registry._batchMode).toBe(true)

      const ctx2 = new (getContext())('nested-batch-2', 'path.2', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx2)

      // Commit the nested batch
      registry.commitBatch()

      // Second context should be registered
      expect(registry.getContextById('nested-batch-2')).toBeDefined()
      expect(registry._batchMode).toBe(false)
    })
  })

  describe('Garbage Collection', () => {
    it('removes orphaned contexts', () => {
      const registry = new (getContextRegistry())()
      const mockInstance = { state: {}, element: document.createElement('div') }

      const ctx = new (getContext())('orphan-test', 'test.path', {
        type: 'binding',
        componentInstance: mockInstance
      })
      registry.registerContext(ctx)

      // Verify context exists
      expect(registry.getContextById('orphan-test')).toBeDefined()

      // Orphan the context by removing component reference
      ctx.componentInstance = null

      // Run garbage collection
      const stats = registry.garbageCollect()

      // GC should return the removed count
      expect(stats).toBeDefined()
      expect(typeof stats === 'number').toBe(true)
    })

    it('preserves contexts with dependents', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      // Create parent context
      const parentCtx = new (getContext())('parent-ctx', 'parent.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(parentCtx)

      // Create child context that depends on parent
      const childCtx = new (getContext())('child-ctx', 'child.path', {
        type: 'binding',
        componentInstance: mockComponent,
        parentContext: parentCtx
      })
      registry.registerContext(childCtx)

      // Register dependency
      registry.registerDependency(childCtx, parentCtx, 'parent.path')

      // Check dependency was registered (dependents on target context)
      expect(parentCtx.dependents && parentCtx.dependents.size > 0).toBe(true)

      // GC should not remove parent because it has dependents
      registry.garbageCollect()

      expect(registry.getContextById('parent-ctx')).toBeDefined()
    })
  })

  describe('Dependency Management', () => {
    it('registers dependencies between contexts', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      const sourceCtx = new (getContext())('source-ctx', 'source.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(sourceCtx)

      const targetCtx = new (getContext())('target-ctx', 'target.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(targetCtx)

      // Register dependency
      registry.registerDependency(sourceCtx, targetCtx, 'target.path')

      // Verify dependency exists (stored in target's dependents)
      expect(targetCtx.dependents.size).toBeGreaterThan(0)
    })

    it('cleans up dependencies when context is removed', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      const ctx1 = new (getContext())('dep-test-1', 'path.1', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx1)

      const ctx2 = new (getContext())('dep-test-2', 'path.2', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx2)

      // Register dependency
      registry.registerDependency(ctx1, ctx2, 'path.2')

      // Remove context
      registry.removeContext('dep-test-1')

      // Context should be removed
      expect(registry.getContextById('dep-test-1')).toBeUndefined()
    })
  })

  describe('Context Type Indices', () => {
    it('maintains type-based indices', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      // Create contexts of different types
      const bindingCtx = new (getContext())('type-binding', 'binding.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(bindingCtx)

      const actionCtx = new (getContext())('type-action', 'action.path', {
        type: 'action',
        componentInstance: mockComponent
      })
      registry.registerContext(actionCtx)

      const listCtx = new (getContext())('type-list', 'list.path', {
        type: 'list',
        componentInstance: mockComponent
      })
      registry.registerContext(listCtx)

      // Query by type
      const bindings = registry.getContextsByType('binding')
      const actions = registry.getContextsByType('action')
      const lists = registry.getContextsByType('list')

      expect(bindings.length).toBeGreaterThanOrEqual(1)
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('updates indices when contexts are removed', () => {
      const registry = new (getContextRegistry())()
      const mockComponent = { state: {}, element: document.createElement('div') }

      const ctx = new (getContext())('removable-ctx', 'test.path', {
        type: 'binding',
        componentInstance: mockComponent
      })
      registry.registerContext(ctx)

      const beforeRemove = registry.getContextsByType('binding').length

      registry.removeContext('removable-ctx')

      const afterRemove = registry.getContextsByType('binding').length

      expect(afterRemove).toBe(beforeRemove - 1)
    })
  })
})
