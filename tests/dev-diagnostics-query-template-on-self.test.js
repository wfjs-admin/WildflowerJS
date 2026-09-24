/**
 * v1.5.3 candidate #4 (mirror of WF-401's "no <template> child" case):
 * data-query on the <template> element ITSELF, instead of on its parent
 * with <template> as a child, silently binds nothing and warns nothing.
 *
 * Verified 2026-09-16 before implementing: data-list and data-pool in this
 * shape already warn WF-401 ("no template found"), reached via
 * _findTemplate's empty querySelector on the <template> tag's own (always
 * empty) light-DOM children. data-query has no equivalent fallback — an
 * empty template with no <template> CHILD is legitimately a valid "record"
 * shape query, so the existing hasTemplateEarly check can't tell "no list
 * child, correctly record-shaped" from "the attribute is on the wrong
 * element" without an explicit tag check. This is the one real gap in the
 * three-way family the finding named.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = (hasFeature('query') && !isMinifiedBuild()) ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qtos-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('dev diagnostics: data-query on the <template> element itself', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    const realWarn = console.warn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        warnings = []
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('warns once and does not silently no-op', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ id: 1, name: 'x' })
        wildflower.query(q, { from: '/api/probe' })

        container.innerHTML = `
            <div data-component="${c}">
                <div id="stage">
                    <template data-query="${q}"><span data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes(q) && /template/i.test(w))
        expect(hit).toBe(true)
    })
})

// The production half, pinned on every lane including min (review C-09).
// 1.5.2 took this element down the record-shape path: it activated the query
// (a fetch) and marked it hasRecord, binding nothing. Now it is skipped in
// every build, so the mistake has no side effects.
describe.skipIf(!hasFeature('query'))('data-query on the <template> element itself: skipped in every build', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => { await loadFramework() })
    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })
    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mount(q, c, markup) {
        let calls = 0
        window.fetch = async () => { calls++; return jsonResponse({ id: 1, name: 'x' }) }
        wildflower.query(q, { from: '/api/probe' })
        container.innerHTML = `<div data-component="${c}">${markup}</div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        return () => calls
    }

    it('control: the attribute on a container activates the query', async () => {
        const q = uname('q'); const c = uname('c')
        const calls = mount(q, c, `<div data-query="${q}"><span data-bind="name"></span></div>`)
        await settle(120)
        expect(calls(), 'the setup cannot detect a fetch; the pin below would be vacuous').toBeGreaterThan(0)
    })

    it('the attribute on the <template> itself does not activate the query', async () => {
        const q = uname('q'); const c = uname('c')
        const calls = mount(q, c, `<template data-query="${q}"><span data-bind="name"></span></template>`)
        await settle(120)
        expect(calls()).toBe(0)
    })
})
