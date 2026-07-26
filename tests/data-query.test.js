/**
 * data-query engine probe tests (full tier only; rides __FEATURE_QUERY__).
 *
 * The primitive: wildflower.query(name, {from, key, refresh, params,
 * initial}) backed by an internal store; [data-query] + <template> transforms
 * to data-list="$name.rows" before list discovery; getQuery(name) auto-tracks
 * in computeds. Design: docs/future/data-query/DESIGN.md.
 *
 * fetch is stubbed per test (window.fetch), restored after.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-${++seq}`

function jsonResponse(data, { status = 200, etag } = {}) {
    const headers = new Headers()
    if (etag) headers.set('ETag', etag)
    return new Response(JSON.stringify(data), { status, headers })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query engine probe', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <p class="loading" data-show="$${qname}.isLoading">Loading…</p>
                <p class="failed" data-show="$${qname}.error">failed</p>
                <span class="count" data-bind="$${qname}.count"></span>
                <ul data-query="${qname}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('renders a remote list through the transform + reconciler', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const rows = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(rows).toEqual(['a', 'b'])
        expect(container.querySelector('.count').textContent).toBe('2')
        // transform delegated to the list pipeline with the declared key
        const ul = container.querySelector('[data-query]')
        expect(ul.getAttribute('data-list')).toBe('$' + q + '.rows')
        expect(ul.getAttribute('data-key')).toBe('id')
    })

    it('walks the isLoading lifecycle and applies on resolve', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([{ id: 1, name: 'x' }])) })
        wildflower.query(q, { from: '/api/x.json' })
        mountList(q, c)
        await settle(40)

        expect(wildflower.getQuery(q).isLoading).toBe(true)
        expect(container.querySelector('.loading').style.display).not.toBe('none')

        release()
        await settle()
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(container.querySelectorAll('.row').length).toBe(1)
        expect(wildflower.getQuery(q).lastSync).not.toBeNull()
    })

    it('hard error: no data, error set; refresh recovers', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => { throw new Error('network down') }
        wildflower.query(q, { from: '/api/x.json' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.error).toContain('network down')
        expect(h.isLoading).toBe(false)
        expect(container.querySelectorAll('.row').length).toBe(0)

        window.fetch = async () => jsonResponse([{ id: 1, name: 'ok' }])
        h.refresh()
        await settle()
        expect(wildflower.getQuery(q).error).toBeNull()
        expect(container.querySelectorAll('.row').length).toBe(1)
    })

    it('transient error: rows preserved, syncError set, error stays null', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'keep' }])
        wildflower.query(q, { from: '/api/x.json' })
        mountList(q, c)
        await settle()
        expect(container.querySelectorAll('.row').length).toBe(1)

        window.fetch = async () => { throw new Error('blip') }
        wildflower.getQuery(q).refresh()
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.syncError).toContain('blip')
        expect(h.error).toBeNull()
        expect([...container.querySelectorAll('.row')].map(e => e.textContent)).toEqual(['keep'])
    })

    it('race discipline: last call wins even when the first resolves later', async () => {
        const q = uname('q'); const c = uname('c')
        const pending = []
        window.fetch = () => new Promise(res => pending.push(res))
        wildflower.query(q, { from: '/api/x.json' })
        mountList(q, c)
        await settle(40)                                   // fetch #1 in flight
        wildflower.getQuery(q).refresh()                   // fetch #2 supersedes
        await settle(40)
        pending[1](jsonResponse([{ id: 2, name: 'second' }]))
        await settle(40)
        pending[0](jsonResponse([{ id: 1, name: 'first-late' }]))
        await settle()

        expect([...container.querySelectorAll('.row')].map(e => e.textContent)).toEqual(['second'])
    })

    it('reconnect rung refetches when the browser comes back online', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'offline-era' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', refresh: ['reconnect'] })
        mountList(q, c)
        await settle()
        expect(container.querySelector('.row').textContent).toBe('offline-era')

        payload = [{ id: 1, name: 'back-online' }]
        window.dispatchEvent(new Event('online'))
        await settle()
        expect(container.querySelector('.row').textContent).toBe('back-online')
    })

    it('focus rung refetches on window focus', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', refresh: ['focus'] })
        mountList(q, c)
        await settle()
        expect(container.querySelector('.row').textContent).toBe('v1')

        payload = [{ id: 1, name: 'v2' }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(container.querySelector('.row').textContent).toBe('v2')
    })

    it('getQuery(...).rows auto-tracks inside a computed', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'b' }, { id: 2, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json' })

        container.innerHTML = `
            <div data-component="${c}">
                <span class="names" data-bind="joined"></span>
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, {
            state: {},
            computed: {
                joined() {
                    const h = wildflower.getQuery(q)
                    return [...(h.rows || [])].map(r => r.name).sort().join(',')
                }
            }
        })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.names').textContent).toBe('a,b')

        payload = [{ id: 3, name: 'c' }]
        wildflower.getQuery(q).refresh()
        await settle()
        expect(container.querySelector('.names').textContent).toBe('c')
    })

    it.skipIf(isMinifiedBuild())('F5 diagnostic fires for an in-place sort of query rows in a computed', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 2, name: 'b' }, { id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json' })

        container.innerHTML = `
            <div data-component="${c}">
                <span data-bind="sortedNames"></span>
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, {
            state: {},
            computed: {
                sortedNames() {
                    const h = wildflower.getQuery(q)
                    return (h.rows || []).sort((x, y) => x.id - y.id).map(r => r.name).join(',')
                }
            }
        })
        wildflower.scan(container)
        await settle()

        expect(warnings.some(w => /during .*(its own )?evaluation/i.test(w) && w.includes('[WF'))).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('unknown query name in markup warns and does not crash', async () => {
        const c = uname('c')
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="never-registered-xyz"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(warnings.some(w => w.includes('never-registered-xyz') && w.includes('no such query'))).toBe(true)
    })

    it('initial rows render before first fetch resolves', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {}) // never resolves
        wildflower.query(q, { from: '/api/x.json', initial: [{ id: 9, name: 'seed' }] })
        mountList(q, c)
        await settle()
        expect(container.querySelector('.row').textContent).toBe('seed')
        // Seeded rows count as data: the catch-up fetch is a stale refresh.
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(wildflower.getQuery(q).isStale).toBe(true)
    })

    // ── Record shape: no <template> child; subtree binds to the single record ──

    function mountRecord(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <article data-query="${qname}">
                    <h2 class="name" data-bind="name"></h2>
                    <p class="title" data-bind="title"></p>
                    <p class="stale" data-show="$${qname}.isStale">Reconnecting…</p>
                </article>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('record shape: result object binds the subtree fields', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'Ada Lovelace', title: 'Analyst' })
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q, c)
        await settle()

        expect(container.querySelector('.name').textContent).toBe('Ada Lovelace')
        expect(container.querySelector('.title').textContent).toBe('Analyst')
        // bare paths were rewritten to the record accessor; $-paths untouched
        expect(container.querySelector('.name').getAttribute('data-bind')).toBe('$' + q + '.rows.0.name')
        expect(container.querySelector('.stale').getAttribute('data-show')).toBe('$' + q + '.isStale')
    })

    it('record shape: refresh updates fields in place', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = { name: 'v1', title: 't1' }
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q, c)
        await settle()
        expect(container.querySelector('.name').textContent).toBe('v1')

        payload = { name: 'v2', title: 't2' }
        wildflower.getQuery(q).refresh()
        await settle()
        expect(container.querySelector('.name').textContent).toBe('v2')
        expect(container.querySelector('.title').textContent).toBe('t2')
    })

    it('record shape: initial record seeds fields before first fetch resolves', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {}) // never resolves
        wildflower.query(q, { from: '/api/me', initial: [{ name: 'Seed Name', title: 'Seed Title' }] })
        mountRecord(q, c)
        await settle()
        expect(container.querySelector('.name').textContent).toBe('Seed Name')
        // Seeded record counts as data: the catch-up fetch is a stale refresh.
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(wildflower.getQuery(q).isStale).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('record shape: null result is a valid empty context and warns in dev', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = { name: 'present', title: 't' }
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q, c)
        await settle()
        expect(container.querySelector('.name').textContent).toBe('present')

        payload = null
        wildflower.getQuery(q).refresh()
        await settle()
        // null record: fields resolve empty, nothing throws, no hard error
        expect(container.querySelector('.name').textContent).toBe('')
        expect(wildflower.getQuery(q).error).toBeNull()
        expect(warnings.some(w => w.includes(q) && w.includes('record query resolved null'))).toBe(true)
    })

    it('record shape: transient error preserves last-good fields', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'keep-me', title: 't' })
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q, c)
        await settle()
        expect(container.querySelector('.name').textContent).toBe('keep-me')

        window.fetch = async () => { throw new Error('blip') }
        wildflower.getQuery(q).refresh()
        await settle()
        expect(container.querySelector('.name').textContent).toBe('keep-me')
        expect(wildflower.getQuery(q).syncError).toContain('blip')
        expect(wildflower.getQuery(q).error).toBeNull()
    })

    // ── Function sources (demo B): from is a function, fetch never involved ──

    it('function source: async function feeds the list shape', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => { throw new Error('fetch must not be called') }
        let payload = [{ id: 1, name: 'fn-a' }]
        wildflower.query(q, { from: async () => payload })
        mountList(q, c)
        await settle()
        expect([...container.querySelectorAll('.row')].map(e => e.textContent)).toEqual(['fn-a'])

        payload = [{ id: 1, name: 'fn-a' }, { id: 2, name: 'fn-b' }]
        wildflower.getQuery(q).refresh()
        await settle()
        expect(container.querySelectorAll('.row').length).toBe(2)
    })

    it('function source: synchronous throw becomes a hard error', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: () => { throw new Error('sync boom') } })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.error).toContain('sync boom')
        expect(h.isLoading).toBe(false)
        expect(container.querySelectorAll('.row').length).toBe(0)
    })

    it('getQuery read in a computed activates the query (no data-query element)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'via-read' }, { id: 2, name: 'second' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })

        // The refinement pattern: no [data-query] element anywhere; the only
        // observer edge is a getQuery read inside a computed.
        container.innerHTML = `
            <div data-component="${c}">
                <span class="n" data-bind="visibleCount"></span>
                <ul data-list="visible" data-key="id"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, {
            state: {},
            computed: {
                visible() {
                    return wildflower.getQuery(q).rows.filter(() => true)
                },
                visibleCount() {
                    return this.computed.visible.length
                }
            }
        })
        wildflower.scan(container)
        await settle()

        expect(container.querySelectorAll('.row').length).toBe(2)
        expect(container.querySelector('.n').textContent).toBe('2')
        expect(wildflower.getQuery(q).lastSync).not.toBeNull()
    })

    // ── Review fixes: activation edges, write ordering, adoption guards ──

    it('registration alone does not fetch; activation needs an observer', async () => {
        const q = uname('q')
        let fetches = 0
        wildflower.query(q, { from: async () => { fetches++; return [{ id: 1, name: 'x' }] } })
        await settle(150)
        expect(fetches).toBe(0)
    })

    it('a subscribe: declaration on a query store is an observer edge', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        wildflower.query(q, { from: async () => { fetches++; return [{ id: 1, name: 'sub' }] } })
        container.innerHTML = `<div data-component="${c}"><span>static</span></div>`
        wildflower.component(c, {
            state: {},
            subscribe: { [q]: ['rows'] },
            onStoreUpdate() {}
        })
        wildflower.scan(container)
        await settle()
        expect(fetches).toBe(1)
        expect(wildflower.getQuery(q).rows.length).toBe(1)
    })

    it('rows notification fires with all query state final (rows written last)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'x' }])
        wildflower.query(q, { from: '/api/x.json' })
        const seen = []
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li data-bind="name"></li></template></ul></div>`
        wildflower.component(c, {
            state: {},
            subscribe: { [q]: ['rows'] },
            onStoreUpdate(store, path) {
                if (store === q && String(path).startsWith('rows')) {
                    const h = wildflower.getQuery(q)
                    seen.push({ isLoading: h.isLoading, lastSync: h.lastSync })
                }
            }
        })
        wildflower.scan(container)
        await settle()
        expect(seen.length).toBeGreaterThan(0)
        const last = seen[seen.length - 1]
        expect(last.isLoading).toBe(false)
        expect(last.lastSync).not.toBeNull()
    })

    it('ssr record adoption ignores content inside nested list containers', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}">
                    <h2 data-bind="name">Ada</h2>
                    <div data-list="hobbies" style="display:none">
                        <template><span data-bind="label"></span></template>
                        <span data-bind="label">Chess</span>
                    </div>
                </article>
            </div>
        `
        wildflower.component(c, { state: { hobbies: [] } })
        wildflower.scan(container)
        await settle()

        const rec = wildflower.getQuery(q).rows[0]
        expect(rec.name).toBe('Ada')
        expect(rec.label).toBeUndefined() // nested list content is not the record's
    })

    it('ssr record adoption reconstructs dotted binding paths', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}">
                    <h2 data-bind="user.name">Ada</h2>
                    <p data-bind="user.title">Analyst</p>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wildflower.getQuery(q).rows[0].user).toEqual({ name: 'Ada', title: 'Analyst' })
    })

    it('null and undefined params never serialize into the URL', async () => {
        const q = uname('q'); const c = uname('c')
        const urls = []
        window.fetch = async (url) => { urls.push(String(url)); return jsonResponse([{ id: 1, name: 'x' }]) }
        wildflower.query(q, { from: '/api/x.json', params: { keep: 'yes', gone: undefined } })
        mountList(q, c)
        await settle()
        wildflower.getQuery(q).refresh({ params: { also: null, n: 0 } })
        await settle()

        expect(urls.length).toBeGreaterThan(1)
        expect(urls[0]).toContain('keep=yes')
        expect(urls[urls.length - 1]).toContain('n=0')     // falsy but real values stay
        for (const u of urls) {
            expect(u).not.toMatch(/undefined|null/)
        }
    })

    it('observer set prunes disconnected elements on each new observation', async () => {
        const q = uname('q'); const c1 = uname('c'); const c2 = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'x' }])
        wildflower.query(q, { from: '/api/x.json' })
        mountList(q, c1)
        await settle()
        expect(wildflower._queryControllers.get(q).elements.size).toBe(1)

        container.innerHTML = '' // old observer disconnects; no rung ever fires
        mountList(q, c2)         // new observation prunes as it adds
        await settle()
        expect(wildflower._queryControllers.get(q).elements.size).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('sub-second poll rungs warn in dev', async () => {
        const q = uname('q')
        wildflower.query(q, { from: async () => [], refresh: 0.2 })
        expect(warnings.some(w => w.includes(q) && /sub-second|poll/i.test(w))).toBe(true)
    })

    it('data-wf-query gets wf-prefixed transform attributes', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'wf' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-wf-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const ul = container.querySelector('[data-wf-query]')
        expect(ul.getAttribute('data-wf-list')).toBe('$' + q + '.rows')
        expect(ul.getAttribute('data-wf-key')).toBe('id')
        expect(ul.hasAttribute('data-list')).toBe(false)
        expect(container.querySelector('.row').textContent).toBe('wf')
    })

    it('dependent queries chain reactively via subscribe + onStoreUpdate', async () => {
        const parent = uname('q'); const dep = uname('q'); const c = uname('c')
        let userId = 7
        const depRequests = []
        window.fetch = async (url) => {
            if (String(url).includes('assignments')) {
                depRequests.push(String(url))
                return jsonResponse([{ id: 1, name: 'task-for-' + String(url).split('userId=')[1] }])
            }
            return jsonResponse([{ id: userId, name: 'user-' + userId }])
        }
        wildflower.query(parent, { from: '/api/me.json' })
        wildflower.query(dep, { from: '/api/assignments', key: 'id' })

        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${dep}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, {
            state: {},
            subscribe: { [parent]: ['rows'] },
            onStoreUpdate(store) {
                if (store === parent) {
                    const user = this.stores[parent].rows[0]
                    if (user) wildflower.getQuery(dep).refresh({ params: { userId: user.id } })
                }
            }
        })
        wildflower.scan(container)
        await settle()

        // Parent's first materialization drove the dependent with its params.
        expect(depRequests.some(u => u.includes('userId=7'))).toBe(true)
        expect(container.querySelector('.row').textContent).toBe('task-for-7')

        // The parent refreshes with a different user: the chain re-fires.
        userId = 9
        wildflower.getQuery(parent).refresh()
        await settle()
        expect(depRequests.some(u => u.includes('userId=9'))).toBe(true)
        expect(container.querySelector('.row').textContent).toBe('task-for-9')
    })

    // ── SSR handoff: data-ssr="true" + data-query, all shapes ──
    // Contract: the server-rendered DOM is the first materialization. No
    // wipe, no isLoading flash; the query takes over liveness and patches
    // in place when data actually changes.

    it('ssr list handoff: server rows stand, no loading flash, refresh patches', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([
            { id: 1, sku: 'AX-100', stock: 40 },   // changed on the server
            { id: 2, sku: 'BX-200', stock: 12 }
        ])) })
        wildflower.query(q, {
            from: '/api/inventory.json',
            key: 'id',
            initial: [
                { id: 1, sku: 'AX-100', stock: 45 },
                { id: 2, sku: 'BX-200', stock: 12 }
            ]
        })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <p class="skeleton" data-show="$${q}.isLoading">Loading…</p>
                <table><tbody data-query="${q}">
                    <template>
                        <tr><td class="sku" data-bind="sku"></td><td class="stock" data-bind="stock" data-type="number"></td></tr>
                    </template>
                    <tr><td class="sku" data-bind="sku">AX-100</td><td class="stock" data-bind="stock" data-type="number">45</td></tr>
                    <tr><td class="sku" data-bind="sku">BX-200</td><td class="stock" data-bind="stock" data-type="number">12</td></tr>
                </tbody></table>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        // Before the fetch resolves: server rows intact, no loading state.
        const stocks = () => [...container.querySelectorAll('.stock')].map(e => e.textContent.trim())
        expect(stocks()).toEqual(['45', '12'])
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(container.querySelector('.skeleton').style.display).toBe('none')

        release()
        await settle()
        // Fresh data lands: the changed row patches, the other stands.
        expect(stocks()).toEqual(['40', '12'])
        expect(container.querySelectorAll('tbody tr').length).toBe(2)
    })

    it('ssr record handoff: server text stands until data arrives, then patches', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse(
            { name: 'Ada Lovelace', title: 'Director, Engine Division' }
        )) })
        wildflower.query(q, {
            from: '/api/me',
            initial: [{ name: 'Ada Lovelace', title: 'Analyst, Engine Division' }]
        })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}">
                    <h2 class="nm" data-bind="name">Ada Lovelace</h2>
                    <p class="ti" data-bind="title">Analyst, Engine Division</p>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.nm').textContent).toBe('Ada Lovelace')
        expect(container.querySelector('.ti').textContent).toBe('Analyst, Engine Division')
        expect(wildflower.getQuery(q).isLoading).toBe(false)

        release()
        await settle()
        expect(container.querySelector('.ti').textContent).toBe('Director, Engine Division')
        expect(container.querySelector('.nm').textContent).toBe('Ada Lovelace')
    })

    it('ssr list adoption: rows parse back from the DOM, no seed needed', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([
            { sku: 'AX-100', stock: 40 },
            { sku: 'BX-200', stock: 12 }
        ])) })
        // No initial: here; the server-rendered rows ARE the seed. The key field
        // (sku) is rendered, so identity survives the parse.
        wildflower.query(q, { from: '/api/inventory.json', key: 'sku' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <table><tbody data-query="${q}">
                    <template>
                        <tr><td class="sku" data-bind="sku"></td><td class="stock" data-bind="stock" data-type="number"></td></tr>
                    </template>
                    <tr><td class="sku" data-bind="sku">AX-100</td><td class="stock" data-bind="stock" data-type="number">45</td></tr>
                    <tr><td class="sku" data-bind="sku">BX-200</td><td class="stock" data-bind="stock" data-type="number">12</td></tr>
                </tbody></table>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        // The store's rows came from the DOM, types coerced.
        const h = wildflower.getQuery(q)
        expect(h.rows).toEqual([
            { sku: 'AX-100', stock: 45 },
            { sku: 'BX-200', stock: 12 }
        ])
        expect(h.isLoading).toBe(false)
        const stocks = () => [...container.querySelectorAll('.stock')].map(e => e.textContent.trim())
        expect(stocks()).toEqual(['45', '12'])

        release()
        await settle()
        expect(stocks()).toEqual(['40', '12'])
    })

    it('ssr record adoption: fields parse back from the DOM, no seed needed', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse(
            { name: 'Ada Lovelace', title: 'Director, Engine Division', unread: 5 }
        )) })
        wildflower.query(q, { from: '/api/me' }) // no initial:
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}">
                    <h2 class="nm" data-bind="name">Ada Lovelace</h2>
                    <p class="ti" data-bind="title">Analyst, Engine Division</p>
                    <p class="un" data-bind="unread" data-type="number">3</p>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wildflower.getQuery(q).rows[0]).toEqual(
            { name: 'Ada Lovelace', title: 'Analyst, Engine Division', unread: 3 }
        )
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(container.querySelector('.ti').textContent).toBe('Analyst, Engine Division')

        release()
        await settle()
        expect(container.querySelector('.ti').textContent).toBe('Director, Engine Division')
        expect(container.querySelector('.un').textContent).toBe('5')
    })

    it('ssr adoption: data-seed carries hidden fields; refreshes stay keyed', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [
            { id: 811, sku: 'AX-100', stock: 40 },   // changed
            { id: 812, sku: 'BX-200', stock: 12 }
        ]
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse(payload)) })
        // The row key (id) is not displayed anywhere; data-seed carries it.
        wildflower.query(q, { from: '/api/inventory.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <table><tbody data-query="${q}">
                    <template>
                        <tr><td class="sku" data-bind="sku"></td><td class="stock" data-bind="stock" data-type="number"></td></tr>
                    </template>
                    <tr data-seed='{"id":811}'><td class="sku" data-bind="sku">AX-100</td><td class="stock" data-bind="stock" data-type="number">45</td></tr>
                    <tr data-seed='{"id":812}'><td class="sku" data-bind="sku">BX-200</td><td class="stock" data-bind="stock" data-type="number">12</td></tr>
                </tbody></table>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wildflower.getQuery(q).rows).toEqual([
            { id: 811, sku: 'AX-100', stock: 45 },
            { id: 812, sku: 'BX-200', stock: 12 }
        ])

        release()
        await settle()
        const stocks = () => [...container.querySelectorAll('.stock')].map(e => e.textContent.trim())
        expect(stocks()).toEqual(['40', '12'])

        // After the first framework render, refreshes are keyed: the
        // unchanged row keeps its DOM node across the next refresh.
        const secondRow = container.querySelectorAll('tbody tr')[1]
        payload = [
            { id: 811, sku: 'AX-100', stock: 38 },
            { id: 812, sku: 'BX-200', stock: 12 }
        ]
        wildflower.getQuery(q).refresh()
        await settle(40)
        release() // resolve the second fetch
        await settle()
        expect(stocks()).toEqual(['38', '12'])
        expect(container.querySelectorAll('tbody tr')[1]).toBe(secondRow)
    })

    it('ssr adoption: record data-seed merges hidden fields and wins overlaps', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {}) // never resolves
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}" data-seed='{"userId":42,"unread":3}'>
                    <h2 class="nm" data-bind="name">Ada Lovelace</h2>
                    <p class="un" data-bind="unread">3 unread</p>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const rec = wildflower.getQuery(q).rows[0]
        expect(rec.userId).toBe(42)          // hidden field carried
        expect(rec.unread).toBe(3)           // seed wins over parsed text ("3 unread")
        expect(rec.name).toBe('Ada Lovelace') // parsed text for the rest
    })

    it('ssr adoption: failed catch-up is transient and adopted rows stand', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => { throw new Error('backend down') }
        wildflower.query(q, { from: '/api/inventory.json', key: 'sku' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <p class="failed" data-show="$${q}.error">failed</p>
                <ul data-query="${q}">
                    <template><li class="row" data-bind="sku"></li></template>
                    <li class="row" data-bind="sku">AX-100</li>
                    <li class="row" data-bind="sku">BX-200</li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.syncError).toContain('backend down')  // transient, not hard
        expect(h.error).toBeNull()
        expect(h.rows.length).toBe(2)                  // adopted rows intact
        const skus = [...container.querySelectorAll('.row')].map(e => e.textContent.trim())
        expect(skus).toEqual(['AX-100', 'BX-200'])
        expect(container.querySelector('.failed').style.display).toBe('none')
    })

    it('ssr adoption: focus rung refetches conditionally after adoption', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ sku: 'AX-100', stock: 45 }]
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse(payload) }
        wildflower.query(q, { from: '/api/inventory.json', key: 'sku', refresh: 'focus' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row"><span data-bind="sku"></span> <span class="st" data-bind="stock" data-type="number"></span></li></template>
                    <li class="row"><span data-bind="sku">AX-100</span> <span class="st" data-bind="stock" data-type="number">45</span></li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        const afterBoot = fetches

        payload = [{ sku: 'AX-100', stock: 30 }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(fetches).toBeGreaterThan(afterBoot)
        expect(container.querySelector('.st').textContent.trim()).toBe('30')
    })

    it('ssr adoption: empty server container falls back to a normal load', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([{ id: 1, name: 'first' }])) })
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(40)

        // Nothing to adopt: this is an ordinary first load.
        expect(wildflower.getQuery(q).isLoading).toBe(true)
        expect(container.querySelectorAll('.row').length).toBe(0)

        release()
        await settle()
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(container.querySelector('.row').textContent).toBe('first')
    })

    it('ssr adoption: record and list queries adopt in one component; state surface reflects parsed rows', async () => {
        const ql = uname('q'); const qr = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {}) // never resolves
        wildflower.query(ql, { from: '/api/inv.json', key: 'sku' })
        wildflower.query(qr, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${qr}">
                    <h2 class="nm" data-bind="name">Ada Lovelace</h2>
                </article>
                <span class="cnt" data-bind="$${ql}.count"></span>
                <ul data-query="${ql}">
                    <template><li class="row" data-bind="sku"></li></template>
                    <li class="row" data-bind="sku">AX-100</li>
                    <li class="row" data-bind="sku">BX-200</li>
                    <li class="row" data-bind="sku">CX-300</li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wildflower.getQuery(qr).rows[0].name).toBe('Ada Lovelace')
        expect(wildflower.getQuery(ql).rows.length).toBe(3)
        expect(container.querySelector('.cnt').textContent).toBe('3')
        expect(container.querySelector('.nm').textContent).toBe('Ada Lovelace')
    })

    it('ssr adoption: sse push patches adopted rows', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            window.fetch = async () => jsonResponse([{ sku: 'AX-100', stock: 45 }])
            wildflower.query(q, { from: '/api/inv.json', key: 'sku', refresh: 'sse', stream: '/api/inv/stream' })
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true">
                    <ul data-query="${q}">
                        <template><li class="row"><span data-bind="sku"></span> <span class="st" data-bind="stock" data-type="number"></span></li></template>
                        <li class="row"><span data-bind="sku">AX-100</span> <span class="st" data-bind="stock" data-type="number">45</span></li>
                    </ul>
                </div>
            `
            wildflower.component(c, { state: {} })
            wildflower.scan(container)
            await settle()
            expect(FakeEventSource.instances.length).toBe(1)

            FakeEventSource.instances[0].onmessage({ data: JSON.stringify([{ sku: 'AX-100', stock: 20 }]) })
            await settle()
            expect(container.querySelector('.st').textContent.trim()).toBe('20')
        } finally { restore() }
    })

    it('ssr adoption: initial wins over the DOM parse and data-seed alike', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, {
            from: '/api/inv.json',
            key: 'id',
            initial: [{ id: 99, sku: 'FROM-INITIAL', stock: 1 }]
        })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="sku"></li></template>
                    <li class="row" data-seed='{"id":811}' data-bind="sku">FROM-DOM</li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wildflower.getQuery(q).rows).toEqual([{ id: 99, sku: 'FROM-INITIAL', stock: 1 }])
    })

    it('initial-seeded query: first fetch is a stale refresh, not a load', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([{ id: 1, name: 'fresh' }])) })
        wildflower.query(q, { from: '/api/x.json', initial: [{ id: 1, name: 'seed' }] })
        mountList(q, c)
        await settle(40)

        // Seeded rows are usable data: no loading state while catching up.
        const h = wildflower.getQuery(q)
        expect(h.isLoading).toBe(false)
        expect(h.isStale).toBe(true)
        expect(container.querySelector('.row').textContent).toBe('seed')

        release()
        await settle()
        expect(wildflower.getQuery(q).isStale).toBe(false)
        expect(container.querySelector('.row').textContent).toBe('fresh')
    })

    // ── Lifecycle: active-while-observed with teardown grace ──

    it('teardown: poll rung stops after observers leave and grace expires', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        wildflower.query(q, { from: async () => { fetches++; return [{ id: 1, name: 'x' }] }, refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 150
        mountList(q, c)
        await settle(300)
        expect(fetches).toBeGreaterThan(1) // polling while observed

        container.innerHTML = '' // observers gone
        await settle(500)        // grace (150ms) + a few would-be ticks
        const after = fetches
        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(false)
        expect(controller.timerId).toBeNull()
        await settle(300)
        expect(fetches).toBe(after) // interval really stopped
        delete wildflower._queryTeardownGraceMs
    })

    it('teardown grace: brief zero-observer window does not tear down', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 5000
        mountList(q, c)
        await settle(150)

        const ul = container.querySelector('[data-query]')
        const parent = ul.parentNode
        parent.removeChild(ul)   // observer count hits zero...
        await settle(150)        // ...for under the grace window
        parent.appendChild(ul)
        await settle(250)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true) // rungs never tore down
        delete wildflower._queryTeardownGraceMs
    })

    // ── SSE rung (fake EventSource; the engine only uses onmessage/onerror/onopen/close) ──

    class FakeEventSource {
        constructor(url) {
            this.url = url
            this.closed = false
            FakeEventSource.instances.push(this)
        }
        close() { this.closed = true }
    }

    let realEventSource
    function stubEventSource() {
        FakeEventSource.instances = []
        realEventSource = window.EventSource
        window.EventSource = FakeEventSource
        return () => { window.EventSource = realEventSource }
    }

    it('sse rung: connects to the stream URL and applies data-carrying messages', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            window.fetch = async () => jsonResponse([{ id: 1, name: 'initial' }])
            wildflower.query(q, { from: '/api/x.json', refresh: 'sse', stream: '/api/x/stream' })
            mountList(q, c)
            await settle()
            expect(container.querySelector('.row').textContent).toBe('initial')

            expect(FakeEventSource.instances.length).toBe(1)
            const es = FakeEventSource.instances[0]
            expect(es.url).toBe('/api/x/stream') // explicit stream endpoint wins

            es.onmessage({ data: JSON.stringify([{ id: 1, name: 'pushed' }, { id: 2, name: 'pushed-2' }]) })
            await settle()
            expect([...container.querySelectorAll('.row')].map(e => e.textContent)).toEqual(['pushed', 'pushed-2'])
            expect(wildflower.getQuery(q).lastSync).not.toBeNull()
        } finally { restore() }
    })

    it('sse rung: empty message is an invalidation signal (conditional refetch)', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            let payload = [{ id: 1, name: 'v1' }]
            let fetches = 0
            window.fetch = async () => { fetches++; return jsonResponse(payload) }
            wildflower.query(q, { from: '/api/x.json', refresh: 'sse' })
            mountList(q, c)
            await settle()
            expect(fetches).toBe(1)
            const es = FakeEventSource.instances[0]
            expect(es.url).toBe('/api/x.json') // falls back to from

            payload = [{ id: 1, name: 'v2' }]
            es.onmessage({ data: '' })
            await settle()
            expect(fetches).toBe(2)
            expect(container.querySelector('.row').textContent).toBe('v2')
        } finally { restore() }
    })

    it('sse rung: stream error is transient, rows preserved; reopen catches up', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            let payload = [{ id: 1, name: 'keep' }]
            window.fetch = async () => jsonResponse(payload)
            wildflower.query(q, { from: '/api/x.json', refresh: 'sse' })
            mountList(q, c)
            await settle()
            const es = FakeEventSource.instances[0]

            es.onerror()
            await settle(40)
            const h = wildflower.getQuery(q)
            expect(h.syncError).toContain('stream interrupted')
            expect(h.isStale).toBe(true)
            expect(container.querySelector('.row').textContent).toBe('keep')

            payload = [{ id: 1, name: 'caught-up' }]
            es.onopen()
            await settle()
            expect(wildflower.getQuery(q).syncError).toBeNull()
            expect(container.querySelector('.row').textContent).toBe('caught-up')
        } finally { restore() }
    })

    it('sse rung: teardown closes the stream after observers leave', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            window.fetch = async () => jsonResponse([{ id: 1, name: 'x' }])
            wildflower._queryTeardownGraceMs = 100
            wildflower.query(q, { from: '/api/x.json', refresh: 'sse' })
            mountList(q, c)
            await settle()
            const es = FakeEventSource.instances[0]
            expect(es.closed).toBe(false)

            container.innerHTML = ''
            await settle(450) // lifecycle tick (grace-spaced) + grace expiry
            expect(es.closed).toBe(true)
            expect(wildflower._queryControllers.get(q).active).toBe(false)
        } finally {
            delete wildflower._queryTeardownGraceMs
            restore()
        }
    })

    it.skipIf(isMinifiedBuild())('sse rung: function source without stream URL warns and skips the rung', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            wildflower.query(q, { from: async () => [{ id: 1, name: 'fn' }], refresh: 'sse' })
            mountList(q, c)
            await settle()
            expect(FakeEventSource.instances.length).toBe(0)
            expect(warnings.some(w => w.includes(q) && w.includes('stream'))).toBe(true)
            expect(container.querySelector('.row').textContent).toBe('fn') // query still works
        } finally { restore() }
    })

    it('re-observation after teardown resumes with a conditional catch-up', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'old' }]
        const seenConditional = []
        window.fetch = async (url, opts) => {
            seenConditional.push(!!(opts && opts.headers && opts.headers['If-None-Match']))
            return jsonResponse(payload, { etag: '"e-' + payload[0].name + '"' })
        }
        wildflower.query(q, { from: '/api/x.json', refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 100
        mountList(q, c)
        await settle(150)
        expect(container.querySelector('.row').textContent).toBe('old')

        container.innerHTML = ''
        await settle(450) // grace expires, teardown
        expect(wildflower._queryControllers.get(q).active).toBe(false)

        payload = [{ id: 1, name: 'new' }]
        const c2 = uname('c')
        mountList(q, c2)  // fresh markup re-observes the query
        await settle(250)
        expect(wildflower._queryControllers.get(q).active).toBe(true)
        expect(container.querySelector('.row').textContent).toBe('new')
        // the catch-up fetch was conditional (sent If-None-Match)
        expect(seenConditional[seenConditional.length - 1]).toBe(true)
        delete wildflower._queryTeardownGraceMs
    })

    // ── WF-950: external writes to query-owned stores (dev diagnostic) ──

    it.skipIf(isMinifiedBuild())('an application write to a query store warns WF-950 but still lands', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        // Match the main diagnostic line only: wfError also emits a doc-URL
        // line that contains the code text.
        const wf950 = () => warnings.filter(w => w.includes('[WF WF-950]')).length
        expect(wf950()).toBe(0) // engine writes are exempt

        const h = wildflower.getQuery(q)
        h.rows = [{ id: 9, name: 'optimistic' }]
        expect(wf950()).toBe(1)
        // Non-blocking: the write is legitimate for optimistic updates.
        expect(wildflower.getQuery(q).rows[0].name).toBe('optimistic')
        await settle()
        expect(container.querySelector('.row').textContent).toBe('optimistic')

        // Warn-once per store: further writes stay quiet.
        h.isStale = true
        h.rows = []
        expect(wf950()).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('engine activity never draws WF-950: fetch, refresh, invalidate, adoption', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'x' }]
        window.fetch = async () => jsonResponse(payload, { etag: '"e1"' })
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        payload = [{ id: 1, name: 'y' }]
        await wildflower.getQuery(q).refresh()
        await wildflower.getQuery(q).invalidate()
        await settle()
        expect(container.querySelector('.row').textContent).toBe('y')
        expect(warnings.filter(w => w.includes('WF-950')).length).toBe(0)

        // SSR adoption writes are engine writes too.
        const q2 = uname('q'); const c2 = uname('c')
        wildflower.query(q2, { from: '/api/y.json', key: 'sku' })
        container.innerHTML = `
            <div data-component="${c2}" data-ssr="true">
                <ul data-query="${q2}">
                    <template><li class="row" data-bind="name"></li></template>
                    <li data-bind="name">seeded</li>
                </ul>
            </div>
        `
        wildflower.component(c2, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(warnings.filter(w => w.includes('WF-950')).length).toBe(0)
    })

    // ── Pagination probe (1.4): append + merge + tombstones through the
    //    single ingestion choke point (PAGINATION_DESIGN.md v0.3) ──

    it('append accumulates pages with keyed dedup updating in place', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        expect(container.querySelectorAll('.row').length).toBe(2)

        payload = [{ id: 2, name: 'two-updated' }, { id: 3, name: 'three' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        const rows = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(rows).toEqual(['one', 'two-updated', 'three'])
    })

    it('gentle merge: fresh head in place, accumulated tail intact, DOM nodes kept', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        payload = [{ id: 3, name: 'c' }, { id: 4, name: 'd' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()

        const tailNode = [...container.querySelectorAll('.row')].find(el => el.textContent === 'd')
        payload = [{ id: 9, name: 'newest' }, { id: 1, name: 'a2' }]
        await wildflower.getQuery(q).invalidate()
        await settle()

        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['newest', 'a2', 'b', 'c', 'd'])
        const tailAfter = [...container.querySelectorAll('.row')].find(el => el.textContent === 'd')
        expect(tailAfter).toBe(tailNode) // the tail row kept its DOM node
    })

    it('explicit refresh() replaces everything and resets to plain', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        payload = [{ id: 2, name: 'b' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        expect(container.querySelectorAll('.row').length).toBe(2)

        payload = [{ id: 7, name: 'fresh-start' }]
        await wildflower.getQuery(q).refresh()
        await settle()
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['fresh-start'])

        // Back to plain: the next gentle arrival replaces, never merges.
        payload = [{ id: 8, name: 'solo' }]
        await wildflower.getQuery(q).invalidate()
        await settle()
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['solo'])
    })

    it('tombstones: a truthy declared field removes the row in every mode', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'keep' }, { id: 2, name: 'dead', gone: true }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id', deleted: 'gone' })
        mountList(q, c)
        await settle()
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['keep'])

        payload = [{ id: 3, name: 'page2' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        // A gentle refetch retracts an accumulated row from the tail.
        payload = [{ id: 1, name: 'keep' }, { id: 3, gone: true }]
        await wildflower.getQuery(q).invalidate()
        await settle()
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['keep'])
    })

    it('tombstones apply at SSR adoption (choke point covers seeding)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {}) // never resolves: only adoption feeds the store
        wildflower.query(q, { from: '/api/x.json', key: 'id', deleted: 'gone' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                    <li data-seed='{"id":1}' data-bind="name">alive</li>
                    <li data-seed='{"id":2,"gone":true}' data-bind="name">retracted</li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(wildflower.getQuery(q).rows.length).toBe(1)
        expect(wildflower.getQuery(q).rows[0].name).toBe('alive')
    })

    it('sse data message merges over an accumulated store and honors tombstones', async () => {
        const restore = stubEventSource()
        try {
            const q = uname('q'); const c = uname('c')
            let payload = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
            window.fetch = async () => jsonResponse(payload)
            wildflower.query(q, { from: '/api/x.json', key: 'id', deleted: 'gone', refresh: 'sse', stream: '/api/x/stream' })
            mountList(q, c)
            await settle()
            payload = [{ id: 3, name: 'c' }]
            await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
            await settle()

            const es = FakeEventSource.instances[0]
            es.onmessage({ data: JSON.stringify([{ id: 9, name: 'pushed' }, { id: 2, gone: true }]) })
            await settle()
            const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
            expect(texts).toEqual(['pushed', 'a', 'c'])
        } finally { restore() }
    })

    it.skipIf(isMinifiedBuild())('unkeyed append warns WF-960 and applies as a replace', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        payload = [{ name: 'no-key' }] // missing the declared key
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        expect(warnings.filter(w => w.includes('[WF WF-960]')).length).toBe(1)
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['no-key'])
    })

    it('refresh() takes an options envelope: params ride inside params', async () => {
        const q = uname('q'); const c = uname('c')
        const urls = []
        window.fetch = async (url) => { urls.push(String(url)); return jsonResponse([{ id: 1, name: 'x' }]) }
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        await wildflower.getQuery(q).refresh({ params: { status: 'open' } })
        await settle()
        expect(urls.some(u => u.includes('status=open'))).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('direct params on refresh() are refused with WF-961 and never serialized', async () => {
        const q = uname('q'); const c = uname('c')
        const urls = []
        window.fetch = async (url) => { urls.push(String(url)); return jsonResponse([{ id: 1, name: 'x' }]) }
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        const before = urls.length

        // The removed direct-params form: the object IS the params.
        await wildflower.getQuery(q).refresh({ status: 'open' })
        await settle()

        expect(warnings.filter(w => w.includes('[WF WF-961]')).length).toBe(1)
        // It still refreshes, but the stray key is never sent as a parameter.
        expect(urls.length).toBeGreaterThan(before)
        expect(urls.some(u => u.includes('status=open'))).toBe(false)
    })

    // ── Pagination × SSR × lifecycle matrix ──

    it('the full chain: SSR-adopted window, then append, then gentle merge', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = []
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                    <li data-seed='{"id":1}' data-bind="name">served-a</li>
                    <li data-seed='{"id":2}' data-bind="name">served-b</li>
                </ul>
            </div>
        `
        // Registration fully inits matching DOM (the 1.3 lesson), so the
        // catch-up payload must be staged BEFORE the component registers.
        payload = [{ id: 1, name: 'served-a' }, { id: 2, name: 'served-b' }]
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        payload = [{ id: 3, name: 'page2' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        payload = [{ id: 9, name: 'newest' }, { id: 1, name: 'served-a' }]
        await wildflower.getQuery(q).invalidate()
        await settle()
        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['newest', 'served-a', 'served-b', 'page2'])
    })

    it('accumulation survives lifecycle teardown; the catch-up merges', async () => {
        const q = uname('q'); const c = uname('c')
        // The stub discriminates by page param: rung firings re-fetch the
        // BASE window and must never see page-2's payload (the first
        // version of this test conflated them and reordered its own tail).
        let base = [{ id: 1, name: 'a' }]
        const page2 = [{ id: 2, name: 'b' }]
        window.fetch = async (url) => jsonResponse(String(url).includes('page=2') ? page2 : base)
        wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 100
        mountList(q, c)
        await settle()
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle(80)

        container.innerHTML = ''
        await settle(450) // grace expires, teardown; data and accumulated persist
        expect(wildflower._queryControllers.get(q).active).toBe(false)

        base = [{ id: 9, name: 'new-head' }, { id: 1, name: 'a' }]
        const c2 = uname('c')
        mountList(q, c2)
        await settle(250) // re-observation catch-up is gentle: merge, not replace
        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['new-head', 'a', 'b'])
        delete wildflower._queryTeardownGraceMs
    })

    it('an empty base window under merge keeps the accumulation (absence is not a signal)', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        payload = [{ id: 2, name: 'b' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()

        payload = []
        await wildflower.getQuery(q).invalidate()
        await settle()
        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['a', 'b'])
    })

    it('merge upserts the whole row from the source; no field blending', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a', note: 'seeded-extra' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()
        payload = [{ id: 2, name: 'b' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()

        payload = [{ id: 1, name: 'a2' }] // source's row now has NO note field
        await wildflower.getQuery(q).invalidate()
        await settle()
        const row = wildflower.getQuery(q).rows.find(r => r.id === 1)
        expect(row.name).toBe('a2')
        expect('note' in row).toBe(false) // the source's row replaced wholesale
    })

    it('append is a stale refresh: isLoading stays false, isStale runs true in flight', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        window.fetch = () => new Promise(res => { release = () => res(jsonResponse([{ id: 2, name: 'b' }])) })
        const p = wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle(40)
        expect(wildflower.getQuery(q).isLoading).toBe(false)
        expect(wildflower.getQuery(q).isStale).toBe(true)
        release()
        await p
        await settle()
        expect(wildflower.getQuery(q).isStale).toBe(false)
        expect(wildflower.getQuery(q).rows.length).toBe(2)
    })

    it.skipIf(isMinifiedBuild())('record shape never accumulates: append degrades to replace with WF-960', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = { name: 'Ada', title: 'Ops' }
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/me.json' })
        mountRecord(q, c)
        await settle()

        payload = { name: 'Grace', title: 'Eng' }
        await wildflower.getQuery(q).refresh({ params: { v: 2 }, append: true })
        await settle()
        expect(wildflower.getQuery(q).rows.length).toBe(1) // one record, never two
        expect(container.querySelector('.name').textContent).toBe('Grace')
        expect(warnings.filter(w => w.includes('[WF WF-960]')).length).toBe(1)
    })

    it('a focus rung firing over an accumulated store merges end to end', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: 'focus' })
        mountList(q, c)
        await settle()
        payload = [{ id: 2, name: 'b' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()

        payload = [{ id: 9, name: 'while-away' }, { id: 1, name: 'a' }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['while-away', 'a', 'b'])
    })

    it('superseded append never splices (last call wins across modes)', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        // Payload-shaped stub (never a call counter): rung bleed from
        // earlier tests' still-graceful poll queries can add base-window
        // fetches here, and those must stay idempotent.
        let base = [{ id: 1, name: 'first' }]
        window.fetch = (url) => {
            if (String(url).includes('page=2')) {
                return new Promise(res => { release = () => res(jsonResponse([{ id: 5, name: 'slow-append' }])) })
            }
            return Promise.resolve(jsonResponse(base))
        }
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const appendP = wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true }) // hangs
        base = [{ id: 3, name: 'winner' }]
        await wildflower.getQuery(q).refresh() // supersedes and replaces
        await settle()
        release()
        await appendP
        await settle()
        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['winner']) // the superseded append never landed
    })
})
