/**
 * DevTools global hook (window.__WF_DEVTOOLS_GLOBAL_HOOK__) — v1.2 surface.
 *
 * Covers Phase 0 (contract: schemaVersion, dev flag, version) and getDefinitions.
 *
 * Gating: the introspection getters are dev-only — they are attached only on
 * development builds and stripped wholesale from minified production builds. Only
 * the contract fields (version / schemaVersion / dev) ship in every build. So the
 * contract test runs everywhere; the functional tests early-return on production
 * builds (where the getters do not exist).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function nextTick(ms = 50) {
    await new Promise(r => setTimeout(r, ms))
}

function hook() {
    return window.__WF_DEVTOOLS_GLOBAL_HOOK__
}

describe('DevTools hook v1.2 surface', () => {
    let wildflower
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { wildflower = window.wildflower; resetFramework() })

    it('Phase 0 contract: version/schemaVersion/dev ship in all builds; getters are dev-only', () => {
        const h = hook()
        expect(h, 'global hook should exist in every build').toBeTruthy()
        expect(h.version).toBe('1.2.0')
        expect(h.schemaVersion).toBe(1)
        expect(typeof h.dev).toBe('boolean')
        // dev builds are the non-minified ones; min builds strip the dev surface.
        expect(h.dev).toBe(!isMinifiedBuild())

        if (h.dev) {
            expect(typeof h.getDefinitions).toBe('function')
        } else {
            // Production: the entire introspection surface is stripped.
            expect(h.getDefinitions).toBeUndefined()
        }
    })

    it('getDefinitions lists registered component definitions and their shape', async () => {
        const h = hook()
        if (!h.dev) return

        const container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
        try {
            wildflower.component('dt-def', {
                state: { count: 0 },
                computed: { doubled() { return this.state.count * 2 } },
                inc() { this.state.count++ },
                reset() { this.state.count = 0 }
            })
            container.innerHTML = `<div data-component="dt-def"><span data-bind="doubled"></span></div>`
            wildflower.scan()
            await nextTick()

            const defs = h.getDefinitions()
            expect(Array.isArray(defs.components)).toBe(true)
            const def = defs.components.find(c => c.name === 'dt-def')
            expect(def, 'dt-def definition should be listed').toBeTruthy()
            expect(def.hasState).toBe(true)
            expect(def.stateKeys).toContain('count')
            expect(def.computed).toContain('doubled')
            expect(def.methods).toEqual(expect.arrayContaining(['inc', 'reset']))
        } finally {
            container.remove()
        }
    })
})
