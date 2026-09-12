/**
 * Object plugins do not need an install() method (1.5.1).
 *
 * Components, stores, plugins, and pool entities share one shape: state,
 * computed, methods, lifecycle. Until 1.5.1 an object plugin without
 * install() threw "Object plugin must have an install() method", so the docs'
 * own side-by-side example (`wildflower.plugin({ name: 'x', state, computed,
 * increment() })`) could not run. install() is now optional; when present it
 * still runs exactly as before.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForUpdate } from './helpers/load-framework.js'

describe.skipIf(!hasFeature('plugins'))('plugin(): install() is optional for object plugins', () => {
    let wildflower

    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { resetFramework(); wildflower = window.wildflower })

    it('registers a state + computed + methods plugin with no install()', async () => {
        wildflower.plugin({
            name: 'tally',
            state: { count: 1 },
            computed: { doubled() { return this.count * 2 } },
            increment() { this.count++ }
        })

        const tally = wildflower.$tally
        expect(tally).toBeTruthy()
        expect(tally.doubled).toBe(2)
        tally.increment()
        await waitForUpdate()
        expect(tally.count).toBe(2)
        expect(tally.doubled).toBe(4)
    })

    it('still runs install() when it is present', () => {
        let installedWith = null
        wildflower.plugin({
            name: 'with-install',
            install(wf, options) { installedWith = { wf, options } },
            state: { ready: true }
        }, { flag: 7 })

        expect(installedWith).not.toBeNull()
        expect(installedWith.wf).toBe(wildflower)
        expect(installedWith.options).toEqual({ flag: 7 })
        expect(wildflower['$with-install'].ready).toBe(true)
    })

    it('still rejects things that are neither a function nor an object', () => {
        expect(() => wildflower.plugin('nope')).toThrow()
        expect(() => wildflower.plugin(42)).toThrow()
    })
})
