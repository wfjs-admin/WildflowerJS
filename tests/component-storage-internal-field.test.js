/**
 * A component with data-storage-key saves and restores all of its state,
 * a field named _internal included. A store's _internal record is the
 * framework's ready flag, and a store's save leaves it out (see
 * store-persistence-readiness.test.js); a component has no such record, so
 * an _internal field in its state is the app's own. The store rule was
 * applied to components too: the field was dropped from the save and from
 * the load (1.5.5 kept it).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe('a component\'s state field named _internal is persisted', () => {
    let wildflower
    let container
    const keys = []
    const key = () => { const k = `wf-test-csi-${++seq}`; keys.push(k); localStorage.removeItem(k); return k }

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

    it('autoSave writes it', async () => {
        const k = key(); const c = `csi-${seq}`
        wildflower.component(c, { state: { _internal: { mine: 1 }, n: 1 } })
        container.innerHTML = `<div data-component="${c}" data-storage-key="${k}" data-auto-save><span data-bind="n"></span></div>`
        wildflower.scan(container)
        await settle()
        wildflower.getComponent(c).n = 2
        await settle()
        expect(JSON.parse(localStorage.getItem(k))).toEqual({ _internal: { mine: 1 }, n: 2 })
    })

    it('the next visit loads it', async () => {
        const k = key(); const c = `csi-${seq}`
        localStorage.setItem(k, JSON.stringify({ _internal: { mine: 2 }, n: 5 }))
        wildflower.component(c, { state: { _internal: { mine: 1 }, n: 1 } })
        container.innerHTML = `<div data-component="${c}" data-storage-key="${k}"><span class="n" data-bind="n"></span><span class="m" data-bind="_internal.mine"></span></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.n').textContent).toBe('5')
        expect(container.querySelector('.m').textContent).toBe('2')
    })
})
