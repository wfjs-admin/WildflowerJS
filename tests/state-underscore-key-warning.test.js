/**
 * WF-236: an underscore key declared in `state`. `this._x` is a raw instance
 * field (the context proxy routes underscore names past state), so a
 * declared `state: { _x: 0 }` is unreachable as `this._x`. Development
 * builds say so, for components, stores and plugins alike.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) wildflower.unregister(live.pop())
    document.querySelectorAll('.suw-host').forEach((el) => el.remove())
})

async function captureWarnings(fn) {
    const lines = []
    const orig = console.warn
    console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
    try { await fn() } finally { console.warn = orig }
    return lines
}

describe.skipIf(isMinifiedBuild())('WF-236: underscore key in state', () => {
    it('a store with state: { _x } warns, naming the key', async () => {
        const name = uniq('suwStore'); live.push(name)
        const lines = await captureWarnings(() => {
            wildflower.store(name, { state: { a: 1, _count: 0 } })
        })
        // The main line only (the "↳ Docs" follow-up carries the code too).
        const hit = lines.filter((l) => l.includes('WF-236') && !l.includes('Docs:'))
        expect(hit.length).toBe(1)
        expect(hit[0]).toContain('_count')
    })

    it('a component with state: { _x } warns', async () => {
        const comp = uniq('suw-comp')
        const lines = await captureWarnings(async () => {
            wildflower.component(comp, { state: { _since: 0 } })
            const host = document.createElement('div')
            host.className = 'suw-host'
            host.innerHTML = `<div data-component="${comp}"></div>`
            document.body.appendChild(host)
            wildflower.scan()
            await new Promise((r) => setTimeout(r, 100))
        })
        expect(lines.some((l) => l.includes('WF-236') && l.includes('_since'))).toBe(true)
    })

    it.skipIf(!hasFeature('plugins'))('a plugin with state: { _x } warns', async () => {
        const name = uniq('suwPlugin')
        const lines = await captureWarnings(() => {
            wildflower.plugin({ name, state: { _handle: null }, ping() {} })
        })
        expect(lines.some((l) => l.includes('WF-236') && l.includes('_handle'))).toBe(true)
    })

    it('state without underscore keys, and this._x set in init(), do not warn', async () => {
        const name = uniq('suwClean'); live.push(name)
        const lines = await captureWarnings(() => {
            wildflower.store(name, { state: { a: 1 }, init() { this._ctx = {} } })
        })
        expect(lines.some((l) => l.includes('WF-236'))).toBe(false)
    })
})
