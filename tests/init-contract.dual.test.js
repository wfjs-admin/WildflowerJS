/**
 * Init contract — must hold identically on BOTH init paths.
 *
 * The incremental path (wildflower.scan / MutationObserver) and the batched
 * page-load path (_scanForComponents) must set components up the same way. This
 * file runs a curated, bounded set of "does the framework wire this up?" scenarios
 * through both, via describe.each(INIT_PATHS). It is NOT a copy of the whole suite —
 * only the contract that both orchestrators owe.
 *
 * Seeded with the two divergences that actually shipped (reactive pool count binding,
 * markup portal in a no-init component) plus a binding sanity. Grow it as new
 * contract items are identified.
 *
 * Plan: docs/future/INIT_PATH_COVERAGE_2026-07-15.md
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))

describe('Init contract (both init paths)', () => {
    let wildflower
    let container
    let portalTarget

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false
            wildflower._initContextSystem()
        }
        // Both paths scan the document root, so the component must live in the document.
        container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.top = '-9999px'
        document.body.appendChild(container)

        portalTarget = document.createElement('div')
        portalTarget.id = 'ic-portal-target'
        portalTarget.style.position = 'absolute'
        portalTarget.style.top = '-9999px'
        document.body.appendChild(portalTarget)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        if (portalTarget && portalTarget.parentNode) portalTarget.parentNode.removeChild(portalTarget)
        document.querySelectorAll('[data-portaled]').forEach(el => el.remove())
        container = null
        portalTarget = null
    })

    describe.each(Object.entries(INIT_PATHS))('via %s path', (pathName, run) => {
        it('a data-bind to state renders', async () => {
            wildflower.component('ic-basic', { state: { msg: 'HELLO' } })
            container.innerHTML = `<div data-component="ic-basic"><b class="m" data-bind="msg"></b></div>`
            run(wildflower)
            await settle()
            expect(container.querySelector('.m').textContent).toBe('HELLO')
        })

        it.skipIf(!hasFeature('pools'))('a computed reading this.pools.x.length binds reactively', async () => {
            wildflower.component('ic-pool', {
                pools: { items: {} },
                computed: { n() { return this.pools.items.length } },
                init() {
                    const batch = []
                    for (let i = 0; i < 50; i++) batch.push({ id: i })
                    this.pools.items.push(batch)
                }
            })
            container.innerHTML = `
                <div data-component="ic-pool">
                    <div data-pool="items" data-key="id"><template><i class="item"></i></template></div>
                    <b class="n" data-bind="n"></b>
                </div>`
            run(wildflower)
            await settle()
            expect(container.querySelector('.n').textContent).toBe('50')
        })

        it.skipIf(!hasFeature('portals'))('a markup portal in a no-init component teleports', async () => {
            wildflower.component('ic-portal', {}) // no init(); portal is in markup
            container.innerHTML = `
                <div data-component="ic-portal">
                    <div data-portal="#ic-portal-target">
                        <span class="pc" data-portaled>hi</span>
                    </div>
                </div>`
            run(wildflower)
            await settle()
            expect(portalTarget.querySelector('.pc')).not.toBeNull()
        })
    })
})
