/**
 * WildflowerJS Cross-Component Method Invocation Test Suite - Vitest Browser Mode
 *
 * Tests for cross-component method calls, getComponent helpers, and instance access.
 * Migrated from unitTestSuite.js CROSS-COMPONENT METHOD INVOCATION section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
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

    // Verify component is registered in componentInstances
    expect(wildflower.componentInstances.has(el.dataset.componentId)).toBe(true)

    // Verify component has required properties
    expect(instance.name).toBe('direct-method-test')
    expect(instance.element).toBe(el)
    expect(instance.stateManager).toBeDefined()

    // Test: method should be directly callable on instance
    expect(typeof instance.increment).toBe('function')

    // Call the method directly
    instance.increment()
    await waitForUpdate(20)

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
    await waitForUpdate()

    // Test the getComponents helper
    expect(typeof wildflower.getComponents).toBe('function')

    const instances = wildflower.getComponents('multi-instance-test')
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
    await waitForUpdate(20)

    // Verify the target was updated
    expect(target.state.value).toBe('updated-by-caller')
  })
})
