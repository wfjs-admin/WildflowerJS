/**
 * Four places where a query took a name or a value for more than it was.
 *
 * 1. persist: 'key' names a storage key of the author's choosing. A value
 *    already there that is not a query snapshot (the app's settings, another
 *    library's data) was deleted on first activation when it parsed as JSON,
 *    and overwritten by the next save when it did not. It is left alone, and
 *    the query runs without persistence.
 * 2. A token named like an inherited member (:toString) took the inherited
 *    function as its value, and the request went out with the function's
 *    source in its path. It has no value until one is supplied.
 * 3. A write of a field named like an inherited member (constructor) to a row
 *    without that field recorded the inherited function as the field's
 *    earlier value, and a rejected write put it on the row as its own field.
 * 4. Development builds: a param that JSON cannot serialize (a BigInt) made
 *    the next engine refetch throw from a diagnostic.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-ie-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('query input edges', () => {
    let container
    let wildflower
    let realFetch
    let calls
    let fail
    const keys = []

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        calls = []
        fail = false
        window.fetch = async (url, init = {}) => {
            const method = init.method || 'GET'
            calls.push({ method, path: new URL(url, location.href).pathname + new URL(url, location.href).search })
            if (method === 'GET') return new Response('[{"id":1,"title":"a"}]', { status: 200 })
            if (fail) return new Response('{}', { status: 500 })
            return new Response(null, { status: 204 })
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
        while (keys.length) localStorage.removeItem(keys.pop())
    })

    function mountList(q, c) {
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li class="row"><span data-bind="title"></span></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    for (const [label, value] of [['a JSON object', '{"theme":"dark","fontSize":14}'], ['a number', '42'], ['text that is not JSON', 'dark-mode']]) {
        it(`a custom persist key that already holds ${label} is left alone, through a fetch and its save`, async () => {
            const q = uname('q'); const c = uname('c'); const key = uname('settings')
            keys.push(key)
            localStorage.setItem(key, value)
            const warn = console.warn
            console.warn = () => {}
            try {
                wildflower.query(q, { from: '/api/items', persist: key })
                mountList(q, c)
                await settle(200)
            } finally { console.warn = warn }
            expect(calls.length).toBe(1)
            expect(container.querySelectorAll('.row').length).toBe(1)
            expect(localStorage.getItem(key)).toBe(value)
        })
    }

    it('a custom persist key holding nothing, or an old snapshot of the query, still persists (control)', async () => {
        const q = uname('q'); const c = uname('c'); const key = uname('snap')
        keys.push(key)
        wildflower.query(q, { from: '/api/items', persist: key })
        mountList(q, c)
        await settle(200)
        const saved = JSON.parse(localStorage.getItem(key))
        expect(saved.v).toBe(1)
        expect(saved.rows).toEqual([{ id: 1, title: 'a' }])
    })

    it('a token named like an inherited member waits for a value', async () => {
        const q = uname('q'); const c = uname('c')
        const warn = console.warn
        console.warn = () => {}
        try {
            wildflower.query(q, { from: '/api/x/:toString' })
            mountList(q, c)
            await settle()
        } finally { console.warn = warn }
        expect(calls).toEqual([])
    })

    it('a rejected write of a field the row lacks, named like an inherited member, leaves the row without it', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', to: '/api/items/:id' })
        mountList(q, c)
        await settle()
        fail = true
        const error = console.error
        console.error = () => {}
        let rejected = false
        try {
            await wildflower.getQuery(q).write({ id: 1, constructor: 'McLaren' }).catch(() => { rejected = true })
            await settle()
        } finally { console.error = error }
        expect(rejected).toBe(true)
        // The row's own field after the rollback is what it was before the
        // write (nothing), never the function a plain object inherits.
        const own = Object.getOwnPropertyDescriptor(wildflower.getQuery(q).rows[0], 'constructor')
        expect(own ? own.value : undefined).toBe(undefined)
    })

    it('a param JSON cannot serialize does not make the next engine refetch throw', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', params: () => ({}) })
        mountList(q, c)
        await settle()
        const warn = console.warn
        console.warn = () => {}
        let threw = null
        try {
            await wildflower.getQuery(q).refresh({ params: { page: 2n } })
            await wildflower.getQuery(q).invalidate().catch((e) => { threw = e })
            await settle()
        } finally { console.warn = warn }
        expect(threw).toBe(null)
    })
})
