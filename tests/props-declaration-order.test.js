/**
 * Props when the child's definition registers BEFORE its parent's.
 *
 * wildflower.component(name) initializes matching elements already in the
 * page. Declare the child first and it is built while the parent element has
 * no instance: _findParentComponent sees the element but no component id, the
 * props resolver returns undefined at its null-parent guard (above every
 * branch, before any deferral), and the recorded prop path carries no parent
 * id for the reactive sweep to recover through. The prop never arrived, in
 * every build and both prefixes. Found through SSR, where the child elements
 * are guaranteed to exist at registration time; the plain-page canaries pin
 * that shape.
 *
 * The fix parks the link on the parent ELEMENT (the only stable key at that
 * moment) and adopts the waiting children when the element gets its instance:
 * hierarchy first, then the same props refresh a parent state change runs.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-declorder-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

describe('props: child declared before its parent', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mount(child, parent, { childAttrs = 'data-prop-label="heading"', extra = '' } = {}) {
        container.innerHTML = `
            <div id="host" data-component="${parent}">
                <span id="own" data-bind="heading"></span>
                <div id="kid" data-component="${child}" ${childAttrs}>
                    <em class="kl" data-bind="props.label"></em>
                </div>
                ${extra}
            </div>
        `
    }

    it('CONTROL: registering the child first initializes it while the parent has no instance', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()

        expect(container.querySelector('#kid').dataset.componentId, 'child initialized on registration').toBeTruthy()
        expect(container.querySelector('#host').dataset.componentId, 'parent has no instance yet').toBeUndefined()
    })

    it('a state prop resolves once the parent registers', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()
        expect(container.querySelector('.kl').textContent, 'nothing to resolve against yet').toBe('')

        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        expect(container.querySelector('.kl').textContent).toBe('Hello')
        expect(container.querySelector('#own').textContent, 'the parent itself renders').toBe('Hello')
    })

    it('the adopted child is wired into the hierarchy', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        let parentHeading = null
        wildflower.component(child, {
            props: { label: { type: 'string' } },
            readParent() { parentHeading = this.parent ? this.parent.heading : null }
        })
        await settle()
        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        const childId = container.querySelector('#kid').dataset.componentId
        const parentId = container.querySelector('#host').dataset.componentId
        const childInstance = wildflower.componentInstances.get(childId)
        const parentInstance = wildflower.componentInstances.get(parentId)

        expect(childInstance.parent, 'instance.parent').toBe(parentInstance)
        expect(parentInstance.children.map(c => c.id), 'parent.children').toEqual([childId])
        expect(wildflower.componentParents.get(childId), 'componentParents').toBe(parentId)
        expect(wildflower.componentChildren.get(parentId), 'componentChildren').toEqual([childId])

        childInstance.context.readParent()
        expect(parentHeading, 'this.parent from the child reads the parent').toBe('Hello')
    })

    it('a computed prop resolves once the parent registers', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent, { childAttrs: 'data-prop-label="greeting"' })

        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()
        wildflower.component(parent, {
            state: { heading: 'x', who: 'Ada' },
            computed: { greeting() { return 'Hi ' + this.who } }
        })
        await settle()

        expect(container.querySelector('.kl').textContent).toBe('Hi Ada')
    })

    it('a default holds until the parent registers, then the real value replaces it', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        wildflower.component(child, { props: { label: { type: 'string', default: 'pending' } } })
        await settle()
        expect(container.querySelector('.kl').textContent, 'default shown before the parent exists').toBe('pending')

        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()
        expect(container.querySelector('.kl').textContent).toBe('Hello')
    })

    it('parent state changes after adoption still reach the child', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        const seen = []
        wildflower.component(child, {
            props: { label: { type: 'string' } },
            onPropsChange() { seen.push(this.props.label) }
        })
        await settle()
        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        const parentId = container.querySelector('#host').dataset.componentId
        wildflower.componentInstances.get(parentId).context.heading = 'Changed'
        await settle()

        expect(container.querySelector('.kl').textContent).toBe('Changed')
        expect(seen, 'onPropsChange saw the adoption and the later write').toEqual(['Hello', 'Changed'])
    })

    it('destroying the parent destroys the adopted child', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        let destroyed = false
        wildflower.component(child, { props: { label: { type: 'string' } }, destroy() { destroyed = true } })
        await settle()
        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        const childId = container.querySelector('#kid').dataset.componentId
        const parentId = container.querySelector('#host').dataset.componentId
        wildflower.destroyComponent(parentId)
        await settle()

        expect(destroyed, 'child destroy hook ran').toBe(true)
        expect(wildflower.componentInstances.has(childId)).toBe(false)
        expect(wildflower.componentParents.has(childId)).toBe(false)
    })

    it('a child destroyed before the parent registers is not adopted', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()

        const kid = container.querySelector('#kid')
        const childId = kid.dataset.componentId
        wildflower.destroyComponent(childId)
        kid.remove()

        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        const parentId = container.querySelector('#host').dataset.componentId
        expect(wildflower.componentInstances.get(parentId).children).toEqual([])
        expect(wildflower.componentChildren.get(parentId) || []).toEqual([])
        expect(container.querySelector('#own').textContent).toBe('Hello')
    })

    it('two children under one late parent are both adopted', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent, {
            extra: `<div id="kid2" data-component="${child}" data-prop-label="heading"><em class="kl2" data-bind="props.label"></em></div>`
        })

        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()
        wildflower.component(parent, { state: { heading: 'Hello' } })
        await settle()

        expect(container.querySelector('.kl').textContent).toBe('Hello')
        expect(container.querySelector('.kl2').textContent).toBe('Hello')
        const parentId = container.querySelector('#host').dataset.componentId
        expect(wildflower.componentInstances.get(parentId).children.length).toBe(2)
    })

    it('CONTROL: parent registered first is unchanged', async () => {
        const child = uname('kid'); const parent = uname('host')
        mount(child, parent)

        wildflower.component(parent, { state: { heading: 'Hello' } })
        wildflower.component(child, { props: { label: { type: 'string' } } })
        await settle()

        expect(container.querySelector('.kl').textContent).toBe('Hello')
        const parentId = container.querySelector('#host').dataset.componentId
        expect(wildflower.componentInstances.get(parentId).children.length).toBe(1)
    })
})
