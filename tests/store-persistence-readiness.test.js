/**
 * A store with storageKey saves its own state and nothing of the
 * framework's. It saved its _internal record too
 * ({"helpSeen":true,"_internal":{"ready":true}}), and the next visit loaded
 * that back when the store was created, before init(): a store whose init()
 * is async reported ready at once, so a component that subscribes to it ran
 * its own init() before the store's had finished, on every visit after the
 * first. A value an earlier version stored (with _internal in it) loads
 * without it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe('store persistence and readiness', () => {
    let wildflower
    let container
    const keys = []
    const key = () => { const k = `wf-test-spr-${++seq}`; keys.push(k); localStorage.removeItem(k); return k }

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => {
        container.remove()
        while (keys.length) localStorage.removeItem(keys.pop())
    })

    it('autoSave stores the store\'s own state, without _internal', async () => {
        const k = key(); const s = `sprstore${seq}`
        wildflower.store(s, { state: { helpSeen: false, prefs: { theme: 'dark' } }, storageKey: k, autoSave: true })
        await settle()
        wildflower.getStore(s).helpSeen = true
        await settle()
        expect(JSON.parse(localStorage.getItem(k))).toEqual({ helpSeen: true, prefs: { theme: 'dark' } })
    })

    // Records, when the component's init() runs, whether the store's async init() had finished.
    const mount = async (k, s) => {
        const c = `spr-c-${seq}`
        const seen = {}
        wildflower.store(s, {
            state: { helpSeen: false, loaded: false },
            storageKey: k,
            autoSave: true,
            async init() { await new Promise(r => setTimeout(r, 150)); this.loaded = true },
        })
        wildflower.component(c, {
            state: {},
            subscribe: { [s]: ['loaded'] },
            init() { seen.storeLoadedAtInit = wildflower.getStore(s).loaded; seen.helpSeen = wildflower.getStore(s).helpSeen },
        })
        container.innerHTML = `<div data-component="${c}"></div>`
        wildflower.scan(container)
        await settle(500)
        return seen
    }

    it('a subscribing component waits for the store\'s async init() on a first visit (control)', async () => {
        const k = key(); const s = `sprstore${seq}`
        const seen = await mount(k, s)
        expect(seen.storeLoadedAtInit).toBe(true)
    })

    it('and on a later visit, with a value in storage', async () => {
        const k = key(); const s = `sprstore${seq}`
        // What a visit before this one stored: by this version, or by an earlier one (with _internal).
        localStorage.setItem(k, JSON.stringify({ helpSeen: true, loaded: false, _internal: { ready: true } }))
        const seen = await mount(k, s)
        expect(seen.helpSeen).toBe(true)
        expect(seen.storeLoadedAtInit).toBe(true)
    })

    it('a stored value that carries _internal does not put it back in storage', async () => {
        const k = key(); const s = `sprstore${seq}`
        localStorage.setItem(k, JSON.stringify({ helpSeen: true, _internal: { ready: true } }))
        wildflower.store(s, { state: { helpSeen: false }, storageKey: k, autoSave: true })
        await settle()
        expect(wildflower.getStore(s).helpSeen).toBe(true)
        wildflower.getStore(s).helpSeen = false
        await settle()
        expect(JSON.parse(localStorage.getItem(k))).toEqual({ helpSeen: false })
    })
})
