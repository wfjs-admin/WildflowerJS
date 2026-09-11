/**
 * @vitest-environment browser
 *
 * Review findings.
 *
 * R10: a malformed suffix on a RECOGNIZED rung prefix ('etag:abc') used to
 * route around WF-967 — the prefix matched, parseInt collapsed to 0, and
 * the rung was silently disabled so the query never refreshed again. The
 * suffix is now validated inside the matched branch and falls to the same
 * warn the unknown-token case gets.
 *
 * R8: the 304 arm wrote isStale/syncError/lastSync but never isLoading,
 * and only the ingest cleared that flag — so a 304 landing before any
 * successful sync left isLoading true FOREVER (lastSync gets stamped, so
 * no later fetch re-arms or clears it). A bound spinner stayed on over an
 * empty list for the life of the tab.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qef-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: etag rung validation and 304 flag hygiene', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it.skipIf(isMinifiedBuild())('R10: a malformed etag: suffix warns WF-967 instead of silently disabling the rung', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response(JSON.stringify([{ id: 1, name: 'a' }]), { status: 200 })

        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: 'etag:abc' })
            mountList(q, c)
            await settle()
        } finally {
            console.warn = realWarn
        }

        expect(warnings.some(w => w.includes('WF-967') && w.includes('etag:abc')),
            'the malformed suffix is named by WF-967').toBe(true)
    })

    it.skipIf(isMinifiedBuild())('R10 calibration: a well-formed etag:N stays silent', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response(JSON.stringify([{ id: 1, name: 'a' }]), { status: 200 })

        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: 'etag:30' })
            mountList(q, c)
            await settle()
        } finally {
            console.warn = realWarn
        }

        expect(warnings.some(w => w.includes('WF-967')), 'no rung warn for valid input').toBe(false)
    })

    it('R8: a 304 landing before any successful sync clears isLoading', async () => {
        const q = uname('q'); const c = uname('c')
        // A misbehaving server: answers 304 to a request that carried no
        // validator. The engine must still treat it as a completed load.
        window.fetch = async () => new Response(null, { status: 304 })

        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const store = wildflower.getStore(q)
        expect(store.isLoading, 'the load is answered; the spinner must drop').toBe(false)
        expect(store.isStale).toBe(false)
        expect(store.error).toBe(null)
        expect(store.lastSync, 'a 304 is a successful sync').not.toBe(null)
        expect(store.rows.length).toBe(0)
    })
})
