/**
 * Portal data-show driven by a SUBSCRIBED STORE value.
 *
 * Regression: the kanban-wf demo edit modal is a `data-portal="body"` element
 * gated by `data-show="isEditing"`, where `isEditing` reads a store value
 * (`this.stores.kanban.editingCard !== null`). Opening worked (a store->state
 * cascade triggered an own-state render that re-evaluated the portal), but
 * CLOSING (editingCard -> null) left the modal on screen: a pure store change
 * reaches a subscribed component only through EntitySystem's dependent-notify
 * loop, which re-evaluated computeds but NOT the component's portals. So the
 * portal's show condition was never re-checked on a store-only change and the
 * teleported content was never hidden.
 *
 * Contract locked here: a portal whose data-show condition depends on a
 * subscribed store path re-evaluates (hides AND shows) when that store path
 * changes, with no own-state write required.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) { await new Promise(r => setTimeout(r, ms)) }

const describeIfPortals = hasFeature('portals') ? describe : describe.skip

describeIfPortals('Portal data-show from a subscribed store value', () => {
    let container, target, wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        if (wildflower._initContextSystem) { wildflower._contextSystemInitialized = false; wildflower._initContextSystem() }
        container = document.createElement('div'); container.id = 'psd-container'
        container.style.cssText = 'position:absolute;top:-9999px'
        document.body.appendChild(container)
        target = document.createElement('div'); target.id = 'psd-target'
        container.appendChild(target)
    })
    afterEach(() => {
        ;[container, target].forEach(el => { if (el && el.parentNode) el.parentNode.removeChild(el) })
    })

    it('portal hides when the subscribed store value flips to null (no own-state write)', async () => {
        wildflower.store('psd-store', {
            state: { editing: null },
            open(args) { this.editing = Object.assign({}, args.payload || args); },
            close() { this.editing = null; }
        })

        wildflower.component('psd-comp', {
            subscribe: { 'psd-store': ['editing'] },
            computed: {
                isEditing() { return this.stores['psd-store'] && this.stores['psd-store'].editing !== null; }
            }
        })

        container.insertAdjacentHTML('beforeend', `
            <div data-component="psd-comp">
                <div data-show="isEditing" data-portal="#psd-target" data-cloak>
                    <div class="psd-modal">Editing</div>
                </div>
            </div>
        `)
        wildflower.scan ? wildflower.scan() : wildflower._scanForComponents()
        await waitForUpdate()

        const modalShown = () => {
            const m = document.querySelector('.psd-modal')
            return !!(m && m.offsetParent !== null || (m && getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().width >= 0 && m.isConnected && m.closest('[data-portal]') === null))
        }
        const modalInTarget = () => !!target.querySelector('.psd-modal')

        const store = wildflower.getStore('psd-store')

        // OPEN: store-only mutation -> portal teleports + shows
        store.open({ payload: { id: 1 } })
        await waitForUpdate()
        expect(modalInTarget(), 'modal teleported to target on open').toBe(true)

        // CLOSE: store-only mutation -> portal must hide (the regression)
        store.close()
        await waitForUpdate()
        const m = document.querySelector('.psd-modal')
        const hidden = !m || getComputedStyle(m).display === 'none' || m.getBoundingClientRect().width === 0
        expect(hidden, 'modal hidden after store value -> null').toBe(true)

        // OPEN again: still reactive after a hide
        store.open({ payload: { id: 2 } })
        await waitForUpdate()
        const m2 = document.querySelector('.psd-modal')
        expect(m2 && getComputedStyle(m2).display !== 'none', 're-opens after close').toBe(true)
    })
})
