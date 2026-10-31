/**
 * The component:beforeInit and component:afterInit plugin hooks fire once
 * for every component on both init paths, with or without an init() method.
 *
 * Before this test, the batched page-load path marked a component with no
 * init() ready without entering the init sequence, so neither hook fired for
 * it, while the incremental path fired both. An extension that marks a
 * component live on afterInit (Kinetic's scenes) never saw a page-load scene
 * with no init(): no seek(local), no CSS catch-up, no readiness wait.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

describe('plugin init hooks without init() (both init paths)', () => {
    let wildflower
    let container
    const unsubs = []

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.top = '-9999px'
        document.body.appendChild(container)
    })

    afterEach(() => {
        while (unsubs.length) { const u = unsubs.pop(); if (typeof u === 'function') u() }
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    describe.each(Object.entries(INIT_PATHS))('via %s path', (name, run) => {
        it('fires beforeInit and afterInit once each for a component with no init(), and once each for one with init()', async () => {
            const seen = []
            unsubs.push(wildflower.hook('component:beforeInit', (inst) => { seen.push('before:' + inst.name) }))
            unsubs.push(wildflower.hook('component:afterInit', (inst) => { seen.push('after:' + inst.name) }))
            wildflower.component('hk-bare', { state: { msg: 'bare' } })
            wildflower.component('hk-init', { state: { msg: 'init' }, init() { this.msg = 'inited' } })
            container.innerHTML = `
                <div data-component="hk-bare"><b class="a" data-bind="msg"></b></div>
                <div data-component="hk-init"><b class="b" data-bind="msg"></b></div>`
            run(wildflower)
            await settle()
            expect(container.querySelector('.a').textContent).toBe('bare')
            expect(container.querySelector('.b').textContent).toBe('inited')
            const count = (k) => seen.filter((s) => s === k).length
            expect(count('before:hk-bare')).toBe(1)
            expect(count('after:hk-bare')).toBe(1)
            expect(count('before:hk-init')).toBe(1)
            expect(count('after:hk-init')).toBe(1)
            // beforeInit precedes afterInit for each.
            expect(seen.indexOf('before:hk-bare')).toBeLessThan(seen.indexOf('after:hk-bare'))
            expect(seen.indexOf('before:hk-init')).toBeLessThan(seen.indexOf('after:hk-init'))
        })

        it('afterInit sees the instance ready: an action bound at scan time runs, and the computeds exist', async () => {
            let ready = null
            unsubs.push(wildflower.hook('component:afterInit', (inst) => { if (inst.name === 'hk-ready') ready = { initReady: inst._initReady, n: inst.context.n } }))
            wildflower.component('hk-ready', { state: { x: 2 }, computed: { n() { return this.x * 2 } } })
            container.innerHTML = `<div data-component="hk-ready"><b data-bind="n"></b></div>`
            run(wildflower)
            await settle()
            expect(ready).toEqual({ initReady: true, n: 4 })
        })
    })
})
