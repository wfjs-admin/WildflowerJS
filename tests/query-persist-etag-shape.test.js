/**
 * A restored snapshot's validator is used only when it is a string stored
 * against a URL.
 *
 * localStorage is writable by any script on the origin, so the snapshot is
 * untrusted input. The validator table was a plain object filled with
 * `etags[env.etagUrl] = env.etag`, so a snapshot naming its URL "__proto__"
 * replaced the table's prototype with an object of its choosing, and every
 * later lookup answered through inheritance: the next request carried an
 * If-None-Match the snapshot chose for a URL it never named. Neither the
 * table nor Object.prototype may answer for a URL nobody stored.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-pe-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('a restored snapshot validator', () => {
    let container
    let wildflower
    let realFetch
    let seen
    let keys

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        seen = []
        keys = []
        window.fetch = (url, init = {}) => {
            seen.push((init.headers || {})['If-None-Match'])
            return new Promise(() => {})
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        for (const k of keys) localStorage.removeItem(k)
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function restore(envelope) {
        const q = uname('q'); const c = uname('c'); const k = 'wf:query:' + q
        keys.push(k)
        localStorage.setItem(k, JSON.stringify(envelope))
        wildflower.query(q, { from: '/api/x', persist: true })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li><span data-bind="title"></span></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        return q
    }

    it('an etagUrl of "__proto__" arms no validator for any URL', async () => {
        restore({ v: 1, rows: [{ id: 1, title: 'a' }], savedAt: Date.now(),
            etag: { '/api/x': 'W/"forged"' }, etagUrl: '__proto__' })
        await settle()
        expect(seen).toEqual([undefined])
        expect(Object.keys(Object.prototype)).toEqual([])
    })

    it('a validator that is not a string is not sent', async () => {
        restore({ v: 1, rows: [{ id: 1, title: 'a' }], savedAt: Date.now(),
            etag: { toString: null }, etagUrl: '/api/x' })
        await settle()
        expect(seen).toEqual([undefined])
    })

    it('a string validator stored for the URL still rides the catch-up request', async () => {
        restore({ v: 1, rows: [{ id: 1, title: 'a' }], savedAt: Date.now(),
            etag: 'W/"v1"', etagUrl: '/api/x', url: '/api/x' })
        await settle()
        expect(seen).toEqual(['W/"v1"'])
    })
})
