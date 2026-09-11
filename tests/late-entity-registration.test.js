/**
 * Entities registered AFTER the markup that binds them.
 *
 * A $entity binding is compiled when its component binds. If the named entity
 * does not exist at that moment, external() misses. The miss path already
 * knows what to do about it: _externalRegisterPending records the waiting
 * dependency, and StoreManager._resolvePendingStoreDependencies drains it when
 * the entity is created, re-evaluating computeds, re-rendering lists, and
 * re-running the render effect.
 *
 * The registration side is narrower than the drain side. It fires only when a
 * _computedTrackingContext is present AND carries a computedName, which is
 * true during computed evaluation and false for a plain data-list or data-bind
 * path. So those bindings register nothing, the drain has nobody to wake, and
 * the binding stays inert for the life of the page even though the entity is
 * now present and holding data.
 *
 * Found while root-causing the data-query "never fetches" report; the query
 * case inherits this rather than owning it. See data-query-late-registration.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-lateent-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

describe('entities registered after their bindings compile', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('CONTROL: a store registered before the scan renders', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { items: [{ name: 'a' }, { name: 'b' }] } })

        container.innerHTML = `
            <div data-component="${c}">
                <div data-list="$${s}.items" data-key="name">
                    <template><span class="row" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelectorAll('.row').length).toBe(2)
    })

    it('a data-list bound to a store that registers later renders when it arrives', async () => {
        const s = uname('s'); const c = uname('c')

        container.innerHTML = `
            <div data-component="${c}">
                <div data-list="$${s}.items" data-key="name">
                    <template><span class="row" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        wildflower.store(s, { state: { items: [{ name: 'a' }, { name: 'b' }] } })
        await settle()

        expect(container.querySelectorAll('.row').length).toBe(2)
    })

    it('a data-bind path on a store that registers later fills in', async () => {
        const s = uname('s'); const c = uname('c')

        container.innerHTML = `
            <div data-component="${c}">
                <span class="v" data-bind="$${s}.label"></span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        wildflower.store(s, { state: { label: 'hello' } })
        await settle()

        expect(container.querySelector('.v').textContent).toBe('hello')
    })

    it('a later mutation of the late store also reaches the list', async () => {
        const s = uname('s'); const c = uname('c')

        container.innerHTML = `
            <div data-component="${c}">
                <div data-list="$${s}.items" data-key="name">
                    <template><span class="row" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        wildflower.store(s, { state: { items: [{ name: 'a' }] } })
        await settle()
        wildflower.getStore(s).items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
        await settle()

        expect(container.querySelectorAll('.row').length).toBe(3)
    })
})
