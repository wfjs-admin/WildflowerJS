import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

/**
 * Tests for inline expression reactivity with getStore()-backed computed properties.
 *
 * Bug: When reactivity comes exclusively through getStore() in computed properties
 * (no local state changes), certain binding types fail to re-evaluate inline expressions.
 *
 * See: docs/future/INLINE_EXPRESSION_REACTIVITY_WITH_GETSTORE.md
 * See: test-cases/inline-expression-store-reactivity.html
 */

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('inline expression store reactivity', () => {
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

    /**
     * Helper: creates a store and a component whose computed properties
     * derive from that store via getStore(). Returns the store instance
     * so tests can mutate it.
     */
    function setupStoreAndComponent(componentName, extraComputed, extraState) {
        const store = wildflower.store('metric', {
            state: { cpu: 30 }
        })

        const computed = {
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
            },
            ...extraComputed
        }

        const def = { computed }
        if (extraState) def.state = extraState

        wildflower.component(componentName, def)
        return store
    }

    // ================================================================
    // Section A: data-bind-style
    // ================================================================

    describe('data-bind-style', () => {
        it('A1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-a1')
            testContainer.innerHTML = `
                <div data-component="test-a1">
                    <div class="target" data-bind-style="barStyle"></div>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.width).toBe('30%')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.width).toBe('75%')
        })

        it('A2: inline object expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-a2')
            testContainer.innerHTML = `
                <div data-component="test-a2">
                    <div class="target" data-bind-style="{ width: storeValue + '%', height: '100%' }"></div>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.width).toBe('30%')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.width).toBe('75%')
        })

        it('A3: computed: prefix updates when store changes', async () => {
            const store = setupStoreAndComponent('test-a3')
            testContainer.innerHTML = `
                <div data-component="test-a3">
                    <div class="target" data-bind-style="computed:barStyle"></div>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.width).toBe('30%')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.width).toBe('75%')
        })
    })

    // ================================================================
    // Section B: data-bind-class
    // ================================================================

    describe('data-bind-class', () => {
        it('B1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-b1')
            testContainer.innerHTML = `
                <div data-component="test-b1">
                    <span class="target" data-bind-class="badgeClass"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.className).toContain('badge-normal')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.className).toContain('badge-danger')
        })

        it('B2: inline expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-b2')
            testContainer.innerHTML = `
                <div data-component="test-b2">
                    <span class="target" data-bind-class="'badge ' + (storeValue > 70 ? 'badge-danger' : storeValue > 40 ? 'badge-warning' : 'badge-normal')"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.className).toContain('badge-normal')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.className).toContain('badge-danger')
        })

        it('B3: computed: prefix updates when store changes', async () => {
            const store = setupStoreAndComponent('test-b3')
            testContainer.innerHTML = `
                <div data-component="test-b3">
                    <span class="target" data-bind-class="computed:badgeClass"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.className).toContain('badge-normal')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.className).toContain('badge-danger')
        })
    })

    // ================================================================
    // Section C: data-bind (text)
    // ================================================================

    describe('data-bind text', () => {
        it('C1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-c1')
            testContainer.innerHTML = `
                <div data-component="test-c1">
                    <span class="target" data-bind="statusLabel"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.textContent).toBe('LOW')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.textContent).toBe('HIGH')
        })

        it('C2: inline ternary expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-c2')
            testContainer.innerHTML = `
                <div data-component="test-c2">
                    <span class="target" data-bind="storeValue > 70 ? 'HIGH' : storeValue > 40 ? 'MED' : 'LOW'"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.textContent).toBe('LOW')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.textContent).toBe('HIGH')
        })

        it('C3: inline concatenation expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-c3')
            testContainer.innerHTML = `
                <div data-component="test-c3">
                    <span class="target" data-bind="'Value: ' + storeValue + '%'"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.textContent).toBe('Value: 30%')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.textContent).toBe('Value: 75%')
        })
    })

    // ================================================================
    // Section D: data-show
    // ================================================================

    describe('data-show', () => {
        it('D1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-d1')
            testContainer.innerHTML = `
                <div data-component="test-d1">
                    <span class="target" data-show="isHigh">VISIBLE</span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            // cpu=30, isHigh = 30 > 60 = false → hidden
            expect(target.style.display).toBe('none')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            // cpu=75, isHigh = 75 > 60 = true → visible
            expect(target.style.display).not.toBe('none')
        })

        it('D2: inline expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-d2')
            testContainer.innerHTML = `
                <div data-component="test-d2">
                    <span class="target" data-show="storeValue > 60">VISIBLE</span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.display).toBe('none')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.display).not.toBe('none')
        })
    })

    // ================================================================
    // Section E: Combined style + class
    // ================================================================

    describe('combined style + class', () => {
        it('E1: both computed names update when store changes', async () => {
            const store = setupStoreAndComponent('test-e1')
            testContainer.innerHTML = `
                <div data-component="test-e1">
                    <div class="target" data-bind-class="fillClass" data-bind-style="fillStyle"></div>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.width).toBe('30%')
            expect(target.className).toContain('fill-normal')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.width).toBe('75%')
            expect(target.className).toContain('fill-danger')
        })

        it('E2: both inline expressions update when store changes', async () => {
            const store = setupStoreAndComponent('test-e2')
            testContainer.innerHTML = `
                <div data-component="test-e2">
                    <div class="target"
                         data-bind-class="'progress-fill fill-' + (storeValue > 70 ? 'danger' : storeValue > 40 ? 'warning' : 'normal')"
                         data-bind-style="{ width: storeValue + '%', height: '100%' }"></div>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.style.width).toBe('30%')
            expect(target.className).toContain('fill-normal')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.style.width).toBe('75%')
            expect(target.className).toContain('fill-danger')
        })
    })

    // ================================================================
    // Section G: data-render
    // ================================================================

    describe('data-render', () => {
        it('G1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-g1')
            testContainer.innerHTML = `
                <div data-component="test-g1">
                    <span class="target" data-render="isHigh">RENDERED</span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            // cpu=30, isHigh = false → element should be removed or replaced with placeholder
            var target = testContainer.querySelector('.target')
            var rendered = target !== null && target.textContent === 'RENDERED'
            expect(rendered).toBe(false)

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            // cpu=75, isHigh = true → element should be in DOM
            target = testContainer.querySelector('.target')
            expect(target).not.toBeNull()
            expect(target.textContent).toBe('RENDERED')
        })

        it('G2: inline expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-g2')
            testContainer.innerHTML = `
                <div data-component="test-g2">
                    <span class="target" data-render="storeValue > 60">RENDERED</span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            var target = testContainer.querySelector('.target')
            var rendered = target !== null && target.textContent === 'RENDERED'
            expect(rendered).toBe(false)

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            target = testContainer.querySelector('.target')
            expect(target).not.toBeNull()
            expect(target.textContent).toBe('RENDERED')
        })
    })

    // ================================================================
    // Section H: data-bind-attr
    // ================================================================

    describe('data-bind-attr', () => {
        it('H1: computed property name updates when store changes', async () => {
            const store = setupStoreAndComponent('test-h1')
            testContainer.innerHTML = `
                <div data-component="test-h1">
                    <span class="target" data-bind-attr="attrObj"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.getAttribute('title')).toBe('CPU: 30%')
            expect(target.getAttribute('data-level')).toBe('low')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.getAttribute('title')).toBe('CPU: 75%')
            expect(target.getAttribute('data-level')).toBe('high')
        })

        it('H2: inline object expression updates when store changes', async () => {
            const store = setupStoreAndComponent('test-h2')
            testContainer.innerHTML = `
                <div data-component="test-h2">
                    <span class="target" data-bind-attr="{ title: 'CPU: ' + storeValue + '%', 'data-level': storeValue > 70 ? 'high' : 'low' }"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.getAttribute('title')).toBe('CPU: 30%')
            expect(target.getAttribute('data-level')).toBe('low')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.getAttribute('title')).toBe('CPU: 75%')
            expect(target.getAttribute('data-level')).toBe('high')
        })

        it('H3: computed: prefix updates when store changes', async () => {
            const store = setupStoreAndComponent('test-h3')
            testContainer.innerHTML = `
                <div data-component="test-h3">
                    <span class="target" data-bind-attr="computed:attrObj"></span>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForCompleteRender()

            const target = testContainer.querySelector('.target')
            expect(target.getAttribute('title')).toBe('CPU: 30%')
            expect(target.getAttribute('data-level')).toBe('low')

            store.state.cpu = 75
            await waitForUpdate(100)
            await waitForCompleteRender()

            expect(target.getAttribute('title')).toBe('CPU: 75%')
            expect(target.getAttribute('data-level')).toBe('high')
        })
    })

    // ================================================================
    // Section F: List context
    // ================================================================

    describe('list context', () => {
        // F1: Computed property names that reference this.value (list item data) inside
        // list templates are a deeper issue — the computed is re-evaluated at component level
        // (where this.value is undefined) rather than per-item. This is a separate bug from
        // the !isComputedPath guard and needs a different fix.
        it('F1: computed property name in list updates when store changes', async () => {
            wildflower.store('metric', {
                state: { cpu: 30 }
            })

            wildflower.component('test-f1', {
                state: {
                    items: [
                        { id: 1, name: 'Alpha', value: 25 },
                        { id: 2, name: 'Beta', value: 55 },
                        { id: 3, name: 'Gamma', value: 80 }
                    ]
                },
                computed: {
                    threshold() {
                        var s = wildflower.getStore('metric')
                        return s ? Math.round(s.state.cpu) : 50
                    },
                    rowClass(item) {
                        var s = wildflower.getStore('metric')
                        var thresh = s ? Math.round(s.state.cpu) : 50
                        if (!item || item.value === undefined) return 'badge badge-normal'
                        return 'badge ' + (item.value > thresh ? 'badge-danger' : 'badge-normal')
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-f1">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li>
                                <span class="status" data-bind-class="rowClass" data-bind="value"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForUpdate(100)
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('li')
            expect(items.length).toBe(3)

            // cpu=30 (threshold=30): Alpha(25)=normal, Beta(55)=danger, Gamma(80)=danger
            const alpha = items[0].querySelector('.status')
            const beta = items[1].querySelector('.status')
            const gamma = items[2].querySelector('.status')

            expect(alpha.className).toContain('badge-normal')
            expect(beta.className).toContain('badge-danger')
            expect(gamma.className).toContain('badge-danger')

            // Change store so threshold=90: all items < 90 → all normal
            const store = wildflower.getStore('metric')
            store.state.cpu = 90
            await waitForUpdate(150)
            await waitForCompleteRender()

            expect(alpha.className).toContain('badge-normal')
            expect(beta.className).toContain('badge-normal')
            expect(gamma.className).toContain('badge-normal')
        })

        // Known issue: list item bindings don't re-evaluate when store-backed computed changes.
        // The conservative fix only targets standalone object-syntax bindings (style/attr).
        // List context re-evaluation requires changes to _updateListClassBindingsForProperty
        // or _refreshListItemComputedBindings — tracked separately.
        it('F2: inline expression in list updates when store changes', async () => {
            wildflower.store('metric', {
                state: { cpu: 30 }
            })

            wildflower.component('test-f2', {
                state: {
                    items: [
                        { id: 1, name: 'Alpha', value: 25 },
                        { id: 2, name: 'Beta', value: 55 },
                        { id: 3, name: 'Gamma', value: 80 }
                    ]
                },
                computed: {
                    threshold() {
                        var s = wildflower.getStore('metric')
                        return s ? Math.round(s.state.cpu) : 50
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-f2">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li>
                                <span class="status" data-bind-class="'badge ' + (value > threshold ? 'badge-danger' : 'badge-normal')" data-bind="value"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `
            wildflower.scan(testContainer)
            await waitForUpdate(100)
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('li')
            expect(items.length).toBe(3)

            const alpha = items[0].querySelector('.status')
            const beta = items[1].querySelector('.status')
            const gamma = items[2].querySelector('.status')

            // cpu=30 (threshold=30): Alpha(25)=normal, Beta(55)=danger, Gamma(80)=danger
            expect(alpha.className).toContain('badge-normal')
            expect(beta.className).toContain('badge-danger')
            expect(gamma.className).toContain('badge-danger')

            // Change store so threshold=90: all < 90 → all normal
            const store = wildflower.getStore('metric')
            store.state.cpu = 90
            await waitForUpdate(150)
            await waitForCompleteRender()

            expect(alpha.className).toContain('badge-normal')
            expect(beta.className).toContain('badge-normal')
            expect(gamma.className).toContain('badge-normal')
        })
    })
})
