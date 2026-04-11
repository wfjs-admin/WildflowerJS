import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

/**
 * Narrowing down: which combination of components causes C2 to fail?
 */

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 100))
}

describe('multi-component store reactivity', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false
            wildflower._initContextSystem()
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

    function sharedComputed() {
        return {
            storeValue() {
                var s = wildflower.getStore('metric')
                return s ? Math.round(s.state.cpu) : 0
            },
            barStyle() {
                return { width: this.computed.storeValue + '%', height: '100%' }
            },
            badgeClass() {
                var v = this.computed.storeValue
                return 'badge ' + (v > 70 ? 'badge-danger' : v > 40 ? 'badge-warning' : 'badge-normal')
            },
            statusLabel() {
                var v = this.computed.storeValue
                return v > 70 ? 'HIGH' : v > 40 ? 'MED' : 'LOW'
            },
            isHigh() {
                return this.computed.storeValue > 60
            },
            fillStyle() {
                return { width: this.computed.storeValue + '%', height: '100%' }
            },
            fillClass() {
                var v = this.computed.storeValue
                return 'progress-fill fill-' + (v > 70 ? 'danger' : v > 40 ? 'warning' : 'normal')
            },
            attrObj() {
                var v = this.computed.storeValue
                return { title: 'CPU: ' + v + '%', 'data-level': v > 70 ? 'high' : 'low' }
            }
        }
    }

    function setupStore() {
        return wildflower.store('metric', { state: { cpu: 30 } })
    }

    // === ISOLATION: c2 alone ===
    it('1: c2 alone', async () => {
        setupStore()
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === PAIR: c1 (computed name) + c2 (expression) ===
    it('2: c1 + c2', async () => {
        setupStore()
        wildflower.component('test-c1', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-c1">
                <span data-bind="statusLabel"></span>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === PAIR: b1 (class computed) + c2 ===
    it('3: b1 + c2', async () => {
        setupStore()
        wildflower.component('test-b1', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-b1">
                <span data-bind-class="badgeClass"></span>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === TRIPLE: b1 + c1 + c2 ===
    it('4: b1 + c1 + c2', async () => {
        setupStore()
        wildflower.component('test-b1', { computed: sharedComputed() })
        wildflower.component('test-c1', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-b1">
                <span data-bind-class="badgeClass"></span>
            </div>
            <div data-component="test-c1">
                <span data-bind="statusLabel"></span>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === PAIR: a1 (style computed) + c2 ===
    it('5: a1 + c2', async () => {
        setupStore()
        wildflower.component('test-a1', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-a1">
                <div data-bind-style="barStyle"></div>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === PAIR: a2 (style expression) + c2 ===
    it('6: a2 + c2', async () => {
        setupStore()
        wildflower.component('test-a2', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-a2">
                <div class="progress-fill" data-bind-style="{ width: storeValue + '%', height: '100%' }"></div>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')
    })

    // === REACTIVITY: a1 + a2 + c2 (matches test 2 from previous run) ===
    it('7: a1 + a2 + c2 reactivity', async () => {
        const store = setupStore()
        wildflower.component('test-a1', { computed: sharedComputed() })
        wildflower.component('test-a2', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-a1">
                <div data-bind-style="barStyle"></div>
            </div>
            <div data-component="test-a2">
                <div class="progress-fill" data-bind-style="{ width: storeValue + '%', height: '100%' }"></div>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')

        store.state.cpu = 85
        await new Promise(resolve => setTimeout(resolve, 100))
        await waitForCompleteRender()

        expect(testContainer.querySelector('.target').textContent).toBe('HIGH')
    })

    // === REACTIVITY: b1 + c1 + c2 (matches test 4 from previous run - failed) ===
    it('8: b1 + c1 + c2 reactivity', async () => {
        const store = setupStore()
        wildflower.component('test-b1', { computed: sharedComputed() })
        wildflower.component('test-c1', { computed: sharedComputed() })
        wildflower.component('test-c2', { computed: sharedComputed() })
        testContainer.innerHTML = `
            <div data-component="test-b1">
                <span data-bind-class="badgeClass"></span>
            </div>
            <div data-component="test-c1">
                <span data-bind="statusLabel"></span>
            </div>
            <div data-component="test-c2">
                <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        expect(testContainer.querySelector('.target').textContent).toBe('LOW')

        store.state.cpu = 85
        await new Promise(resolve => setTimeout(resolve, 100))
        await waitForCompleteRender()

        expect(testContainer.querySelector('.target').textContent).toBe('HIGH')
    })
})
