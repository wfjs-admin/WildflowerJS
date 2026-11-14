/**
 * Query edge cases.
 *
 * 1. A row key matches in any spelling: '1' from the DOM or the route names
 *    the row keyed 1. (Row matching was strict while the in-flight claims
 *    compared as strings, so a write keyed '1' left row 1 unedited and added
 *    a third row until the next fetch.)
 * 2. A read answered 204 means no rows. An empty 200 is an error whose text
 *    says the response had no body (it was the JSON parser's message).
 * 3. Registering a name a second time returns the handle and starts nothing.
 * 4. A data-query element detached past the grace and put back resumes when
 *    scan() runs over it (pinned; documented).
 * 5. The page-revisit cache keeps its own copy of each row: an edit made in
 *    place does not come back as the server's earlier answer.
 * 6. Development builds name a param whose value is an object.
 * 7. A retry and an invalidateQueries() refetch do not run for a query
 *    nothing has watched for the grace.
 * 8. A validator leaves with its URL's cached rows.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-lf-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
const json = (data, headers) => new Response(JSON.stringify(data), { status: 200, headers: headers || {} })

suite('query edge cases', () => {
    let container
    let wildflower
    let realFetch
    let calls
    let respond
    let graceWas

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        calls = []
        respond = () => json([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
        window.fetch = async (url, init = {}) => {
            const u = new URL(url, location.href)
            const call = { method: init.method || 'GET', path: u.pathname + u.search }
            calls.push(call)
            return respond(call, init)
        }
        graceWas = wildflower._queryTeardownGraceMs
    })

    afterEach(() => {
        window.fetch = realFetch
        wildflower._queryTeardownGraceMs = graceWas
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const listMarkup = (q, c) => `<div data-component="${c}"><ul data-query="${q}"><template><li class="row"><span data-bind="title"></span></li></template></ul></div>`
    function mountList(q, c) {
        container.innerHTML = listMarkup(q, c)
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }
    const titles = () => [...container.querySelectorAll('.row')].map(li => li.textContent.trim())
    const gets = () => calls.filter(c => c.method === 'GET').length

    it('a write whose key is the string form of a numeric key edits that row, and adds none', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        respond = (call) => call.method === 'GET'
            ? json([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
            : new Promise(r => { release = () => r(new Response(null, { status: 204 })) })
        wildflower.query(q, { from: '/api/items', to: '/api/items/:id' })
        mountList(q, c)
        await settle()
        const done = wildflower.getQuery(q).write({ id: '1', title: 'edited' })
        await settle(50)
        expect(titles()).toEqual(['edited', 'b'])
        expect(calls.filter(x => x.method !== 'GET').map(x => x.path)).toEqual(['/api/items/1'])
        release()
        await done
        await settle()
        expect(titles().length).toBe(2)
    })

    it('a read answered 204 empties the list, with no error', async () => {
        const q = uname('q'); const c = uname('c')
        respond = () => new Response(null, { status: 204 })
        wildflower.query(q, { from: '/api/items' })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.isLoading).toBe(false)
        expect(h.error == null || h.error === '').toBe(true)
        expect(titles()).toEqual([])
    })

    it('a read answered 200 with no body is an error that says so', async () => {
        const q = uname('q'); const c = uname('c')
        respond = () => new Response('', { status: 200 })
        const error = console.error
        console.error = () => {}
        try {
            wildflower.query(q, { from: '/api/items' })
            mountList(q, c)
            await settle()
        } finally { console.error = error }
        const h = wildflower.getQuery(q)
        expect(h.isLoading).toBe(false)
        expect(String(h.error)).toContain('no body')
    })

    it('registering the same name twice starts no fetch', async () => {
        const q = uname('q')
        const warn = console.warn
        console.warn = () => {}
        try {
            wildflower.query(q, { from: '/api/items' })
            wildflower.query(q, { from: '/api/items' })
            await settle()
        } finally { console.warn = warn }
        expect(calls).toEqual([])
    })

    it('a data-query element put back after the grace resumes when scan() runs over it', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower._queryTeardownGraceMs = 100
        wildflower.query(q, { from: '/api/items', refresh: [0.05] })
        mountList(q, c)
        await settle(150)
        const host = container.firstElementChild
        host.remove()
        await settle(400)
        const before = gets()
        container.appendChild(host)
        wildflower.scan(container)
        await settle(300)
        expect(gets()).toBeGreaterThan(before)
    })

    it('the page-revisit cache repaints what the server said, not an edit made in place', async () => {
        const q = uname('q'); const c = uname('c')
        let hold = null
        respond = (call) => {
            const page = new URL(call.path, location.href).searchParams.get('page') || '1'
            const body = json([{ id: Number(page) * 10, title: 'server-' + page }])
            return hold ? new Promise(r => { hold.release = () => r(body) }) : body
        }
        wildflower.query(q, { from: '/api/items', params: { page: 1 } })
        mountList(q, c)
        await settle()
        expect(titles()).toEqual(['server-1'])
        wildflower.getQuery(q).rows[0].title = 'EDITED'
        await settle(30)
        await wildflower.getQuery(q).refresh({ params: { page: 2 } })
        await settle(30)
        hold = {}
        const back = wildflower.getQuery(q).refresh({ params: { page: 1 } })
        await settle(50)
        expect(titles()).toEqual(['server-1'])
        hold.release()
        await back
    })

    devIt('a param whose value is an object is named in a development warning', async () => {
        const q = uname('q'); const c = uname('c')
        const seen = []
        const warn = console.warn
        console.warn = (...a) => { seen.push(a.map(String).join(' ')) }
        try {
            wildflower.query(q, { from: '/api/items', params: { filter: { status: 'open' } } })
            mountList(q, c)
            await settle()
        } finally { console.warn = warn }
        expect(seen.some(s => s.indexOf('filter') !== -1 && s.indexOf('object') !== -1)).toBe(true)
    })

    it('invalidateQueries() does not refetch a query nothing has watched for the grace', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower._queryTeardownGraceMs = 100
        wildflower.query(q, { from: '/api/items' })
        mountList(q, c)
        await settle()
        expect(gets()).toBe(1)
        container.innerHTML = ''
        await settle(300)
        await wildflower.invalidateQueries(q)
        await settle(300)
        await wildflower.invalidateQueries(q)
        await settle()
        expect(gets()).toBe(1)
    })

    it('invalidateQueries() refetches a query that is on the page (control)', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower._queryTeardownGraceMs = 100
        wildflower.query(q, { from: '/api/items' })
        mountList(q, c)
        await settle(300)
        await wildflower.invalidateQueries(q)
        await settle()
        expect(gets()).toBe(2)
    })

    // What counts as watching: not only a data-query element. A reader whose
    // value has not changed lately is still a reader.
    const READERS = [
        ['a $name. binding', (q) => `<b class="n" data-bind="$${q}.count"></b>`, {}],
        ['a computed over getQuery() that a binding shows', () => `<b class="n" data-bind="howMany"></b>`,
            (q) => ({ computed: { howMany() { return window.wildflower.getQuery(q).rows.length } } })],
        ['a list over $name.rows', (q) => `<ul data-list="$${q}.rows" data-key="id"><template><li class="n" data-bind="title"></li></template></ul>`, {}],
    ]
    for (const [label, markup, extra] of READERS) {
        it(`invalidateQueries() refetches a query watched only through ${label}, long after its last change`, async () => {
            const q = uname('q'); const c = uname('c')
            wildflower._queryTeardownGraceMs = 100
            wildflower.query(q, { from: '/api/items' })
            wildflower.component(c, { state: {}, ...(typeof extra === 'function' ? extra(q) : extra) })
            container.innerHTML = `<div data-component="${c}">${markup(q)}</div>`
            wildflower.scan(container)
            await settle(400)
            const before = gets()
            expect(before).toBeGreaterThan(0)
            await wildflower.invalidateQueries(q)
            await settle(300)
            await wildflower.invalidateQueries(q)
            await settle()
            expect(gets()).toBe(before + 2)
            container.innerHTML = ''
            await settle(300)
            await wildflower.invalidateQueries(q)
            await settle(300)
            await wildflower.invalidateQueries(q)
            await settle()
            expect(gets()).toBe(before + 2)
        })
    }

    it('the retry ladder stops once nothing has watched the query for the grace', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower._queryTeardownGraceMs = 100
        respond = () => new Response('{}', { status: 500 })
        const error = console.error
        console.error = () => {}
        try {
            wildflower.query(q, { from: '/api/items', retry: 5 })
            mountList(q, c)
            await settle(50)
            container.innerHTML = ''
            await settle(4500)
        } finally { console.error = error }
        expect(gets()).toBeLessThanOrEqual(2)
    }, 10000)

    devIt('a validator leaves with its URL\'s cached rows', async () => {
        const q = uname('q'); const c = uname('c')
        respond = (call) => json([{ id: 1, title: call.path }], { ETag: '"' + call.path + '"' })
        wildflower.query(q, { from: '/api/items', params: { page: 0 } })
        mountList(q, c)
        await settle()
        for (let p = 1; p <= 40; p++) await wildflower.getQuery(q).refresh({ params: { page: p } })
        const controller = wildflower._queryControllers.get(q)
        const cached = controller.snapshots ? controller.snapshots.size : 0
        expect(cached).toBeGreaterThan(0)
        expect(Object.keys(controller.etags || {}).length).toBeLessThanOrEqual(cached + 1)
    })
})
