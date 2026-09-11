/**
 * refresh({ clear: true }): the list's identity changed, so the rows on
 * screen describe a different list and must not stay up while the new one
 * loads. Every other refetch path keeps its behavior (previous rows stay,
 * marked isStale), which is what a pager wants and what a filter, profile,
 * or tag switch does not.
 *
 * Cleared: rows (so count), error, syncError, isStale, lastSync. Kept: the
 * result cache (a cached target URL paints as stale instead of loading),
 * the ETag validators, the persisted snapshot. Appended pages are dropped.
 * A write pending on a cleared row settles without re-appending it.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-clr-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

function jsonResponse(data, { status = 200, etag } = {}) {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    if (etag) headers.set('ETag', etag)
    return new Response(JSON.stringify(data), { status, headers })
}

const LISTS = {
    a: [{ id: 1, name: 'a1' }, { id: 2, name: 'a2' }],
    b: [{ id: 3, name: 'b1' }]
}

suite('refresh({ clear: true })', () => {
    let container
    let wildflower
    let realFetch
    let realWarn
    let warnings
    let calls
    let holds       // when set, responses wait until release() is called
    let release

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        warnings = []
        console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
        calls = []
        holds = false
        release = null
        window.fetch = (url) => {
            const u = String(url)
            calls.push(u)
            const list = (u.match(/list=([ab])/) || [])[1] || 'a'
            const page = Number((u.match(/page=(\d+)/) || [])[1] || 1)
            const rows = page === 2 ? [{ id: 9, name: 'p2' }] : LISTS[list]
            if (!holds) return Promise.resolve(jsonResponse(rows))
            return new Promise(res => { release = () => res(jsonResponse(rows)) })
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function declare(q, extra = {}) {
        const state = { list: 'a', page: 1 }
        wildflower.query(q, Object.assign({
            from: '/api/items',
            key: 'id',
            params: () => ({ list: state.list, page: state.page })
        }, extra))
        return state
    }

    function mount(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <p class="loading" data-show="$${q}.isLoading">loading</p>
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const names = () => Array.from(container.querySelectorAll('li')).map(li => li.textContent)
    const loadingShown = () => container.querySelector('.loading').style.display !== 'none'

    it('resets the store and shows loading until the new rows land', async () => {
        const q = uname('q'); const c = uname('c')
        const state = declare(q)
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)
        expect(names()).toEqual(['a1', 'a2'])
        expect(s.lastSync).not.toBeNull()

        holds = true
        state.list = 'b'
        const p = s.refresh({ clear: true })
        await settle(40)
        expect(s.rows.length).toBe(0)
        expect(s.count).toBe(0)
        expect(s.isLoading).toBe(true)
        expect(s.isStale).toBe(false)
        expect(s.lastSync).toBeNull()
        expect(s.error).toBeNull()
        expect(s.syncError).toBeNull()
        expect(names()).toEqual([])
        expect(loadingShown()).toBe(true)

        release()
        await p
        await settle(60)
        expect(names()).toEqual(['b1'])
        expect(s.isLoading).toBe(false)
        expect(s.isStale).toBe(false)
        expect(s.lastSync).not.toBeNull()
        expect(loadingShown()).toBe(false)
        expect(warnings.filter(w => w.includes('WF-961'))).toEqual([])
    })

    it('a plain refresh with new params keeps the previous rows, marked stale', async () => {
        const q = uname('q'); const c = uname('c')
        const state = declare(q)
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        holds = true
        state.list = 'b'
        const p = s.refresh()
        await settle(40)
        expect(names()).toEqual(['a1', 'a2'])
        expect(s.isStale).toBe(true)
        expect(s.isLoading).toBe(false)

        release()
        await p
        await settle(60)
        expect(names()).toEqual(['b1'])
        expect(s.isStale).toBe(false)
    })

    it('a cached target URL paints as stale instead of loading', async () => {
        const q = uname('q'); const c = uname('c')
        const state = declare(q)
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        state.list = 'b'
        await s.refresh()
        await settle(60)
        expect(names()).toEqual(['b1'])

        holds = true
        state.list = 'a'
        const p = s.refresh({ clear: true })
        await settle(40)
        expect(names()).toEqual(['a1', 'a2'])
        expect(s.isStale).toBe(true)
        expect(s.isLoading).toBe(false)

        release()
        await p
        await settle(60)
        expect(names()).toEqual(['a1', 'a2'])
        expect(s.isStale).toBe(false)
    })

    it('drops appended pages and returns the query to plain', async () => {
        const q = uname('q'); const c = uname('c')
        const state = declare(q)
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        await s.refresh({ params: { page: 2 }, append: true })
        await settle(60)
        expect(names()).toEqual(['a1', 'a2', 'p2'])

        state.list = 'b'
        await s.refresh({ clear: true })
        await settle(60)
        expect(names()).toEqual(['b1'])

        // Back to plain: a later plain refresh replaces rather than merges.
        state.list = 'a'
        await s.refresh()
        await settle(60)
        expect(names()).toEqual(['a1', 'a2'])
    })

    it('invalidate() never clears', async () => {
        const q = uname('q'); const c = uname('c')
        declare(q)
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        holds = true
        const p = s.invalidate()
        await settle(40)
        expect(names()).toEqual(['a1', 'a2'])
        expect(s.isLoading).toBe(false)
        release()
        await p
        await settle(40)
        expect(names()).toEqual(['a1', 'a2'])
    })

    it('a write pending across a clear settles without re-appending its row', async () => {
        const q = uname('q'); const c = uname('c')
        let resolveWrite = null
        const state = declare(q, {
            to: (item) => new Promise(res => { resolveWrite = () => res({ id: item.id, name: item.name }) })
        })
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        const w = s.write({ id: 1, name: 'a1!' })
        await settle(20)
        expect(s.pendingWrites).toBe(1)
        expect(names()).toEqual(['a1!', 'a2'])

        state.list = 'b'
        await s.refresh({ clear: true })
        await settle(60)
        expect(names()).toEqual(['b1'])

        resolveWrite()
        await w
        await settle(60)
        expect(s.pendingWrites).toBe(0)
        expect(names()).toEqual(['b1'])
        expect(s.isStale).toBe(false)
        expect(s.syncError).toBeNull()
    })

    it('a write rejected after a clear reports the error and restores nothing', async () => {
        const q = uname('q'); const c = uname('c')
        let rejectWrite = null
        const state = declare(q, {
            to: () => new Promise((res, rej) => { rejectWrite = () => rej(new Error('nope')) })
        })
        mount(q, c)
        await settle(120)
        const s = wildflower.getQuery(q)

        const w = s.write({ id: 1, name: 'a1!' }).catch(() => 'rejected')
        await settle(20)
        state.list = 'b'
        await s.refresh({ clear: true })
        await settle(60)
        expect(names()).toEqual(['b1'])

        rejectWrite()
        expect(await w).toBe('rejected')
        await settle(60)
        expect(s.pendingWrites).toBe(0)
        expect(names()).toEqual(['b1'])
        expect(s.syncError).not.toBeNull()
    })

    it('record shape: the record clears and the new one lands', async () => {
        const q = uname('q'); const c = uname('c')
        const state = { user: 'ann' }
        window.fetch = (url) => {
            const u = String(url)
            calls.push(u)
            const user = (u.match(/user=(\w+)/) || [])[1] || 'ann'
            const rec = { id: user === 'ann' ? 1 : 2, name: user }
            if (!holds) return Promise.resolve(jsonResponse(rec))
            return new Promise(res => { release = () => res(jsonResponse(rec)) })
        }
        wildflower.query(q, { from: '/api/profile', params: () => ({ user: state.user }) })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}"><span class="name" data-bind="name"></span></div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(120)
        const s = wildflower.getQuery(q)
        const nameEl = () => container.querySelector('.name').textContent
        expect(nameEl()).toBe('ann')

        holds = true
        state.user = 'bob'
        const p = s.refresh({ clear: true })
        await settle(40)
        expect(nameEl()).toBe('')
        expect(s.isLoading).toBe(true)

        release()
        await p
        await settle(60)
        expect(nameEl()).toBe('bob')
        expect(s.isLoading).toBe(false)
    })
})
