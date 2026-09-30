/**
 * Every author attribute honours the data-wf- prefix.
 *
 * The prefix helpers (_getAttr / _hasAttr / _attrSelector) let an author write
 * data-X or data-wf-X, and in exclusive mode (data-wf-prefix="true" on the
 * script tag, or setWfPrefixMode(true)) only data-wf-X. These tests pin the
 * attributes that were read as plain data-X only: modifiers, validation,
 * persistence, error fallbacks, slots, transitions, key filters, templates,
 * custom directives and router opt-outs. Each runs in exclusive mode, where
 * the data-wf- form must work and the plain form must be ignored.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForUpdate, waitForCompleteRender } from './helpers/load-framework.js'

const itIfTransitions = hasFeature('transitions') ? it : it.skip
const itIfLists = hasFeature('lists') ? it : it.skip
const itIfRouter = hasFeature('router') ? it : it.skip

function key(type, k) {
    return new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })
}

describe('data-wf- prefix: every author attribute', () => {
    let wildflower
    let testContainer

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.style.position = 'absolute'
        testContainer.style.left = '-9999px'
        document.body.appendChild(testContainer)
        wildflower.setWfPrefixMode(true)
    })

    afterEach(() => {
        wildflower.setWfPrefixMode(false)
        testContainer.remove()
    })

    const instanceOf = (name) => {
        const el = testContainer.querySelector(`[data-wf-component="${name}"]`)
        return wildflower.componentInstances.get(el.getAttribute('data-component-id'))
    }
    const type = async (input, value, evt = 'input') => {
        input.value = value
        input.dispatchEvent(new Event(evt, { bubbles: true }))
        await waitForUpdate()
    }

    describe('data-model modifiers', () => {
        it('data-wf-model-number converts to a number', async () => {
            wildflower.component('wfp-number', { state: { price: 0 } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-number">
                    <input data-wf-model="price" data-wf-model-number>
                </div>`
            wildflower.scan()
            await waitForCompleteRender()
            await type(testContainer.querySelector('input'), '42')
            expect(instanceOf('wfp-number').state.price).toBe(42)
        })

        it('a plain data-model-number is ignored in exclusive mode', async () => {
            wildflower.component('wfp-number-plain', { state: { price: 0 } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-number-plain">
                    <input data-wf-model="price" data-model-number>
                </div>`
            wildflower.scan()
            await waitForCompleteRender()
            await type(testContainer.querySelector('input'), '42')
            expect(instanceOf('wfp-number-plain').state.price).toBe('42')
        })

        it('data-wf-model-trim trims the value', async () => {
            wildflower.component('wfp-trim', { state: { name: '' } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-trim">
                    <input data-wf-model="name" data-wf-model-trim>
                </div>`
            wildflower.scan()
            await waitForCompleteRender()
            await type(testContainer.querySelector('input'), '  Ada  ')
            expect(instanceOf('wfp-trim').state.name).toBe('Ada')
        })

        it('data-wf-model-lazy syncs on change, not on input', async () => {
            wildflower.component('wfp-lazy', { state: { name: '' } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-lazy">
                    <input data-wf-model="name" data-wf-model-lazy>
                </div>`
            wildflower.scan()
            await waitForCompleteRender()
            const input = testContainer.querySelector('input')
            await type(input, 'typed')
            expect(instanceOf('wfp-lazy').state.name).toBe('')
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()
            expect(instanceOf('wfp-lazy').state.name).toBe('typed')
        })
    })

    describe('data-event-key- filters', () => {
        it('data-wf-event-key-enter fires on Enter only', async () => {
            wildflower.component('wfp-key', { state: { n: 0 }, submit() { this.state.n++ } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-key">
                    <input data-wf-action="keyup:submit" data-wf-event-key-enter>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            const input = testContainer.querySelector('input')
            input.dispatchEvent(key('keyup', 'a'))
            await waitForUpdate()
            expect(instanceOf('wfp-key').state.n).toBe(0)
            input.dispatchEvent(key('keyup', 'Enter'))
            await waitForUpdate()
            expect(instanceOf('wfp-key').state.n).toBe(1)
        })

        it('a plain data-event-key-enter is ignored in exclusive mode (every key fires)', async () => {
            wildflower.component('wfp-key-plain', { state: { n: 0 }, submit() { this.state.n++ } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-key-plain">
                    <input data-wf-action="keyup:submit" data-event-key-enter>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            testContainer.querySelector('input').dispatchEvent(key('keyup', 'a'))
            await waitForUpdate()
            expect(instanceOf('wfp-key-plain').state.n).toBe(1)
        })
    })

    describe('form validation', () => {
        it('data-wf-validate-on and data-wf-error-for block the submit and show the error', async () => {
            let submitted = false
            wildflower.component('wfp-validate', { state: { username: '' }, handleSubmit() { submitted = true } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-validate">
                    <form data-wf-validate-on="submit" data-wf-action="handleSubmit" novalidate>
                        <input type="text" data-wf-model="username" required>
                        <span id="err" data-wf-error-for="username"></span>
                        <button type="submit">Go</button>
                    </form>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            testContainer.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(50)
            expect(submitted).toBe(false)
            expect(testContainer.querySelector('#err').textContent).not.toBe('')
        })
    })

    describe('state persistence', () => {
        it('data-wf-storage-key with data-wf-auto-save saves to localStorage', async () => {
            localStorage.removeItem('wfp-save')
            wildflower.component('wfp-storage', { state: { count: 0 } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-storage" data-wf-storage-key="wfp-save" data-wf-auto-save>
                    <span data-wf-bind="count"></span>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            instanceOf('wfp-storage').state.count = 42
            await waitForUpdate(100)
            const stored = localStorage.getItem('wfp-save')
            localStorage.removeItem('wfp-save')
            expect(stored).not.toBeNull()
            expect(JSON.parse(stored).count).toBe(42)
        })
    })

    describe('error boundaries', () => {
        it('data-wf-error-fallback shows the fallback when init throws', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wfp-fallback" data-wf-error-fallback=".fallback">
                    <div class="fallback" style="display:none">Something went wrong</div>
                </div>`
            wildflower.component('wfp-fallback', { state: {}, init() { throw new Error('boom') } })
            wildflower.scan()
            await waitForUpdate(100)
            expect(getComputedStyle(testContainer.querySelector('.fallback')).display).toBe('block')
        })
    })

    describe('slots', () => {
        it('data-wf-slot content moves into its data-wf-slot-container', async () => {
            wildflower.component('wfp-slot', { state: {} })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-slot">
                    <div data-wf-slot-container="main" id="target"></div>
                    <div data-wf-slot="main"><p>Projected</p></div>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            const p = testContainer.querySelector('#target p')
            expect(p && p.textContent).toBe('Projected')
        })
    })

    describe('transitions', () => {
        itIfTransitions('data-wf-transition applies its enter classes', async () => {
            wildflower.component('wfp-transition', { state: { on: false } })
            // A real CSS duration, or the classes come off at once
            testContainer.innerHTML = `
                <style>.fade-enter-active { transition: opacity 0.3s; } .fade-enter { opacity: 0; }</style>
                <div data-wf-component="wfp-transition">
                    <div id="t" data-wf-show="on" data-wf-transition="fade">Hi</div>
                </div>`
            wildflower.scan()
            await waitForCompleteRender()
            instanceOf('wfp-transition').state.on = true
            await waitForUpdate(20)
            const el = testContainer.querySelector('#t')
            expect(el.classList.contains('fade-enter') || el.classList.contains('fade-enter-active')).toBe(true)
        })
    })

    describe('templates', () => {
        itIfLists('data-wf-template-key picks a template per item type', async () => {
            wildflower.component('wfp-poly', { state: { rows: [{ id: 1, kind: 'a', t: 'A' }, { id: 2, kind: 'b', t: 'B' }] } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-poly">
                    <ul data-wf-list="rows" data-wf-key="id" data-wf-template-key="kind">
                        <template data-wf-type="a"><li class="is-a" data-wf-bind="t"></li></template>
                        <template data-wf-type="b"><li class="is-b" data-wf-bind="t"></li></template>
                    </ul>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            expect(testContainer.querySelectorAll('.is-a').length).toBe(1)
            expect(testContainer.querySelectorAll('.is-b').length).toBe(1)
        })
    })

    describe('custom directives', () => {
        it('a directive registered as "wfp-mark" runs on data-wf-wfp-mark', async () => {
            const seen = []
            wildflower.directive('wfp-mark', { init(el, value) { seen.push(value) } })
            wildflower.component('wfp-directive', { state: {} })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-directive">
                    <span data-wf-wfp-mark="yes"></span>
                    <span data-wfp-mark="plain"></span>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            expect(seen).toEqual(['yes'])
        })
    })

    describe('directive names', () => {
        it('a directive name starting "wf-" is refused (data-wf-X means directive X)', () => {
            expect(() => wildflower.directive('wf-thing', { init() {} })).toThrow(/wf-/)
        })
    })

    describe('portals inside list rows', () => {
        const itIfPortalsAndLists = hasFeature('portals') && hasFeature('lists') ? it : it.skip
        itIfPortalsAndLists('a data-wf-portal in a data-wf-list template moves each row\'s content', async () => {
            const target = document.createElement('div')
            target.id = 'wfp-portal-target'
            document.body.appendChild(target)
            try {
                testContainer.innerHTML = `
                    <div data-wf-component="wfp-portal-list">
                        <ul data-wf-list="items" data-wf-key="id">
                            <template>
                                <li>
                                    <div data-wf-portal="#wfp-portal-target">
                                        <div class="moved" data-wf-bind="name"></div>
                                    </div>
                                </li>
                            </template>
                        </ul>
                    </div>`
                wildflower.component('wfp-portal-list', { state: { items: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }] } })
                wildflower.scan()
                await waitForUpdate(100)
                const moved = target.querySelectorAll('.moved')
                expect(moved.length).toBe(2)
                expect(moved[0].textContent).toBe('One')
            } finally {
                target.remove()
            }
        })
    })

    describe('queries', () => {
        const itIfQuery = hasFeature('query') ? it : it.skip
        itIfQuery('exclusive mode leaves a bare data-query element untouched', async () => {
            wildflower.query('wfpThings', { from: () => Promise.resolve([{ id: 1, name: 'one' }]), key: 'id', refresh: ['once'] })
            wildflower.component('wfp-query', {})
            testContainer.innerHTML = `
                <div data-wf-component="wfp-query">
                    <ul id="ours" data-wf-query="wfpThings"><template><li data-wf-bind="name"></li></template></ul>
                    <ul id="theirs" data-query="wfpThings"><template><li data-bind="name"></li></template></ul>
                </div>`
            wildflower.scan()
            await waitForUpdate(150)
            expect(testContainer.querySelectorAll('#ours li').length).toBe(1)
            const theirs = testContainer.querySelector('#theirs')
            expect(theirs.hasAttribute('data-list')).toBe(false)
            expect(theirs.hasAttribute('data-key')).toBe(false)
            expect(theirs.hasAttribute('data-wf-list')).toBe(false)
        })
    })

    describe('store-backed lists', () => {
        itIfLists('a data-wf-list over a store follows the store', async () => {
            wildflower.store('wfpTodos', { state: { items: [{ id: 1, t: 'a' }] } })
            wildflower.component('wfp-store-list', { subscribe: { wfpTodos: [] } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-store-list">
                    <ul data-wf-list="$wfpTodos.items" data-wf-key="id"><template><li class="row" data-wf-bind="t"></li></template></ul>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            expect(testContainer.querySelectorAll('.row').length).toBe(1)
            wildflower.getStore('wfpTodos').items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
            await waitForUpdate(100)
            expect(testContainer.querySelectorAll('.row').length).toBe(2)
        })
    })

    describe('default mode (both forms read)', () => {
        it('the data-wf- form wins when an element carries both', async () => {
            wildflower.setWfPrefixMode(false)
            wildflower.component('wfp-both', { state: { a: 'plain', b: 'prefixed' } })
            testContainer.innerHTML = `
                <div data-component="wfp-both">
                    <span id="both" data-bind="a" data-wf-bind="b"></span>
                </div>`
            wildflower.scan()
            await waitForUpdate(100)
            expect(testContainer.querySelector('#both').textContent).toBe('prefixed')
        })
    })

    describe('server-rendered list rows', () => {
        const itIfSSR = hasFeature('ssr') ? it : it.skip
        itIfSSR('a hydrated row root keeps its data-wf-show verdict', async () => {
            wildflower.component('wfp-ssr-rows', { state: { rows: [] } })
            testContainer.innerHTML = `
                <div data-wf-component="wfp-ssr-rows" data-wf-ssr="true">
                    <ul data-wf-list="rows">
                        <template><li data-wf-show="open"><span data-wf-bind="name"></span></li></template>
                        <li data-wf-show="open" data-wf-seed='{"open": true}'><span data-wf-bind="name">Shown</span></li>
                        <li data-wf-show="open" data-wf-seed='{"open": false}'><span data-wf-bind="name">Hidden</span></li>
                    </ul>
                </div>`
            wildflower.scan()
            await waitForUpdate(150)
            const lis = testContainer.querySelectorAll('li')
            expect(lis.length).toBe(2)
            expect(getComputedStyle(lis[0]).display).not.toBe('none')
            expect(getComputedStyle(lis[1]).display).toBe('none')
        })
    })

    describe('router', () => {
        itIfRouter('data-wf-no-router lets a link through the router', () => {
            // Public surface only (min builds rename private methods): init()
            // installs the router's document click listener; a listener added
            // after it, on the same target and phase, sees whether the router
            // took the click (defaultPrevented).
            const router = new RouteManager({ mode: 'hash' })
            router.init()
            const seen = {}
            const spy = (e) => {
                const a = e.target.closest && e.target.closest('a')
                if (a) { seen[a.id] = e.defaultPrevented; e.preventDefault() }   // never actually navigate
            }
            document.addEventListener('click', spy)
            try {
                testContainer.innerHTML = `<a id="out" href="/elsewhere" data-wf-no-router>x</a><a id="in" href="/inside">y</a>`
                testContainer.querySelector('#out').click()
                testContainer.querySelector('#in').click()
                expect(seen.out).toBe(false)
                expect(seen.in).toBe(true)
            } finally {
                document.removeEventListener('click', spy)
                router.destroy()
                window.location.hash = ''
            }
        })
    })
})
