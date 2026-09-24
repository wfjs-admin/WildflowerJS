/**
 * v1.5.3 candidate #6: a presence-only modifier written as ="false" (or
 * "0"/"no"/"off") turns the modifier ON, since presence alone is what the
 * framework reads — the value is never inspected at the call sites
 * (element.hasAttribute('data-model-lazy'), etc.). The author's intent is
 * unambiguous and the framework does the opposite. Warn in dev when one of
 * the eight presence-only modifiers carries a falsy-looking value.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const suite = isMinifiedBuild() ? describe.skip : describe

async function settle(ms = 30) {
    await new Promise(r => setTimeout(r, ms))
}

const MODIFIERS = ['model-lazy', 'model-number', 'model-trim', 'event-self', 'event-stop', 'event-prevent', 'event-outside', 'external']

suite('dev diagnostics: presence-only modifier written with a falsy value', () => {
    let container
    let wildflower
    let warnings

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        warnings = []
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it.each(MODIFIERS)('warns on data-%s="false"', async (mod) => {
        container.innerHTML = `<div data-${mod}="false"></div>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes(`data-${mod}`))
        expect(hit).toBe(true)
    })

    it.each(['0', 'no', 'off'])('also warns on the "%s" spelling', async (val) => {
        container.innerHTML = `<div data-model-lazy="${val}"></div>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes('data-model-lazy'))
        expect(hit).toBe(true)
    })

    it('does not warn on the bare (no-value) form', async () => {
        container.innerHTML = `<div data-model-lazy></div>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes('data-model-lazy'))
        expect(hit).toBe(false)
    })

    it('does not warn on a value that is not one of the recognized falsy spellings', async () => {
        container.innerHTML = `<div data-model-lazy="true"></div>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes('data-model-lazy'))
        expect(hit).toBe(false)
    })
})
