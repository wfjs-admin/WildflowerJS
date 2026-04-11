/**
 * @vitest-environment browser
 *
 * Tests for watcher :immediate suffix on component-level watchers.
 * Verifies that 'path:immediate' watchers fire with the initial value
 * during component setup, before any state changes occur.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wf) {
    if (wf._setupDynamicComponentDetection) {
        wf._setupDynamicComponentDetection()
    }
}

describe('Watcher :immediate suffix', () => {
    let wildflower
    let testContainer

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        resetFramework()
        if (testContainer?.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('should fire watcher immediately with initial value', async () => {
        const calls = []

        wildflower.component('imm-test-1', {
            state: { count: 42 },
            watch: {
                'count:immediate'(newVal, oldVal) {
                    calls.push({ newVal, oldVal })
                }
            }
        })

        testContainer.innerHTML = '<div data-component="imm-test-1"></div>'
        ensureComponentScanning(wildflower)
        await waitForUpdate(150)

        // Should have fired once immediately with initial value
        expect(calls.length).toBeGreaterThanOrEqual(1)
        expect(calls[0].newVal).toBe(42)
        expect(calls[0].oldVal).toBeUndefined()
    })

    it('should not fire immediately without :immediate suffix', async () => {
        const calls = []

        wildflower.component('imm-test-2', {
            state: { count: 42 },
            watch: {
                count(newVal, oldVal) {
                    calls.push({ newVal, oldVal })
                }
            }
        })

        testContainer.innerHTML = '<div data-component="imm-test-2"></div>'
        ensureComponentScanning(wildflower)
        await waitForUpdate(150)

        // Should NOT have fired — no state change happened
        expect(calls.length).toBe(0)
    })

    it('should fire immediately AND on subsequent changes', async () => {
        const calls = []

        wildflower.component('imm-test-3', {
            state: { name: 'Alice' },
            watch: {
                'name:immediate'(newVal, oldVal) {
                    calls.push({ newVal, oldVal })
                }
            },
            changeName() {
                this.state.name = 'Bob'
            }
        })

        testContainer.innerHTML = `
            <div data-component="imm-test-3">
                <span id="imm3-name" data-bind="name"></span>
                <button id="imm3-btn" data-action="changeName">Change</button>
            </div>
        `
        ensureComponentScanning(wildflower)
        await waitForUpdate(150)

        // First call: immediate with initial value
        expect(calls.length).toBeGreaterThanOrEqual(1)
        expect(calls[0].newVal).toBe('Alice')
        expect(calls[0].oldVal).toBeUndefined()

        // Trigger state change
        document.getElementById('imm3-btn').click()
        await new Promise(r => setTimeout(r, 100))

        // Should have a second call with the new value
        expect(calls.length).toBeGreaterThanOrEqual(2)
        const lastCall = calls[calls.length - 1]
        expect(lastCall.newVal).toBe('Bob')
    })

    it('should work with nested property paths', async () => {
        const calls = []

        wildflower.component('imm-test-4', {
            state: { user: { name: 'Alice' } },
            watch: {
                'user.name:immediate'(newVal, oldVal) {
                    calls.push({ newVal, oldVal })
                }
            }
        })

        testContainer.innerHTML = '<div data-component="imm-test-4"><span data-bind="user.name"></span></div>'
        ensureComponentScanning(wildflower)
        await waitForUpdate(150)

        expect(calls.length).toBeGreaterThanOrEqual(1)
        expect(calls[0].newVal).toBe('Alice')
    })
})
