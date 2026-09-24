/**
 * A `__proto__` key in query data (JSON.parse makes it an own, enumerable
 * property) must never become a row's prototype, and must never reach
 * Object.prototype.
 *
 * Copying such an object with `Object.assign` or `out[k] = v` runs the
 * inherited __proto__ setter, so the copy's prototype is swapped for the
 * attacker's object and `row.isAdmin` reads true (and renders). Fetch ingest
 * already keeps the key as plain data; the MERGE paths (patch(), write()'s
 * confirmation, create's minted-key copy, SSR adoption) skip it, as Solid's
 * store and jQuery.extend do. SSR adoption's `data-bind` path walk must not
 * descend into Object.prototype either.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-proto-${++seq}`
const raw = (s) => new Response(s, { status: 200 })
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))
const EVIL = '{"__proto__":{"isAdmin":true}}'

suite('data-query: a __proto__ key in data never becomes a prototype', () => {
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
        delete Object.prototype.isAdmin
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row"><span class="t" data-bind="title"></span><span class="adm" data-bind="isAdmin"></span></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    function mountRecord(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}"><span class="nm" data-bind="name"></span><span class="adm" data-bind="isAdmin"></span></div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const admText = () => container.querySelector('.adm').textContent

    it('keyed patch(): the key is skipped, the other fields merge', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('[{"id":1,"title":"a"}]')
        wildflower.query(q, { from: '/api/x', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([JSON.parse('{"id":1,"title":"b","__proto__":{"isAdmin":true}}')])
        await settle(40)

        expect(h.rows[0].title).toBe('b')
        expect(h.rows[0].isAdmin).toBeUndefined()
        expect(admText()).toBe('')
        expect(({}).isAdmin).toBeUndefined()
    })

    it('keyed patch(): a fetched row carrying the key as data does not swap on merge', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('[{"id":1,"title":"a","__proto__":{"isAdmin":true}}]')
        wildflower.query(q, { from: '/api/x', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 1, title: 'b' }])
        await settle(40)

        expect(h.rows[0].title).toBe('b')
        expect(h.rows[0].isAdmin).toBeUndefined()
        expect(admText()).toBe('')
    })

    it('record patch(): the key is skipped, the other fields merge', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('{"name":"Ada"}')
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch(JSON.parse('{"name":"Grace","__proto__":{"isAdmin":true}}'))
        await settle(40)

        expect(h.rows[0].name).toBe('Grace')
        expect(h.rows[0].isAdmin).toBeUndefined()
        expect(admText()).toBe('')
    })

    it('write(): a server confirmation carrying the key does not swap the row', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('[{"id":1,"title":"a"}]')
        wildflower.query(q, {
            from: '/api/x', key: 'id',
            to: async () => JSON.parse('{"id":1,"title":"confirmed","__proto__":{"isAdmin":true}}')
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'x' })
        await settle(40)

        expect(h.rows[0].title).toBe('confirmed')
        expect(h.rows[0].isAdmin).toBeUndefined()
        expect(admText()).toBe('')
    })

    it('write(): a nested object in the confirmation skips the key too', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('[{"id":1,"title":"a","meta":{"v":1}}]')
        wildflower.query(q, {
            from: '/api/x', key: 'id',
            to: async () => JSON.parse('{"id":1,"title":"confirmed","meta":{"v":2,"__proto__":{"isAdmin":true}}}')
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'x' })
        await settle(40)

        expect(h.rows[0].meta.v).toBe(2)
        expect(h.rows[0].meta.isAdmin).toBeUndefined()
    })

    it('create(): an item carrying the key does not swap the optimistic row', async () => {
        const q = uname('q'); const c = uname('c')
        // The read answers; the POST never settles, so the optimistic row stays.
        window.fetch = (url, init) => (init && init.method && init.method !== 'GET')
            ? new Promise(() => {})
            : Promise.resolve(raw('[]'))
        wildflower.query(q, { from: '/api/x', key: 'id', create: { url: '/api/x', body: (i) => ({ title: i.title }) } })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.create(JSON.parse('{"title":"new","__proto__":{"isAdmin":true}}')).catch(() => {})
        await settle(40)

        expect(h.rows.length).toBe(1)
        expect(h.rows[0].title).toBe('new')
        expect(h.rows[0].isAdmin).toBeUndefined()
        expect(admText()).toBe('')
    })

    it('record query: a fetched __proto__ key does not reach the scope expressions read', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => raw('{"name":"Ada","__proto__":{"isAdmin":true}}')
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}">
                    <span class="nm" data-bind="name"></span>
                    <span class="adm" data-show="isAdmin">ADMIN</span>
                    <i class="cls" data-bind-class="isAdmin ? 'adm' : 'no'"></i>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.nm').textContent).toBe('Ada')
        expect(container.querySelector('.adm').style.display).toBe('none')
        expect(container.querySelector('.cls').classList.contains('adm')).toBe(false)
    })

    it('SSR adoption: a data-seed carrying the key does not swap the record', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}" data-seed='${EVIL}'>
                    <h2 data-bind="name">Ada</h2>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const rec = wildflower.getQuery(q).rows[0]
        expect(rec.name).toBe('Ada')
        expect(rec.isAdmin).toBeUndefined()
    })

    it('SSR adoption: a data-bind path through __proto__ never reaches Object.prototype', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <article data-query="${q}">
                    <h2 data-bind="name">Ada</h2>
                    <span data-bind="__proto__.isAdmin">yes</span>
                </article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(({}).isAdmin).toBeUndefined()
        const rec = wildflower.getQuery(q).rows[0]
        expect(rec.name).toBe('Ada')
        expect(rec.isAdmin).toBeUndefined()
    })
})
