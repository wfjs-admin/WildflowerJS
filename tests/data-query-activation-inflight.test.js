/**
 * Activation does not start a second request while one is already running.
 *
 * An app that sets its route and calls refresh() before the query's section
 * mounts had that request aborted and re-issued by the activation catch-up
 * a moment later, so every cold load and every return to an idled view cost
 * two identical requests. Activation still installs its rungs, and still
 * fetches when nothing is in flight; an explicit refresh() still supersedes
 * whatever is running.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-act-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

function jsonResponse(data, { status = 200, etag } = {}) {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    if (etag) headers.set('ETag', etag)
    return new Response(JSON.stringify(data), { status, headers })
}

suite('activation with a request in flight', () => {
    let container
    let wildflower
    let realFetch
    let realWarn
    let calls
    let holds
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
        console.warn = () => {}
        calls = []
        holds = false
        release = null
        window.fetch = (url, init) => {
            calls.push({ url: String(url), etag: init && init.headers && init.headers['If-None-Match'] })
            const rows = [{ id: 1, name: 'x' }]
            if (!holds) return Promise.resolve(jsonResponse(rows, { etag: '"v1"' }))
            return new Promise(res => { release = () => res(jsonResponse(rows, { etag: '"v1"' })) })
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mount(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('refresh() before the section mounts: activation does not re-issue the request', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', key: 'id' })
        holds = true
        const s = wildflower.getQuery(q)
        const p = s.refresh()
        await settle(30)
        expect(calls.length).toBe(1)

        mount(q, c)
        await settle(150)
        expect(calls.length).toBe(1)

        release()
        await p
        await settle(60)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(calls.length).toBe(1)
    })

    it('activation with nothing in flight still fetches', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', key: 'id' })
        mount(q, c)
        await settle(150)
        expect(calls.length).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('return after idle: refresh then re-observe costs one request', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 0.2 })
        wildflower._queryTeardownGraceMs = 150
        mount(q, c)
        await settle(200)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)

        container.innerHTML = ''
        await settle(600)
        expect(controller.active).toBe(false)
        const before = calls.length

        holds = true
        const s = wildflower.getQuery(q)
        const p = s.refresh({ clear: true })
        await settle(30)
        expect(calls.length).toBe(before + 1)

        mount(q, c)
        await settle(150)
        expect(controller.active).toBe(true)
        expect(calls.length).toBe(before + 1)

        release()
        await p
        await settle(60)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('a resumed activation with nothing in flight still does its conditional catch-up', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 0.2 })
        wildflower._queryTeardownGraceMs = 150
        mount(q, c)
        await settle(200)
        const controller = wildflower._queryControllers.get(q)

        container.innerHTML = ''
        await settle(600)
        expect(controller.active).toBe(false)
        const before = calls.length

        mount(q, c)
        await settle(120)
        expect(controller.active).toBe(true)
        expect(calls.length).toBe(before + 1)
        expect(calls[calls.length - 1].etag).toBe('"v1"')
    })

    it('an explicit refresh() still supersedes a request in flight', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/items', key: 'id' })
        holds = true
        mount(q, c)
        await settle(150)
        expect(calls.length).toBe(1)

        const s = wildflower.getQuery(q)
        const p = s.refresh()
        await settle(30)
        expect(calls.length).toBe(2)
        release()
        await p
        await settle(60)
        expect(container.querySelectorAll('li').length).toBe(1)
    })
})
