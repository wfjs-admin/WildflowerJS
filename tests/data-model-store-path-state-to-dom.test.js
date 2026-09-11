/**
 * Store-backed data-model ("storeName.field") must repaint the input when the
 * store field changes programmatically — the state→DOM direction.
 *
 * The gap: FormHandling's WRITE path routes "editor.title" model writes to
 * the named store, but the render effect's value read resolved only
 * component state, so the input never repainted on a store write (prefill
 * from a router handler, clearing from an action). DOM→state always worked,
 * which made the asymmetry look like a reactivity flake. Found twice on the
 * Conduit build (memory feedback_data_model_state_to_dom_sync_gap).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-dmstore-${++seq}`

async function settle(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-model store paths — state→DOM repaint', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    it('external store write repaints the bound input (prefill shape)', async () => {
        const st = uname('st'); const c = uname('c')
        wildflower.store(st, { state: { title: '', body: '' } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="title" data-model="${st}.title">
                <textarea class="body" data-model="${st}.body"></textarea>
            </div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.title').value).toBe('')

        // The router-handler prefill shape: programmatic writes, no user input.
        wildflower.getStore(st).title = 'How to build'
        wildflower.getStore(st).body = 'article body'
        await settle()

        expect(container.querySelector('.title').value).toBe('How to build')
        expect(container.querySelector('.body').value).toBe('article body')

        // And again — the binding stays live, not a one-shot.
        wildflower.getStore(st).title = 'Retitled'
        await settle()
        expect(container.querySelector('.title').value).toBe('Retitled')
    })

    it('clearing the store field from the input\'s own action handler empties the input', async () => {
        const st = uname('st'); const c = uname('c')
        wildflower.store(st, { state: { tagInput: '', tags: [] } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="tag" data-model="${st}.tagInput" data-action="keydown:addTag">
            </div>`
        wildflower.component(c, {
            state: {},
            addTag(event) {
                if (event.key !== 'Enter') return
                const store = wildflower.getStore(st)
                store.tags.push(store.tagInput)
                store.tagInput = ''
            }
        })
        wildflower.scan(container)
        await settle()

        const input = container.querySelector('.tag')
        // User types (DOM→state), then Enter clears via the handler (state→DOM).
        input.focus()
        input.value = 'reactivity'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(wildflower.getStore(st).tagInput).toBe('reactivity')

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()

        expect(wildflower.getStore(st).tagInput).toBe('')
        expect(wildflower.getStore(st).tags).toEqual(['reactivity'])
        // The visible value must follow the cleared store field.
        expect(input.value).toBe('')
    })

    it('component-state data-model still repaints (regression guard)', async () => {
        const c = uname('c')
        let ctx
        container.innerHTML = `
            <div data-component="${c}">
                <input class="nm" data-model="name">
            </div>`
        wildflower.component(c, { state: { name: '' }, init() { ctx = this } })
        wildflower.scan(container)
        await settle()

        ctx.name = 'alpha'
        await settle()
        expect(container.querySelector('.nm').value).toBe('alpha')
    })
})
