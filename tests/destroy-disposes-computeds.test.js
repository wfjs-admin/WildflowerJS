/**
 * A destroyed component's computeds let go of what they read.
 *
 * A computed that reads a store is linked into the store's observers. The
 * store outlives the component, so a computed that stays linked keeps the
 * component, and the elements its bindings wrote to, alive after the
 * component is destroyed. Each mount of such a component then leaves one more
 * copy behind.
 *
 * The first test reads the graph node directly, so it runs on the builds that
 * keep internal names. The second runs everywhere and checks that a destroyed
 * component's computed no longer evaluates.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-ddc-${++seq}`
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

describe('destroy disposes a component\'s computeds', () => {
    let wildflower
    let container

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        container.remove()
    })

    const mount = (storeName, host, kid, onInit) => {
        wildflower.store(storeName, { state: { rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } })
        wildflower.component(host, { state: { on: true } })
        wildflower.component(kid, {
            computed: { count() { return wildflower.getStore(storeName).rows.length } },
            init() { onInit(this) },
        })
        container.innerHTML = `
            <div data-component="${host}">
                <div data-render="on">
                    <div data-component="${kid}"><span class="count" data-bind="count"></span></div>
                </div>
            </div>
        `
        wildflower.scan(container)
    }

    it.skipIf(isMinifiedBuild())('a computed that read a store has no sources after its component is destroyed', async () => {
        const storeName = uname('rows')
        const host = uname('host')
        const kid = uname('kid')
        let kidContext = null
        mount(storeName, host, kid, (ctx) => { kidContext = ctx })
        await settle()

        expect(container.querySelector('.count').textContent).toBe('2')
        const node = kidContext.stateManager._getters.count.__node
        expect(node.sources.length).toBeGreaterThan(0)

        wildflower.getComponents(host)[0].on = false
        await settle()

        expect(container.querySelector('.count')).toBeNull()
        expect(node.sources.length).toBe(0)
    })

    it('a destroyed component\'s computed does not run again when the store changes', async () => {
        const storeName = uname('rows')
        const host = uname('host')
        const kid = uname('kid')
        let runs = 0
        wildflower.store(storeName, { state: { rows: [{ id: 1, name: 'a' }] } })
        wildflower.component(host, { state: { on: true } })
        wildflower.component(kid, {
            computed: { count() { runs++; return wildflower.getStore(storeName).rows.length } },
            watch: { count() {} },
        })
        container.innerHTML = `
            <div data-component="${host}">
                <div data-render="on">
                    <div data-component="${kid}"><span class="count" data-bind="count"></span></div>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.count').textContent).toBe('1')

        wildflower.getComponents(host)[0].on = false
        await settle()
        const runsAtDestroy = runs

        wildflower.getStore(storeName).rows.push({ id: 2, name: 'b' })
        await settle()
        expect(runs).toBe(runsAtDestroy)
    })
})
