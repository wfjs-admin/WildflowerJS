/**
 * A plugin whose functions sit at the top level, with no state/computed/
 * methods block, is a valid entity shape (same as a methods-only component
 * or store) but until 1.5.3 got no $name accessor: _installPlugin gated
 * accessor creation on `metadata.state || metadata.methods ||
 * metadata.computed`, so a pure service plugin registered silently with
 * wildflower.$name reading undefined (WF-215 audit finding, ecommerce-wf
 * toast plugin).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

describe.skipIf(!hasFeature('plugins'))('plugin(): methods-only top-level shape gets a $name accessor', () => {
    let wildflower

    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { resetFramework(); wildflower = window.wildflower })

    it('creates $name for a plugin with only top-level functions', () => {
        wildflower.plugin({
            name: 'toast',
            success(msg) { return `success:${msg}` },
            error(msg) { return `error:${msg}` }
        })

        expect(wildflower.$toast).toBeTruthy()
        expect(wildflower.$toast.success('ok')).toBe('success:ok')
        expect(wildflower.$toast.error('bad')).toBe('error:bad')
    })

    it('still creates $name via an explicit methods: block', () => {
        wildflower.plugin({
            name: 'toast2',
            methods: {
                success(msg) { return `success:${msg}` }
            }
        })

        expect(wildflower.$toast2).toBeTruthy()
        expect(wildflower.$toast2.success('ok')).toBe('success:ok')
    })

    it('leaves a plugin with no state/computed/methods/top-level functions with no accessor', () => {
        wildflower.plugin({
            name: 'empty',
            version: '1.0.0'
        })

        expect(wildflower.$empty).toBeUndefined()
    })

    // WF-109 (dev builds): warn about a plugin that exposes nothing AND does
    // nothing. install() always runs, so an install-only plugin is legitimate:
    // advanced-plugins.html documents two (tooltips, dataSync).
    describe.skipIf(isMinifiedBuild())('WF-109', () => {
        let warnings
        const realWarn = console.warn
        beforeEach(() => { warnings = []; console.warn = (...a) => { warnings.push(a.join(' ')) } })
        afterEach(() => { console.warn = realWarn })
        const wf109 = () => warnings.filter(w => w.startsWith('[WF WF-109]'))

        it('stays quiet for an install-only plugin that registers a directive (the documented tooltips shape)', () => {
            wildflower.plugin({ name: 'tooltipsDoc', install(wf) { wf.directive('tooltip-doc', { init() {} }) } })
            expect(wf109()).toEqual([])
        })

        it('stays quiet for a uses + install plugin (the documented dataSync shape)', () => {
            wildflower.plugin({ name: 'dataSyncDoc', version: '1.0.0', uses: [], install() {} })
            expect(wf109()).toEqual([])
        })

        it('still warns for a plugin that exposes nothing and does nothing', () => {
            wildflower.plugin({ name: 'inert', version: '1.0.0' })
            expect(wf109().length).toBe(1)
        })
    })
})
