/**
 * wildflower.toRaw() — public API for unwrapping reactive state to plain JS.
 *
 * Surfaced as a real need by the PM tracker's IndexedDB persistence work:
 * structured-clone-based browser APIs (IDB, postMessage, Web Workers,
 * BroadcastChannel, Cache API) reject reactive proxies with DataCloneError.
 * toRaw() walks the proxy and returns a deep plain-JS copy.
 *
 * Locks the contract: the result of toRaw() MUST round-trip through
 * structuredClone() without error, and MUST preserve the same shape and
 * values as the source.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

describe('wildflower.toRaw()', () => {
    let wildflower
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { wildflower = window.wildflower; resetFramework() })

    it('returns primitives unchanged', () => {
        expect(wildflower.toRaw(null)).toBe(null)
        expect(wildflower.toRaw(undefined)).toBe(undefined)
        expect(wildflower.toRaw(42)).toBe(42)
        expect(wildflower.toRaw('hello')).toBe('hello')
        expect(wildflower.toRaw(true)).toBe(true)
        expect(wildflower.toRaw(false)).toBe(false)
    })

    it('deep-copies plain objects', () => {
        const src = { a: 1, b: { c: 2, d: [3, 4] } }
        const out = wildflower.toRaw(src)
        expect(out).toEqual(src)
        expect(out).not.toBe(src)
        expect(out.b).not.toBe(src.b)
        expect(out.b.d).not.toBe(src.b.d)
    })

    it('deep-copies arrays', () => {
        const src = [1, 'two', { three: 3 }, [4, 5]]
        const out = wildflower.toRaw(src)
        expect(out).toEqual(src)
        expect(out).not.toBe(src)
        expect(out[2]).not.toBe(src[2])
    })

    it('preserves Date objects', () => {
        const d = new Date('2026-05-11T12:00:00Z')
        const out = wildflower.toRaw(d)
        expect(out).toBeInstanceOf(Date)
        expect(out.getTime()).toBe(d.getTime())
        expect(out).not.toBe(d)
    })

    it('preserves RegExp objects', () => {
        const r = /^foo.*bar$/gi
        const out = wildflower.toRaw(r)
        expect(out).toBeInstanceOf(RegExp)
        expect(out.source).toBe(r.source)
        expect(out.flags).toBe(r.flags)
        expect(out).not.toBe(r)
    })

    it('preserves Map and Set', () => {
        const m = new Map([['a', 1], ['b', 2]])
        const s = new Set([1, 2, 3])
        const outM = wildflower.toRaw(m)
        const outS = wildflower.toRaw(s)
        expect(outM).toBeInstanceOf(Map)
        expect(outM.get('a')).toBe(1)
        expect(outM.size).toBe(2)
        expect(outS).toBeInstanceOf(Set)
        expect(outS.has(2)).toBe(true)
        expect(outS.size).toBe(3)
    })

    it('handles cyclic references without infinite-looping', () => {
        const a = { name: 'a' }
        const b = { name: 'b', other: a }
        a.other = b
        const out = wildflower.toRaw(a)
        expect(out.name).toBe('a')
        expect(out.other.name).toBe('b')
        expect(out.other.other).toBe(out) // cycle preserved
    })

    it('skips function values', () => {
        const src = { a: 1, b: function () { return 2 }, c: 3 }
        const out = wildflower.toRaw(src)
        expect(out).toEqual({ a: 1, c: 3 })
        expect('b' in out).toBe(false)
    })

    it('unwraps reactive store state so it passes structuredClone()', () => {
        const store = wildflower.storeManager.createStoreComponent('toraw-store', {
            state: {
                tasks: [
                    { id: 1, title: 'A', tags: ['x'] },
                    { id: 2, title: 'B', tags: ['y', 'z'] }
                ],
                meta: { version: 7 }
            }
        })

        // Direct structuredClone of the reactive proxy throws DataCloneError.
        // (We don't assert that here because some engines may handle proxies
        // differently; the important test is the positive case below.)

        const plain = wildflower.toRaw(store.state)
        // structuredClone must accept the result without throwing.
        const cloned = structuredClone(plain)
        expect(cloned).toEqual({
            tasks: [
                { id: 1, title: 'A', tags: ['x'] },
                { id: 2, title: 'B', tags: ['y', 'z'] }
            ],
            meta: { version: 7 }
        })
        // The result is a deep plain copy — mutating it doesn't touch the store.
        plain.tasks[0].title = 'MUTATED'
        expect(store.state.tasks[0].title).toBe('A')
    })

    it('unwraps a reactive array directly', () => {
        const store = wildflower.storeManager.createStoreComponent('toraw-arr', {
            state: { items: [{ a: 1 }, { a: 2 }, { a: 3 }] }
        })
        const plain = wildflower.toRaw(store.state.items)
        expect(Array.isArray(plain)).toBe(true)
        expect(plain.length).toBe(3)
        expect(plain[1].a).toBe(2)
        // structuredClone-safe
        expect(() => structuredClone(plain)).not.toThrow()
    })

    it('is idempotent on already-plain values', () => {
        const plain = { a: 1, b: [2, 3] }
        const out1 = wildflower.toRaw(plain)
        const out2 = wildflower.toRaw(out1)
        expect(out2).toEqual(plain)
        // Each call produces a fresh copy (no shared structure).
        expect(out2).not.toBe(out1)
    })
})
