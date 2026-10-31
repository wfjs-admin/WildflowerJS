/**
 * Bindings on a component's root element.
 *
 * A binding written on a component's ROOT element is read in the scope of
 * whoever wrote the tag: the parent component, or, when the root is also a
 * list row, the row item for bare names and the parent for other names. This
 * holds on every arrival path:
 *
 *   static  the child is in the parent's HTML when the parent scans
 *   late    the child sits inside a parent data-render section that turns on later
 *   append  the child is inserted into an already-mounted parent, then scanned
 *
 * data-action on the root stays the component's OWN handler
 * (<form data-component="search" data-action="submit:onSearch">), and a
 * top-level component with no parent reads its own root.
 *
 * Every value case gives parent and child the same key with different values,
 * so an inert binding, a child-scoped binding and a parent-scoped binding each
 * produce a different observation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForUpdate } from './helpers/load-framework.js'

let seq = 0
const uid = (base) => `crb-${base}-${++seq}`

async function settle() {
    await waitForUpdate()
    await new Promise(resolve => setTimeout(resolve, 20))
    await waitForUpdate()
}

describe('bindings on a component root', () => {
    let wildflower
    let host

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        host = document.createElement('div')
        host.className = 'crb-host'
        host.style.position = 'absolute'
        host.style.left = '-9999px'
        document.body.appendChild(host)
    })

    afterEach(() => {
        if (host?.parentNode) host.parentNode.removeChild(host)
    })

    const instOf = (el) => (el && el.dataset.componentId ? wildflower.componentInstances.get(el.dataset.componentId) : null)
    const parentEl = () => host.querySelector('.parent')
    const childEl = () => host.querySelector('.child')

    /**
     * Mount a parent and a child whose root markup is `childHtml` (with CHILD
     * standing for the child's component name) by one arrival path.
     * The parent's state always carries `open` for the late path's section.
     */
    async function arrive(arrival, parentDef, childDef, childHtml) {
        const P = uid('parent')
        const C = uid('child')
        wildflower.component(C, childDef)
        wildflower.component(P, { ...parentDef, state: { open: false, ...(parentDef.state || {}) } })
        const html = childHtml.replaceAll('CHILD', C)

        if (arrival === 'static' || arrival === 'static-pageload') {
            host.innerHTML = `<div class="parent" data-component="${P}"><p>before</p>${html}</div>`
            if (arrival === 'static') wildflower.scan()
            else wildflower._scanForComponents()
            await settle()
        } else if (arrival === 'late') {
            host.innerHTML = `<div class="parent" data-component="${P}"><p>before</p><div class="section" data-render="open">${html}</div></div>`
            wildflower.scan()
            await settle()
            expect(childEl()).toBeNull()
            instOf(parentEl()).state.open = true
            await settle()
        } else if (arrival === 'append') {
            host.innerHTML = `<div class="parent" data-component="${P}"><p>before</p></div>`
            wildflower.scan()
            await settle()
            parentEl().insertAdjacentHTML('beforeend', html)
            wildflower.scan()
            await settle()
        } else {
            throw new Error('unknown arrival ' + arrival)
        }
        return { P, C, parent: instOf(parentEl()) }
    }

    // One spec per value-binding family. `key` is the shared state key; the
    // parent starts at p1 and moves to p2, the child starts at c1 and moves to
    // c2. `read` turns the root into an observation; `expect*` are the
    // observations a parent-scoped binding produces.
    const families = {
        'data-show': {
            html: '<div class="child" data-component="CHILD" data-show="flag"></div>',
            key: 'flag', p1: false, p2: true, c1: true, c2: false,
            read: () => {
                const el = childEl()
                if (!el) return 'absent'
                if (el.style.display === 'none') return 'hidden'
                return el.classList.contains('wf-show') ? 'shown' : 'untouched'
            },
            expect1: 'hidden', expect2: 'shown'
        },
        'data-render': {
            html: '<div class="child" data-component="CHILD" data-render="flag"></div>',
            key: 'flag', p1: false, p2: true, c1: true, c2: false,
            read: () => (childEl() ? 'present' : 'absent'),
            expect1: 'absent', expect2: 'present'
        },
        'data-bind': {
            html: '<div class="child" data-component="CHILD" data-bind="label"></div>',
            key: 'label', p1: 'P-one', p2: 'P-two', c1: 'C-one', c2: 'C-two',
            read: () => childEl()?.textContent,
            expect1: 'P-one', expect2: 'P-two'
        },
        'data-bind-class': {
            html: '<div class="child" data-component="CHILD" data-bind-class="tone"></div>',
            key: 'tone', p1: 'p-one', p2: 'p-two', c1: 'c-one', c2: 'c-two',
            read: () => {
                const el = childEl()
                return ['p-one', 'p-two', 'c-one', 'c-two'].filter(c => el.classList.contains(c)).join(' ')
            },
            expect1: 'p-one', expect2: 'p-two'
        },
        'data-bind-attr': {
            html: `<div class="child" data-component="CHILD" data-bind-attr="({ 'data-tone': tone })"></div>`,
            key: 'tone', p1: 'p-one', p2: 'p-two', c1: 'c-one', c2: 'c-two',
            read: () => childEl()?.getAttribute('data-tone'),
            expect1: 'p-one', expect2: 'p-two'
        },
        'data-bind-style': {
            html: '<div class="child" data-component="CHILD" data-bind-style="({ width: size })"></div>',
            key: 'size', p1: '11px', p2: '12px', c1: '21px', c2: '22px',
            read: () => childEl()?.style.width,
            expect1: '11px', expect2: '12px'
        },
        'data-model': {
            html: '<input class="child" data-component="CHILD" data-model="text">',
            key: 'text', p1: 'P-one', p2: 'P-two', c1: 'C-one', c2: 'C-two',
            read: () => childEl()?.value,
            expect1: 'P-one', expect2: 'P-two'
        },
        'data-bind-html': {
            html: '<div class="child" data-component="CHILD" data-bind-html="markup"></div>',
            key: 'markup', p1: '<b>p-one</b>', p2: '<i>p-two</i>', c1: '<u>c-one</u>', c2: '<s>c-two</s>',
            read: () => childEl()?.innerHTML,
            expect1: '<b>p-one</b>', expect2: '<i>p-two</i>'
        }
    }

    const arrivals = ['static', 'static-pageload', 'late', 'append']

    for (const [family, spec] of Object.entries(families)) {
        describe(family, () => {
            for (const arrival of arrivals) {
                it(`${arrival}: reads the parent, follows the parent, ignores the child`, async () => {
                    const { parent } = await arrive(
                        arrival,
                        { state: { [spec.key]: spec.p1 } },
                        { state: { [spec.key]: spec.c1 } },
                        spec.html
                    )
                    expect(spec.read()).toBe(spec.expect1)

                    parent.state[spec.key] = spec.p2
                    await settle()
                    expect(spec.read()).toBe(spec.expect2)

                    // The child is live once its root is in the document.
                    const child = instOf(childEl())
                    expect(child).toBeTruthy()
                    child.state[spec.key] = spec.c2
                    await settle()
                    expect(spec.read()).toBe(spec.expect2)

                    // And the parent still drives it after the child wrote.
                    parent.state[spec.key] = spec.p1
                    await settle()
                    expect(spec.read()).toBe(spec.expect1)
                })
            }
        })
    }

    describe('data-model on a child root writes the parent', () => {
        for (const arrival of arrivals) {
            it(`${arrival}: typing updates the parent's state, not the child's`, async () => {
                const { parent } = await arrive(
                    arrival,
                    { state: { text: 'P-one' } },
                    { state: { text: 'C-one' } },
                    families['data-model'].html
                )
                const input = childEl()
                const child = instOf(input)
                input.value = 'typed'
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await settle()
                expect(parent.state.text).toBe('typed')
                expect(child.state.text).toBe('C-one')
            })
        }
    })

    describe('data-action on a child root is the child\'s own handler', () => {
        for (const arrival of ['static', 'static-pageload', 'late', 'append']) {
            it(`${arrival}: runs the child's method when both define it`, async () => {
                const calls = []
                await arrive(
                    arrival,
                    { state: {}, hit() { calls.push('parent') } },
                    { state: {}, hit() { calls.push('child') } },
                    '<button class="child" data-component="CHILD" data-action="hit">go</button>'
                )
                childEl().click()
                await settle()
                expect(calls).toEqual(['child'])
            })
        }

        it('static: a value binding and an action on the same root split by scope', async () => {
            const calls = []
            const { parent } = await arrive(
                'static',
                { state: { tone: 'p-one' }, hit() { calls.push('parent') } },
                { state: { tone: 'c-one' }, hit() { calls.push('child'); this.tone = 'c-two' } },
                `<button class="child" data-component="CHILD" data-action="hit" data-bind-attr="({ 'data-tone': tone })">go</button>`
            )
            expect(childEl().getAttribute('data-tone')).toBe('p-one')
            childEl().click()
            await settle()
            expect(calls).toEqual(['child'])
            expect(childEl().getAttribute('data-tone')).toBe('p-one')
            parent.state.tone = 'p-two'
            await settle()
            expect(childEl().getAttribute('data-tone')).toBe('p-two')
        })
    })

    describe('a data-render on a child root removes and restores a live child', () => {
        for (const arrival of arrivals) {
            it(`${arrival}: the child comes back initialized, once, and keeps its inner bindings`, async () => {
                const { C, parent } = await arrive(
                    arrival,
                    { state: { flag: true } },
                    { state: { flag: true, label: 'inner' } },
                    '<div class="child" data-component="CHILD" data-render="flag"><span class="inner" data-bind="label"></span></div>'
                )
                const live = () => wildflower.getComponentsByType(C).length
                expect(host.querySelector('.inner').textContent).toBe('inner')
                expect(live()).toBe(1)
                for (let round = 0; round < 2; round++) {
                    parent.state.flag = false
                    await settle()
                    expect(childEl()).toBeNull()
                    expect(live()).toBe(0)
                    parent.state.flag = true
                    await settle()
                    const child = instOf(childEl())
                    expect(child).toBeTruthy()
                    expect(live()).toBe(1)
                    expect(host.querySelector('.inner').textContent).toBe('inner')
                    child.state.label = 'moved ' + round
                    await settle()
                    expect(host.querySelector('.inner').textContent).toBe('moved ' + round)
                    child.state.label = 'inner'
                    await settle()
                }
            })
        }
    })

    describe('a nested component styling its own root', () => {
        it('onUpdate with this.$el().toggleClass() reaches the root (the documented pattern)', async () => {
            await arrive(
                'static',
                { state: {} },
                {
                    state: { isOpen: false },
                    toggle() { this.isOpen = !this.isOpen },
                    onUpdate() { this.$el().toggleClass('open', this.isOpen) }
                },
                '<div class="child" data-component="CHILD"><button class="toggle" data-action="toggle">t</button></div>'
            )
            expect(childEl().classList.contains('open')).toBe(false)
            host.querySelector('.toggle').click()
            await settle()
            expect(childEl().classList.contains('open')).toBe(true)
            host.querySelector('.toggle').click()
            await settle()
            expect(childEl().classList.contains('open')).toBe(false)
        })
    })

    describe('a child root that leaves the page', () => {
        const collect = async () => {
            await settle()
            wildflower.garbageCollect()
            await settle()
        }

        it.skipIf(isMinifiedBuild())('append, remove and re-append three times: one live entry set per root, none for removed roots', async () => {
            const { C, parent } = await arrive(
                'append',
                { state: { tone: 'p-one', flag: true, keep: true } },
                { state: { tone: 'c-one' } },
                '<div class="child" data-component="CHILD" data-bind-class="tone" data-show="flag" data-render="keep"></div>'
            )
            const entries = () => parent._renderMeta || []
            const records = () => parent._renderContexts || []
            const html = `<div class="child" data-component="${C}" data-bind-class="tone" data-show="flag" data-render="keep"></div>`
            for (let round = 0; round < 3; round++) {
                // One root in the page: its class, show and render entries.
                expect(entries().length).toBe(3)
                expect(entries().every(m => (m.element || m.context.element).isConnected)).toBe(true)
                expect(records().length).toBe(1)
                const removed = childEl()
                removed.remove()
                await collect()
                expect(wildflower.getComponentsByType(C).length).toBe(0)
                expect(entries().length).toBe(0)
                expect(records().length).toBe(0)
                // The removed root is no longer written to.
                parent.state.tone = 'p-' + round
                await settle()
                expect(removed.classList.contains('p-' + round)).toBe(false)
                parentEl().insertAdjacentHTML('beforeend', html)
                wildflower.scan()
                await settle()
                expect(childEl().classList.contains('p-' + round)).toBe(true)
            }
            expect(entries().length).toBe(3)
            expect(records().length).toBe(1)
        })

        // Two appended roots with a section each, plus a section of the
        // parent's own. The first root is removed by hand; the sections after
        // it in the parent's effect must keep toggling, with nothing thrown,
        // whether or not the removed child has been collected yet.
        for (const variant of ['before collection', 'after collection', 'plain section removed by hand']) {
            it(`${variant}: the parent's other sections keep toggling and nothing is thrown`, async () => {
                const errors = []
                const originalError = console.error
                console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError.apply(console, args) }
                try {
                    const P = uid('parent')
                    const C = uid('child')
                    wildflower.component(C, { state: {} })
                    wildflower.component(P, { state: { flag: true } })
                    host.innerHTML = `<div class="parent" data-component="${P}"><div class="s1" data-render="flag">one</div><div class="s2" data-render="flag">two</div></div>`
                    wildflower.scan()
                    await settle()
                    parentEl().insertAdjacentHTML('beforeend',
                        `<div class="c1" data-component="${C}" data-render="flag"></div><div class="c2" data-component="${C}" data-render="flag"></div>`)
                    wildflower.scan()
                    await settle()
                    const parent = instOf(parentEl())
                    if (variant === 'plain section removed by hand') {
                        host.querySelector('.s1').remove()
                    } else {
                        host.querySelector('.c1').remove()
                        if (variant === 'after collection') await collect()
                    }
                    const present = () => ['.s1', '.s2', '.c1', '.c2'].filter(s => host.querySelector(s)).join(' ')
                    const expectedOn = variant === 'plain section removed by hand' ? '.s2 .c1 .c2' : '.s1 .s2 .c2'
                    for (let round = 0; round < 2; round++) {
                        parent.state.flag = false
                        await settle()
                        expect(present()).toBe('')
                        parent.state.flag = true
                        await settle()
                        expect(present()).toBe(expectedOn)
                        expect(instOf(host.querySelector('.c2'))).toBeTruthy()
                    }
                    expect(errors.filter(e => e.includes('Error'))).toEqual([])
                } finally {
                    console.error = originalError
                }
            })
        }
    })

    describe('a section or root other code moves', () => {
        it('a section removed by hand still disposes the list inside it when it turns off', async () => {
            const errors = []
            const originalError = console.error
            console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError.apply(console, args) }
            try {
                const P = uid('parent')
                wildflower.component(P, { state: { flag: true, items: [{ id: 1, n: 1 }] } })
                host.innerHTML = `<div class="parent" data-component="${P}"><div class="s1" data-render="flag"><ul class="l" data-list="items" data-key="id"><template><li data-bind="n"></li></template></ul></div><div class="s2" data-render="flag">two</div></div>`
                wildflower.scan()
                await settle()
                const parent = instOf(parentEl())
                const list = host.querySelector('.l')
                expect(list.querySelectorAll('li').length).toBe(1)
                host.querySelector('.s1').remove()
                parent.state.flag = false
                await settle()
                expect(host.querySelector('.s2')).toBeNull()
                // The removed section's list no longer follows the array.
                parent.state.items.push({ id: 2, n: 2 })
                await settle()
                expect(list.querySelectorAll('li').length).toBe(1)
                parent.state.flag = true
                await settle()
                expect(host.querySelector('.s2')).not.toBeNull()
                expect(errors.filter(e => e.includes('Error'))).toEqual([])
            } finally {
                console.error = originalError
            }
        })

        for (const arrival of ['static', 'append']) {
            it(`${arrival}: a root detached by hand and put back before collection keeps following the parent`, async () => {
                const { C, parent } = await arrive(
                    arrival,
                    { state: { tone: 'p-one' } },
                    { state: { tone: 'c-one' } },
                    '<div class="child c1" data-component="CHILD" data-bind-class="tone"></div>'
                )
                const c1 = host.querySelector('.c1')
                // In one task: take c1 out, append and scan a sibling, put c1 back.
                c1.remove()
                parentEl().insertAdjacentHTML('beforeend', `<div class="child c2" data-component="${C}" data-bind-class="tone"></div>`)
                wildflower.scan()
                parentEl().appendChild(c1)
                await settle()
                expect(instOf(c1)).toBeTruthy()
                parent.state.tone = 'p-two'
                await settle()
                expect(c1.classList.contains('p-two')).toBe(true)
                expect(host.querySelector('.c2').classList.contains('p-two')).toBe(true)
            })
        }

        // A child root the parent teleports keeps the parent as its owner,
        // wherever the target is.
        for (const arrival of ['static', 'append']) {
            it.skipIf(!hasFeature('portals'))(`${arrival}: a root portaled into another component is read by the parent only`, async () => {
                const A = uid('app')
                const P = uid('parent')
                const C = uid('child')
                wildflower.component(A, { state: { tone: 'a-one' } })
                wildflower.component(C, { state: { tone: 'c-one' } })
                wildflower.component(P, { state: { tone: 'p-one' } })
                const parentHtml = `<div class="parent" data-component="${P}"><div data-portal="#crb-target"><div class="child" data-component="${C}" data-bind-class="tone"></div></div></div>`
                if (arrival === 'static') {
                    host.innerHTML = `<div class="app" data-component="${A}"><div id="crb-target"></div>${parentHtml}</div>`
                } else {
                    host.innerHTML = `<div class="app" data-component="${A}"><div id="crb-target"></div></div>`
                    wildflower.scan()
                    await settle()
                    host.querySelector('.app').insertAdjacentHTML('beforeend', parentHtml)
                }
                wildflower.scan()
                await settle()
                const child = childEl()
                const classes = () => ['a-one', 'a-two', 'p-one', 'p-two', 'c-one', 'c-two'].filter(c => child.classList.contains(c)).join(' ')
                expect(child.parentElement.id).toBe('crb-target')
                expect(classes()).toBe('p-one')
                instOf(host.querySelector('.app')).state.tone = 'a-two'
                await settle()
                expect(classes()).toBe('p-one')
                instOf(parentEl()).state.tone = 'p-two'
                await settle()
                expect(classes()).toBe('p-two')
                instOf(child).state.tone = 'c-two'
                await settle()
                expect(classes()).toBe('p-two')
                if (!isMinifiedBuild()) {
                    const app = instOf(host.querySelector('.app'))
                    expect([...(app._renderMeta || []), ...(app._renderContexts || [])].some(m => m.element === child)).toBe(false)
                }
            })
        }

        for (const family of ['data-show', 'data-bind-class']) {
            it.skipIf(!hasFeature('portals'))(`${family} on a root portaled to a target outside every component is read by the parent, not the child`, async () => {
                const target = document.createElement('div')
                target.id = 'crb-out-target'
                document.body.appendChild(target)
                try {
                    const P = uid('parent')
                    const C = uid('child')
                    wildflower.component(C, { state: { flag: true, tone: 'c-one' } })
                    wildflower.component(P, { state: { flag: false, tone: 'p-one' } })
                    const attr = family === 'data-show' ? 'data-show="flag"' : 'data-bind-class="tone"'
                    host.innerHTML = `<div class="parent" data-component="${P}"><div data-portal="#crb-out-target"><div class="child" data-component="${C}" ${attr}></div></div></div>`
                    wildflower.scan()
                    await settle()
                    const child = target.querySelector('.child')
                    expect(child).not.toBeNull()
                    const read = () => family === 'data-show'
                        ? (child.style.display === 'none' ? 'hidden' : 'shown')
                        : ['p-one', 'p-two', 'c-one', 'c-two'].filter(c => child.classList.contains(c)).join(' ')
                    const [first, moved] = family === 'data-show' ? ['hidden', 'shown'] : ['p-one', 'p-two']
                    expect(read()).toBe(first)
                    Object.assign(instOf(child).state, { flag: false, tone: 'c-two' })
                    await settle()
                    expect(read()).toBe(first)
                    Object.assign(instOf(parentEl()).state, { flag: true, tone: 'p-two' })
                    await settle()
                    expect(read()).toBe(moved)
                } finally {
                    target.remove()
                }
            })
        }
    })

    describe('appending many children with root bindings', () => {
        // Mount a parent, append 500 children, and scan once. `spy` wraps the
        // parent's effect creation and disposal for the duration of the scan.
        const appendAndScan = async (withBinding, spy) => {
            const P = uid('perf')
            const C = uid('perfchild')
            wildflower.component(C, { state: {} })
            wildflower.component(P, { state: { tone: 'p-tone' } })
            host.innerHTML = `<div class="parent" data-component="${P}"><span class="own" data-bind="tone"></span></div>`
            wildflower.scan()
            await settle()
            const parent = instOf(parentEl())
            parentEl().insertAdjacentHTML('beforeend', Array.from({ length: 500 }, (_, i) => withBinding
                ? `<div class="child" data-component="${C}" data-bind-class="tone">${i}</div>`
                : `<div class="child" data-component="${C}">${i}</div>`).join(''))
            const counts = { created: 0, disposed: 0 }
            if (spy) {
                const create = wildflower._createComponentRenderEffect
                const dispose = wildflower._disposeComponentRenderEffect
                wildflower._createComponentRenderEffect = function (inst) { if (inst === parent) counts.created++; return create.call(this, inst) }
                wildflower._disposeComponentRenderEffect = function (inst) { if (inst === parent) counts.disposed++; return dispose.call(this, inst) }
            }
            const start = performance.now()
            try {
                wildflower.scan()
            } finally {
                if (spy) {
                    delete wildflower._createComponentRenderEffect
                    delete wildflower._disposeComponentRenderEffect
                }
            }
            const ms = performance.now() - start
            await settle()
            return { ms, counts, parent }
        }

        it.skipIf(isMinifiedBuild())('500 in one scan rebuild the parent\'s effect exactly once', async () => {
            const { counts, parent } = await appendAndScan(true, true)
            expect(counts).toEqual({ created: 1, disposed: 1 })
            expect(host.querySelectorAll('.child').length).toBe(500)
            expect(host.querySelectorAll('.child.p-tone').length).toBe(500)
            parent.state.tone = 'p-tone-2'
            await settle()
            expect(host.querySelectorAll('.child.p-tone-2').length).toBe(500)
            expect(host.querySelector('.own').textContent).toBe('p-tone-2')
        })

        it.skipIf(isMinifiedBuild())('a section turning on with 50 child roots in it rebuilds the parent\'s effect once', async () => {
            const P = uid('lateperf')
            const C = uid('latechild')
            wildflower.component(C, { state: {} })
            wildflower.component(P, { state: { open: false, tone: 'p-tone' } })
            host.innerHTML = `<div class="parent" data-component="${P}"><div class="section" data-render="open">` +
                Array.from({ length: 50 }, (_, i) => `<div class="child" data-component="${C}" data-bind-class="tone">${i}</div>`).join('') +
                '</div></div>'
            wildflower.scan()
            await settle()
            const parent = instOf(parentEl())
            let created = 0
            const create = wildflower._createComponentRenderEffect
            wildflower._createComponentRenderEffect = function (inst) { if (inst === parent) created++; return create.call(this, inst) }
            try {
                parent.state.open = true
                await settle()
            } finally {
                delete wildflower._createComponentRenderEffect
            }
            expect(created).toBe(1)
            expect(host.querySelectorAll('.child.p-tone').length).toBe(50)
            parent.state.tone = 'p-tone-2'
            await settle()
            expect(host.querySelectorAll('.child.p-tone-2').length).toBe(50)
        })

        it('500 in one scan stay within a loose bound of children without root bindings (min of 3 each)', async () => {
            await appendAndScan(false, false)   // warm-up
            const plain = []
            const bound = []
            for (let i = 0; i < 3; i++) {
                plain.push((await appendAndScan(false, false)).ms)
                bound.push((await appendAndScan(true, false)).ms)
            }
            expect(Math.min(...bound)).toBeLessThan(Math.max(Math.min(...plain), 5) * 4)
        })
    })

    describe('a root inside a component registered later', () => {
        // P > U > C, with U registered after P has mounted. The root's owner
        // is U, the element whose markup holds C's tag, registered or not:
        // until U initializes the root's bindings are inert, then U reads
        // them, and P never does.
        const cases = {
            'data-show': {
                html: '<div class="child" data-component="CHILD" data-show="flag"></div>',
                p: { flag: false }, u: { flag: true }, c: { flag: false },
                read: () => {
                    const el = childEl()
                    if (!el) return 'absent'
                    if (el.style.display === 'none') return 'hidden'
                    return el.classList.contains('wf-show') ? 'shown' : 'untouched'
                },
                steps: [['before', 'untouched'], ['p', { flag: true }, 'untouched'], ['register', 'shown'],
                    ['p', { flag: false }, 'shown'], ['u', { flag: false }, 'hidden'], ['p', { flag: true }, 'hidden'], ['u', { flag: true }, 'shown']]
            },
            'data-render': {
                html: '<div class="child" data-component="CHILD" data-render="flag"><span class="inner" data-bind="label"></span></div>',
                p: { flag: true }, u: { flag: false }, c: { label: 'inner' },
                read: () => {
                    const el = childEl()
                    if (!el) return 'absent'
                    return instOf(el) && el.querySelector('.inner').textContent === 'inner' ? 'live' : 'present'
                },
                steps: [['before', 'live'], ['p', { flag: false }, 'live'], ['register', 'absent'],
                    ['u', { flag: true }, 'live'], ['p', { flag: true }, 'live'], ['u', { flag: false }, 'absent'], ['p', { flag: false }, 'absent'], ['u', { flag: true }, 'live']]
            },
            'data-bind-class': {
                html: '<div class="child" data-component="CHILD" data-bind-class="tone"></div>',
                p: { tone: 'p-one' }, u: { tone: 'u-one' }, c: { tone: 'c-one' },
                read: () => ['p-one', 'p-two', 'u-one', 'u-two', 'c-one'].filter(c => childEl().classList.contains(c)).join(' '),
                steps: [['before', ''], ['p', { tone: 'p-two' }, ''], ['register', 'u-one'],
                    ['p', { tone: 'p-one' }, 'u-one'], ['u', { tone: 'u-two' }, 'u-two']]
            }
        }
        for (const [family, spec] of Object.entries(cases)) {
            it(`${family}: exactly one owner, the middle component, once it registers`, async () => {
                const P = uid('parent')
                const U = uid('middle')
                const C = uid('child')
                wildflower.component(C, { state: spec.c })
                wildflower.component(P, { state: spec.p })
                host.innerHTML = `<div class="parent" data-component="${P}"><div class="middle" data-component="${U}">${spec.html.replace('CHILD', C)}</div></div>`
                wildflower.scan()
                await settle()
                const parent = instOf(parentEl())
                for (const step of spec.steps) {
                    if (step[0] === 'register') {
                        wildflower.component(U, { state: spec.u })
                        await settle()
                    } else if (step[0] === 'p' || step[0] === 'u') {
                        Object.assign((step[0] === 'p' ? parent : instOf(host.querySelector('.middle'))).state, step[1])
                        await settle()
                    }
                    expect(spec.read(), `${family} after ${step[0]} ${JSON.stringify(step[1] || '')}`).toBe(step[step.length - 1])
                }
                if (!isMinifiedBuild()) {
                    const touches = (inst) => [...(inst._renderMeta || []), ...(inst._renderContexts || [])]
                        .some(m => (m.element || (m.context && m.context.element)) && host.contains(m.element || m.context.element) &&
                            (m.element || m.context.element).classList.contains('child'))
                    expect(touches(parent)).toBe(false)
                }
                await settle()
                wildflower.garbageCollect()
                await settle()
                expect(wildflower.getComponentsByType(C).filter(i => i.element.isConnected).length).toBe(childEl() ? 1 : 0)
            })
        }
    })

    describe('instances whose root bindings differ from the first instance\'s', () => {
        // The second and third instance of each child differ from the first
        // in their root bindings only, so they are set up by the fallback
        // collector rather than the first instance's compiled snapshot.
        for (const arrival of ['static', 'append', 'children registered late']) {
            it(`${arrival}: every root reads the parent from the first paint`, async () => {
                const P = uid('parent')
                const F = uid('field')
                const G = uid('flag')
                const children = () => {
                    wildflower.component(F, { state: { a: 'FA', b: 'FB', c: 'FC' } })
                    wildflower.component(G, { state: { x: true, y: false, label: 'GL' } })
                }
                if (arrival !== 'children registered late') children()
                wildflower.component(P, { state: { a: 'PA', b: 'PB', c: 'PC', x: false, y: true, label: 'PL' } })
                const inner = `<input class="m ma" data-component="${F}" data-model="a"><input class="m mb" data-component="${F}" data-model="b"><input class="m mc" data-component="${F}" data-model="c">` +
                    `<div class="g gx" data-component="${G}" data-show="x"></div><div class="g gy" data-component="${G}" data-show="y"></div><div class="g gl" data-component="${G}" data-bind="label"></div>`
                if (arrival === 'append') {
                    host.innerHTML = `<div class="parent" data-component="${P}"></div>`
                    wildflower.scan()
                    await settle()
                    parentEl().insertAdjacentHTML('beforeend', inner)
                    wildflower.scan()
                } else {
                    host.innerHTML = `<div class="parent" data-component="${P}">${inner}</div>`
                    wildflower.scan()
                    if (arrival === 'children registered late') {
                        await settle()
                        children()
                    }
                }
                const q = (s) => host.querySelector(s)
                const paint = () => [q('.ma').value, q('.mb').value, q('.mc').value,
                    q('.gx').style.display === 'none', q('.gy').style.display === 'none', q('.gl').textContent]
                // First paint, before anything else has run.
                expect(paint()).toEqual(['PA', 'PB', 'PC', true, false, 'PL'])
                await settle()
                expect(paint()).toEqual(['PA', 'PB', 'PC', true, false, 'PL'])
                expect(host.querySelectorAll('[data-component-id]').length).toBe(7)

                const parent = instOf(parentEl())
                Object.assign(parent.state, { b: 'PB2', x: true, label: 'PL2' })
                await settle()
                expect(paint()).toEqual(['PA', 'PB2', 'PC', false, false, 'PL2'])

                q('.mc').value = 'typed'
                q('.mc').dispatchEvent(new Event('input', { bubbles: true }))
                await settle()
                expect(parent.state.c).toBe('typed')
                expect(instOf(q('.mc')).state.c).toBe('FC')
            })
        }
    })

    describe('a section whose copy holds an already-initialized component', () => {
        // The component inside registered before the section's owner, so it
        // was live when the owner took the section out; the section turns on
        // again before that instance has been collected.
        for (const shape of ['the section is the child root', 'the section wraps the child']) {
            it(`${shape}: the copy initializes a fresh child`, async () => {
                const P = uid('parent')
                const C = uid('child')
                wildflower.component(C, { state: { label: 'L' } })
                const child = `<div class="child" data-component="${C}"${shape.endsWith('root') ? ' data-render="flag"' : ''}><span class="inner" data-bind="label"></span></div>`
                host.innerHTML = `<div class="parent" data-component="${P}">${shape.endsWith('root') ? child : `<div class="w" data-render="flag">${child}</div>`}</div>`
                wildflower.scan()
                await settle()
                expect(instOf(childEl())).toBeTruthy()
                wildflower.component(P, { state: { flag: false } })
                expect(childEl()).toBeNull()
                instOf(parentEl()).state.flag = true
                await settle()
                expect(instOf(childEl())).toBeTruthy()
                expect(host.querySelector('.inner').textContent).toBe('L')
                wildflower.garbageCollect()
                await settle()
                expect(instOf(childEl())).toBeTruthy()
                expect(wildflower.getComponentsByType(C).length).toBe(1)
            })
        }
    })

    describe('data-cloak on a child root', () => {
        it('the cloak strip takes its data-show verdict from the parent', async () => {
            const P = uid('parent')
            const C = uid('child')
            wildflower.component(P, { state: { flag: true } })
            host.innerHTML = `<div class="parent" data-component="${P}"><div class="child" data-component="${C}" data-cloak data-show="flag"></div></div>`
            wildflower.scan()
            await settle()
            // The child registers late; its init strips the cloak with a verdict.
            wildflower.component(C, { state: { flag: false } })
            await settle()
            const el = childEl()
            expect(instOf(el)).toBeTruthy()
            expect(el.hasAttribute('data-cloak')).toBe(false)
            expect(el.style.display).not.toBe('none')
        })
    })

    describe('a list row that is also a child root', () => {
        // static: the list is in the page at load. late: the list sits in a
        // data-render section of its component that turns on afterwards.
        // append: the list's component is inserted into a mounted component
        // and scanned.
        for (const arrival of ['static', 'late', 'append']) it(`${arrival}: bare names read the item, other names read the parent, child state never shadows`, async () => {
            const P = uid('rows')
            const C = uid('rowchild')
            wildflower.component(C, { state: { tone: 'c-tone', mode: 'c-mode', visible: true, label: 'c-label' } })
            wildflower.component(P, {
                state: {
                    open: arrival !== 'late',
                    mode: 'p-mode',
                    items: [
                        { id: 1, tone: 'i1', visible: true, label: 'L1' },
                        { id: 2, tone: 'i2', visible: false, label: 'L2' }
                    ]
                }
            })
            const markup = `
                <div class="parent" data-component="${P}">
                    <div class="section" data-render="open">
                        <div class="rows" data-list="items" data-key="id">
                            <template>
                                <div class="child" data-component="${C}"
                                     data-bind="label"
                                     data-show="visible"
                                     data-bind-class="mode"
                                     data-bind-attr="({ 'data-tone': tone, 'data-mode': mode })"></div>
                            </template>
                        </div>
                    </div>
                </div>`
            if (arrival === 'append') {
                const G = uid('outer')
                wildflower.component(G, { state: { mode: 'g-mode' } })
                host.innerHTML = `<div class="outer" data-component="${G}"></div>`
                wildflower.scan()
                await settle()
                host.querySelector('.outer').insertAdjacentHTML('beforeend', markup)
            } else {
                host.innerHTML = markup
            }
            wildflower.scan()
            await settle()
            if (arrival === 'late') {
                expect(host.querySelectorAll('.child').length).toBe(0)
                instOf(parentEl()).state.open = true
                await settle()
            }

            const rows = () => Array.from(host.querySelectorAll('.child'))
            const shown = (el) => el.style.display !== 'none'
            const snapshot = () => rows().map(el => [
                el.getAttribute('data-tone'),
                el.getAttribute('data-mode'),
                el.classList.contains('p-mode') ? 'p-mode' : (el.classList.contains('p-mode-2') ? 'p-mode-2' : (el.classList.contains('c-mode') ? 'c-mode' : '-')),
                shown(el),
                el.textContent
            ])

            // First paint
            expect(snapshot()).toEqual([
                ['i1', 'p-mode', 'p-mode', true, 'L1'],
                ['i2', 'p-mode', 'p-mode', false, 'L2']
            ])

            const parent = instOf(parentEl())

            // Item edits
            parent.state.items[0].tone = 'i1b'
            parent.state.items[0].label = 'L1b'
            parent.state.items[1].visible = true
            await settle()
            expect(snapshot()).toEqual([
                ['i1b', 'p-mode', 'p-mode', true, 'L1b'],
                ['i2', 'p-mode', 'p-mode', true, 'L2']
            ])

            // A parent (non-item) name moves every row
            parent.state.mode = 'p-mode-2'
            await settle()
            expect(snapshot()).toEqual([
                ['i1b', 'p-mode-2', 'p-mode-2', true, 'L1b'],
                ['i2', 'p-mode-2', 'p-mode-2', true, 'L2']
            ])

            // A pushed row reads its item and the parent
            parent.state.items.push({ id: 3, tone: 'i3', visible: false, label: 'L3' })
            await settle()
            expect(snapshot()).toEqual([
                ['i1b', 'p-mode-2', 'p-mode-2', true, 'L1b'],
                ['i2', 'p-mode-2', 'p-mode-2', true, 'L2'],
                ['i3', 'p-mode-2', 'p-mode-2', false, 'L3']
            ])

            // Child state never shadows either scope
            for (const el of rows()) {
                const child = instOf(el)
                expect(child).toBeTruthy()
                child.state.tone = 'c-tone-2'
                child.state.mode = 'c-mode-2'
                child.state.visible = true
                child.state.label = 'c-label-2'
            }
            await settle()
            expect(snapshot()).toEqual([
                ['i1b', 'p-mode-2', 'p-mode-2', true, 'L1b'],
                ['i2', 'p-mode-2', 'p-mode-2', true, 'L2'],
                ['i3', 'p-mode-2', 'p-mode-2', false, 'L3']
            ])
        })
    })

    describe('a top-level component reads its own root', () => {
        const topLevel = {
            'data-show': {
                html: '<div class="child" data-component="SELF" data-show="flag"></div>',
                key: 'flag', v1: false, v2: true,
                read: () => (childEl().style.display === 'none' ? 'hidden' : (childEl().classList.contains('wf-show') ? 'shown' : 'untouched')),
                e1: 'hidden', e2: 'shown'
            },
            'data-bind': {
                html: '<div class="child" data-component="SELF" data-bind="label"></div>',
                key: 'label', v1: 'one', v2: 'two',
                read: () => childEl().textContent, e1: 'one', e2: 'two'
            },
            'data-bind-class': {
                html: '<div class="child" data-component="SELF" data-bind-class="tone"></div>',
                key: 'tone', v1: 't-one', v2: 't-two',
                read: () => ['t-one', 't-two'].filter(c => childEl().classList.contains(c)).join(' '),
                e1: 't-one', e2: 't-two'
            },
            'data-bind-attr': {
                html: `<div class="child" data-component="SELF" data-bind-attr="({ 'data-tone': tone })"></div>`,
                key: 'tone', v1: 't-one', v2: 't-two',
                read: () => childEl().getAttribute('data-tone'), e1: 't-one', e2: 't-two'
            },
            'data-bind-style': {
                html: '<div class="child" data-component="SELF" data-bind-style="({ width: size })"></div>',
                key: 'size', v1: '31px', v2: '32px',
                read: () => childEl().style.width, e1: '31px', e2: '32px'
            },
            'data-model': {
                html: '<input class="child" data-component="SELF" data-model="text">',
                key: 'text', v1: 'one', v2: 'two',
                read: () => childEl().value, e1: 'one', e2: 'two'
            },
            'data-bind-html': {
                html: '<div class="child" data-component="SELF" data-bind-html="markup"></div>',
                key: 'markup', v1: '<b>one</b>', v2: '<i>two</i>',
                read: () => childEl().innerHTML, e1: '<b>one</b>', e2: '<i>two</i>'
            },
            // data-render is inert on a top-level root (a component cannot
            // take its own root out of the page); its data-show still works.
            'data-show beside data-render': {
                html: '<div class="child" data-component="SELF" data-show="flag" data-render="flag"></div>',
                key: 'flag', v1: false, v2: true,
                read: () => (childEl().style.display === 'none' ? 'hidden' : (childEl().classList.contains('wf-show') ? 'shown' : 'untouched')),
                e1: 'hidden', e2: 'shown'
            }
        }
        for (const [family, spec] of Object.entries(topLevel)) {
            it(`${family} on a top-level root reads the component's own state`, async () => {
                const S = uid('solo')
                wildflower.component(S, { state: { [spec.key]: spec.v1 } })
                host.innerHTML = spec.html.replace('SELF', S)
                wildflower.scan()
                await settle()
                expect(spec.read()).toBe(spec.e1)
                instOf(childEl()).state[spec.key] = spec.v2
                await settle()
                expect(spec.read()).toBe(spec.e2)
            })
        }
    })

    describe.skipIf(isMinifiedBuild())('dev diagnostics', () => {
        let captured
        let originalWarn

        beforeEach(() => {
            wildflower.options.debug = true
            wildflower.debug = true
            captured = []
            originalWarn = console.warn
            console.warn = (...args) => {
                captured.push(args.map(String).join(' '))
                originalWarn.apply(console, args)
            }
        })

        afterEach(() => {
            console.warn = originalWarn
        })

        const wf509 = (...tokens) => captured.filter(m => m.includes('WF-509') && tokens.every(t => m.includes(t)))

        it('no WF-509 for data-action on a child root when the child defines the method', async () => {
            const { P, C } = await arrive(
                'static',
                { state: {} },
                { state: {}, childOnly() {} },
                '<button class="child" data-component="CHILD" data-action="childOnly">go</button><button class="ctl" data-action="parentMissing">ctl</button>'
            )
            // Positive control in the same setup: the channel works.
            expect(wf509('"parentMissing"', `"${P}"`).length).toBeGreaterThan(0)
            expect(wf509('"childOnly"')).toEqual([])
            expect(C).toBeTruthy()
        })

        it('warns against the child when neither defines the method', async () => {
            const { P, C } = await arrive(
                'static',
                { state: {} },
                { state: {} },
                '<button class="child" data-component="CHILD" data-action="nobodyHasIt">go</button>'
            )
            expect(wf509('"nobodyHasIt"', `"${C}"`).length).toBeGreaterThan(0)
            expect(wf509('"nobodyHasIt"', `"${P}"`)).toEqual([])
        })

        it('warns against the child when only the parent defines the method', async () => {
            const calls = []
            const { P, C } = await arrive(
                'static',
                { state: {}, parentOnly() { calls.push('parent') } },
                { state: {} },
                '<button class="child" data-component="CHILD" data-action="parentOnly">go</button>'
            )
            expect(wf509('"parentOnly"', `"${C}"`).length).toBeGreaterThan(0)
            expect(wf509('"parentOnly"', `"${P}"`)).toEqual([])
        })

        it('warns against the child for an action appended into a mounted parent', async () => {
            const { C } = await arrive(
                'append',
                { state: {} },
                { state: {} },
                '<button class="child" data-component="CHILD" data-action="appendedMissing">go</button>'
            )
            expect(wf509('"appendedMissing"', `"${C}"`).length).toBeGreaterThan(0)
        })

        for (const arrival of ['static', 'append', 'children registered late']) {
            it(`${arrival}: no WF-509 against a child whose instances differ in their root bindings`, async () => {
                const P = uid('parent')
                const G = uid('flag')
                const register = () => wildflower.component(G, { state: {} })
                if (arrival !== 'children registered late') register()
                wildflower.component(P, { state: { x: true, y: true, label: 'L' } })
                const inner = `<div data-component="${G}" data-show="x"></div><div data-component="${G}" data-show="y"></div><div data-component="${G}" data-bind="label"></div>`
                // Positive control: the parent names a key it lacks.
                const control = '<span data-bind="parentLacksThis"></span>'
                if (arrival === 'append') {
                    host.innerHTML = `<div class="parent" data-component="${P}">${control}</div>`
                    wildflower.scan()
                    await settle()
                    parentEl().insertAdjacentHTML('beforeend', inner)
                    wildflower.scan()
                } else {
                    host.innerHTML = `<div class="parent" data-component="${P}">${control}${inner}</div>`
                    wildflower.scan()
                    if (arrival === 'children registered late') {
                        await settle()
                        register()
                    }
                }
                await settle()
                expect(host.querySelectorAll('[data-component-id]').length).toBe(4)
                expect(wf509('"parentLacksThis"', `"${P}"`).length).toBeGreaterThan(0)
                expect(wf509(`"${G}"`)).toEqual([])
            })
        }

        for (const [family, html] of [
            ['data-show', '<div class="child" data-component="CHILD" data-show="ghost"></div>'],
            ['data-bind', '<div class="child" data-component="CHILD" data-bind="ghost"></div>'],
            ['data-render', '<div class="child" data-component="CHILD" data-render="ghost"></div>'],
            ['data-bind-class', '<div class="child" data-component="CHILD" data-bind-class="ghost"></div>']
        ]) {
            it(`${family} on a child root naming a key only the child has warns against the parent`, async () => {
                const { P, C } = await arrive('static', { state: {} }, { state: { ghost: true } }, html)
                expect(wf509('"ghost"', `"${P}"`).length).toBeGreaterThan(0)
                expect(wf509('"ghost"', `"${C}"`)).toEqual([])
            })
        }
    })
})
