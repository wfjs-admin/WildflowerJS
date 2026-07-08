/**
 * data-bind-attr `false` / boolean-attribute contract (applyAttrObj convergence)
 *
 * Canonical semantics on EVERY path (list and component effect), per the
 * BindingWriters.applyAttrObj kernel:
 * - false on a boolean HTML attribute (disabled, checked, ...) -> attribute removed
 * - false on a non-boolean attribute -> literal ="false"
 * - true on a boolean attribute -> present as ="" (canonical presence form)
 * - keys dropping out of the bound object -> attribute removed (stale-key cleanup)
 *
 * Previously the component effect path removed ANY attr on false (losing the
 * literal "false") and never cleaned up dropped keys; this guards the convergence.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan()
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('data-bind-attr false/boolean contract', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('component path: boolean attr false -> removed; non-boolean false -> literal "false"; boolean true -> ""', async () => {
        wildflower.component('attr-false-comp', {
            state: {
                attrs: { disabled: false, 'data-flag': false, required: true, title: 'hello' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="attr-false-comp">
                <input data-bind-attr="attrs" id="afc-target">
            </div>
        `)
        await waitForUpdate(150)

        const el = document.getElementById('afc-target')
        // boolean attr + false -> absent
        expect(el.hasAttribute('disabled')).toBe(false)
        // non-boolean attr + false -> literal "false" (component path used to REMOVE it)
        expect(el.getAttribute('data-flag')).toBe('false')
        // boolean attr + true -> present, canonical "" form
        expect(el.hasAttribute('required')).toBe(true)
        expect(el.getAttribute('required')).toBe('')
        // ordinary value untouched
        expect(el.getAttribute('title')).toBe('hello')
    })

    it('component path: keys dropping out of the bound object are removed (stale-key cleanup)', async () => {
        wildflower.component('attr-drop-comp', {
            state: {
                attrs: { title: 'first', 'data-extra': 'temp' }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="attr-drop-comp">
                <span data-bind-attr="attrs" id="adc-target"></span>
            </div>
        `)
        await waitForUpdate(150)

        const el = document.getElementById('adc-target')
        expect(el.getAttribute('data-extra')).toBe('temp')

        // Drop the key entirely — the stale attribute must be cleared
        instance.state.attrs = { title: 'second' }
        await waitForUpdate(150)

        expect(el.getAttribute('title')).toBe('second')
        expect(el.hasAttribute('data-extra')).toBe(false)
    })

    it('list path: identical false semantics inside list rows', async () => {
        wildflower.component('attr-false-list', {
            state: {
                items: [
                    { id: 1, locked: true, tag: 'a' },
                    { id: 2, locked: false, tag: 'b' }
                ]
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="attr-false-list">
                <div data-list="items">
                    <template>
                        <div class="row">
                            <input class="field" data-bind-attr="{disabled: locked, 'data-locked': locked, 'data-tag': tag}">
                        </div>
                    </template>
                </div>
            </div>
        `)
        await waitForUpdate(200)

        const fields = testContainer.querySelectorAll('.field')
        expect(fields.length).toBe(2)

        // row 1: locked=true -> disabled present, data-locked literal "true"
        expect(fields[0].hasAttribute('disabled')).toBe(true)
        expect(fields[0].getAttribute('data-locked')).toBe('true')
        expect(fields[0].getAttribute('data-tag')).toBe('a')

        // row 2: locked=false -> disabled ABSENT (boolean), data-locked literal "false" (non-boolean)
        expect(fields[1].hasAttribute('disabled')).toBe(false)
        expect(fields[1].getAttribute('data-locked')).toBe('false')
        expect(fields[1].getAttribute('data-tag')).toBe('b')
    })
})
