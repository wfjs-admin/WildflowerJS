/**
 * @vitest-environment browser
 *
 * List rows must re-render when a computed they reference (directly or through
 * an item-level computed) changes upstream. Pins the wake-gap fix from the
 * 2026-08-15 investigation:
 * `computed:`-prefixed bindings in list templates were classified as
 * dependency-free in ListRenderer._computeDeps, so the tracking-frame walk
 * never evaluated them, no graph edges formed, and the upstream computed sat
 * DIRTY with zero observers forever. Unprefixed spellings and class bindings
 * classified correctly, which hid the gap.
 *
 * Fixture shape shared by most tests: component state { items, loaded:false },
 * component computed reading `loaded`, item computed reading that computed,
 * and a finish() action that flips `loaded`. The DOM must change after finish().
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 100) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('List rows wake on upstream computed changes', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    // Registers the component, renders, asserts the pre-change DOM via
    // check(pre=true), flips state, asserts the post-change DOM.
    async function mountAndFinish(name, definition, html) {
        wildflower.component(name, definition)
        testContainer.innerHTML = html
        wildflower.scan(testContainer)
        await waitForUpdate()
        const el = testContainer.querySelector('[data-component]')
        const comp = wildflower.componentInstances.get(el.dataset.componentId)
        return comp
    }

    const baseDefinition = () => ({
        state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
        computed: {
            avatars() {
                return this.state.loaded ? { 1: 'ada.png', 2: 'grace.png' } : null
            },
            avatarFor(item) {
                const all = this.avatars
                return all ? all[item.id] : 'pending'
            }
        },
        finish() { this.state.loaded = true }
    })

    const rowTexts = () => Array.from(testContainer.querySelectorAll('li, li span.t')).length
    const texts = (sel) => Array.from(testContainer.querySelectorAll(sel)).map(n => n.textContent)

    it('root text binding data-bind="computed:X" re-renders on upstream change', async () => {
        const comp = await mountAndFinish('wake-root-prefixed', baseDefinition(), `
            <div data-component="wake-root-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li data-bind="computed:avatarFor"></li></template>
                </ul>
            </div>
        `)
        expect(texts('li')).toEqual(['pending', 'pending'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('li')).toEqual(['ada.png', 'grace.png'])
    })

    it('nested text binding data-bind="computed:X" re-renders on upstream change', async () => {
        const comp = await mountAndFinish('wake-nested-prefixed', baseDefinition(), `
            <div data-component="wake-nested-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
    })

    it('mixed template (prefixed computed + flat item prop) re-renders — the fast-touch route', async () => {
        // Second failure route: with a flat item-prop binding present, the
        // template used to classify fast-touch eligible (skip deps are
        // invisible), so walkRowDeps never ran at all for these rows.
        const def = baseDefinition()
        def.state.items = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
        const comp = await mountAndFinish('wake-mixed', def, `
            <div data-component="wake-mixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span><span class="n" data-bind="name"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        expect(texts('.n')).toEqual(['one', 'two'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
        // Item-field reactivity must survive the reclassification.
        comp.state.items[0].name = 'uno'
        await waitForUpdate()
        expect(texts('.n')).toEqual(['uno', 'two'])
    })

    it('PIN: unprefixed data-bind="X" keeps re-rendering on upstream change', async () => {
        const comp = await mountAndFinish('wake-unprefixed', baseDefinition(), `
            <div data-component="wake-unprefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
    })

    it('PIN: class binding data-bind-class="computed:X" keeps re-rendering', async () => {
        const def = baseDefinition()
        def.computed.rowClass = function (item) {
            const all = this.avatars
            return all ? 'loaded-' + item.id : 'row-pending'
        }
        const comp = await mountAndFinish('wake-class-prefixed', def, `
            <div data-component="wake-class-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li data-bind-class="computed:rowClass"></li></template>
                </ul>
            </div>
        `)
        let classes = Array.from(testContainer.querySelectorAll('li')).map(li => li.className)
        expect(classes).toEqual(['row-pending', 'row-pending'])
        comp.context.finish()
        await waitForUpdate()
        classes = Array.from(testContainer.querySelectorAll('li')).map(li => li.className)
        expect(classes).toEqual(['loaded-1', 'loaded-2'])
    })

    it('zero-arg component computed as data-bind="computed:X" in a row re-renders', async () => {
        const comp = await mountAndFinish('wake-zeroarg-prefixed', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                header() { return this.state.loaded ? 'ready' : 'waiting' }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-zeroarg-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="h" data-bind="computed:header"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.h')).toEqual(['waiting', 'waiting'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.h')).toEqual(['ready', 'ready'])
    })

    it('nested data-show="computed:X" re-evaluates on upstream change', async () => {
        const comp = await mountAndFinish('wake-show-prefixed', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                isUnlocked() { return this.state.loaded }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-show-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="s" data-show="computed:isUnlocked">unlocked</span></li></template>
                </ul>
            </div>
        `)
        const visible = () => Array.from(testContainer.querySelectorAll('.s'))
            .filter(n => n.style.display !== 'none').length
        expect(visible()).toBe(0)
        comp.context.finish()
        await waitForUpdate()
        expect(visible()).toBe(2)
    })

    it('root data-show="computed:X" re-evaluates on upstream change', async () => {
        const comp = await mountAndFinish('wake-rootshow-prefixed', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                isUnlocked() { return this.state.loaded }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-rootshow-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li data-show="computed:isUnlocked">row</li></template>
                </ul>
            </div>
        `)
        const visible = () => Array.from(testContainer.querySelectorAll('li'))
            .filter(n => n.style.display !== 'none').length
        expect(visible()).toBe(0)
        comp.context.finish()
        await waitForUpdate()
        expect(visible()).toBe(2)
    })

    it('nested data-bind-html="computed:X" re-renders on upstream change', async () => {
        const comp = await mountAndFinish('wake-html-prefixed', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                banner() { return this.state.loaded ? '<b>done</b>' : '<i>busy</i>' }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-html-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="b" data-bind-html="computed:banner"></span></li></template>
                </ul>
            </div>
        `)
        expect(testContainer.querySelectorAll('.b i').length).toBe(2)
        comp.context.finish()
        await waitForUpdate()
        expect(testContainer.querySelectorAll('.b b').length).toBe(2)
    })

    it('nested data-render="computed:X" re-evaluates on upstream change', async () => {
        const comp = await mountAndFinish('wake-render-prefixed', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                isUnlocked() { return this.state.loaded }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-render-prefixed">
                <ul data-list="items" data-key="id">
                    <template><li><span class="r" data-render="computed:isUnlocked">rendered</span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.r').filter(t => t === 'rendered').length).toBe(0)
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.r').filter(t => t === 'rendered').length).toBe(2)
    })

    it('a two-level computed chain wakes rows (item computed -> A -> B -> state)', async () => {
        const comp = await mountAndFinish('wake-chain', {
            state: { items: [{ id: 1 }, { id: 2 }], loaded: false },
            computed: {
                flag() { return this.state.loaded },
                avatars() { return this.flag ? { 1: 'ada.png', 2: 'grace.png' } : null },
                avatarFor(item) {
                    const all = this.avatars
                    return all ? all[item.id] : 'pending'
                }
            },
            finish() { this.state.loaded = true }
        }, `
            <div data-component="wake-chain">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        comp.context.finish()
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
    })

    it('an item computed reading a store-backed component computed wakes rows', async () => {
        wildflower.store('wakeAvatarStore', {
            state: { loaded: false },
            unlock() { this.loaded = true }
        })
        const comp = await mountAndFinish('wake-store-chain', {
            subscribe: ['wakeAvatarStore'],
            state: { items: [{ id: 1 }, { id: 2 }] },
            computed: {
                avatars() {
                    return this.stores.wakeAvatarStore.loaded ? { 1: 'ada.png', 2: 'grace.png' } : null
                },
                avatarFor(item) {
                    const all = this.avatars
                    return all ? all[item.id] : 'pending'
                }
            }
        }, `
            <div data-component="wake-store-chain">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        wildflower.getStore('wakeAvatarStore').unlock()
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
    })

    it('an async upstream computed wakes rows when it lands (v1.5)', async () => {
        let resolveAvatars = null
        const comp = await mountAndFinish('wake-async-chain', {
            state: { items: [{ id: 1 }, { id: 2 }] },
            computed: {
                avatars() {
                    return new Promise(resolve => { resolveAvatars = resolve })
                },
                avatarFor(item) {
                    const all = this.avatars
                    return all ? all[item.id] : 'pending'
                }
            }
        }, `
            <div data-component="wake-async-chain">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        expect(texts('.v')).toEqual(['pending', 'pending'])
        resolveAvatars({ 1: 'ada.png', 2: 'grace.png' })
        await waitForUpdate()
        expect(texts('.v')).toEqual(['ada.png', 'grace.png'])
    })

    it('rows added after the initial render also wake on upstream change', async () => {
        const comp = await mountAndFinish('wake-late-row', baseDefinition(), `
            <div data-component="wake-late-row">
                <ul data-list="items" data-key="id">
                    <template><li><span class="v" data-bind="computed:avatarFor"></span></li></template>
                </ul>
            </div>
        `)
        comp.state.items.push({ id: 2 + 1 })
        await waitForUpdate()
        expect(texts('.v')).toEqual(['pending', 'pending', 'pending'])
        comp.context.finish()
        await waitForUpdate()
        // id 3 has no avatar entry; the computed maps it to undefined -> ''
        expect(texts('.v').slice(0, 2)).toEqual(['ada.png', 'grace.png'])
    })
})
