/**
 * A child component destroyed while its root is still in the page, then
 * removed (the teardown WF-106 suggests): the bindings on that root were the
 * parent's, and the parent stops reading them once the root has left. A root
 * the next scan brings back keeps them.
 *
 * Also pins data-cloak on a root that root: { show } hides: the cloak strip
 * reads only the tag's data-show, and the root stays hidden through it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

let seq = 0
const uname = (b) => `crdr-${b}-${++seq}`
async function settle(ms = 30) {
    await waitForUpdate()
    await new Promise(r => setTimeout(r, ms))
    await waitForUpdate()
}

describe('child root: destroyed in the page, then removed', () => {
    let wildflower, container
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { container.remove() })

    async function setup(extra = '') {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { label: 'a', on: true } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="parent" data-component="${p}"><div class="kid" data-component="${c}" data-bind-attr="{ title: label }" ${extra}></div></div>`
        wildflower.scan(container)
        await settle(120)
        return { kid: container.querySelector('.kid'), P: wildflower.getComponent(p) }
    }

    it('the parent stops writing to the removed root', async () => {
        const { kid, P } = await setup()
        expect(kid.getAttribute('title')).toBe('a')
        wildflower.destroyComponent(kid.dataset.componentId)
        kid.remove()
        await settle()
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('a')
        P.label = 'c'
        await settle()
        expect(kid.getAttribute('title')).toBe('a')
    })

    it('the parent stops writing to every binding on the removed root', async () => {
        const { kid, P } = await setup('data-bind-class="{ lit: on }" data-bind="label"')
        expect(kid.classList.contains('lit')).toBe(true)
        wildflower.destroyComponent(kid.dataset.componentId)
        kid.remove()
        await settle()
        P.on = false
        P.label = 'b'
        await settle()
        expect(kid.classList.contains('lit')).toBe(true)
        expect(kid.getAttribute('title')).toBe('a')
        expect(kid.textContent).toBe('a')
    })

    it('a root the next scan brings back keeps the parent\'s bindings', async () => {
        const { kid, P } = await setup()
        wildflower.destroyComponent(kid.dataset.componentId)
        wildflower.scan(container)
        await settle(120)
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('b')
    })

    it('a root brought back and then removed still stops the parent\'s writes', async () => {
        const { kid, P } = await setup()
        wildflower.destroyComponent(kid.dataset.componentId)
        wildflower.scan(container)
        await settle(120)
        kid.remove()
        await settle(60)
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('a')
    })

    // A root that carries its own data-render (a section the parent owns).
    // Removed by hand after a destroy, it is gone like any other root; taken
    // out by its own section, it comes back with the section. (The parent
    // kept writing to a hand-removed root of this kind: its entries were
    // never marked, so that the section could bring it back.)
    async function setupSection() {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { label: 'a', on: true } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="parent" data-component="${p}"><i class="sib" data-bind="label"></i>` +
            `<div class="kid" data-component="${c}" data-render="on" data-bind-attr="{ title: label }"></div></div>`
        wildflower.scan(container)
        await settle(120)
        return { kid: container.querySelector('.kid'), P: wildflower.getComponent(p) }
    }
    const sib = () => container.querySelector('.sib').textContent

    it('a root with its own data-render, destroyed and removed by hand: the parent stops writing to it', async () => {
        const { kid, P } = await setupSection()
        expect(kid.getAttribute('title')).toBe('a')
        wildflower.destroyComponent(kid.dataset.componentId)
        kid.remove()
        await settle()
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('a')
        expect(sib()).toBe('b')
        // Its section is gone with it: a later toggle brings nothing back and stops nothing.
        P.on = false
        await settle()
        P.on = true
        P.label = 'c'
        await settle()
        expect(container.querySelector('.kid')).toBe(null)
        expect(kid.getAttribute('title')).toBe('a')
        expect(sib()).toBe('c')
    })

    it('a root its own data-render takes out comes back with the section and follows the parent', async () => {
        const { kid, P } = await setupSection()
        P.on = false
        await settle()
        expect(container.querySelector('.kid')).toBe(null)
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('a')
        P.on = true
        await settle(120)
        const back = container.querySelector('.kid')
        expect(back).not.toBe(null)
        expect(back.getAttribute('title')).toBe('b')
        P.label = 'c'
        await settle()
        expect(back.getAttribute('title')).toBe('c')
        expect(sib()).toBe('c')
    })

    it('a root destroyed in the page and then taken out by its own data-render still comes back', async () => {
        const { kid, P } = await setupSection()
        wildflower.destroyComponent(kid.dataset.componentId)
        P.on = false
        await settle()
        expect(container.querySelector('.kid')).toBe(null)
        P.label = 'b'
        await settle()
        P.on = true
        await settle(120)
        const back = container.querySelector('.kid')
        expect(back).not.toBe(null)
        expect(back.getAttribute('title')).toBe('b')
        P.label = 'c'
        await settle()
        expect(back.getAttribute('title')).toBe('c')
    })

    it('a root moved elsewhere in the parent after destroy keeps the bindings', async () => {
        const { kid, P } = await setup()
        wildflower.destroyComponent(kid.dataset.componentId)
        const parent = container.querySelector('.parent')
        const box = document.createElement('section')
        parent.appendChild(box)
        box.appendChild(kid)
        await settle(60)
        P.label = 'b'
        await settle()
        expect(kid.getAttribute('title')).toBe('b')
    })
})

describe('data-cloak on a root that root.show hides', () => {
    let wildflower, container, style
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        style = document.createElement('style')
        style.textContent = '[data-cloak] { display: none !important; }'
        document.head.appendChild(style)
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { container.remove(); style.remove() })

    const hidden = (el) => getComputedStyle(el).display === 'none'

    it('a top-level root stays hidden through the strip, and shows when root.show turns true', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { open: false }, root: { show: 'open' } })
        container.innerHTML = `<div class="kid" data-component="${c}" data-cloak>x</div>`
        wildflower.scan(container)
        await settle(200)
        const kid = container.querySelector('.kid')
        expect(kid.hasAttribute('data-cloak')).toBe(false)
        expect(hidden(kid)).toBe(true)
        wildflower.getComponent(c).open = true
        await settle()
        expect(hidden(kid)).toBe(false)
    })

    it('a child root whose tag data-show is true stays hidden', async () => {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { pshow: true } })
        wildflower.component(c, { state: { open: false }, root: { show: 'open' } })
        container.innerHTML = `<div data-component="${p}"><div class="kid" data-component="${c}" data-show="pshow" data-cloak>x</div></div>`
        wildflower.scan(container)
        await settle(200)
        const kid = container.querySelector('.kid')
        expect(kid.hasAttribute('data-cloak')).toBe(false)
        expect(hidden(kid)).toBe(true)
    })

    it('a child registered after its parent mounted (the late strip) stays hidden', async () => {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { pshow: true } })
        container.innerHTML = `<div data-component="${p}"><div class="kid" data-component="${c}" data-show="pshow" data-cloak>x</div></div>`
        wildflower.scan(container)
        await settle(120)
        wildflower.component(c, { state: { open: false }, root: { show: 'open' } })
        await settle(200)
        const kid = container.querySelector('.kid')
        expect(kid.hasAttribute('data-cloak')).toBe(false)
        expect(hidden(kid)).toBe(true)
    })
})
