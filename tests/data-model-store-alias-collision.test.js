/**
 * @vitest-environment browser
 *
 * Review finding:data-model's
 * two directions resolve a bare root by ONE rule — component-first, store
 * as fallback, decided by root ownership.
 *
 * A bare name is component scope everywhere in the framework; the store
 * route in data-model exists because `$store.path` is refused there
 * (WF-501), and it is the FALLBACK for roots the component's state does
 * not declare. Before this rule the two directions disagreed on a
 * collision: typing routed to the store unconditionally while the repaint
 * read component state first — a keystroke landed in the store, the input
 * repainted from state's empty string, and the data split across two
 * homes. The reverse contaminated too: a state-owned root whose leaf was
 * still undefined painted the same-named STORE's value into a component
 * input. WF-512 names the shadowing once per component and root.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const itDev = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-dmsc-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

describe('data-model store-alias collisions resolve component-first', () => {
    let container
    let wildflower
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const wf512 = () => warnings.filter(w => w.includes('WF-512'))

    it('a state-owned root binds component state in BOTH directions; the store is untouched', async () => {
        const root = uname('checkout'); const c = uname('c')
        wildflower.store(root, { state: { email: 'store-side' } })
        wildflower.component(c, { state: { [root]: { email: '' } } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="email" data-model="${root}.email">
            </div>`
        wildflower.scan(container)
        await settle()

        const input = container.querySelector('.email')
        const inst = wildflower.componentInstances.get(
            container.querySelector('[data-component]').dataset.componentId)

        // Typing writes COMPONENT state, never the store.
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()

        expect(inst.state[root].email, 'the keystroke lands in component state').toBe('typed')
        expect(wildflower.getStore(root).email, 'the same-named store is untouched').toBe('store-side')

        // Programmatic component-state writes repaint the input.
        inst.state[root].email = 'from-state'
        await settle()
        expect(input.value, 'the repaint reads the same home the write used').toBe('from-state')
    })

    it('a state-owned root with an undefined leaf never paints the same-named store', async () => {
        const root = uname('user'); const c = uname('c')
        wildflower.store(root, { state: { email: 'contaminant' } })
        wildflower.component(c, { state: { [root]: {} } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="email" data-model="${root}.email">
            </div>`
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.email').value,
            'an unset component field renders empty, not the store\'s value').toBe('')
    })

    it('calibration: an unowned root is store-backed in both directions, as before', async () => {
        const root = uname('prefs'); const c = uname('c')
        wildflower.store(root, { state: { theme: 'light' } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="theme" data-model="${root}.theme">
            </div>`
        wildflower.scan(container)
        await settle()

        const input = container.querySelector('.theme')
        expect(input.value, 'the store prefills the input').toBe('light')

        input.value = 'dark'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(wildflower.getStore(root).theme, 'typing writes the store').toBe('dark')

        wildflower.getStore(root).theme = 'sepia'
        await settle()
        expect(input.value, 'a programmatic store write repaints').toBe('sepia')
    })

    itDev('WF-512 names the shadowing once per component and root', async () => {
        const root = uname('acct'); const c = uname('c')
        wildflower.store(root, { state: { name: 'store-side', mail: 'store-side' } })
        wildflower.component(c, { state: { [root]: { name: '', mail: '' } } })
        container.innerHTML = `
            <div data-component="${c}">
                <input class="a" data-model="${root}.name">
                <input class="b" data-model="${root}.mail">
            </div>`
        wildflower.scan(container)
        await settle()

        const afterMount = wf512().length
        expect(afterMount, 'the shadowing is named').toBeGreaterThan(0)
        expect(wf512().some(w => w.includes(root)), 'the root is named').toBe(true)

        // A later repaint (and the second input sharing the root) add nothing.
        const inst = wildflower.componentInstances.get(
            container.querySelector('[data-component]').dataset.componentId)
        inst.state[root].name = 'again'
        await settle()
        expect(wf512().length, 'once per component and root').toBe(afterMount)
    })

    itDev('WF-512 calibration: the store-backed pattern is never named', async () => {
        const root = uname('quiet'); const c = uname('c')
        wildflower.store(root, { state: { v: 'x' } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `
            <div data-component="${c}">
                <input data-model="${root}.v">
            </div>`
        wildflower.scan(container)
        await settle()

        expect(wf512().length).toBe(0)
    })
})
