/**
 * getQuery(name).patch(data) — the engine-sanctioned optimistic write
 * (V1_4_ROADMAP §4, formalizing the WF-950 hatch).
 *
 * Contract: patch applies rows through the ingestion choke point with
 * source 'patch'. Keyed rows update in place (order preserved), unseen
 * keys append, tombstones remove. Unkeyed data replaces (the record-query
 * case). The store is marked isStale until the next confirming sync,
 * which clears it. No WF-950 — patch IS the sanctioned path. lastSync,
 * error, syncError, and the accumulated flag are untouched.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-patch-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

const hook = () => window.__WF_DEVTOOLS_GLOBAL_HOOK__

suite('query patch() — sanctioned optimistic write', () => {
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
                <ul data-query="${qname}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('keyed patch updates a row in place, preserving order and the DOM', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }
        ])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 2, name: 'B!' }])
        await settle(40)

        expect(h.rows.map(r => r.name)).toEqual(['a', 'B!', 'c'])
        expect(h.isStale).toBe(true)
        const texts = [...container.querySelectorAll('.row')].map(e => e.textContent)
        expect(texts).toEqual(['a', 'B!', 'c'])
    })

    it('patch appends rows with unseen keys and honors tombstones', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id', deleted: 'gone' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 3, name: 'new' }, { id: 1, gone: true }])
        await settle(40)

        expect(h.rows.map(r => r.name)).toEqual(['b', 'new'])
        expect(h.isStale).toBe(true)
    })

    it('patch never draws WF-950; a direct store write still does', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 1, name: 'A' }])
        await settle(40)
        const wf950 = () => warnings.filter(w => w.includes('was written from application code')).length

        if (!isMinifiedBuild()) {
            expect(wf950(), 'patch must not draw WF-950').toBe(0)
            h.rows = [{ id: 9, name: 'external' }]
            await settle(20)
            expect(wf950(), 'direct write control must still draw WF-950').toBeGreaterThan(0)
        } else {
            expect(h.rows[0].name).toBe('A')
        }
    })

    it('a confirming sync clears isStale and wins over the patch', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'server' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        const lastSyncBefore = h.lastSync
        h.patch([{ id: 1, name: 'optimistic' }])
        await settle(40)
        expect(h.isStale).toBe(true)
        expect(h.lastSync, 'patch must not touch lastSync').toBe(lastSyncBefore)
        expect(h.rows[0].name).toBe('optimistic')

        payload = [{ id: 1, name: 'confirmed' }]
        h.invalidate()
        await settle()
        expect(h.isStale).toBe(false)
        expect(h.rows[0].name).toBe('confirmed')
    })

    it('unkeyed patch replaces (the record-query case)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'Ada', role: 'eng' })
        wildflower.query(q, { from: '/api/me.json' })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}">
                    <span class="who" data-bind="name"></span>
                    <span class="role" data-bind="role"></span>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.who').textContent).toBe('Ada')

        const h = wildflower.getQuery(q)
        h.patch({ name: 'Grace', role: 'eng' })
        await settle(40)

        expect(container.querySelector('.who').textContent).toBe('Grace')
        expect(h.isStale).toBe(true)
    })

    it('patch leaves the accumulated pagination flag untouched', async () => {
        const q = uname('q'); const c = uname('c')
        let page = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(page)
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        page = [{ id: 2, name: 'b' }]
        h.refresh({ append: true })
        await settle()

        h.patch([{ id: 1, name: 'A' }])
        await settle(40)

        if (!isMinifiedBuild()) {
            const entry = hook().getQueries().find(e => e.name === q)
            expect(entry.accumulated, 'patch must not reset accumulation').toBe(true)
            expect(entry.lastSource).toBe('patch')
        }
        expect(h.rows.map(r => r.name)).toEqual(['A', 'b'])
    })

    devIt('getQueries() reports lastSource "patch" after a patch', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).patch([{ id: 1, name: 'A' }])
        await settle(40)

        expect(hook().getQueries().find(e => e.name === q).lastSource).toBe('patch')
    })
})
