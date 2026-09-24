/**
 * `__proto__` in a binding path or in seeded data never reaches a prototype.
 *
 * pathResolver.set walks a dotted path and creates objects as it goes. A
 * `__proto__` segment used to walk straight into Object.prototype, so an SSR
 * `data-bind="__proto__.isAdmin"` (parsed into state at adoption) or a
 * `data-model="__proto__.isAdmin"` input (written on every keystroke) set
 * `isAdmin` on every object in the page. The walk now refuses the segment.
 *
 * data-seed is JSON, so `__proto__` arrives as an own key, and merging it with
 * Object.assign replaced the state object's prototype. The seed merge skips
 * it (mergeData in wfUtils.js). The query versions of both live in
 * data-query-proto-key.test.js.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-pk-${++seq}`
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

describe('__proto__ in binding paths and seeded data', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        delete Object.prototype.isAdmin
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('data-model="__proto__.isAdmin": typing never writes Object.prototype', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { name: '' } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="name" data-model="name">
                <input class="evil" data-model="__proto__.isAdmin">
            </div>
        `
        wildflower.scan(container)
        await settle()

        const evil = container.querySelector('.evil')
        evil.value = 'yes'
        evil.dispatchEvent(new Event('input', { bubbles: true }))
        const name = container.querySelector('.name')
        name.value = 'Ada'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(40)

        expect(({}).isAdmin).toBeUndefined()
        expect(wildflower.getComponentsByType(c)[0].state.name).toBe('Ada')
    })

    // Copies keep the key as the own data key it was (as the graph's _clone,
    // spread and structuredClone do); they must not assign it.
    const EVIL_PROFILE = '{"name":"Ada","__proto__":{"isAdmin":true}}'
    const ownProto = (o) => Object.prototype.hasOwnProperty.call(o, '__proto__')

    it('wildflower.toRaw(): a nested __proto__ key comes back as data', async () => {
        const s = uname('s')
        wildflower.store(s, { state: { profile: JSON.parse(EVIL_PROFILE) } })
        const raw = wildflower.toRaw(wildflower.getStore(s).profile)

        expect(raw.name).toBe('Ada')
        expect(raw.isAdmin).toBeUndefined()
        expect(ownProto(raw)).toBe(true)
    })

    it('store reset(): a nested __proto__ key is restored as data', async () => {
        const s = uname('s')
        wildflower.store(s, { state: { profile: JSON.parse(EVIL_PROFILE) } })
        const store = wildflower.getStore(s)
        store.profile = { name: 'Grace' }
        store.reset()
        await settle(20)

        expect(store.profile.name).toBe('Ada')
        expect(store.profile.isAdmin).toBeUndefined()
    })

    it.runIf(hasFeature('plugins'))('plugin reset(): a nested __proto__ key is restored as data', async () => {
        const p = uname('p').replace(/-/g, '')
        wildflower.plugin({
            name: p,
            version: '1.0.0',
            state: { profile: JSON.parse(EVIL_PROFILE) },
            methods: { rename(n) { this.state.profile = { name: n } } },
            install() {}
        })
        const plugin = wildflower['$' + p]
        plugin.rename('Grace')
        plugin.reset()
        await settle(20)

        expect(plugin.state.profile.name).toBe('Ada')
        expect(plugin.state.profile.isAdmin).toBeUndefined()
    })

    // update() hands each key to the graph's setValue, a path writer like
    // pathResolver.set, which walked `__proto__` the same way.
    it('this.update(json): a __proto__ key is skipped, the other fields apply', async () => {
        const c = uname('c')
        let inst
        wildflower.component(c, { state: { name: 'a' }, init() { inst = this } })
        container.innerHTML = `<div data-component="${c}"><b class="nm" data-bind="name"></b></div>`
        wildflower.scan(container)
        await settle()

        inst.update(JSON.parse('{"name":"b","__proto__":{"isAdmin":true}}'))
        await settle(40)

        expect(container.querySelector('.nm').textContent).toBe('b')
        expect(inst.state.isAdmin).toBeUndefined()
    })

    it('store update(json): a __proto__ key is skipped, the other fields apply', async () => {
        const s = uname('s')
        wildflower.store(s, { state: { name: 'a' } })
        const store = wildflower.getStore(s)

        store.update(JSON.parse('{"name":"b","__proto__":{"isAdmin":true}}'))
        await settle(20)

        expect(store.name).toBe('b')
        expect(store.isAdmin).toBeUndefined()
    })

    it('this.update("__proto__.x", v) never writes Object.prototype', async () => {
        const c = uname('c')
        let inst
        wildflower.component(c, { state: { name: 'a' }, init() { inst = this } })
        container.innerHTML = `<div data-component="${c}"></div>`
        wildflower.scan(container)
        await settle()

        inst.update('__proto__.isAdmin', 'yes')
        await settle(20)

        expect(({}).isAdmin).toBeUndefined()
    })

    it('data-model="__proto__.x" on a web component never writes Object.prototype', async () => {
        if (!customElements.get('pk-field')) {
            customElements.define('pk-field', class extends HTMLElement { constructor() { super(); this.value = '' } })
        }
        const c = uname('c')
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}"><pk-field class="f" data-model="__proto__.isAdmin"></pk-field></div>`
        wildflower.scan(container)
        await settle()

        const f = container.querySelector('.f')
        f.value = 'yes'
        f.dispatchEvent(new Event('input', { bubbles: true }))
        f.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(40)

        expect(({}).isAdmin).toBeUndefined()
    })

    // The graph's computed-getter table was a plain object, so a field named
    // like an Object.prototype member found the inherited member there and was
    // read as a computed: `constructor` rendered "[object Object]", `toString`
    // "[object Undefined]", and `valueOf` threw in the render effect.
    it('state fields named constructor, toString and valueOf render as data', async () => {
        const c = uname('c')
        let inst
        wildflower.component(c, { state: { constructor: 'Bob', toString: 'ts', valueOf: 'vo' }, init() { inst = this } })
        container.innerHTML = `
            <div data-component="${c}">
                <b class="a" data-bind="constructor"></b>
                <b class="b" data-bind="toString"></b>
                <b class="v" data-bind="valueOf"></b>
            </div>
        `
        wildflower.scan(container)
        await settle()

        const t = (s) => container.querySelector(s).textContent
        expect([t('.a'), t('.b'), t('.v')]).toEqual(['Bob', 'ts', 'vo'])

        inst.state.constructor = 'Ann'
        await settle(40)
        expect(t('.a')).toBe('Ann')
    })

    it.runIf(hasFeature('pools'))('pool.update(key, props): a __proto__ key in props is skipped', async () => {
        const c = uname('c')
        let pool
        wildflower.component(c, { state: {}, pools: { items: { entity: {} } }, init() { pool = this.getPool('items') } })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-pool="items" data-key="id">
                    <template><div class="row"><b class="nm" data-bind="name"></b><span class="adm" data-show="isAdmin">ADMIN</span></div></template>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        pool.push({ id: 1, name: 'a' })
        await settle()

        pool.update(1, JSON.parse('{"name":"b","__proto__":{"isAdmin":true}}'))
        await settle()

        expect(container.querySelector('.nm').textContent).toBe('b')
        expect(container.querySelector('.adm').style.display).toBe('none')
    })

    describeIfSSR('SSR adoption', () => {
        it('data-bind="__proto__.isAdmin" never writes Object.prototype', async () => {
            const c = uname('c')
            wildflower.component(c, { state: {} })
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true">
                    <h2 data-bind="name">Ada</h2>
                    <span data-bind="__proto__.isAdmin">yes</span>
                </div>
            `
            wildflower.scan(container)
            await settle()

            expect(({}).isAdmin).toBeUndefined()
            expect(wildflower.getComponentsByType(c)[0].state.name).toBe('Ada')
        })

        it('a root data-seed carrying the key does not swap the state prototype', async () => {
            const c = uname('c')
            wildflower.component(c, { state: {} })
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true" data-seed='{"userId":7,"__proto__":{"isAdmin":true}}'>
                    <h2 data-bind="name">Ada</h2>
                </div>
            `
            wildflower.scan(container)
            await settle()

            const inst = wildflower.getComponentsByType(c)[0]
            expect(inst.state.userId).toBe(7)
            expect(inst.state.isAdmin).toBeUndefined()
        })

        it.runIf(hasFeature('lists'))('an item data-seed carrying the key does not swap the item prototype', async () => {
            const c = uname('c')
            wildflower.component(c, { state: { items: [] } })
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true">
                    <div data-list="items">
                        <template><div class="row"><span data-bind="name"></span></div></template>
                        <div class="row" data-seed='{"id":11,"__proto__":{"isAdmin":true}}'><span data-bind="name">Alpha</span></div>
                    </div>
                </div>
            `
            wildflower.scan(container)
            await settle()

            const item = wildflower.getComponentsByType(c)[0].state.items[0]
            expect(item.id).toBe(11)
            expect(item.isAdmin).toBeUndefined()
        })
    })
})
