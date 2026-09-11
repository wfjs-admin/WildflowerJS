/**
 * @vitest-environment browser
 *
 * Async computeds (v1.5): a computed may return a Promise. The binding keeps
 * serving the previous value while a request is in flight and updates when it
 * lands.
 *
 * The design leans on one pre-existing behavior, pinned first below:
 * data-bind="user.name" with `user` undefined renders empty, never throws.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

// Plugins are stripped from lite/mini/nano builds; the plugin-parity case
// only runs where the plugin system exists.
const itIfPlugins = hasFeature('plugins') ? it : it.skip

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan(testContainer)
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('Async computeds', () => {
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

    describe('Pinned assumption: undefined head renders empty', () => {
        it('renders empty for data-bind="user.name" when user is undefined state', async () => {
            wildflower.component('pin-undef-state', {
                state: { user: undefined }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="pin-undef-state">
                    <span id="pin-target-1" data-bind="user.name"></span>
                </div>
            `)

            expect(component).not.toBeNull()
            const el = testContainer.querySelector('#pin-target-1')
            expect(el).not.toBeNull()
            expect(el.textContent).toBe('')
        })

        it('renders empty for data-bind="user.name" when user is a computed returning undefined', async () => {
            wildflower.component('pin-undef-computed', {
                state: {},
                computed: {
                    user() { return undefined }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="pin-undef-computed">
                    <span id="pin-target-2" data-bind="user.name"></span>
                </div>
            `)

            expect(component).not.toBeNull()
            const el = testContainer.querySelector('#pin-target-2')
            expect(el).not.toBeNull()
            expect(el.textContent).toBe('')
        })
    })

    describe('Basic resolution', () => {
        it('shows empty before resolution, the resolved value after', async () => {
            let resolveUser
            const userPromise = new Promise(resolve => { resolveUser = resolve })

            wildflower.component('async-basic', {
                state: {},
                computed: {
                    user() { return userPromise }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="async-basic">
                    <span id="async-target-1" data-bind="user.name"></span>
                </div>
            `)

            expect(component).not.toBeNull()
            const el = testContainer.querySelector('#async-target-1')
            expect(el).not.toBeNull()

            // In flight: no previous value, so the binding renders empty.
            expect(el.textContent).toBe('')

            resolveUser({ name: 'Ada' })
            await waitForUpdate()

            expect(el.textContent).toBe('Ada')
        })

        it('resolves an immediately-resolved promise', async () => {
            wildflower.component('async-resolved', {
                state: {},
                computed: {
                    user() { return Promise.resolve({ name: 'Ada' }) }
                }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="async-resolved">
                    <span id="async-target-2" data-bind="user.name"></span>
                </div>
            `)

            const el = testContainer.querySelector('#async-target-2')
            expect(el).not.toBeNull()
            await waitForUpdate()
            expect(el.textContent).toBe('Ada')
        })
    })

    describe('Previous value held during refresh', () => {
        it('keeps serving the last good value while a new request is in flight', async () => {
            const resolvers = {}

            wildflower.component('async-hold', {
                state: { userId: 1 },
                computed: {
                    user() {
                        const id = this.state.userId
                        return new Promise(resolve => { resolvers[id] = resolve })
                    }
                },
                bump() { this.state.userId = 2 }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="async-hold">
                    <span id="hold-target" data-bind="user.name"></span>
                    <button id="hold-btn" data-action="bump">bump</button>
                </div>
            `)

            const el = testContainer.querySelector('#hold-target')
            expect(el.textContent).toBe('')

            resolvers[1]({ name: 'Ada' })
            await waitForUpdate()
            expect(el.textContent).toBe('Ada')

            // Change the input: a new request launches, the old value stays
            // on screen (no loading state over real content).
            testContainer.querySelector('#hold-btn').click()
            await waitForUpdate()
            expect(el.textContent).toBe('Ada')

            resolvers[2]({ name: 'Bob' })
            await waitForUpdate()
            expect(el.textContent).toBe('Bob')
        })
    })

    describe('Supersession: last call wins', () => {
        it('discards a superseded request even when it resolves later', async () => {
            const resolvers = {}

            wildflower.component('async-supersede', {
                state: { userId: 1 },
                computed: {
                    user() {
                        const id = this.state.userId
                        return new Promise(resolve => { resolvers[id] = resolve })
                    }
                },
                bump() { this.state.userId = 2 }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="async-supersede">
                    <span id="sup-target" data-bind="user.name"></span>
                    <button id="sup-btn" data-action="bump">bump</button>
                </div>
            `)

            const el = testContainer.querySelector('#sup-target')

            // Supersede request 1 before it resolves.
            testContainer.querySelector('#sup-btn').click()
            await waitForUpdate()
            expect(el.textContent).toBe('')

            // The newer request resolves first and lands.
            resolvers[2]({ name: 'Bob' })
            await waitForUpdate()
            expect(el.textContent).toBe('Bob')

            // The stale request resolves late: discarded silently.
            resolvers[1]({ name: 'Ada' })
            await waitForUpdate()
            expect(el.textContent).toBe('Bob')
        })
    })

    describe('Rejection', () => {
        it('routes a rejection to onError and surfaces undefined', async () => {
            const onErrorCalls = []
            let rejectUser

            wildflower.component('async-reject', {
                state: {},
                computed: {
                    user() { return new Promise((_r, reject) => { rejectUser = reject }) }
                },
                onError(error, context) {
                    onErrorCalls.push({ error, context })
                    return true
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="async-reject">
                    <span id="rej-target" data-bind="user.name"></span>
                </div>
            `)

            const el = testContainer.querySelector('#rej-target')
            expect(el.textContent).toBe('')

            rejectUser(new Error('backend down'))
            await waitForUpdate()

            expect(el.textContent).toBe('')
            expect(component.context.computed.user).toBeUndefined()
            expect(onErrorCalls.length).toBe(1)
            expect(onErrorCalls[0].error.message).toBe('backend down')
            expect(onErrorCalls[0].context.lifecycle).toBe('computed')
            // `computedName` sits in mangle-properties.json, so minified builds
            // rename the key in the onError context — for sync computed errors
            // (ComponentLifecycle) exactly as for this async path. Pre-existing
            // behavior; assert the readable key on unminified builds only.
            if (!isMinifiedBuild()) {
                expect(onErrorCalls[0].context.computedName).toBe('user')
            }
        })

        it('a later successful run recovers from a rejection', async () => {
            const settlers = {}

            wildflower.component('async-recover', {
                state: { userId: 1 },
                computed: {
                    user() {
                        const id = this.state.userId
                        return new Promise((resolve, reject) => { settlers[id] = { resolve, reject } })
                    }
                },
                onError() { return true },
                bump() { this.state.userId = 2 }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="async-recover">
                    <span id="rec-target" data-bind="user.name"></span>
                    <button id="rec-btn" data-action="bump">bump</button>
                </div>
            `)

            const el = testContainer.querySelector('#rec-target')
            settlers[1].reject(new Error('first load failed'))
            await waitForUpdate()
            expect(el.textContent).toBe('')

            testContainer.querySelector('#rec-btn').click()
            await waitForUpdate()
            settlers[2].resolve({ name: 'Ada' })
            await waitForUpdate()
            expect(el.textContent).toBe('Ada')
        })
    })

    describe('Entity parity: stores and plugins', () => {
        it('a store async computed resolves through the same facade', async () => {
            let resolveUser = null

            wildflower.store('asyncUsers', {
                state: {},
                computed: {
                    user() { return new Promise(resolve => { resolveUser = resolve }) }
                }
            })

            const store = wildflower.getStore('asyncUsers')
            expect(store.user).toBeUndefined()

            resolveUser({ name: 'Grace' })
            await waitForUpdate()

            expect(store.user).toEqual({ name: 'Grace' })
        })

        it('a component binding to a store async computed updates on resolution', async () => {
            let resolveUser = null

            wildflower.store('asyncProfile', {
                state: {},
                computed: {
                    user() { return new Promise(resolve => { resolveUser = resolve }) }
                }
            })

            wildflower.component('store-reader', {
                subscribe: ['asyncProfile'],
                state: {},
                computed: {
                    userName() {
                        const u = this.stores.asyncProfile.user
                        return u ? u.name : ''
                    }
                }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="store-reader">
                    <span id="store-target" data-bind="userName"></span>
                </div>
            `)

            const el = testContainer.querySelector('#store-target')
            expect(el.textContent).toBe('')

            resolveUser({ name: 'Grace' })
            await waitForUpdate()

            expect(el.textContent).toBe('Grace')
        })

        itIfPlugins('a plugin async computed resolves through the same facade', async () => {
            let resolveInfo = null

            wildflower.plugin({
                name: 'asyncMeta',
                state: {},
                computed: {
                    info() { return new Promise(resolve => { resolveInfo = resolve }) }
                },
                install() {}
            })

            const plugin = wildflower.$asyncMeta
            expect(plugin).toBeDefined()
            expect(plugin.info).toBeUndefined()

            resolveInfo({ version: 7 })
            await waitForUpdate()

            expect(plugin.info).toEqual({ version: 7 })
        })
    })

    describe('Docs pattern: list rows derived from an async collection', () => {
        // The WF-235 guidance (and the async-computed docs page) recommends
        // fetching the collection once at component level and DERIVING the row
        // array from it in a component-level computed, so the landing rides
        // normal computed chaining into the keyed list reconciler. (An
        // item-level computed reading an async component-level computed also
        // wakes its rows on landing — pinned in list-item-computed-wake — so
        // this derived-array shape is a preference, not a workaround.)
        it('a derived row array re-renders the list when the collection lands', async () => {
            let resolveAvatars = null

            wildflower.component('async-rows', {
                state: { items: [{ id: 1 }, { id: 2 }] },
                computed: {
                    avatars() {
                        return new Promise(resolve => { resolveAvatars = resolve })
                    },
                    rows() {
                        const all = this.avatars || {}
                        return this.state.items.map(i => ({ id: i.id, avatar: all[i.id] || 'pending' }))
                    }
                }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="async-rows">
                    <ul data-list="rows" data-key="id">
                        <template><li data-bind="avatar"></li></template>
                    </ul>
                </div>
            `)

            const rows = () => Array.from(testContainer.querySelectorAll('li')).map(li => li.textContent)
            expect(rows()).toEqual(['pending', 'pending'])

            resolveAvatars({ 1: 'ada.png', 2: 'grace.png' })
            await waitForUpdate(100)

            expect(rows()).toEqual(['ada.png', 'grace.png'])
        })
    })

    describe('Watcher-observed computed while in flight', () => {
        it('does not re-fire the body on forced recomputes while a request is in flight', async () => {
            let bodyRuns = 0
            let resolveUser = null
            const watched = []

            wildflower.component('async-watch', {
                state: {},
                computed: {
                    user() {
                        bodyRuns++
                        return new Promise(resolve => { resolveUser = resolve })
                    }
                },
                watch: {
                    user(newVal) { watched.push(newVal) }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="async-watch">
                    <span id="watch-target" data-bind="user.name"></span>
                </div>
            `)

            expect(bodyRuns).toBe(1)

            // The framework's nudge paths (store subscription changes, props
            // refresh) force-dirty every computed and re-evaluate. While a
            // request is in flight that must NOT re-fire the body.
            const sm = component.stateManager
            sm.scheduleComputedEvaluation('user')
            sm.scheduleComputedEvaluation('user')
            await waitForUpdate()
            expect(bodyRuns).toBe(1)

            const el = testContainer.querySelector('#watch-target')
            expect(el.textContent).toBe('')

            resolveUser({ name: 'Ada' })
            await waitForUpdate()

            expect(el.textContent).toBe('Ada')
            expect(watched).toContainEqual({ name: 'Ada' })
            // Resolution consumed the settled value without re-invoking the body.
            expect(bodyRuns).toBe(1)
        })
    })
})
