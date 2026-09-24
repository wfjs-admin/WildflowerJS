/**
 * wildflower.destroy() completeness (v1.5.3 candidate #3, 2026-09-09 external
 * review). destroy() already tears down components, templates, event
 * handlers, plugins, and directive/hook state, but left three things
 * running: the dynamic-component-detection MutationObserver (never
 * disconnected), the DOMContentLoaded fallback listener that arms it (an
 * anonymous listener with no reference to remove), and every registered
 * query controller (its poll/lifecycle timers, SSE stream, focus/reconnect
 * window listeners, and in-flight fetch).
 *
 * Benign for a page-lifetime singleton — which is why it never bit anyone —
 * but not benign for a test harness or widget/micro-frontend embedding where
 * the framework is meant to be genuinely removable: the "destroyed" instance
 * stayed reachable from `document`'s listener list and its timers kept
 * firing forever.
 *
 * These tests run against the shared framework singleton and call
 * wildflower.destroy() directly, so each reconnects what it tore down in its
 * own afterEach rather than relying on resetFramework() (which does not
 * recreate the mutation observer) or on test order.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-destroy-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

describe('wildflower.destroy(): completeness', () => {
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
    })

    // Neither test below depends on live mutation-triggered auto-detection —
    // both scan explicitly (or don't scan at all) — so there's no need to
    // re-arm the observer after a test disconnects it. (_setupDynamicComponentDetection
    // is a private, terser-mangled method with no fixed alias in test-utils'
    // MANGLE_MAP, so it isn't safely callable by name from a min-build test
    // anyway.)

    it('disconnects the dynamic-component-detection MutationObserver', () => {
        const observer = wildflower._mutationObserver
        expect(observer).toBeTruthy()
        const disconnectSpy = vi.spyOn(observer, 'disconnect')

        wildflower.destroy()

        expect(disconnectSpy).toHaveBeenCalledTimes(1)
        expect(wildflower._mutationObserver).toBeNull()
    })

    const suiteIfQuery = hasFeature('query') ? describe : describe.skip
    suiteIfQuery('query controllers', () => {
        let container
        let realFetch

        beforeEach(() => {
            container = document.createElement('div')
            document.body.appendChild(container)
            realFetch = window.fetch
        })

        afterEach(() => {
            window.fetch = realFetch
            if (container && container.parentNode) container.parentNode.removeChild(container)
            container = null
        })

        it('tears down every controller and aborts an in-flight fetch', async () => {
            const q = uname('q'); const c = uname('c')
            let aborted = false
            window.fetch = (url, opts) => {
                opts.signal.addEventListener('abort', () => { aborted = true })
                return new Promise(() => {}) // never resolves on its own
            }
            wildflower.query(q, { from: '/api/things', key: 'id' })
            container.innerHTML = `
                <div data-component="${c}">
                    <span data-query="${q}"></span>
                </div>
            `
            wildflower.component(c, { state: {} })
            wildflower.scan(container)
            await settle()

            expect(wildflower._queryControllers.size).toBeGreaterThan(0)

            wildflower.destroy()

            expect(aborted).toBe(true)
            expect(wildflower._queryControllers.size).toBe(0)
        })
    })

    // Regression pin for a real bug this file's own min-build run surfaced:
    // destroy()'s plugin-accessor
    // cleanup used to scan Object.keys(this) for anything starting with
    // '$' and delete it, on the assumption that only $pluginName accessors
    // ever look like that. terser's automatic (unpinned-in-mangle.json)
    // property mangling can legitimately assign a `$`-prefixed short name
    // to an UNRELATED internal field in some builds — it did, for
    // _deferredReactiveUpdates -> "$t" in a full.min build assembled while
    // building the v1.5.3 diagnostics in this same file — and the blanket
    // scan deleted it, corrupting deferred-update tracking for every
    // component initialized after a destroy(). Fixed by tracking accessor
    // keys explicitly (_createPluginAccessor pushes into
    // wildflower._pluginAccessorKeys) instead of inferring them from shape.
    const suiteIfPlugins = hasFeature('plugins') ? describe : describe.skip
    suiteIfPlugins('plugin accessor cleanup', () => {
        it('removes a real plugin accessor', () => {
            const p = uname('p')
            wildflower.plugin({ name: p, greet() { return 'hi' } })
            expect(typeof wildflower['$' + p]).toBe('object')

            wildflower.destroy()

            expect(wildflower['$' + p]).toBeUndefined()
        })

        it.skipIf(isMinifiedBuild())('does not delete an unrelated own property that happens to start with $', () => {
            // Not a plugin accessor — a plain own property a reader (or, in
            // the wild, a different mangled internal field) happens to be
            // named starting with '$'. skipIf(isMinifiedBuild()) because the
            // whole POINT is that the SAME source property name can be
            // mangled to a $-prefixed short name in one build and not
            // another; asserting on the literal string '$notAPlugin' is
            // only meaningful unminified, where property names are stable.
            wildflower.$notAPlugin = 'unrelated state'

            wildflower.destroy()

            expect(wildflower.$notAPlugin).toBe('unrelated state')
            delete wildflower.$notAPlugin
        })
    })
})
