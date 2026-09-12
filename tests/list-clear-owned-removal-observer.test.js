/**
 * Framework-owned bulk removals and the component-scanning MutationObserver.
 *
 * A data-list full clear and a pool clear tear their rows down themselves and
 * end in one replaceChildren(). The observer in _setupDynamicComponentDetection
 * used to walk every removed node of that record just to skip each one as a
 * row (~50-100µs per 1000 rows, inside the clear's own frame). The renderers
 * now stamp the container (_wfOwnedRemoval = child count) when every child is
 * one of their rows, and the observer consumes the stamp for exactly the
 * record whose removedNodes count matches.
 *
 * What must stay true:
 *   - the stamp is consumed by the clear's record (no stale stamp survives to
 *     swallow a later, unrelated removal on the same container);
 *   - dynamic component detection keeps working after a stamped clear;
 *   - a FOREIGN component element living inside the list container (count
 *     mismatch, so no stamp) is still noticed when the clear removes it, and
 *     its instance is garbage-collected.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer, hasFeature,
} from '../packages/test-utils/index.js'

async function until(fn, ms = 2000) {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
        if (fn()) return true
        await new Promise(r => setTimeout(r, 20))
    }
    return fn()
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'row ' + (i + 1) }))

describe('Framework-owned bulk removal stamp (data-list full clear)', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    function mountList(n) {
        wildflower.component('owned-removal-list', {
            state: { rows: rows(n) },
            clear() { this.rows = [] }
        })
        wildflower.component('late-widget', { state: { ok: 'late' } })
        testContainer.innerHTML = `
            <div data-component="owned-removal-list">
                <ul class="rows" data-list="rows" data-key="id">
                    <template><li data-bind="label"></li></template>
                </ul>
            </div>
        `
    }

    const instanceOf = (el) => wildflower.componentInstances.get(el.dataset.componentId)

    it('stamps the container for a full clear and the observer consumes the stamp', async () => {
        mountList(40)
        await waitForCompleteRender()
        const ul = testContainer.querySelector('.rows')
        expect(ul.querySelectorAll('li').length).toBe(40)
        // The bulk create stamped its pure-add record too, and the observer
        // consumed it (no stale addition stamp survives the initial render).
        await until(() => ul._wfOwnedAddition === undefined)
        expect(ul._wfOwnedAddition).toBeUndefined()

        instanceOf(testContainer.querySelector('[data-component="owned-removal-list"]')).context.clear()
        await waitForCompleteRender()
        expect(ul.querySelectorAll('li').length).toBe(0)

        // The observer's callback ran (microtask after the clear) and consumed
        // the stamp; a stale stamp would swallow a later unrelated removal.
        await until(() => ul._wfOwnedRemoval === undefined)
        expect(ul._wfOwnedRemoval).toBeUndefined()
    })

    it('dynamic component detection still works after a stamped clear', async () => {
        mountList(40)
        await waitForCompleteRender()
        instanceOf(testContainer.querySelector('[data-component="owned-removal-list"]')).context.clear()
        await waitForCompleteRender()

        const late = document.createElement('div')
        late.setAttribute('data-component', 'late-widget')
        late.innerHTML = '<span data-bind="ok"></span>'
        testContainer.appendChild(late)

        await until(() => late.dataset.componentId && late.querySelector('span').textContent === 'late')
        expect(late.querySelector('span').textContent).toBe('late')
    })

    it('a foreign component inside the list container is still collected when the clear removes it', async () => {
        mountList(40)
        await waitForCompleteRender()
        const ul = testContainer.querySelector('.rows')

        // Foreign element (not a list row) placed directly in the container,
        // detected by the observer as a dynamic component.
        const foreign = document.createElement('li')
        foreign.setAttribute('data-component', 'late-widget')
        foreign.innerHTML = '<span data-bind="ok"></span>'
        ul.appendChild(foreign)
        await until(() => !!foreign.dataset.componentId)
        const foreignId = foreign.dataset.componentId
        expect(wildflower.componentInstances.has(foreignId)).toBe(true)

        // 41 children vs 40 tracked rows: no stamp, the observer walks the
        // record, finds the removed component element and schedules GC.
        instanceOf(testContainer.querySelector('[data-component="owned-removal-list"]')).context.clear()
        await waitForCompleteRender()
        expect(ul.children.length).toBe(0)
        expect(ul._wfOwnedRemoval).toBeUndefined()

        await until(() => !wildflower.componentInstances.has(foreignId), 3000)
        expect(wildflower.componentInstances.has(foreignId)).toBe(false)
    })
})

// Pools ship in lite and above plus mini-pool; mini and nano have no
// PoolRenderer (nano does not even reject the `pools:` key, so a runtime probe
// cannot tell): gate on the build's feature set.
describe.skipIf(!hasFeature('pools'))('Framework-owned bulk removal stamp (pool clear)', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('pool.clear() stamps, the observer consumes, and later detection still works', async () => {
        wildflower.component('owned-removal-pool', {
            state: {},
            pools: { things: {} },
            init() { this.pools.things.push(rows(40)) },
            clear() { this.pools.things.clear() }
        })
        wildflower.component('late-widget-pool', { state: { ok: 'late' } })
        testContainer.innerHTML = `
            <div data-component="owned-removal-pool">
                <ul class="things" data-pool="things" data-key="id">
                    <template><li data-bind="label"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const ul = testContainer.querySelector('.things')
        await until(() => ul.querySelectorAll('li').length === 40)
        expect(ul.querySelectorAll('li').length).toBe(40)
        // pool.push stamped the pure-add record; the observer consumed it.
        await until(() => ul._wfOwnedAddition === undefined)
        expect(ul._wfOwnedAddition).toBeUndefined()

        const host = testContainer.querySelector('[data-component="owned-removal-pool"]')
        wildflower.componentInstances.get(host.dataset.componentId).context.clear()
        await waitForCompleteRender()
        expect(ul.querySelectorAll('li').length).toBe(0)
        await until(() => ul._wfOwnedRemoval === undefined)
        expect(ul._wfOwnedRemoval).toBeUndefined()

        const late = document.createElement('div')
        late.setAttribute('data-component', 'late-widget-pool')
        late.innerHTML = '<span data-bind="ok"></span>'
        testContainer.appendChild(late)
        await until(() => late.dataset.componentId && late.querySelector('span').textContent === 'late')
        expect(late.querySelector('span').textContent).toBe('late')
    })
})
