/**
 * @vitest-environment browser
 *
 * The async-BODY tier (review coverage finding):
 * before this file, no test in the suite defined a real `async` function
 * computed — every fixture returned a hand-built Promise from a synchronous
 * body, the one authoring shape where the documented post-`await` tracking
 * rule cannot bite. This file exercises the form the docs actually teach
 * (async-computed.html): an `async` body with genuine `await` boundaries.
 *
 * The tracking contract, pinned in both directions: the body runs
 * synchronously under the graph's observer up to the FIRST await, so reads
 * before it form dependency edges; the continuation after it runs as a
 * microtask with no active observer, so reads there form NO edge — the
 * documented limitation, pinned as characterization so a change to it is a
 * decision rather than drift.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const itProd = isMinifiedBuild() ? it : it.skip

let seq = 0
const uname = (p) => `${p}-acb-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

function gate() {
    let release
    const opened = new Promise(res => { release = res })
    return { opened, release }
}

describe('async-body computeds (the documented authoring form)', () => {
    let testContainer
    let wildflower
    let errors
    let realError

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        errors = []
        realError = console.error
        console.error = (...a) => { errors.push(a.join(' ')); realError.apply(console, a) }
    })

    afterEach(() => {
        console.error = realError
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function inst() {
        return wildflower.componentInstances.get(
            testContainer.querySelector('[data-component]').dataset.componentId)
    }

    it('a real async body renders empty in flight and the value after landing', async () => {
        const c = uname('basic')
        const g = gate()
        wildflower.component(c, {
            state: {},
            computed: {
                async user() {
                    const data = await g.opened
                    return { name: data }
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t1" data-bind="user.name"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        expect(testContainer.querySelector('#t1').textContent, 'in flight: empty').toBe('')

        g.release('Ada')
        await settle()
        expect(testContainer.querySelector('#t1').textContent).toBe('Ada')
    })

    it('a read BEFORE the first await forms an edge: changing it relaunches', async () => {
        const c = uname('preawait')
        let bodyRuns = 0
        let release = null
        wildflower.component(c, {
            state: { uid: 1 },
            computed: {
                async user() {
                    bodyRuns++
                    const id = this.state.uid          // BEFORE the await: tracked
                    const data = await new Promise(res => { release = res })
                    return { name: data + '-' + id }
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t2" data-bind="user.name"></span></div>`
        wildflower.scan(testContainer)
        await settle()
        expect(bodyRuns).toBe(1)

        release('ada')
        await settle()
        expect(testContainer.querySelector('#t2').textContent).toBe('ada-1')

        inst().state.uid = 2
        await settle()
        expect(bodyRuns, 'the pre-await read is a real dependency').toBe(2)

        release('ada')
        await settle()
        expect(testContainer.querySelector('#t2').textContent, 'the relaunch saw the new value').toBe('ada-2')
    })

    it('a read AFTER the first await forms NO edge (the documented limitation, pinned)', async () => {
        const c = uname('postawait')
        let bodyRuns = 0
        let release = null
        wildflower.component(c, {
            state: { suffix: 'x' },
            computed: {
                async label() {
                    bodyRuns++
                    const data = await new Promise(res => { release = res })
                    return data + ':' + this.state.suffix   // AFTER the await: untracked
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t3" data-bind="label"></span></div>`
        wildflower.scan(testContainer)
        await settle()
        release('v')
        await settle()
        expect(testContainer.querySelector('#t3').textContent).toBe('v:x')

        inst().state.suffix = 'y'
        await settle()

        expect(bodyRuns, 'no edge, no relaunch — the docs teach exactly this').toBe(1)
        expect(testContainer.querySelector('#t3').textContent,
            'the rendered value is stale by contract until a tracked dep moves').toBe('v:x')
    })

    it('last call wins with real async bodies: a slow early run loses to a fast later one', async () => {
        const c = uname('race')
        const releases = []
        wildflower.component(c, {
            state: { uid: 1 },
            computed: {
                async user() {
                    const id = this.state.uid
                    const data = await new Promise(res => { releases.push(res) })
                    return { name: data + '-' + id }
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t4" data-bind="user.name"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        inst().state.uid = 2
        await settle()
        expect(releases.length, 'two requests flew').toBe(2)

        releases[1]('fast')     // the LATER run lands first
        await settle()
        expect(testContainer.querySelector('#t4').textContent).toBe('fast-2')

        releases[0]('slow')     // the superseded run lands late
        await settle()
        expect(testContainer.querySelector('#t4').textContent,
            'the superseded resolution is discarded').toBe('fast-2')
    })

    it('a throw after an await lands in onError; the next tracked change recovers', async () => {
        const c = uname('reject')
        let release = null
        let onErrorCalls = 0
        wildflower.component(c, {
            state: { uid: 1 },
            computed: {
                async user() {
                    const id = this.state.uid
                    const ok = await new Promise(res => { release = res })
                    if (!ok) throw new Error('load failed for ' + id)
                    return { name: 'u' + id }
                }
            },
            onError() { onErrorCalls++; return true }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t5" data-bind="user.name"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        release(false)   // the async body throws past its await → rejection
        await settle()
        expect(onErrorCalls, 'the rejection reached onError').toBe(1)
        expect(testContainer.querySelector('#t5').textContent, 'errored reads render empty').toBe('')

        inst().state.uid = 2
        await settle()
        release(true)
        await settle()
        expect(testContainer.querySelector('#t5').textContent, 'recovery needs no extra code').toBe('u2')
    })

    it('a component destroyed mid-flight absorbs the late landing quietly', async () => {
        const c = uname('teardown')
        let release = null
        wildflower.component(c, {
            state: {},
            computed: {
                async user() {
                    const data = await new Promise(res => { release = res })
                    return { name: data }
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span data-bind="user.name"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        const el = testContainer.querySelector('[data-component]')
        const id = el.dataset.componentId
        el.remove()
        wildflower.destroyComponent(id)
        await settle()

        const errorsBefore = errors.length
        release('too late')
        await settle(80)

        expect(errors.length, 'no console error from the late landing').toBe(errorsBefore)
        expect(wildflower.componentInstances.get(id), 'nothing resurrected').toBeFalsy()
    })

    it('store parity: a rejecting async body routes to the STORE\'s onError', async () => {
        const s = uname('dir')
        let release = null
        let storeOnError = 0
        wildflower.store(s, {
            state: {},
            computed: {
                async members() {
                    const ok = await new Promise(res => { release = res })
                    if (!ok) throw new Error('directory down')
                    return ['a']
                }
            },
            onError() { storeOnError++; return true }
        })
        const c = uname('c')
        wildflower.component(c, { state: {} })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t7" data-bind="$${s}.members.length"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        release(false)
        await settle()

        expect(storeOnError, 'entity parity: the store hook hears its own computed').toBe(1)
    })

    it('an async body that later returns a plain value supersedes its in-flight request', async () => {
        const c = uname('tosync')
        let release = null
        wildflower.component(c, {
            state: { mode: 'remote' },
            computed: {
                async label() {
                    if (this.state.mode === 'local') return 'local-value'
                    const data = await new Promise(res => { release = res })
                    return data
                }
            }
        })
        testContainer.innerHTML = `<div data-component="${c}"><span id="t8" data-bind="label"></span></div>`
        wildflower.scan(testContainer)
        await settle()

        inst().state.mode = 'local'
        await settle()
        expect(testContainer.querySelector('#t8').textContent,
            'the sync-return run lands immediately').toBe('local-value')

        release('remote-value')
        await settle()
        expect(testContainer.querySelector('#t8').textContent,
            'the superseded request cannot overwrite it').toBe('local-value')
    })

    // Production characterization: WF-235 (item-level computeds must be
    // synchronous) is dev-only. This pins what a production build actually
    // renders when the rule is broken, so the failure shape is a recorded
    // fact rather than a surprise.
    itProd('production: an item-level computed returning a promise renders as text, not a crash', async () => {
        const c = uname('proditem')
        wildflower.component(c, {
            state: { items: [{ id: 1 }] },
            computed: {
                badge(item) { return Promise.resolve('never-' + item.id) }
            }
        })
        testContainer.innerHTML = `
            <div data-component="${c}">
                <ul data-list="items"><template><li class="row" data-bind="badge"></li></template></ul>
            </div>`
        wildflower.scan(testContainer)
        await settle(120)

        const row = testContainer.querySelector('.row')
        expect(row, 'the list rendered; no crash').toBeTruthy()
        expect(row.textContent, 'the promise stringifies into the row — the recorded failure shape')
            .toBe('[object Promise]')
    })
})
