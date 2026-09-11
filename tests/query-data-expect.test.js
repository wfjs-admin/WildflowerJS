/**
 * data-expect — dev-scoped shape-drift warn at the query boundary
 * (V1_4_ROADMAP §4b, ruled 2026-07-25; WF-962).
 *
 * Scope, deliberately narrow: dev builds only; warns when a declared field
 * is missing from incoming rows or present with a different primitive type
 * (string|number|boolean). Presence-only tokens check existence alone.
 * Null values are a data condition, not drift. One warn per query per
 * field per kind, forever (poll-flood protection). No coercion, no
 * transformation, no throwing, no production cost — the attribute is inert
 * in minified builds.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it
const minIt = isMinifiedBuild() ? it : it.skip

let seq = 0
const uname = (p) => `${p}-exp-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-expect shape-drift warn (WF-962)', () => {
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

    // The bracketed prefix appears exactly once per wfError call (the
    // trailing "↳ Docs:" line also contains the bare code, so a bare
    // filter double-counts).
    const wf962 = () => warnings.filter(w => w.includes('[WF WF-962]'))

    function mountList(qname, cname, expectSpec) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}" data-expect="${expectSpec}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    devIt('a missing declared field warns once, naming query, field, and source', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, name:string, price:number')
        await settle()

        expect(wf962().length).toBe(1)
        expect(wf962()[0]).toContain(q)
        expect(wf962()[0]).toContain('price')
        expect(wf962()[0]).toContain('fetch')

        wildflower.getQuery(q).invalidate()
        await settle()
        expect(wf962().length, 'same drift must not re-warn').toBe(1)
    })

    devIt('a primitive type drift warns with declared vs actual', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: '1', name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, name:string')
        await settle()

        expect(wf962().length).toBe(1)
        expect(wf962()[0]).toContain('id')
        expect(wf962()[0]).toContain('number')
        expect(wf962()[0]).toContain('string')
    })

    devIt('a conforming payload is silent', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a', ok: true }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, name:string, ok:boolean')
        await settle()

        expect(wf962().length).toBe(0)
    })

    devIt('presence-only tokens check existence, not type; null is not drift', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: null, tag: { a: 1 } }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id, name:string, tag')
        await settle()

        expect(wf962().length, 'null value and typeless tokens must not warn').toBe(0)
    })

    devIt('drift arriving via patch() warns with source "patch"', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, name:string')
        await settle()
        expect(wf962().length).toBe(0)

        wildflower.getQuery(q).patch([{ id: 2, name: 42 }])
        await settle(40)

        expect(wf962().length).toBe(1)
        expect(wf962()[0]).toContain('patch')
    })

    devIt('a malformed declaration token is ignored with a warn; valid tokens still check', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1 }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, price:currency, name:string')
        await settle()

        const all = wf962()
        expect(all.some(w => w.includes('currency')), 'bad token warns').toBe(true)
        expect(all.some(w => w.includes('"name"')), 'valid tokens still checked').toBe(true)
    })

    // ── Slot burn on client partials (survey batch 8, Lane B row 2) ─────
    // The drift warn is once-per-query-per-field-per-kind, forever. An
    // optimistic write applies a PARTIAL through the same choke point, and a
    // partial legitimately omits every field it is not writing, so checking
    // it spent the "missing" slot on a non-arrival and masked the real drift
    // that arrived later from the server. A client intent is not data to
    // validate; only genuine arrivals are.
    devIt('an optimistic write partial does not burn the drift slot', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'a', price: 10 }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, {
            from: '/api/x.json', key: 'id',
            to: () => Promise.resolve(undefined)
        })
        mountList(q, c, 'id:number, name:string, price:number')
        await settle()
        expect(wf962().length, 'complete rows, no drift').toBe(0)

        // A write carries only what it changes. `name` and `price` are absent
        // by design, not missing from the source.
        await wildflower.getQuery(q).write({ id: 1, name: 'b' }).catch(() => {})
        await settle(40)
        expect(wf962().length, 'a client partial is not an arrival to validate').toBe(0)

        // Now the source really does drop a declared field.
        payload = [{ id: 1, name: 'b' }]
        await wildflower.getQuery(q).refresh()
        await settle(40)

        const hits = wf962()
        expect(hits.length, 'the real drift still gets said').toBe(1)
        expect(hits[0]).toContain('price')
    })

    minIt('the attribute is inert in production: rows render, nothing warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c, 'id:number, name:string, price:number')
        await settle()

        expect(container.querySelector('.row').textContent).toBe('a')
        expect(wf962().length).toBe(0)
    })
})
