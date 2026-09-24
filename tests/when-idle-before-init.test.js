/**
 * whenIdle() called before the page-load scan must wait for it.
 *
 * Init is deferred a step after load, and the page-load scan used to be
 * counted only once init started it, so a whenIdle() in that gap resolved
 * before any component existed.
 *
 * Loads the bundle itself: loadFramework() calls scan() on min lanes, which
 * would run init first. Public surface only, so valid on every lane.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getFrameworkScripts, getDistMode } from '../packages/test-utils/index.js'

const NAME = 'when-idle-before-init-probe'

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

const initialized = () => !!document.querySelector(`[data-component="${NAME}"][data-component-id]`)

describe('whenIdle() before the page-load scan', () => {
    let host
    let initializedWhenCalled
    let initializedWhenResolved

    beforeAll(async () => {
        host = document.createElement('div')
        host.setAttribute('data-component', NAME)
        host.innerHTML = `<span data-bind="msg">NOT-INIT</span>`
        document.body.appendChild(host)

        for (const src of getFrameworkScripts(getDistMode())) {
            await loadScriptOnce(src)
        }
        window.wildflower.component(NAME, { state: { msg: 'INIT' } })

        initializedWhenCalled = initialized()
        await window.wildflower.whenIdle()
        initializedWhenResolved = initialized()
    })

    afterAll(() => {
        if (host && host.parentNode) host.parentNode.removeChild(host)
    })

    it('was called before init, so the case under test really ran', () => {
        // Guards against a vacuous pass: after init, resolving at once is correct.
        expect(initializedWhenCalled).toBe(false)
    })

    it('resolves only after the page-load scan has initialized the page', () => {
        expect(initializedWhenResolved, 'whenIdle() resolved before the page-load scan ran').toBe(true)
    })
})
