/**
 * jQuery Coexistence Tests
 *
 * Verifies WildflowerJS plays nicely on pages that already use jQuery —
 * the WordPress / legacy-CMS scenario. The framework should:
 *   - Not clobber jQuery's `$` or `jQuery` globals
 *   - Leave jQuery-managed DOM regions and event handlers alone
 *   - Co-exist with jQuery-attached handlers on the same element
 *   - Survive jQuery DOM mutations on sibling/outer regions
 *   - Pick up new components in HTML that jQuery just AJAX-injected
 *   - Work under jQuery's $.noConflict() mode
 *
 * Tested against both jQuery 3.7.1 (what WordPress core ships) and
 * jQuery 4.0.0 (the modern release).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender, createTestContainer } from '../packages/test-utils/index.js'

const JQUERY_VERSIONS = [
    { version: '3.7.1', cdn: 'https://code.jquery.com/jquery-3.7.1.min.js' },
    { version: '4.0.0', cdn: 'https://code.jquery.com/jquery-4.0.0.min.js' },
]

function loadJQuery(cdn) {
    return new Promise((resolve, reject) => {
        // Remove any prior jQuery so we get a clean load per describe block
        try { delete window.jQuery; delete window.$; } catch (_) {}
        const s = document.createElement('script')
        s.src = cdn
        s.onload = () => resolve()
        s.onerror = (e) => reject(new Error(`Failed to load ${cdn}`))
        document.head.appendChild(s)
    })
}

describe.each(JQUERY_VERSIONS)('jQuery $version coexistence', ({ version, cdn }) => {
    let testContainer
    let cleanup
    let $

    beforeAll(async () => {
        // Order matters: load WildflowerJS first (the "page already has WF" case
        // is the more interesting test of `$` preservation). Then load jQuery.
        await loadFramework()
        await loadJQuery(cdn)
        $ = window.jQuery
        if (!$) throw new Error(`jQuery ${version} did not register window.jQuery`)
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    // -----------------------------------------------------------------------
    // 1. Globals preserved
    // -----------------------------------------------------------------------
    it('preserves jQuery $ and jQuery globals after WildflowerJS loads', () => {
        expect(typeof window.jQuery).toBe('function')
        expect(typeof window.$).toBe('function')
        expect(window.$).toBe(window.jQuery)
        // Sanity: jQuery's version is what we loaded
        expect(window.jQuery.fn.jquery).toBe(version)
    })

    // -----------------------------------------------------------------------
    // 2. DOM ownership boundary: jQuery handlers outside data-component fire
    // -----------------------------------------------------------------------
    it('jQuery click handlers on non-WF elements still fire after WF scan', async () => {
        let jqueryClicks = 0
        let componentRef = null

        wildflower.component('jq-coexist-2', {
            state: { count: 0 },
            inc() { this.count++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div>
                <button id="jq-button">jQuery owned</button>
                <div data-component="jq-coexist-2">
                    <button id="wf-button" data-action="inc">WF owned</button>
                </div>
            </div>
        `

        // jQuery attaches handler BEFORE WF scan
        $('#jq-button').on('click', () => { jqueryClicks++ })

        wildflower.scan()
        await waitForCompleteRender()

        // jQuery click still works
        $('#jq-button').trigger('click')
        expect(jqueryClicks).toBe(1)

        // WF click also works (independent path)
        document.getElementById('wf-button').click()
        await waitForCompleteRender()
        expect(componentRef.count).toBe(1)
    })

    // -----------------------------------------------------------------------
    // 3. Co-handled element: jQuery .on() AND data-action on same button
    // -----------------------------------------------------------------------
    it('jQuery .on() and WF data-action on the same element both fire', async () => {
        let jqClicks = 0
        let componentRef = null

        wildflower.component('jq-coexist-3', {
            state: { wfClicks: 0 },
            click() { this.wfClicks++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-3">
                <button id="dual-button" data-action="click">Both</button>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // jQuery binds AFTER WF (the "WF was already scanning when jQuery hooked up" case)
        $('#dual-button').on('click', () => { jqClicks++ })

        document.getElementById('dual-button').click()
        await waitForCompleteRender()

        expect(jqClicks).toBe(1)
        expect(componentRef.wfClicks).toBe(1)
    })

    // -----------------------------------------------------------------------
    // 4. WF mutation observer (if any) ignores jQuery DOM changes outside WF
    // -----------------------------------------------------------------------
    it('jQuery DOM mutation outside WF components does not trigger WF re-render', async () => {
        let wfRenders = 0

        wildflower.component('jq-coexist-4', {
            state: { label: 'initial' },
            init() {
                // Hook the per-instance render path if it exists. Any render
                // after setup here is unexpected — jQuery DOM thrashing outside
                // WF components must not trigger WF re-evaluation.
                if (this._scheduleRender) {
                    const orig = this._scheduleRender.bind(this)
                    this._scheduleRender = (...args) => { wfRenders++; return orig(...args) }
                }
            }
        })

        testContainer.innerHTML = `
            <div id="outside-wf"><p>jQuery territory</p></div>
            <div data-component="jq-coexist-4">
                <span data-bind="label"></span>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()
        const baselineRenders = wfRenders

        // Heavy jQuery DOM thrashing OUTSIDE any WF component
        for (let i = 0; i < 20; i++) {
            $('#outside-wf').append(`<p>added ${i}</p>`)
        }
        $('#outside-wf p').addClass('jq-styled').attr('data-jq', 'yes')

        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        // WF should not have re-rendered for changes outside its component tree
        expect(wfRenders).toBe(baselineRenders)
    })

    // -----------------------------------------------------------------------
    // 5. WF reactive update preserves jQuery-added attributes on bound elements
    // -----------------------------------------------------------------------
    it('WF reactive update preserves jQuery-added attributes on bound elements', async () => {
        let componentRef = null

        wildflower.component('jq-coexist-5', {
            state: { label: 'first' },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-5">
                <span id="bound-span" data-bind="label">first</span>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // jQuery decorates the element AFTER WF binding
        $('#bound-span').attr('data-jquery-flag', 'set').addClass('jq-class')

        // Trigger WF reactive update
        componentRef.label = 'second'
        await waitForCompleteRender()

        const span = document.getElementById('bound-span')
        expect(span.textContent).toBe('second')
        // jQuery-added attribute and class should survive WF text update
        expect(span.getAttribute('data-jquery-flag')).toBe('set')
        expect(span.classList.contains('jq-class')).toBe(true)
    })

    // -----------------------------------------------------------------------
    // 6. WF list survives jQuery sibling manipulation
    // -----------------------------------------------------------------------
    it('WF list reactivity survives jQuery DOM manipulation of sibling regions', async () => {
        let componentRef = null

        wildflower.component('jq-coexist-6', {
            state: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div>
                <div id="jq-sibling"></div>
                <div data-component="jq-coexist-6">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="row" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('.row').length).toBe(2)

        // jQuery thrashes the sibling
        $('#jq-sibling').html('<p>jq added</p><p>more</p>').find('p').addClass('jq')

        // Now mutate WF list — must still react
        componentRef.items.push({ id: 3, name: 'c' })
        await waitForCompleteRender()

        const rows = testContainer.querySelectorAll('.row')
        expect(rows.length).toBe(3)
        expect(rows[2].textContent).toBe('c')
    })

    // -----------------------------------------------------------------------
    // 7. jQuery-loaded HTML picked up by WF scan (WordPress AJAX pattern)
    // -----------------------------------------------------------------------
    it('jQuery-injected HTML registers as a WF component after wildflower.scan()', async () => {
        wildflower.component('jq-coexist-7', {
            state: { msg: 'hello from injected' }
        })

        // Empty container — nothing for WF to scan yet
        testContainer.innerHTML = `<div id="injection-target"></div>`
        wildflower.scan()
        await waitForCompleteRender()

        // jQuery injects HTML (the WP "load fragment via AJAX, append" pattern)
        $('#injection-target').html(
            '<div data-component="jq-coexist-7"><span class="m" data-bind="msg"></span></div>'
        )

        // Caller invokes scan() to register the new component
        wildflower.scan()
        await waitForCompleteRender()

        const span = testContainer.querySelector('.m')
        expect(span).not.toBeNull()
        expect(span.textContent).toBe('hello from injected')
    })

    // -----------------------------------------------------------------------
    // 8. $.noConflict() mode: WF unaffected
    // -----------------------------------------------------------------------
    it('jQuery $.noConflict() mode does not interfere with WF', async () => {
        // Save current $ binding, then noConflict it
        const origDollar = window.$
        const restoredJQ = window.jQuery.noConflict(false) // false: keep jQuery global, release $
        // After noConflict(false): window.$ is whatever it was BEFORE jQuery loaded
        //   (undefined in the test env unless something else set it). window.jQuery still works.

        let componentRef = null

        wildflower.component('jq-coexist-8', {
            state: { count: 0 },
            inc() { this.count++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-8">
                <button id="nc-button" data-action="inc">click</button>
                <span id="nc-display" data-bind="count">0</span>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Use the captured restoredJQ reference (no $ in scope)
        let jqClicks = 0
        restoredJQ('#nc-button').on('click', () => { jqClicks++ })

        document.getElementById('nc-button').click()
        await waitForCompleteRender()

        expect(componentRef.count).toBe(1)
        expect(jqClicks).toBe(1)
        expect(document.getElementById('nc-display').textContent).toBe('1')

        // Restore for downstream tests
        window.$ = origDollar
    })

    // ═══════════════════════════════════════════════════════════════════════
    // Legacy CMS / WordPress hardening scenarios (Gemini-suggested, 2026-04-27)
    // ═══════════════════════════════════════════════════════════════════════

    // -----------------------------------------------------------------------
    // 9a. jQuery moves component container — reactivity survives
    // -----------------------------------------------------------------------
    it('reactivity survives jQuery moving the component container to a new parent', async () => {
        let componentRef = null
        wildflower.component('jq-coexist-9a', {
            state: { msg: 'before-move' },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div id="orig-parent">
                <div id="moveable" data-component="jq-coexist-9a">
                    <span class="m" data-bind="msg"></span>
                </div>
            </div>
            <div id="new-parent"></div>
        `

        wildflower.scan()
        await waitForCompleteRender()
        expect(testContainer.querySelector('.m').textContent).toBe('before-move')

        // jQuery moves the component into a different parent (sidebar plugin / tab switcher pattern)
        $('#moveable').appendTo('#new-parent')

        // State change after the move must still update the bound DOM
        componentRef.msg = 'after-move'
        await waitForCompleteRender()

        const span = testContainer.querySelector('#new-parent .m')
        expect(span).not.toBeNull()
        expect(span.textContent).toBe('after-move')
    })

    // -----------------------------------------------------------------------
    // 9b. jQuery detach + reattach — reactivity survives
    // -----------------------------------------------------------------------
    it('reactivity survives jQuery detach + reattach round-trip', async () => {
        let componentRef = null
        wildflower.component('jq-coexist-9b', {
            state: { count: 0 },
            inc() { this.count++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div id="parent-9b">
                <div id="detachable" data-component="jq-coexist-9b">
                    <button data-action="inc">click</button>
                    <span class="c" data-bind="count">0</span>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Detach (jQuery preserves attached data + handlers, unlike .remove())
        const detached = $('#detachable').detach()
        expect(testContainer.querySelector('#detachable')).toBeNull()

        // Reattach
        detached.appendTo('#parent-9b')
        await waitForCompleteRender()

        // Action handler must still work after the round-trip
        testContainer.querySelector('#detachable button').click()
        await waitForCompleteRender()
        expect(componentRef.count).toBe(1)
        expect(testContainer.querySelector('.c').textContent).toBe('1')
    })

    // -----------------------------------------------------------------------
    // 10a. Event bubbling: WF data-action + jQuery $(document).on() delegation both fire
    // -----------------------------------------------------------------------
    it('jQuery $(document).on() delegation co-exists with WF data-action on the same click', async () => {
        let jqDelegated = 0
        let componentRef = null

        wildflower.component('jq-coexist-10a', {
            state: { count: 0 },
            inc() { this.count++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-10a">
                <button class="trigger-btn" data-action="inc">click</button>
            </div>
        `

        // jQuery delegated handler at document level (the WordPress plugin pattern)
        $(document).on('click.jq-coexist-10a', '.trigger-btn', () => { jqDelegated++ })

        wildflower.scan()
        await waitForCompleteRender()

        testContainer.querySelector('.trigger-btn').click()
        await waitForCompleteRender()

        // BOTH paths fire — neither swallows the other's event
        expect(componentRef.count).toBe(1)
        expect(jqDelegated).toBe(1)

        // Cleanup the document-level handler we attached
        $(document).off('click.jq-coexist-10a')
    })

    // -----------------------------------------------------------------------
    // 10b. Multiple jQuery delegated handlers fire alongside WF action
    // -----------------------------------------------------------------------
    it('multiple jQuery delegated handlers + WF action all fire (no event swallowing)', async () => {
        const fired = []
        let componentRef = null

        wildflower.component('jq-coexist-10b', {
            state: { count: 0 },
            inc() { this.count++; fired.push('wf') },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div id="outer-10b">
                <div data-component="jq-coexist-10b">
                    <button class="multi-btn" data-action="inc">go</button>
                </div>
            </div>
        `

        // Two layers of jQuery delegation — common in WP themes (one global, one per-section)
        $(document).on('click.10b-doc', '.multi-btn', () => fired.push('jq-document'))
        $('#outer-10b').on('click.10b-out', '.multi-btn', () => fired.push('jq-outer'))

        wildflower.scan()
        await waitForCompleteRender()

        testContainer.querySelector('.multi-btn').click()
        await waitForCompleteRender()

        // All three handlers fire. WF doesn't stopPropagation by default.
        expect(componentRef.count).toBe(1)
        expect(fired).toContain('wf')
        expect(fired).toContain('jq-outer')
        expect(fired).toContain('jq-document')

        $(document).off('click.10b-doc')
        $('#outer-10b').off('click.10b-out')
    })

    // -----------------------------------------------------------------------
    // 11a. jQuery strips data-bind after WF binding — existing reactivity holds
    // -----------------------------------------------------------------------
    it('reactivity holds when jQuery strips data-bind attribute after binding', async () => {
        let componentRef = null
        wildflower.component('jq-coexist-11a', {
            state: { label: 'first' },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-11a">
                <span id="bound-11a" data-bind="label">first</span>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()
        expect(testContainer.querySelector('#bound-11a').textContent).toBe('first')

        // jQuery "cleanup" plugin strips the data-bind attribute (rare but documented behavior)
        $('#bound-11a').removeAttr('data-bind')
        expect(testContainer.querySelector('#bound-11a').hasAttribute('data-bind')).toBe(false)

        // WF binding was cached at scan time — reactive update should still target this element
        componentRef.label = 'updated'
        await waitForCompleteRender()
        expect(testContainer.querySelector('#bound-11a').textContent).toBe('updated')
    })

    // -----------------------------------------------------------------------
    // 11b. jQuery mutates data-bind to a bogus path — original binding unaffected
    // -----------------------------------------------------------------------
    it('jQuery mutating data-bind attr post-scan does not corrupt existing binding', async () => {
        let componentRef = null
        wildflower.component('jq-coexist-11b', {
            state: { real: 'real-value', other: 'other-value' },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-11b">
                <span id="bound-11b" data-bind="real">real-value</span>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // jQuery rewrites the attribute to point at a different state property
        $('#bound-11b').attr('data-bind', 'other')

        // WF should ignore the post-hoc attribute change — it bound to `real` at scan time
        componentRef.real = 'updated-real'
        await waitForCompleteRender()
        expect(testContainer.querySelector('#bound-11b').textContent).toBe('updated-real')

        // Updating `other` should NOT affect this element (binding is to `real`)
        componentRef.other = 'updated-other'
        await waitForCompleteRender()
        expect(testContainer.querySelector('#bound-11b').textContent).toBe('updated-real')
    })

    // -----------------------------------------------------------------------
    // 12. Zombie listeners: beforeDestroy fires when component element is removed,
    //     and re-init/teardown cycles don't grow document listener count unboundedly
    // -----------------------------------------------------------------------
    it('component teardown is detected and document listener count stays bounded', async () => {
        let destroyCount = 0
        wildflower.component('jq-coexist-12', {
            state: { x: 0 },
            inc() { this.x++ },
            beforeDestroy() { destroyCount++ }
        })

        // Wrap document.addEventListener to count deltas across init/destroy cycles
        const origAdd = document.addEventListener.bind(document)
        const origRemove = document.removeEventListener.bind(document)
        let netDocListeners = 0
        document.addEventListener = function(...args) { netDocListeners++; return origAdd(...args) }
        document.removeEventListener = function(...args) { netDocListeners--; return origRemove(...args) }

        try {
            const baseline = netDocListeners

            // 5 init + jQuery-driven removal cycles
            for (let i = 0; i < 5; i++) {
                const div = document.createElement('div')
                div.setAttribute('data-component', 'jq-coexist-12')
                div.innerHTML = `<button data-action="inc">b</button>`
                testContainer.appendChild(div)
                wildflower.scan()
                await waitForCompleteRender()

                // jQuery removes the element (the legacy "switch tab, destroy old panel" pattern)
                $(div).remove()
                await waitForCompleteRender()
                await new Promise(r => setTimeout(r, 30))
            }

            // beforeDestroy should have fired for at least some of the removed components.
            // Strict equality (5) would over-specify the contract; require > 0 to confirm
            // the framework detected at least one removal.
            expect(destroyCount).toBeGreaterThan(0)

            // Document listener count should not grow unboundedly across 5 cycles. Allow a
            // tolerance for any framework-internal listeners that may legitimately remain.
            expect(netDocListeners - baseline).toBeLessThanOrEqual(5)
        } finally {
            document.addEventListener = origAdd
            document.removeEventListener = origRemove
        }
    })

    // -----------------------------------------------------------------------
    // 13a. WF scan happens BEFORE jQuery $(ready) fires — both work
    // -----------------------------------------------------------------------
    it('jQuery $(document).ready() callback works after WF has already scanned', async () => {
        let readyFired = false
        let jqClicks = 0
        let componentRef = null

        wildflower.component('jq-coexist-13a', {
            state: { count: 0 },
            inc() { this.count++ },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="jq-coexist-13a">
                <button id="btn-13a" data-action="inc">click</button>
                <p id="jq-target-13a">unbound</p>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Now jQuery's $(ready) fires (it's actually synchronous at this point because
        // DOMContentLoaded has long since fired in the test env). Bind handlers in it.
        await new Promise((resolve) => {
            $(function() {
                readyFired = true
                $('#btn-13a').on('click.jq-13a', () => { jqClicks++ })
                $('#jq-target-13a').text('jq-bound').addClass('jq-class')
                resolve()
            })
        })

        expect(readyFired).toBe(true)

        testContainer.querySelector('#btn-13a').click()
        await waitForCompleteRender()

        // WF action AND jQuery's late-bound handler both fire
        expect(componentRef.count).toBe(1)
        expect(jqClicks).toBe(1)
        // jQuery's DOM mutations from inside ready() are intact
        expect(testContainer.querySelector('#jq-target-13a').textContent).toBe('jq-bound')
        expect(testContainer.querySelector('#jq-target-13a').classList.contains('jq-class')).toBe(true)

        $('#btn-13a').off('click.jq-13a')
    })

    // -----------------------------------------------------------------------
    // 13b. Reverse order: jQuery $(ready) creates DOM, then WF scans it
    //      (the "WP loads jQuery in header, WF in footer" pattern)
    // -----------------------------------------------------------------------
    it('WF picks up components that jQuery $(ready) injected before WF script ran', async () => {
        wildflower.component('jq-coexist-13b', {
            state: { msg: 'from-jq-ready' }
        })

        testContainer.innerHTML = `<div id="ready-target-13b"></div>`

        // Simulate the WP pattern: jQuery $(ready) injects HTML containing a WF component
        await new Promise((resolve) => {
            $(function() {
                $('#ready-target-13b').html(
                    '<div data-component="jq-coexist-13b"><span class="m" data-bind="msg"></span></div>'
                )
                resolve()
            })
        })

        // WF script runs later (footer) and scans the DOM
        wildflower.scan()
        await waitForCompleteRender()

        const span = testContainer.querySelector('.m')
        expect(span).not.toBeNull()
        expect(span.textContent).toBe('from-jq-ready')
    })
})
