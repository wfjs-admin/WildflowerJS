/**
 * data-wf-component roots on the two scan paths that do not go through
 * wildflower.scan().
 *
 * wf-prefix.test.js proves the prefixed root works when wildflower.scan()
 * runs. A page that loads the framework from a <script> tag never calls
 * scan(): the auto-init path is _scanForComponentsAsync, and a component
 * registered after init is picked up by _initializeComponentElements. Both
 * resolved the component name from the bare data-component attribute only,
 * so a data-wf-component root rendered nothing on a plain page even though
 * the same markup worked after a manual scan.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

async function waitFor(cond, timeout = 5000) {
    const start = performance.now()
    while (!cond()) {
        if (performance.now() - start > timeout) return false
        await new Promise(r => setTimeout(r, 20))
    }
    return true
}

describe('data-wf-component on the non-scan() paths', () => {
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

    it('initial page-load scan initializes a data-wf-component root', async () => {
        wildflower.component('wf-initial-counter', {
            state: { count: 0 },
            increment() { this.count++ }
        })

        testContainer.innerHTML = `
            <div data-wf-component="wf-initial-counter">
                <span class="count" data-wf-bind="count"></span>
                <button data-wf-action="increment">+</button>
            </div>`

        await wildflower._scanForComponentsAsync()

        const root = testContainer.firstElementChild
        const rendered = await waitFor(() => root.querySelector('.count').textContent === '0')
        expect(rendered, 'bound text never rendered on the initial scan').toBe(true)
        expect(root.hasAttribute('data-component-id')).toBe(true)

        root.querySelector('button').click()
        const updated = await waitFor(() => root.querySelector('.count').textContent === '1')
        expect(updated).toBe(true)
    })

    it('a component registered after init picks up a data-wf-component root already in the DOM', async () => {
        testContainer.innerHTML = `
            <div data-wf-component="wf-late-counter">
                <span class="count" data-wf-bind="count"></span>
            </div>`

        expect(wildflower._hasInitialized, 'test assumes the framework has initialized').toBe(true)

        wildflower.component('wf-late-counter', {
            state: { count: 5 }
        })

        const root = testContainer.firstElementChild
        const rendered = await waitFor(() => root.querySelector('.count').textContent === '5')
        expect(rendered, 'late registration never initialized the prefixed root').toBe(true)
        expect(root.hasAttribute('data-component-id')).toBe(true)
    })

    it('the same two paths still initialize a plain data-component root', async () => {
        wildflower.component('plain-initial-counter', { state: { count: 0 } })
        testContainer.innerHTML = `
            <div data-component="plain-initial-counter"><span class="count" data-bind="count"></span></div>
            <div data-component="plain-late-counter"><span class="count" data-bind="count"></span></div>`

        await wildflower._scanForComponentsAsync()
        wildflower.component('plain-late-counter', { state: { count: 9 } })

        const [first, second] = testContainer.children
        expect(await waitFor(() => first.querySelector('.count').textContent === '0')).toBe(true)
        expect(await waitFor(() => second.querySelector('.count').textContent === '9')).toBe(true)
    })

    // The rest of the file covers the other places that read a component
    // boundary or a binding attribute under the bare prefix only.

    it('a data-wf-component added to the page later initializes without a manual scan', async () => {
        wildflower.component('wf-observed-counter', { state: { count: 3 } })

        // Direct child: the observer's fast path (attribute on the added node).
        const direct = document.createElement('div')
        direct.setAttribute('data-wf-component', 'wf-observed-counter')
        direct.innerHTML = '<span class="count" data-wf-bind="count"></span>'
        testContainer.appendChild(direct)

        // Wrapped: the slow path (querySelector inside the added node).
        const wrapper = document.createElement('div')
        wrapper.innerHTML = '<div data-wf-component="wf-observed-counter"><span class="count" data-wf-bind="count"></span></div>'
        testContainer.appendChild(wrapper)

        expect(await waitFor(() => direct.querySelector('.count').textContent === '3'), 'direct child').toBe(true)
        expect(await waitFor(() => wrapper.querySelector('.count').textContent === '3'), 'wrapped child').toBe(true)
    })

    it('emit() reaches a data-wf-component parent', async () => {
        let received = null
        wildflower.component('wf-emit-parent', {
            state: {},
            onPing(detail) { received = detail }
        })
        wildflower.component('wf-emit-child', {
            state: {},
            send() { this.emit('ping', { n: 1 }) }
        })
        testContainer.innerHTML = `
            <div data-wf-component="wf-emit-parent">
                <div data-wf-component="wf-emit-child"><button data-wf-action="send">go</button></div>
            </div>`
        wildflower.scan()
        expect(await waitFor(() => testContainer.querySelectorAll('[data-component-id]').length === 2)).toBe(true)

        testContainer.querySelector('button').click()
        expect(await waitFor(() => received !== null && received.n === 1), 'parent never received the emit').toBe(true)
    })

    it('a data-wf-component nested in a list row owns its own bindings and actions', async () => {
        let outerHits = 0
        let innerHits = 0
        wildflower.component('wf-row-host', {
            state: { rows: [{ id: 1, label: 'row one' }] },
            hit() { outerHits++ }
        })
        wildflower.component('wf-row-child', {
            state: { label: 'child label' },
            hit() { innerHits++ }
        })
        testContainer.innerHTML = `
            <div data-wf-component="wf-row-host">
                <ul data-wf-list="rows" data-wf-key="id">
                    <template>
                        <li>
                            <span class="row-label" data-wf-bind="label"></span>
                            <div data-wf-component="wf-row-child">
                                <span class="child-label" data-wf-bind="label"></span>
                                <button class="inner" data-wf-action="hit">inner</button>
                            </div>
                        </li>
                    </template>
                </ul>
            </div>`
        wildflower.scan()

        expect(await waitFor(() => testContainer.querySelector('.row-label')?.textContent === 'row one')).toBe(true)
        expect(await waitFor(() => testContainer.querySelector('.child-label')?.textContent === 'child label'),
            'the nested component\'s bind read the row instead of its own state').toBe(true)

        testContainer.querySelector('.inner').click()
        expect(await waitFor(() => innerHits === 1), 'nested component never received its action').toBe(true)
        await new Promise(r => setTimeout(r, 60))
        expect(outerHits, 'the list host handled an action that belongs to the nested component').toBe(0)
    })

    // The portal system is stripped from lite and below, so this one test has
    // nothing to teleport there and timed out on those lanes. The rest of the
    // file is prefix behavior every tier carries.
    it.skipIf(!hasFeature('portals'))('portaled content honors data-wf-bind and data-wf-action', async () => {
        let hits = 0
        wildflower.component('wf-portal-host', {
            state: { msg: 'from host' },
            hit() { hits++ }
        })
        const target = document.createElement('div')
        target.id = 'wf-portal-target'
        document.body.appendChild(target)
        try {
            testContainer.innerHTML = `
                <div data-wf-component="wf-portal-host">
                    <div data-wf-portal="#wf-portal-target">
                        <span class="msg" data-wf-bind="msg"></span>
                        <button class="go" data-wf-action="hit">go</button>
                    </div>
                </div>`
            wildflower.scan()

            expect(await waitFor(() => target.querySelector('.msg')?.textContent === 'from host'),
                'portaled data-wf-bind never rendered').toBe(true)
            target.querySelector('.go').click()
            expect(await waitFor(() => hits === 1), 'portaled data-wf-action never fired').toBe(true)
        } finally {
            target.remove()
        }
    })
})
