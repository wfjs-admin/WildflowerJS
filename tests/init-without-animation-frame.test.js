/**
 * Auto-init must not depend on requestAnimationFrame firing.
 *
 * WildflowerCore schedules `_initialize()` behind `requestAnimationFrame`
 * (after DOMContentLoaded, or immediately when the document is already
 * parsed). Browsers suspend rAF for a tab that is not visible, so a page
 * opened in a background tab (cmd-click, "open in new tab", session restore)
 * sat fully parsed but uninitialized until the tab was first brought forward:
 * no bindings, no handlers, nothing in the console. Measured on the home page
 * 2026-09-18: DOMContentLoaded -> init took 15.6 s in a background tab, and
 * exactly as long as it took to focus the tab.
 *
 * This file loads the framework with rAF stubbed to never fire and asserts
 * that a component registered before init still comes up. It loads the bundle
 * itself instead of through loadFramework(): on minified lanes that helper
 * calls scan(), and scan() runs _initialize() when it has not run yet, which
 * would hide exactly the path under test.
 *
 * Assertions read only public surface (bound text, getComponent, the
 * data-component-id attribute), so the same file is valid on the min lanes.
 * Passes on Chromium and Firefox (153). With a live rAF in a visible tab the
 * two triggers land within 0.1 ms of each other in both, so the fallback
 * changes nothing there; it only decides the case where no frame comes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getFrameworkScripts, getDistMode } from '../packages/test-utils/index.js'

const NAME = 'raf-independent-probe'

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
        const s = document.createElement('script')
        s.src = src
        s.onload = resolve
        s.onerror = () => reject(new Error(`Failed to load: ${src}`))
        document.head.appendChild(s)
    })
}

async function untilTrue(fn, timeoutMs) {
    const start = performance.now()
    while (performance.now() - start < timeoutMs) {
        if (fn()) return true
        await new Promise(r => setTimeout(r, 10))
    }
    return fn()
}

describe('auto-init when requestAnimationFrame never fires', () => {
    const realRaf = window.requestAnimationFrame
    const realCaf = window.cancelAnimationFrame
    const rafCalls = []
    let host

    beforeAll(async () => {
        // A hidden tab in miniature: frames are requested but never delivered.
        window.requestAnimationFrame = (cb) => { rafCalls.push(cb); return rafCalls.length }
        window.cancelAnimationFrame = () => {}

        // Element present before the framework loads, like server-sent markup.
        host = document.createElement('div')
        host.setAttribute('data-component', NAME)
        host.innerHTML = `<span id="raf-probe-out" data-bind="msg">NOT-INIT</span>`
        document.body.appendChild(host)

        for (const src of getFrameworkScripts(getDistMode())) {
            await loadScriptOnce(src)
        }
        // Registration lands before init either way: init is deferred, this is not.
        window.wildflower.component(NAME, { state: { msg: 'INIT' } })
    })

    afterAll(() => {
        window.requestAnimationFrame = realRaf
        window.cancelAnimationFrame = realCaf
        if (host && host.parentNode) host.parentNode.removeChild(host)
    })

    it('still initializes the page', async () => {
        const live = await untilTrue(
            () => document.getElementById('raf-probe-out').textContent === 'INIT',
            1500
        )
        expect(live, 'binding never applied: init is waiting on a frame that will not come').toBe(true)
        expect(window.wildflower.getComponent(NAME)).toBeTruthy()
    })

    it('went through the frame-requesting path, so the stub was on the path under test', () => {
        // Guards against a vacuous pass: if the framework stopped requesting a
        // frame at all, this file would no longer be exercising the fallback.
        expect(rafCalls.length).toBeGreaterThan(0)
    })

    it('initializes the element exactly once', () => {
        const initialized = document.querySelectorAll(`[data-component="${NAME}"][data-component-id]`)
        expect(initialized.length).toBe(1)
    })
})
