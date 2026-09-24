/**
 * write()'s reconcile path (mergePatchRow in QuerySystem.js, JSON Merge
 * Patch per RFC 7396) recurses into every plain-object field with no depth
 * cap and no cycle guard. findNonRoundTrippable in the same file already
 * solves this correctly (depth capped at 5, a `seen` Set for cycles) for its
 * own recursive walk; mergePatchRow needs the same shape.
 *
 * The trigger is application-supplied: JSON.parse can never produce a cycle,
 * so this needs a function `to:` or a `confirmation` callback returning
 * something self-referential or absurdly deep. The failure mode today is an
 * uncaught stack overflow inside write()'s resolve handler (v1.5.3 candidate
 * #2).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-cyc-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query write() reconcile: cycle and depth guard', () => {
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

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('a self-referential confirmation does not overflow the stack', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: (item) => {
                const confirmed = { id: item.id, title: 'confirmed' }
                confirmed.self = confirmed // cycle: confirmed.self.self.self... forever
                return confirmed
            }
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        let caught = null
        try {
            await h.write({ id: 1, title: 'x' })
        } catch (e) {
            caught = e
        }
        expect(caught).toBeNull()
        await settle(40)
        expect(h.rows[0].title).toBe('confirmed')
    })

    it('a confirmation nested far beyond the depth cap does not overflow the stack', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: (item) => {
                // 5000 levels of { child: { child: ... } } — no cycle, just
                // deep enough that unguarded recursion risks a real stack
                // overflow on its own.
                let deep = { leaf: true }
                for (let i = 0; i < 5000; i++) deep = { child: deep }
                return { id: item.id, title: 'confirmed', deep }
            }
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        let caught = null
        try {
            await h.write({ id: 1, title: 'x' })
        } catch (e) {
            caught = e
        }
        expect(caught).toBeNull()
        await settle(40)
        expect(h.rows[0].title).toBe('confirmed')
    })

    // A sub-object reused in two places is not a cycle. Both occurrences must
    // merge the same way (RFC 7396: null deletes, absent fields survive).
    it('a sub-object shared by two fields merges identically at both', async () => {
        const q = uname('q'); const c = uname('c')
        const row = () => ({ street: 'a', geo: { lat: 1, lng: 2, keep: 'k' } })
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', billing: row(), shipping: row() }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: (item) => {
                const addr = { street: 'z', geo: { lat: 9, lng: null } }
                return { id: item.id, title: 'confirmed', billing: addr, shipping: addr }
            }
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'x' })
        await settle(40)

        const expected = { street: 'z', geo: { lat: 9, keep: 'k' } }
        expect(JSON.parse(JSON.stringify(h.rows[0].billing))).toEqual(expected)
        expect(JSON.parse(JSON.stringify(h.rows[0].shipping)), 'second occurrence was not merged').toEqual(expected)
    })
})
