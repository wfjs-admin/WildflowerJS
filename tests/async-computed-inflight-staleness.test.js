/**
 * @vitest-environment browser
 *
 * Review finding:an async
 * computed must never let a settled result beat a NEWER input.
 *
 * Three reproduced shapes, all fixed together:
 *  - R3a: a dependency write landing after the promise resolves but before
 *    the result is consumed used to be eaten by the consume branch — the
 *    body never re-ran and the stale value pinned until the dep moved again.
 *    Fix: the continuation discards when the node is DIRTY at settle time
 *    (a forced nudge flags itself via ctl.forced and still installs).
 *  - R3b: a throwing re-run never bumped the generation, so the superseded
 *    request PARKED its result (its cell edge was trimmed by the throwing
 *    run, so nothing woke), and the next genuine dependency change consumed
 *    the parked stale value instead of re-running the body. Fix: an error
 *    run supersedes, exactly as a sync return does.
 *  - R4: a props change mid-flight was absorbed by the forced-hold (props
 *    have no graph edge; the forced flag was their only wake channel), so
 *    the request was never relaunched — contradicting the docs' "a change
 *    to any dependency relaunches the request". Fix: the change-gated props
 *    refresh flags a RELAUNCH, which re-runs the body and supersedes the
 *    in-flight continuation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Async computeds: in-flight staleness discipline', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('R3a: a dep change after resolve, before consume, re-runs the body', async () => {
        let bodyRuns = 0
        let resolveP = null

        wildflower.component('stale-consume', {
            state: { version: 1 },
            computed: {
                label() {
                    bodyRuns++
                    const v = this.state.version
                    return new Promise(res => { resolveP = (s) => res(s + '-for-v' + v) })
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="stale-consume">
                <span id="sc-target" data-bind="label"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        expect(bodyRuns, 'launch ran once').toBe(1)
        const el = testContainer.querySelector('#sc-target')
        const inst = wildflower.componentInstances.get(
            testContainer.querySelector('[data-component]').dataset.componentId)

        // Resolve run 1, then in the SAME synchronous turn write the dep.
        resolveP('data')
        inst.state.version = 2
        await waitForUpdate()

        expect(bodyRuns, 'the version=2 write re-runs the body').toBe(2)

        resolveP('data')
        await waitForUpdate()
        expect(el.textContent, 'the value reflects the newest dependency').toBe('data-for-v2')
    })

    it('R3b: after an error run, a parked stale resolution never surfaces', async () => {
        let bodyRuns = 0
        let resolveP1 = null
        let resolveLast = null

        wildflower.component('stale-park', {
            state: { mode: 'ok' },
            computed: {
                data() {
                    bodyRuns++
                    if (this.state.mode === 'boom') throw new Error('sync-throw')
                    return new Promise(res => {
                        if (bodyRuns === 1) resolveP1 = res
                        else resolveLast = res
                    })
                }
            },
            onError() { /* the throw is the fixture, not the assertion */ }
        })

        testContainer.innerHTML = `
            <div data-component="stale-park">
                <span id="sp-target" data-bind="data.name"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        const el = testContainer.querySelector('#sp-target')
        const inst = wildflower.componentInstances.get(
            testContainer.querySelector('[data-component]').dataset.componentId)
        expect(bodyRuns, 'launch ran once').toBe(1)

        // Newest evaluation throws; it supersedes the in-flight request.
        inst.state.mode = 'boom'
        await waitForUpdate()
        const runsAfterBoom = bodyRuns
        expect(el.textContent, 'error state renders empty').toBe('')

        // The superseded request lands: discarded, not parked.
        resolveP1({ name: 'stale' })
        await waitForUpdate()
        expect(el.textContent, 'stale resolution stays invisible').toBe('')

        // A genuine dep change re-runs the body; the stale value never renders.
        inst.state.mode = 'ok'
        await waitForUpdate()
        expect(el.textContent, 'the parked stale value must not surface on recovery').toBe('')
        expect(bodyRuns, 'recovery re-runs the body').toBeGreaterThan(runsAfterBoom)

        resolveLast({ name: 'fresh' })
        await waitForUpdate()
        expect(el.textContent, 'the fresh request wins').toBe('fresh')
    })

    it('R4: a props change while in flight relaunches the request', async () => {
        let bodyRuns = 0
        let resolveP = null

        wildflower.component('relaunch-parent', { state: { uid: 1 } })
        wildflower.component('relaunch-child', {
            props: { uid: { type: Number } },
            computed: {
                user() {
                    bodyRuns++
                    const id = this.props.uid
                    return new Promise(res => { resolveP = (name) => res({ name: name + '-' + id }) })
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="relaunch-parent">
                <div data-component="relaunch-child" data-prop-uid="uid">
                    <span id="rl-target" data-bind="user.name"></span>
                </div>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate(120)

        expect(bodyRuns, 'launch ran once').toBe(1)
        const parentEl = testContainer.querySelector('[data-component="relaunch-parent"]')
        const parent = wildflower.componentInstances.get(parentEl.dataset.componentId)

        parent.state.uid = 2
        await waitForUpdate(150)

        expect(bodyRuns, 'the prop change relaunches the request').toBe(2)

        resolveP('ada')
        await waitForUpdate()
        expect(testContainer.querySelector('#rl-target').textContent,
            'the relaunched request resolves against the new prop').toBe('ada-2')
    })

    // Review finding: the rejection continuation used to report to onError
    // BEFORE bumping the cell, so during the handler the node was CLEAN
    // with node.error set — and reading the same computed from inside
    // onError re-threw the original error out of the evaluation. The cell
    // bump now precedes the report, so the read consumes the errored
    // state and yields undefined, like any other read of a failed async
    // computed.
    it('R13: reading the computed inside onError yields undefined instead of throwing', async () => {
        let rejectP = null
        let observed = 'onerror-never-ran'

        wildflower.component('onerr-read', {
            state: {},
            computed: {
                data() { return new Promise((_, rej) => { rejectP = rej }) }
            },
            onError() {
                try { observed = String(this.data) } catch (e) { observed = 'THREW' }
            }
        })
        testContainer.innerHTML = `
            <div data-component="onerr-read"><span data-bind="data.name"></span></div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        rejectP(new Error('network down'))
        await waitForUpdate()

        expect(observed, 'the handler can read the errored computed safely').toBe('undefined')
    })

    // Review finding, pinned as the CONTRACT (docs state it now): a rejection
    // landing for a request a newer run superseded is discarded silently —
    // the newer run owns the outcome, and a failure of a request nobody is
    // waiting on is not an application error.
    it('R14: a superseded request that rejects never reaches onError', async () => {
        let rejectP1 = null
        let bodyRuns = 0
        let onErrorCalls = 0

        wildflower.component('superseded-reject', {
            state: { version: 1 },
            computed: {
                data() {
                    bodyRuns++
                    const v = this.state.version
                    if (bodyRuns === 1) return new Promise((_, rej) => { rejectP1 = rej })
                    return new Promise(() => { void v })
                }
            },
            onError() { onErrorCalls++ }
        })
        testContainer.innerHTML = `
            <div data-component="superseded-reject"><span data-bind="data.name"></span></div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()
        expect(bodyRuns).toBe(1)

        const inst = wildflower.componentInstances.get(
            testContainer.querySelector('[data-component]').dataset.componentId)
        inst.state.version = 2
        await waitForUpdate()
        expect(bodyRuns, 'the dep change relaunched (run 2 owns the outcome)').toBe(2)

        rejectP1(new Error('late failure of the superseded request'))
        await waitForUpdate()

        expect(onErrorCalls, 'the superseded rejection is silent by contract').toBe(0)
    })
})
