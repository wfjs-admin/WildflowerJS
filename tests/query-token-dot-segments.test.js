/**
 * A URL token whose value is a dot segment never reaches the request.
 *
 * Token values are percent-encoded so that one token is exactly one path
 * segment. Percent-encoding leaves `.` alone, and the URL parser resolves a
 * whole segment of `.` or `..` as a dot segment. So a key of '..' turned
 * `DELETE /api/items/:id` into `DELETE /api/`, and a parent id of '..' in
 * `/api/users/:uid/notes/:id` addressed `/api/notes/:id`, another resource.
 * Such a value is now treated as no value, the rule the empty string
 * already follows: a read waits and sends nothing, a write rejects naming
 * the token and sends nothing.
 *
 * Dots inside a segment ('v1.2', 'file.txt', '...') are ordinary path text
 * and still go through, and a value carrying a slash still encodes to one
 * segment. The text "%2e%2e" is safe as it stands: its percent signs are
 * encoded, so it never spells the parser's encoded dot segment.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
// What a refused write's message must contain: the token in a development
// build, the code in a production one, whose message is the code and the
// code's page on the docs site.
const says = (words, code) => (isMinifiedBuild() ? '[' + code + ']' : words)

let seq = 0
const uname = (p) => `${p}-dot-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('a dot-segment token value never reaches the request', () => {
    let container
    let wildflower
    let realFetch
    let calls

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        calls = []
        window.fetch = async (url, init = {}) => {
            const method = init.method || 'GET'
            calls.push({ method, url, path: new URL(url, location.href).pathname })
            if (method === 'GET') return new Response('[{"id":1,"title":"a"}]', { status: 200 })
            return new Response(null, { status: 204 })
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row"><span data-bind="title"></span></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    for (const value of ['..', '.']) {
        it(`a read whose token is ${JSON.stringify(value)} waits and sends nothing`, async () => {
            const q = uname('q'); const c = uname('c')
            wildflower.query(q, { from: '/api/users/:uid/items', params: { uid: value } })
            mountList(q, c)
            await settle()
            expect(calls).toEqual([])
            expect(wildflower.getQuery(q).isLoading).toBe(true)
        })
    }

    for (const value of ['..', '.']) {
        it(`a delete whose key is ${JSON.stringify(value)} rejects and sends nothing`, async () => {
            const q = uname('q'); const c = uname('c')
            wildflower.query(q, { from: '/api/items', to: '/api/items/:id', deleted: 'removed' })
            mountList(q, c)
            await settle()
            calls.length = 0
            let err = null
            await wildflower.getQuery(q).write('delete', { id: value }).catch((e) => { err = e })
            expect(err).toBeTruthy()
            expect(String(err.message)).toContain(says(':id', 'WF-972'))
            expect(calls.filter(x => x.method === 'DELETE')).toEqual([])
        })
    }

    it('a parent token of ".." in a write URL rejects and sends nothing', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', to: '/api/users/:uid/notes/:id', body: (i) => i })
        mountList(q, c)
        await settle()
        calls.length = 0
        let err = null
        await wildflower.getQuery(q).write({ id: 1, uid: '..', title: 'x' }).catch((e) => { err = e })
        expect(err).toBeTruthy()
        expect(String(err.message)).toContain(says(':uid', 'WF-972'))
        expect(calls.filter(x => x.method === 'PATCH')).toEqual([])
    })

    for (const [value, path] of [
        ['v1.2', '/api/items/v1.2'],
        ['file.txt', '/api/items/file.txt'],
        ['...', '/api/items/...'],
        ['.hidden', '/api/items/.hidden'],
        ['a/b', '/api/items/a%2Fb'],
        ['../x', '/api/items/..%2Fx'],
        // Percent signs are encoded too, so the text "%2e%2e" is never the
        // parser's encoded dot segment.
        ['%2e%2e', '/api/items/%252e%252e'],
        ['.%2e', '/api/items/.%252e'],
        ['%2F', '/api/items/%252F'],
    ]) {
        it(`a token of ${JSON.stringify(value)} is one ordinary segment`, async () => {
            const q = uname('q'); const c = uname('c')
            wildflower.query(q, { from: '/api/items/:id', params: { id: value } })
            mountList(q, c)
            await settle()
            expect(calls.map(x => x.path)).toEqual([path])
        })
    }
})
