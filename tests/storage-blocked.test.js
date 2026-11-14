/**
 * A browser that blocks site data (Chrome's "Block all site data", Safari's
 * blocked cookies in some modes) throws a SecurityError when a page so much
 * as reads window.localStorage. The framework treats that as storage that is
 * not there: a store or component with a storageKey works from its initial
 * state and saves nothing, and a data-query with persist fetches as usual.
 * Before, the availability test (typeof localStorage) sat outside its try, so
 * the read threw: the store failed to register (WF-904, getStore() null), and
 * scan() threw for a page with a persisted query.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe('site storage blocked', () => {
    let wildflower
    let container
    let descriptor
    let errors
    let origError

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        errors = []
        origError = console.error
        console.error = (...a) => { errors.push(a.map(String).join(' ')) }
        // Reading window.localStorage throws, as a blocking browser makes it.
        descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError') },
        })
    })
    afterEach(() => {
        if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
        console.error = origError
        container.remove()
    })

    it('the stub throws on a read (the test blocks what it says it blocks)', () => {
        expect(() => window.localStorage).toThrow()
    })

    it('a store with a storageKey registers with its initial state, and a write does not throw', async () => {
        const s = `sblkstore${++seq}`
        wildflower.store(s, { state: { helpSeen: false, n: 1 }, storageKey: 'sblk-store', autoSave: true })
        await settle()
        const store = wildflower.getStore(s)
        expect(store).not.toBe(null)
        expect(store.helpSeen).toBe(false)
        expect(() => { store.helpSeen = true; store.n = 2 }).not.toThrow()
        await settle()
        expect(store.helpSeen).toBe(true)
        expect(errors.filter(e => e.includes('WF-904'))).toEqual([])
    })

    it('a component with data-storage-key mounts, binds and updates', async () => {
        const c = `sblk-c-${++seq}`
        wildflower.component(c, { state: { count: 1 } })
        container.innerHTML = `<div data-component="${c}" data-storage-key="sblk-comp" data-auto-save><span class="n" data-bind="count"></span></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.n').textContent).toBe('1')
        wildflower.getComponent(c).count = 5
        await settle()
        expect(container.querySelector('.n').textContent).toBe('5')
    })

    it.skipIf(!hasFeature('query'))('a data-query with persist renders what it fetches, and clearPersisted() clears nothing', async () => {
        const realFetch = window.fetch
        window.fetch = () => Promise.resolve(new Response(JSON.stringify([{ id: 1, n: 'a' }, { id: 2, n: 'b' }]), { headers: { 'Content-Type': 'application/json' } }))
        try {
            const q = `sblkq${++seq}`; const c = `sblk-qc-${seq}`
            wildflower.query(q, { from: '/api/sblk.json', key: 'id', persist: true })
            wildflower.component(c, { state: {} })
            container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li data-bind="n"></li></template></ul></div>`
            expect(() => wildflower.scan(container)).not.toThrow()
            await settle(300)
            expect([...container.querySelectorAll('li')].map(l => l.textContent)).toEqual(['a', 'b'])
            expect(wildflower.clearPersisted(q)).toBe(0)
            expect(wildflower.clearPersisted()).toBe(0)
        } finally {
            window.fetch = realFetch
        }
    })
})
