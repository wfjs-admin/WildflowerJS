/**
 * @vitest-environment browser
 *
 * Review tier-3 batch:
 * - R23: the append/patch tail dedup used a `seen` snapshot never updated
 *   inside its own loop, so two same-key rows in ONE payload (key not
 *   already present) both appended — silent row duplication, and every
 *   later write against that key resolved against the first copy.
 * - A2: WF-960's unkeyed-append guard inspected only live[0], so a MIXED
 *   payload whose first row was keyed slipped the guard; the unkeyed rows
 *   entered the accumulation once and then vanished from every later page.
 * - A3: write('delete') with no `deleted:` declared fired WF-975 AND
 *   WF-976 for the one mistake, and WF-976's advice is wrong for a
 *   delete. One mistake, one warning.
 * - R20 / WF-985: `initial:` silently did nothing for any non-array —
 *   and the natural record-query seed IS an object. Every other
 *   misdeclared option in the constructor warns; now this one does too.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const itDev = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-qt3-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query tier-3 guards', () => {
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
        console.warn = (...a) => { warnings.push(a.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
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

    const count = (code) => warnings.filter(w => w.includes(code)).length

    // R23 — the duplicate-key payload. Needs a malformed payload (a source
    // or caller defect), but the engine must degrade to ONE row, not two.
    it('R23: duplicate keys within one patch payload collapse to one appended row', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/items', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 9, name: 'first' }, { id: 9, name: 'second' }])
        await settle(40)

        const nines = h.rows.filter(r => r.id === 9)
        expect(nines.length, 'one row per key, later payload entry wins the merge slot').toBe(1)
        expect(h.rows.length).toBe(2)
    })

    // A2 — the mixed append page. The guard must see the unkeyed rows
    // wherever they sit in the payload, downgrade to replace, and warn.
    itDev('A2: a mixed keyed/unkeyed append page warns WF-960 and applies as a replace', async () => {
        const q = uname('q'); const c = uname('c')
        let page = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(page)
        wildflower.query(q, { from: '/api/items', key: 'id' })
        mountList(q, c)
        await settle()

        page = [{ id: 2, name: 'b' }, { name: 'unkeyed' }]
        wildflower.getQuery(q).refresh({ append: true })
        await settle(40)

        expect(count('WF-960'), 'the mixed page is named').toBeGreaterThan(0)
        const h = wildflower.getQuery(q)
        expect(h.rows.length, 'applied as a replace, not an accumulation').toBe(2)
        expect(h.rows.map(r => r.name)).toEqual(['b', 'unkeyed'])
    })

    itDev('A2 calibration: a fully keyed append page accumulates silently', async () => {
        const q = uname('q'); const c = uname('c')
        let page = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(page)
        wildflower.query(q, { from: '/api/items', key: 'id' })
        mountList(q, c)
        await settle()

        page = [{ id: 2, name: 'b' }]
        wildflower.getQuery(q).refresh({ append: true })
        await settle(40)

        expect(count('WF-960')).toBe(0)
        expect(wildflower.getQuery(q).rows.length).toBe(2)
    })

    // A3 — one mistake, one warning.
    itDev('A3: delete with no deleted: field warns WF-975 alone, never WF-976 too', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            to: { delete: { url: '/api/items/:id', method: 'DELETE' } }
        })
        mountList(q, c)
        await settle()

        await wildflower.getQuery(q).write('delete', { id: 1 }).catch(() => {})
        await settle(40)

        expect(count('WF-975'), 'the real mistake is named').toBeGreaterThan(0)
        expect(count('WF-976'), 'no second warning with wrong advice').toBe(0)
    })

    itDev('A3 calibration: a keyless pure side-effect operation still gets WF-976', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            to: { resend: { url: '/api/items/:id/resend', method: 'POST' } }
        })
        mountList(q, c)
        await settle()

        await wildflower.getQuery(q).write('resend', { id: 1 }).catch(() => {})
        await settle(40)

        expect(count('WF-976')).toBeGreaterThan(0)
        expect(count('WF-975')).toBe(0)
    })

    // R20 / WF-985 — the natural record seed is an object; it must be named,
    // not silently dropped.
    itDev('WF-985: a non-array initial: warns at registration', async () => {
        const q = uname('q')
        wildflower.query(q, { from: async () => [], initial: { name: 'Loading…' } })
        expect(warnings.some(w => w.includes('WF-985') && w.includes(q)),
            'the dropped seed is named').toBe(true)
    })

    itDev('WF-985 calibration: an array initial: stays silent and seeds', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Promise(() => {})   // never resolves
        wildflower.query(q, { from: '/api/items', key: 'id', initial: [{ id: 1, name: 'seed' }] })
        mountList(q, c)
        await settle()

        expect(warnings.some(w => w.includes('WF-985'))).toBe(false)
        expect(wildflower.getQuery(q).rows[0].name).toBe('seed')
    })
})
