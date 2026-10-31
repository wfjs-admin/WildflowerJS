/**
 * The root: block of a component definition: the component's own side of its
 * root element.
 *
 *   wildflower.component('dropdown', {
 *       state: { isOpen: false, label: 'Menu', width: '12rem' },
 *       root: {
 *           class: { open: 'isOpen' },
 *           attr:  { 'aria-expanded': 'isOpen', title: 'label' },
 *           style: { minWidth: 'width' },
 *           show:  'isOpen',
 *           directives: { tooltip: 'label' }
 *       }
 *   })
 *
 * Every value is an expression in the component's OWN scope. The tag (what
 * the parent, or the page, wrote on the element) reads the parent; the two
 * sides merge: classes are a union, show composes (hidden when either side
 * hides), and an attribute, style property or directive set on both sides is
 * the tag's (WF-520 in dev builds). render is not a key (a component cannot
 * remove its own root); it and any other unknown key warn WF-219 and are
 * ignored.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, hasConsoleWarnings, isMinifiedBuild } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip
const portalsSuite = hasFeature('portals') ? describe : describe.skip
const ssrSuite = hasFeature('ssr') ? describe : describe.skip
const warnSuite = hasConsoleWarnings() ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rdb-${++seq}`
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

let container
let wildflower
let warns
let realWarn

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    warns = []
    realWarn = console.warn
    console.warn = (...args) => { warns.push(args.map(String).join(' ')) }
})

afterEach(() => {
    console.warn = realWarn
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

const coded = (code, ...tokens) => warns.filter(m => m.includes(code) && tokens.every(t => m.includes(t)))

async function mount(html) {
    container.innerHTML = html
    wildflower.scan(container)
    await settle(120)
}

const shown = (el) => el.style.display !== 'none'

describe('each key alone, in the component\'s own scope', () => {
    it('class toggles names', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false, busy: true }, root: { class: { open: 'isOpen', 'is-busy': 'busy' } } })
        await mount(`<div class="dd base" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        expect([...el.classList].sort()).toEqual(['base', 'dd', 'is-busy'])
        Object.assign(wildflower.getComponent(c), { isOpen: true, busy: false })
        await settle()
        expect([...el.classList].sort()).toEqual(['base', 'dd', 'open'])
    })

    it('attr sets attributes; booleans follow the data-bind-attr rules', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false, label: 'Menu', off: true }, root: { attr: { 'aria-expanded': 'isOpen', title: 'label', disabled: 'off' } } })
        await mount(`<button class="dd" data-component="${c}"></button>`)
        const el = container.querySelector('.dd')
        expect(el.getAttribute('aria-expanded')).toBe('false')
        expect(el.getAttribute('title')).toBe('Menu')
        expect(el.hasAttribute('disabled')).toBe(true)
        Object.assign(wildflower.getComponent(c), { isOpen: true, label: 'Close', off: false })
        await settle()
        expect(el.getAttribute('aria-expanded')).toBe('true')
        expect(el.getAttribute('title')).toBe('Close')
        expect(el.hasAttribute('disabled')).toBe(false)
    })

    it('style sets properties, camelCase, kebab-case and custom', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { width: '12rem', gap: '3px', hue: 'red' }, root: { style: { minWidth: 'width', 'padding-left': 'gap', '--hue': 'hue' } } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        expect(el.style.minWidth).toBe('12rem')
        expect(el.style.paddingLeft).toBe('3px')
        expect(el.style.getPropertyValue('--hue').trim()).toBe('red')
        Object.assign(wildflower.getComponent(c), { width: '20rem', gap: null })
        await settle()
        expect(el.style.minWidth).toBe('20rem')
        expect(el.style.paddingLeft).toBe('')
    })

    it('show hides and shows the root', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false }, root: { show: 'isOpen' } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        expect(shown(el)).toBe(false)
        wildflower.getComponent(c).isOpen = true
        await settle()
        expect(shown(el)).toBe(true)
    })

    it('directives run on the root: init once, update from the component, destroy once', async () => {
        const c = uname('c'); const dir = uname('tip')
        const calls = { init: [], update: [], destroy: 0 }
        wildflower.directive(dir, {
            init(el, value, ctx) { calls.init.push(ctx.resolvedValue) },
            update(el, v) { calls.update.push(v) },
            destroy() { calls.destroy++ }
        })
        wildflower.component(c, { state: { label: 'Menu' }, root: { directives: { [dir]: 'label', [uname('unregistered')]: 'label' } } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        expect(calls.init).toEqual(['Menu'])
        wildflower.getComponent(c).label = 'Close'
        await settle()
        expect(calls.update).toEqual(['Close'])
        const el = container.querySelector('.dd')
        const id = el.dataset.componentId
        el.remove()
        wildflower.destroyComponent(id)
        await settle()
        expect(calls.destroy).toBe(1)
    })

    it('expressions: negation, comparison, a computed, a store shorthand', async () => {
        const c = uname('c'); const s = uname('s')
        wildflower.store(s, { state: { theme: 'dark' } })
        wildflower.component(c, {
            state: { isOpen: false, count: 1 },
            computed: { many() { return this.count > 2 } },
            root: { class: { closed: '!isOpen', big: 'count > 2', many: 'many', dark: `$${s}.theme === 'dark'` } }
        })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        const on = () => ['closed', 'big', 'many', 'dark'].filter(n => el.classList.contains(n))
        expect(on()).toEqual(['closed', 'dark'])
        wildflower.getComponent(c).count = 3
        wildflower.getComponent(c).isOpen = true
        wildflower.getStore(s).theme = 'light'
        await settle()
        expect(on()).toEqual(['big', 'many'])
    })
})

describe('all keys together', () => {
    it('the documented dropdown', async () => {
        const c = uname('dropdown'); const dir = uname('tooltip')
        const tips = []
        wildflower.directive(dir, { init(el, v, ctx) { tips.push(ctx.resolvedValue) }, update(el, v) { tips.push(v) } })
        wildflower.component(c, {
            state: { isOpen: false, label: 'Menu', width: '12rem' },
            root: {
                class: { open: 'isOpen' },
                attr: { 'aria-expanded': 'isOpen', title: 'label' },
                style: { minWidth: 'width' },
                show: 'isOpen',
                directives: { [dir]: 'label' }
            },
            toggle() { this.isOpen = !this.isOpen }
        })
        await mount(`<div class="dd" data-component="${c}"><button class="t" data-action="toggle">t</button></div>`)
        const el = container.querySelector('.dd')
        expect(el.classList.contains('open')).toBe(false)
        expect(el.getAttribute('aria-expanded')).toBe('false')
        expect(el.style.minWidth).toBe('12rem')
        expect(shown(el)).toBe(false)
        expect(tips).toEqual(['Menu'])
        wildflower.getComponent(c).toggle()
        wildflower.getComponent(c).label = 'Close'
        await settle()
        expect(el.classList.contains('open')).toBe(true)
        expect(el.getAttribute('aria-expanded')).toBe('true')
        expect(el.getAttribute('title')).toBe('Close')
        expect(shown(el)).toBe(true)
        expect(tips).toEqual(['Menu', 'Close'])
    })

    it('is applied with the component\'s first render of its bindings', () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: true, label: 'Menu' }, root: { class: { open: 'isOpen' }, attr: { title: 'label' } } })
        container.innerHTML = `<div class="dd" data-component="${c}"><span class="b" data-bind="label"></span></div>`
        wildflower.scan(container)
        const el = container.querySelector('.dd')
        const painted = container.querySelector('.b').textContent === 'Menu'
        expect(el.classList.contains('open')).toBe(painted)
        expect(el.getAttribute('title') === 'Menu').toBe(painted)
    })
})

describe('a child: the tag reads the parent, root: reads the child, and the two merge', () => {
    // Parent and child share every key name with different values, so the
    // scope each side reads is visible.
    function defs(p, c, childRoot, parentExtra = {}, childExtra = {}) {
        wildflower.component(p, { state: { on: false, isOpen: false, label: 'P', show: true, width: '1px', ...parentExtra } })
        wildflower.component(c, { state: { isOpen: true, label: 'C', show: true, width: '9px', ...childExtra }, root: childRoot })
    }

    async function arrive(arrival, p, kidHtml) {
        if (arrival === 'static') {
            await mount(`<div class="parent" data-component="${p}">${kidHtml}</div>`)
        } else if (arrival === 'late') {
            await mount(`<div class="parent" data-component="${p}"><section data-render="on">${kidHtml}</section></div>`)
            expect(container.querySelector('.kid')).toBeNull()
            wildflower.getComponent(p).on = true
            await settle(200)
        } else {
            await mount(`<div class="parent" data-component="${p}"></div>`)
            container.querySelector('.parent').insertAdjacentHTML('beforeend', kidHtml)
            wildflower.scan(container)
            await settle(150)
        }
        return container.querySelector('.kid')
    }

    for (const arrival of ['static', 'late', 'append']) {
        it(`${arrival}: root: reads the child's state, not the parent's`, async () => {
            const p = uname('p'); const c = uname('c')
            defs(p, c, { class: { open: 'isOpen' }, attr: { title: 'label' }, style: { minWidth: 'width' } })
            const kid = await arrive(arrival, p, `<div class="kid" data-component="${c}"></div>`)
            expect(kid.dataset.componentId).toBeTruthy()
            expect(kid.classList.contains('open')).toBe(true)
            expect(kid.getAttribute('title')).toBe('C')
            expect(kid.style.minWidth).toBe('9px')
            wildflower.getComponent(p).label = 'P2'
            await settle()
            expect(kid.getAttribute('title')).toBe('C')
            Object.assign(wildflower.getComponent(c), { isOpen: false, label: 'C2' })
            await settle()
            expect(kid.classList.contains('open')).toBe(false)
            expect(kid.getAttribute('title')).toBe('C2')
        })

        it(`${arrival}: classes are a union; a name both sides set is on while either holds it`, async () => {
            const p = uname('p'); const c = uname('c')
            defs(p, c, { class: { open: 'isOpen', mine: 'isOpen' } }, { pOpen: false }, { isOpen: false })
            const kid = await arrive(arrival, p, `<div class="kid" data-component="${c}" data-bind-class="{ open: pOpen, theirs: pOpen }"></div>`)
            const parent = wildflower.getComponent(p); const child = wildflower.getComponent(c)
            const on = () => ['open', 'mine', 'theirs'].filter(n => kid.classList.contains(n)).join(' ')
            expect(on()).toBe('')
            parent.pOpen = true
            await settle()
            expect(on()).toBe('open theirs')
            child.isOpen = true
            await settle()
            expect(on()).toBe('open mine theirs')
            parent.pOpen = false
            await settle()
            expect(on()).toBe('open mine')
            child.isOpen = false
            await settle()
            expect(on()).toBe('')
        })

        it(`${arrival}: show composes: hidden while either side hides`, async () => {
            const p = uname('p'); const c = uname('c')
            defs(p, c, { show: 'show' })
            const kid = await arrive(arrival, p, `<div class="kid" data-component="${c}" data-show="show"></div>`)
            const parent = wildflower.getComponent(p); const child = wildflower.getComponent(c)
            expect(shown(kid)).toBe(true)
            parent.show = false
            await settle()
            expect(shown(kid)).toBe(false)
            child.show = false
            parent.show = true
            await settle()
            expect(shown(kid)).toBe(false)
            child.show = true
            await settle()
            expect(shown(kid)).toBe(true)
        })

        it(`${arrival}: an attribute, a style property and a directive set on both sides are the tag's`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const inits = []
            wildflower.directive(dir, { init(el, v, ctx) { inits.push(ctx.resolvedValue) } })
            defs(p, c, { attr: { title: 'label', 'data-own': 'label' }, style: { minWidth: 'width' }, directives: { [dir]: 'label' } })
            const kid = await arrive(arrival, p,
                `<div class="kid" data-component="${c}" data-bind-attr="{ title: label }" data-bind-style="{ 'min-width': width }" data-${dir}="label"></div>`)
            expect(kid.getAttribute('title')).toBe('P')
            expect(kid.getAttribute('data-own')).toBe('C')
            expect(kid.style.minWidth).toBe('1px')
            expect(inits).toEqual(['P'])
            wildflower.getComponent(c).label = 'C2'
            wildflower.getComponent(c).width = '7px'
            await settle()
            expect(kid.getAttribute('title')).toBe('P')
            expect(kid.getAttribute('data-own')).toBe('C2')
            expect(kid.style.minWidth).toBe('1px')
            wildflower.getComponent(p).label = 'P2'
            await settle()
            expect(kid.getAttribute('title')).toBe('P2')
        })
    }
})

warnSuite('dev warnings', () => {
    it('WF-520 once per component and name when both sides set the same attribute, style property or directive', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        wildflower.directive(dir, { init() {} })
        wildflower.component(p, { state: { label: 'P', w: '1px' } })
        wildflower.component(c, { state: { label: 'C', w: '2px' }, root: { attr: { title: 'label' }, style: { minWidth: 'w' }, directives: { [dir]: 'label' } } })
        const kid = `<div data-component="${c}" data-bind-attr="{ title: label }" data-bind-style="{ minWidth: w }" data-${dir}="label"></div>`
        await mount(`<div data-component="${p}">${kid}${kid}</div>`)
        wildflower.getComponents(c).forEach(k => { k.label = 'C2' })
        await settle()
        expect(coded('WF-520', `'${c}'`, '"title"').length).toBe(1)
        expect(coded('WF-520', `'${c}'`, '"minWidth"').length).toBe(1)
        expect(coded('WF-520', `'${c}'`, `"${dir}"`).length).toBe(1)
    })

    it('render, an unknown key and a non-string value warn WF-219 and are ignored; root itself is a contract key', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { on: false }, root: { render: 'on', action: 'go', class: { a: 'on', b: 5 } } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        expect(el.isConnected).toBe(true)
        expect(coded('WF-219', `'${c}'`, 'root: render').length).toBe(1)
        expect(coded('WF-219', `'${c}'`, 'root: action').length).toBe(1)
        expect(coded('WF-219', `'${c}'`, 'root: class.b').length).toBe(1)
        expect(coded('WF-219', `'${c}'`, "top-level key 'root'")).toEqual([])
        wildflower.getComponent(c).on = true
        await settle()
        expect(el.classList.contains('a')).toBe(true)
    })

    it('a root: that is not an object, a non-string or unregistered directive, and a bad class value warn WF-219 with their key', async () => {
        const c1 = uname('c'); const c2 = uname('c'); const d = uname('dir'); const nope = uname('nope')
        wildflower.directive(d, { init() {} })
        wildflower.component(c1, { state: {}, root: 'oops' })
        wildflower.component(c2, { state: { a: 1 }, root: { directives: { [d]: 5, [nope]: 'a' }, class: { ok: 'a', b: 5 } } })
        await mount(`<div class="one" data-component="${c1}"></div><div class="two" data-component="${c2}"></div><div data-component="${c2}"></div>`)
        expect(coded('WF-219', `'${c1}'`, 'root:').length).toBe(1)
        expect(coded('WF-219', `'${c2}'`, `root: directives.${d}`).length).toBe(1)
        expect(coded('WF-219', `'${c2}'`, `root: directives.${nope}`).length).toBe(1)
        expect(coded('WF-219', `'${c2}'`, 'root: class.b').length).toBe(1)
        expect(container.querySelector('.two').classList.contains('ok')).toBe(true)
    })

    it('a literal directive value in root.directives is not validated, as on a tag', async () => {
        wildflower.options.debug = true
        wildflower.debug = true
        const c = uname('c'); const d = uname('tip')
        wildflower.directive(d, { init() {} })
        wildflower.component(c, { state: { label: 'x' }, root: { directives: { [d]: 'Hello' }, class: { on: 'nope' } } })
        await mount(`<div data-component="${c}"><span data-${d}="Hello"></span></div>`)
        expect(coded('WF-509', 'nope', c).length).toBeGreaterThan(0)
        expect(warns.filter(m => m.includes('Hello'))).toEqual([])
    })

    it('the dev validator checks root: names against the component', async () => {
        wildflower.options.debug = true
        wildflower.debug = true
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false }, root: { class: { open: 'isOpne' }, show: 'isOpen' } })
        await mount(`<div data-component="${c}"></div>`)
        expect(coded('WF-509', 'isOpne', c).length).toBeGreaterThan(0)
        expect(coded('WF-509', '"isOpen"', c)).toEqual([])
    })
})

describe('a top-level component: its tag and root: read the same scope and merge', () => {
    it('class union, show composes, the tag\'s attribute wins', async () => {
        const c = uname('c')
        wildflower.component(c, {
            state: { a: false, b: false, vis: true, hide: false, t1: 'tag', t2: 'root' },
            root: { class: { open: 'b' }, show: '!hide', attr: { title: 't2' } }
        })
        await mount(`<div class="dd" data-component="${c}" data-bind-class="{ open: a }" data-show="vis" data-bind-attr="{ title: t1 }"></div>`)
        const el = container.querySelector('.dd')
        const ctx = wildflower.getComponent(c)
        expect(el.classList.contains('open')).toBe(false)
        expect(el.getAttribute('title')).toBe('tag')
        ctx.b = true
        await settle()
        expect(el.classList.contains('open')).toBe(true)
        ctx.hide = true
        await settle()
        expect(shown(el)).toBe(false)
        ctx.hide = false
        ctx.vis = false
        await settle()
        expect(shown(el)).toBe(false)
        ctx.vis = true
        await settle()
        expect(shown(el)).toBe(true)
    })
})

describe('show composes whichever side runs first', () => {
    async function place(arrival, p, kidHtml) {
        if (arrival === 'static') {
            await mount(`<div class="parent" data-component="${p}">${kidHtml}</div>`)
        } else {
            await mount(`<div class="parent" data-component="${p}"></div>`)
            container.querySelector('.parent').insertAdjacentHTML('beforeend', kidHtml)
            wildflower.scan(container)
            await settle(150)
        }
        return container.querySelector('.kid')
    }

    for (const arrival of ['static', 'append']) {
        for (const [tag, own] of [[false, true], [true, false]]) {
            it(`${arrival}: tag ${tag} and root: ${own} start hidden; both true show`, async () => {
                const p = uname('p'); const c = uname('c')
                wildflower.component(p, { state: { pshow: tag } })
                wildflower.component(c, { state: { cshow: own }, root: { show: 'cshow' } })
                const kid = await place(arrival, p, `<div class="kid" data-component="${c}" data-show="pshow"></div>`)
                expect(kid.dataset.componentId).toBeTruthy()
                expect(shown(kid)).toBe(false)
                wildflower.getComponent(p).pshow = true
                wildflower.getComponent(c).cshow = true
                await settle()
                expect(shown(kid)).toBe(true)
                wildflower.getComponent(c).cshow = false
                await settle()
                expect(shown(kid)).toBe(false)
                wildflower.getComponent(c).cshow = true
                wildflower.getComponent(p).pshow = false
                await settle()
                expect(shown(kid)).toBe(false)
            })
        }
    }
})

listsSuite('show composes on a list row that is a child root (data-list)', () => {
    for (const n of [3, 13]) {
        for (const [tag, own] of [[false, true], [true, false]]) {
            it(`${n} rows: row data-show ${tag} and root: ${own} start hidden; both true show`, async () => {
                const p = uname('p'); const c = uname('c')
                wildflower.component(c, { state: { cshow: own }, root: { show: 'cshow' } })
                wildflower.component(p, { state: { rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, vis: tag })) } })
                await mount(`<div data-component="${p}"><ul data-list="rows" data-key="id"><template><li class="kid" data-component="${c}" data-show="vis"></li></template></ul></div>`)
                await settle(150)
                const kids = [...container.querySelectorAll('.kid')]
                expect(kids.length).toBe(n)
                expect(kids.filter(shown).length).toBe(0)
                wildflower.getComponent(p).rows[0].vis = true
                wildflower.getComponents(c).forEach(k => { k.cshow = true })
                await settle()
                expect(shown(kids[0])).toBe(true)
                expect(shown(kids[1])).toBe(tag)
            })
        }
    }
})

hasFeature('transitions') ? describe('data-transition on the tag (root.show itself is instant)', () => {
    async function setup() {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { pshow: true } })
        wildflower.component(c, { state: { cshow: true }, root: { show: 'cshow' } })
        await mount(`<div class="parent" data-component="${p}"><div class="kid" data-component="${c}" data-show="pshow" data-transition="fade"></div></div>`)
        return { kid: container.querySelector('.kid'), P: wildflower.getComponent(p), C: wildflower.getComponent(c) }
    }

    it('a root hidden by root.show stays hidden through the tag\'s enter', async () => {
        const { kid, P, C } = await setup()
        C.cshow = false
        await settle(150)
        expect(shown(kid)).toBe(false)
        P.pshow = false
        await settle(300)
        P.pshow = true
        await settle(300)
        expect(shown(kid)).toBe(false)
        C.cshow = true
        await settle(150)
        expect(shown(kid)).toBe(true)
    })

    it('after the tag leaves and enters, a root.show run keeps a root both sides show visible', async () => {
        const { kid, P, C } = await setup()
        P.pshow = false
        await settle(300)
        expect(shown(kid)).toBe(false)
        P.pshow = true
        await settle(300)
        expect(shown(kid)).toBe(true)
        C.cshow = false
        await settle(100)
        C.cshow = true
        await settle(150)
        expect(shown(kid)).toBe(true)
    })
}) : describe.skip('data-transition on the tag', () => {})

describe('a static class on the tag', () => {
    // root: takes off only a class it put on; one written on the tag while
    // the root.class entry is false at mount stays.
    it('present while root.class is false at mount: kept through false, true, false', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false }, root: { class: { open: 'isOpen', added: 'isOpen' } } })
        await mount(`<div class="kid open" data-component="${c}"></div>`)
        const el = container.querySelector('.kid')
        expect(el.classList.contains('open')).toBe(true)
        for (const v of [true, false]) {
            wildflower.getComponent(c).isOpen = v
            await settle()
            expect(el.classList.contains('open')).toBe(true)
            expect(el.classList.contains('added')).toBe(v)
        }
        expect([...el.classList].filter(n => n !== 'wf-show').sort()).toEqual(['kid', 'open'])
    })

    // The client twin of a server-rendered root: a static class matching a
    // root.class entry that is true at mount is root:'s.
    it('matching a root.class entry that is true at mount: root:\'s, removed when it turns false', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: true }, root: { class: { open: 'isOpen' } } })
        await mount(`<div class="kid open" data-component="${c}"></div>`)
        const el = container.querySelector('.kid')
        expect(el.classList.contains('open')).toBe(true)
        wildflower.getComponent(c).isOpen = false
        await settle()
        expect(el.classList.contains('open')).toBe(false)
        wildflower.getComponent(c).isOpen = true
        await settle()
        expect(el.classList.contains('open')).toBe(true)
    })

    it('a class the tag binds is still a union with root:', async () => {
        const p = uname('p'); const c = uname('c')
        wildflower.component(p, { state: { t: true } })
        wildflower.component(c, { state: { r: false }, root: { class: { open: 'r' } } })
        await mount(`<div data-component="${p}"><div class="kid" data-component="${c}" data-bind-class="{ open: t }"></div></div>`)
        const el = container.querySelector('.kid')
        expect(el.classList.contains('open')).toBe(true)
        wildflower.getComponent(c).r = true
        await settle()
        wildflower.getComponent(p).t = false
        await settle()
        expect(el.classList.contains('open')).toBe(true)
        wildflower.getComponent(c).r = false
        await settle()
        expect(el.classList.contains('open')).toBe(false)
    })
})

hasFeature('query') ? describe('inside a record-shape data-query', () => {
    let realFetch
    beforeEach(() => {
        realFetch = window.fetch
        window.fetch = async () => new Response(JSON.stringify({ title: 'Row' }), { status: 200 })
    })
    afterEach(() => { window.fetch = realFetch })

    it('root: reads the component\'s state, the tag reads the row', async () => {
        const q = uname('q'); const p = uname('p'); const c = uname('c')
        wildflower.query(q, { from: '/api/rdb' })
        wildflower.component(p, { state: { title: 'Parent' } })
        wildflower.component(c, { state: { title: 'Kid' }, root: { attr: { 'data-own': 'title' }, class: { 'has-title': "title === 'Kid'" } } })
        await mount(`<div data-component="${p}"><article data-query="${q}"><div class="kid" data-component="${c}" data-bind-attr="{ 'data-tag': title }"></div></article></div>`)
        await settle(150)
        const kid = container.querySelector('.kid')
        expect(kid.getAttribute('data-tag')).toBe('Row')
        expect(kid.getAttribute('data-own')).toBe('Kid')
        expect(kid.classList.contains('has-title')).toBe(true)
    })
}) : describe.skip('inside a record-shape data-query', () => {})

describe('teardown', () => {
    it('a destroyed component stops writing its root, and its root: visibility no longer hides the element', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: false, label: 'a' }, root: { attr: { title: 'label' }, show: 'isOpen' } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        const ctx = wildflower.getComponent(c)
        expect(el.getAttribute('title')).toBe('a')
        el.remove()
        wildflower.destroyComponent(el.dataset.componentId)
        ctx.label = 'b'
        await settle()
        expect(el.getAttribute('title')).toBe('a')
    })
})

listsSuite('a list row that is a child\'s root', () => {
    it('gets the child\'s root:, merged with the row\'s bindings on the tag (data-list row)', async () => {
        const p = uname('p'); const c = uname('c')
        wildflower.component(c, { state: { hot: false }, root: { class: { hot: 'hot', mine: 'hot' }, attr: { 'data-kid': 'hot' } } })
        wildflower.component(p, { state: { rows: [{ id: 1, sel: false }, { id: 2, sel: true }] } })
        await mount(`<div data-component="${p}"><ul data-list="rows" data-key="id"><template>
            <li class="kid" data-component="${c}" data-bind-class="{ hot: sel, picked: sel }"></li></template></ul></div>`)
        await settle(100)
        const kids = [...container.querySelectorAll('.kid')]
        expect(kids.length).toBe(2)
        const on = (el) => ['hot', 'mine', 'picked'].filter(n => el.classList.contains(n)).join(' ')
        expect(kids.map(on)).toEqual(['', 'hot picked'])
        expect(kids.map(k => k.getAttribute('data-kid'))).toEqual(['false', 'false'])
        wildflower.getComponents(c)[0].hot = true
        await settle()
        expect(on(kids[0])).toBe('hot mine')
        expect(kids[0].getAttribute('data-kid')).toBe('true')
        wildflower.getComponent(p).rows[1].sel = false
        await settle()
        expect(on(kids[1])).toBe('')
    })
})

portalsSuite('a portaled root', () => {
    it('keeps its root: (the child\'s) while its tag stays with the parent that moved it', async () => {
        const a = uname('app'); const p = uname('p'); const c = uname('c'); const tgt = uname('tgt')
        wildflower.component(a, { state: { tone: 'a-one' } })
        wildflower.component(p, { state: { tone: 'p-one' } })
        wildflower.component(c, { state: { tone: 'c-one', isOpen: false }, root: { class: { open: 'isOpen' }, attr: { 'data-tone': 'tone' } } })
        await mount(`<div data-component="${a}"><div id="${tgt}"></div>
            <div class="parent" data-component="${p}"><div data-portal="#${tgt}"><div class="kid" data-component="${c}" data-bind-class="tone"></div></div></div></div>`)
        await settle(100)
        const kid = container.querySelector('.kid')
        expect(kid.parentElement.id).toBe(tgt)
        expect(kid.classList.contains('p-one')).toBe(true)
        expect(kid.getAttribute('data-tone')).toBe('c-one')
        wildflower.getComponent(c).isOpen = true
        wildflower.getComponent(c).tone = 'c-two'
        wildflower.getComponent(a).tone = 'a-two'
        await settle()
        expect(kid.classList.contains('open')).toBe(true)
        expect(kid.getAttribute('data-tone')).toBe('c-two')
        expect(kid.classList.contains('p-one')).toBe(true)
        wildflower.getComponent(p).tone = 'p-two'
        await settle()
        expect(kid.classList.contains('p-two')).toBe(true)
        expect(kid.classList.contains('open')).toBe(true)
    })
})

ssrSuite('server-rendered root attributes', () => {
    it('adopt without a flash: nothing the server rendered is removed and put back', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { isOpen: true, label: 'Menu' }, root: { class: { open: 'isOpen' }, attr: { 'aria-expanded': 'isOpen', title: 'label' } } })
        container.innerHTML = `<div class="dd open" data-component="${c}" data-ssr="true" aria-expanded="true" title="Menu"><span data-bind="label">Menu</span></div>`
        const el = container.querySelector('.dd')
        const records = []
        const mo = new MutationObserver(list => records.push(...list))
        mo.observe(el, { attributes: true, attributeOldValue: true })
        wildflower.scan(container)
        await settle(200)
        records.push(...mo.takeRecords())
        mo.disconnect()
        expect(el.dataset.componentId).toBeTruthy()
        // No write took 'open' away (every class change starts from a value
        // that has it), and the server's attribute values were not rewritten.
        const classValues = records.filter(r => r.attributeName === 'class').map(r => r.oldValue || '')
        expect(classValues.every(v => v.split(/\s+/).includes('open'))).toBe(true)
        expect(records.filter(r => r.attributeName === 'aria-expanded' || r.attributeName === 'title').map(r => r.attributeName)).toEqual([])
        expect(el.classList.contains('open')).toBe(true)
        wildflower.getComponent(c).isOpen = false
        await settle()
        expect(el.classList.contains('open')).toBe(false)
        expect(el.getAttribute('aria-expanded')).toBe('false')
    })
})

describe('CSP-safe evaluation', () => {
    afterEach(() => {
        wildflower.config({ forceCSPMode: false })
        if (wildflower._useCSPSafeEvaluation) wildflower._useCSPSafeEvaluation = false
    })

    it('root: expressions evaluate through the CSP-safe path', async () => {
        wildflower.config({ forceCSPMode: true })
        const c = uname('c')
        wildflower.component(c, { state: { count: 1, label: 'x' }, root: { class: { big: 'count > 2 && label === \'x\'' }, attr: { 'data-n': 'count * 2' } } })
        await mount(`<div class="dd" data-component="${c}"></div>`)
        const el = container.querySelector('.dd')
        expect(el.classList.contains('big')).toBe(false)
        expect(el.getAttribute('data-n')).toBe('2')
        wildflower.getComponent(c).count = 3
        await settle()
        expect(el.classList.contains('big')).toBe(true)
        expect(el.getAttribute('data-n')).toBe('6')
        if (!isMinifiedBuild()) expect(wildflower._useCSPSafeEvaluation).toBe(true)
    })
})
