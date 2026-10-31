/**
 * A component definition's `events` block is not read. An action's options
 * come from its element's data-event-* attributes, and a listener outside the
 * component's markup is added by the component's own code (init() and
 * destroy(), this.$el().on(), wildflower.on()). `events` is a definition key
 * like any other that the framework does not use: a definition that still
 * carries the block loads, the block changes nothing, and a development build
 * says the key is not part of the contract (WF-219).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('a component definition\'s events block is not read', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    it('its action delays and its listeners do nothing, and nothing is thrown', async () => {
        let picks = 0
        let pings = 0
        const warned = []
        const errors = []
        const origWarn = console.warn
        const origError = console.error
        console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
        console.error = (...a) => { errors.push(a.map(String).join(' ')) }
        try {
            const events = {
                actions: { click: { delay: 300 }, pick: { delay: 300 } },
                listeners: [{ event: 'evb-ping', handler: 'onPing', target: 'document' }]
            }
            const def = { state: {}, events, pick() { picks++ }, onPing() { pings++ } }
            wildflower.component('evb-panel', def)
            host.innerHTML = '<div data-component="evb-panel"><button id="evb-pick" data-action="pick">pick</button></div>'
            wildflower.scan()
            await settle()

            host.querySelector('#evb-pick').click()
            await settle(30)
            expect(picks).toBe(1)                     // at once, not after 300 ms

            document.dispatchEvent(new CustomEvent('evb-ping'))
            await settle(400)
            expect(pings).toBe(0)
            expect(picks).toBe(1)                     // and no delayed second call
            expect(def.events).toBe(events)           // left as it was written
        } finally {
            console.warn = origWarn
            console.error = origError
        }
        expect(errors).toEqual([])
        // The one thing said about it: the key is not part of the contract.
        const coded = warned.filter((line) => line.startsWith('[WF-'))
        if (isMinifiedBuild()) {
            // (A production build prints a code as "[WF-219] <url>".)
            expect(warned.filter((line) => line.includes('WF-219'))).toEqual([])
        } else {
            expect(coded.length).toBe(1)
            expect(coded[0]).toContain('WF-219')
            expect(coded[0]).toContain("'events'")
        }
    })
})
