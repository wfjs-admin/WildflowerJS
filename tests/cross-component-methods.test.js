/**
 * WildflowerJS Cross-Component Method Invocation Test Suite - Vitest Browser Mode
 *
 * Tests for direct method calls, getComponent(), and getComponents() helpers.
 * Migrated from unitTestSuite.js Cross-Component Method Invocation section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for a specific number of component instances
async function waitForComponentInstances(name, count, timeout = 2000) {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    const instances = window.wildflower.getComponents(name)
    if (instances && instances.length >= count) {
      return instances
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  // Return whatever we have after timeout
  return window.wildflower.getComponents(name) || []
}

describe('Cross-Component Method Invocation', () => {
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

  it('instance.methodName() should be directly callable', async () => {
    wildflower.component('direct-method-test', {
      state: {
        counter: 0
      },
      increment() {
        this.state.counter++
      }
    })

    testContainer.innerHTML = `<div data-component="direct-method-test"></div>`
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="direct-method-test"]')
    const instance = wildflower.componentInstances.get(el.dataset.componentId)

    // Test: method should be directly callable on instance
    expect(typeof instance.increment).toBe('function')

    // Call the method directly
    instance.increment()
    await waitForUpdate()

    expect(instance.state.counter).toBe(1)
  })

  it('instance method should be same reference as context method', async () => {
    wildflower.component('method-reference-test', {
      state: { value: 0 },
      doSomething() {
        this.state.value = 42
      }
    })

    testContainer.innerHTML = `<div data-component="method-reference-test"></div>`
    wildflower.scan()
    await waitForUpdate()

    const el = testContainer.querySelector('[data-component="method-reference-test"]')
    const instance = wildflower.componentInstances.get(el.dataset.componentId)

    // Both should reference the same function object (not copies)
    expect(instance.doSomething).toBe(instance.context.doSomething)
  })

  it('wildflower.getComponent() should return instance by name', async () => {
    wildflower.component('get-component-test', {
      state: { id: 'test-123' }
    })

    testContainer.innerHTML = `<div data-component="get-component-test"></div>`
    wildflower.scan()
    await waitForUpdate()

    // Test the getComponent helper
    expect(typeof wildflower.getComponent).toBe('function')

    const instance = wildflower.getComponent('get-component-test')
    expect(instance).not.toBeNull()
    expect(instance.state.id).toBe('test-123')
  })

  it('wildflower.getComponent() should return null for non-existent component', async () => {
    expect(typeof wildflower.getComponent).toBe('function')

    const instance = wildflower.getComponent('non-existent-component-xyz')
    expect(instance).toBeNull()
  })

  it('wildflower.getComponents() should return array of all instances', async () => {
    wildflower.component('multi-instance-test', {
      state: { index: 0 }
    })

    // Create multiple instances
    testContainer.innerHTML = `
      <div data-component="multi-instance-test" id="multi-1"></div>
      <div data-component="multi-instance-test" id="multi-2"></div>
      <div data-component="multi-instance-test" id="multi-3"></div>
    `
    wildflower.scan()

    // Wait for all 3 instances to be initialized (more reliable than fixed timeout)
    const instances = await waitForComponentInstances('multi-instance-test', 3)

    // Test the getComponents helper
    expect(typeof wildflower.getComponents).toBe('function')
    expect(Array.isArray(instances)).toBe(true)
    expect(instances.length).toBe(3)

    // Verify each instance is a valid ContextProxy
    instances.forEach(inst => {
      expect(inst).not.toBeNull()
      expect(inst.state).toBeDefined()
    })
  })

  it('cross-component method call via getComponent()', async () => {
    // Component that will be called
    wildflower.component('target-component', {
      state: { value: 'initial' },
      setValue(newValue) {
        this.state.value = newValue
      }
    })

    // Component that makes the call
    wildflower.component('caller-component', {
      state: {},
      callTarget() {
        const target = wildflower.getComponent('target-component')
        if (target) {
          target.setValue('updated-by-caller')
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="target-component"></div>
      <div data-component="caller-component"></div>
    `
    wildflower.scan()
    await waitForUpdate()

    const targetEl = testContainer.querySelector('[data-component="target-component"]')
    const target = wildflower.componentInstances.get(targetEl.dataset.componentId)

    const callerEl = testContainer.querySelector('[data-component="caller-component"]')
    const caller = wildflower.componentInstances.get(callerEl.dataset.componentId)

    // Initial state
    expect(target.state.value).toBe('initial')

    // Call the method that invokes cross-component method
    caller.callTarget()
    await waitForUpdate()

    // Verify the target was updated
    expect(target.state.value).toBe('updated-by-caller')
  })

  describe('getComponent() ContextProxy shorthand', () => {
    it('should read state without .state. prefix', async () => {
      wildflower.component('shorthand-read-target', {
        state: { count: 42, label: 'hello' }
      })

      testContainer.innerHTML = `<div data-component="shorthand-read-target"></div>`
      wildflower.scan()
      await waitForUpdate()

      const comp = wildflower.getComponent('shorthand-read-target')
      expect(comp).not.toBeNull()
      // Shorthand: comp.count instead of comp.state.count
      expect(comp.count).toBe(42)
      expect(comp.label).toBe('hello')
      // Explicit .state. still works too
      expect(comp.state.count).toBe(42)
    })

    it('should read computed without .computed. prefix', async () => {
      wildflower.component('shorthand-computed-target', {
        state: { firstName: 'Jane', lastName: 'Doe' },
        computed: {
          fullName() {
            return `${this.firstName} ${this.lastName}`
          }
        }
      })

      testContainer.innerHTML = `<div data-component="shorthand-computed-target"></div>`
      wildflower.scan()
      await waitForUpdate()

      const comp = wildflower.getComponent('shorthand-computed-target')
      // Shorthand: comp.fullName instead of comp.stateManager.evaluateComputed('fullName')
      expect(comp.fullName).toBe('Jane Doe')
    })

    it('should write state without .state. prefix', async () => {
      wildflower.component('shorthand-write-target', {
        state: { score: 0 }
      })

      testContainer.innerHTML = `
        <div data-component="shorthand-write-target">
          <span class="score" data-bind="score"></span>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const comp = wildflower.getComponent('shorthand-write-target')
      expect(comp.score).toBe(0)

      // Write via shorthand — should trigger reactivity
      comp.score = 100
      await waitForUpdate()

      expect(comp.score).toBe(100)
      expect(testContainer.querySelector('.score').textContent).toBe('100')
    })

    it('should call methods on getComponent() result', async () => {
      wildflower.component('shorthand-method-target', {
        state: { value: 'original' },
        updateValue(newVal) {
          this.value = newVal
        }
      })

      testContainer.innerHTML = `<div data-component="shorthand-method-target"></div>`
      wildflower.scan()
      await waitForUpdate()

      const comp = wildflower.getComponent('shorthand-method-target')
      comp.updateValue('changed')
      await waitForUpdate()

      expect(comp.value).toBe('changed')
    })

    it('getComponents() should also return ContextProxy instances', async () => {
      wildflower.component('multi-shorthand', {
        state: { active: false }
      })

      testContainer.innerHTML = `
        <div data-component="multi-shorthand"></div>
        <div data-component="multi-shorthand"></div>
      `
      wildflower.scan()
      await waitForUpdate()

      const instances = await waitForComponentInstances('multi-shorthand', 2)
      expect(instances.length).toBe(2)

      // Each should support shorthand
      instances.forEach(inst => {
        expect(inst.active).toBe(false)
        inst.active = true
      })

      await waitForUpdate()
      instances.forEach(inst => {
        expect(inst.active).toBe(true)
      })
    })

    it('should auto-track dependencies when computed reads via shorthand', async () => {
      wildflower.component('shorthand-source', {
        state: { temperature: 72 }
      })

      wildflower.component('shorthand-observer', {
        computed: {
          tempDisplay() {
            const source = wildflower.getComponent('shorthand-source')
            // Read via shorthand (no .state.)
            return source ? `${source.temperature}°F` : 'N/A'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="shorthand-source"></div>
        <div data-component="shorthand-observer">
          <span class="display" data-bind="computed:tempDisplay"></span>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.display').textContent).toBe('72°F')

      // Mutate source — observer should auto-update
      const source = wildflower.getComponent('shorthand-source')
      source.temperature = 85
      await waitForUpdate(100)

      expect(testContainer.querySelector('.display').textContent).toBe('85°F')
    })
  })
})
