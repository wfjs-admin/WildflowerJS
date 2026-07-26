/**
 * A8 (DX diagnostics sweep): actions fired before init() are queued and
 * replayed afterward — a deliberate guarantee — but the replayed handler's
 * event is stale: the browser processed its default action long before
 * replay, so preventDefault()/stopPropagation() execute fine and do nothing.
 * In dev builds the stale event's methods are stubbed with a pointed warning
 * (data-event-prevent is the reliable tool). Fires ONLY on actual calls
 * during replay; normal dispatches and event-untouching handlers are silent.
 *
 * __DEV__-gated; skipped on min variants.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A8).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForUpdate } from './helpers/load-framework.js'

describe.skipIf(isMinifiedBuild())('Dev-mode replayed-action preventDefault warning (A8)', () => {
    let testContainer
    let warnings
    let originalWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function replayWarnings() {
        return warnings.filter(w => w.includes('no-op') && w.includes('replay'))
    }

    it('warns when a replayed handler calls preventDefault on its stale event', async () => {
        let sawWarning = false
        window.wildflower.component('rp-warn', {
            state: { saved: false },
            init() {},
            save(event) {
                event.preventDefault()
                this.state.saved = true
            }
        })
        testContainer.innerHTML = '<div data-component="rp-warn"></div>'
        window.wildflower.scan(testContainer)

        const inst = window.wildflower.componentInstances.get(
            testContainer.querySelector('[data-component-id]').dataset.componentId)
        expect(inst._initReady).toBeFalsy()

        // Fire before init: gets queued with its (about-to-be-stale) event.
        inst.context.save(new Event('submit', { cancelable: true }))
        expect(replayWarnings()).toEqual([])

        await waitForUpdate(30)

        // Handler replayed, ran fully, and the preventDefault call warned.
        expect(inst.state.saved).toBe(true)
        const found = replayWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-605]')
        expect(found[0]).toContain('preventDefault()')
        // The data-event-prevent fix rides wfError's suggestion line.
        expect(warnings.some(w => w.includes('data-event-prevent'))).toBe(true)
        sawWarning = found.length === 1
        expect(sawWarning).toBe(true)
    })

    it('stays silent for post-init dispatches that call preventDefault', async () => {
        window.wildflower.component('rp-normal', {
            state: {},
            init() {},
            save(event) { event.preventDefault() }
        })
        testContainer.innerHTML = '<div data-component="rp-normal"></div>'
        window.wildflower.scan(testContainer)
        await waitForUpdate(30)

        const inst = window.wildflower.componentInstances.get(
            testContainer.querySelector('[data-component-id]').dataset.componentId)
        expect(inst._initReady).toBe(true)

        const ev = new Event('submit', { cancelable: true })
        inst.context.save(ev)

        expect(replayWarnings()).toEqual([])
        expect(ev.defaultPrevented).toBe(true)
    })

    it('stays silent for replayed handlers that never touch the event', async () => {
        window.wildflower.component('rp-untouched', {
            state: { n: 0 },
            init() {},
            bump(event) { this.state.n++ }
        })
        testContainer.innerHTML = '<div data-component="rp-untouched"></div>'
        window.wildflower.scan(testContainer)

        const inst = window.wildflower.componentInstances.get(
            testContainer.querySelector('[data-component-id]').dataset.componentId)
        inst.context.bump(new Event('click', { cancelable: true }))
        await waitForUpdate(30)

        expect(inst.state.n).toBe(1)
        expect(replayWarnings()).toEqual([])
    })
})
