/**
 * An async computed that reads a store which registers while the computed's
 * request runs.
 *
 * The request was launched before the store existed, so the body read no
 * edge to it. The store's arrival invalidates the computeds that waited for
 * it, and counts as a real input change: a nudge from outside the graph
 * never relaunches a running request, and treated as one, the arrival left
 * the request to settle with a result built without the store, and nothing
 * linked the computed to the store afterwards, so its later changes were not
 * followed either.
 *
 * Controls: the store arriving after the request settled, and the store
 * there from the start.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) { try { wildflower.unregister(live.pop()) } catch (e) { /* already gone */ } }
})

function reader(src, rdr) {
    const launched = [], resolvers = []
    wildflower.store(rdr, {
        state: {},
        subscribe: { [src]: [] },
        computed: {
            label() {
                const s = this.stores[src]
                const x = s ? s.x : 'none'
                launched.push(x)
                return new Promise((r) => resolvers.push(() => r('x ' + x)))
            },
        },
    })
    const settleAll = () => { while (resolvers.length) resolvers.shift()() }
    return { launched, settleAll }
}

describe('an async store computed reading a store that arrives while its request runs', () => {
    it('relaunches for the store, and follows it afterwards', async () => {
        const src = uniq('alsSource'), rdr = uniq('alsReader'); live.push(rdr, src)
        const { launched, settleAll } = reader(src, rdr)
        const B = wildflower.getStore(rdr)
        expect(launched).toEqual(['none'])          // launched by setup, still running
        wildflower.store(src, { state: { x: 1 } })  // the store arrives mid-request
        void B.label
        await tick()
        wildflower.getStore(src).x = 2
        void B.label
        await tick()
        expect(launched).toEqual(['none', 1, 2])
        settleAll()
        await tick()
        expect(B.label).toBe('x 2')
    })

    it('control: the store arriving after the request settled relaunches', async () => {
        const src = uniq('alsAfterSource'), rdr = uniq('alsAfterReader'); live.push(rdr, src)
        const { launched, settleAll } = reader(src, rdr)
        const B = wildflower.getStore(rdr)
        settleAll()
        await tick()
        expect(B.label).toBe('x none')
        wildflower.store(src, { state: { x: 1 } })
        void B.label
        await tick()
        wildflower.getStore(src).x = 2
        void B.label
        await tick()
        expect(launched).toEqual(['none', 1, 2])
        settleAll()
        await tick()
        expect(B.label).toBe('x 2')
    })

    it('control: the store there from the start is followed', async () => {
        const src = uniq('alsFirstSource'), rdr = uniq('alsFirstReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        const { launched, settleAll } = reader(src, rdr)
        const B = wildflower.getStore(rdr)
        wildflower.getStore(src).x = 2
        void B.label
        await tick()
        expect(launched).toEqual([1, 2])
        settleAll()
        await tick()
        expect(B.label).toBe('x 2')
    })
})
