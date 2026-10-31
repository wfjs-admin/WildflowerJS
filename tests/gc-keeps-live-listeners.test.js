/**
 * garbageCollect() removes event handlers whose component is gone. It must
 * not remove handlers of live components, or handlers that belong to no
 * component. Entries without an explicit componentId used to be matched by
 * splitting the key on '-', so a hyphenated component ID ("my-panel-3") read
 * as component "my" and its handlers went on the first background sweep;
 * `wildflower.on()` keys (`on-click-...`) read as "click".
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('garbageCollect keeps handlers that are still live', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    it('a hyphen-named component keeps the listener it added with this.$el().on()', async () => {
        let hits = 0
        wildflower.component('gc-live-panel', {
            state: {},
            init() { this.$el().on('gc-ping', () => this.hit()) },
            hit() { hits++ }
        })
        host.innerHTML = `<div data-component="gc-live-panel"></div>`
        wildflower.scan()
        await settle()
        wildflower.garbageCollect()
        host.querySelector('[data-component="gc-live-panel"]').dispatchEvent(new CustomEvent('gc-ping'))
        expect(hits).toBe(1)
    })

    it('a wildflower.on() handler survives', async () => {
        let hits = 0
        host.innerHTML = `<button id="gc-on-btn">x</button>`
        wildflower.on('click', '#gc-on-btn', () => { hits++ })
        wildflower.garbageCollect()
        host.querySelector('#gc-on-btn').click()
        expect(hits).toBe(1)
    })

    it('a destroyed component still loses its listeners', async () => {
        let hits = 0
        wildflower.component('gc-gone-panel', {
            state: {},
            init() { this.$el().on('gc-gone', () => this.hit()) },
            hit() { hits++ }
        })
        host.innerHTML = `<div data-component="gc-gone-panel"></div>`
        wildflower.scan()
        await settle()
        const el = host.querySelector('[data-component="gc-gone-panel"]')
        host.innerHTML = ''
        await settle()
        wildflower.garbageCollect()
        el.dispatchEvent(new CustomEvent('gc-gone'))
        expect(hits).toBe(0)
    })
})
