/**
 * Server-rendered markup whose bindings read a store that registers after the
 * scan keeps its server state until the store arrives, for every binding
 * type: data-bind, data-bind-html,
 * -attr, -class, -style, data-show and data-render. Before, each one wrote
 * the missing store's nothing at activation: the HTML emptied, the attribute
 * and style dropped, data-show hid and data-render removed the element, until
 * the store registered. Outside server-rendered markup nothing changes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('SSR bindings over a store that registers late', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const visible = (el) => !!el && el.style.display !== 'none'
    // [name, markup(store), read(el), server state, the store's two values, what each shows]
    const cases = [
        ['data-bind', (s) => `<span class="x" data-bind="$${s}.v">Server</span>`, (el) => el.textContent,
            'Server', ['A', 'B'], ['A', 'B']],
        ['data-bind expression', (s) => `<span class="x" data-bind="'Hi ' + $${s}.v">Hi Server</span>`, (el) => el.textContent,
            'Hi Server', ['A', 'B'], ['Hi A', 'Hi B']],
        ['data-bind-html', (s) => `<div class="x" data-bind-html="$${s}.v"><b>Server</b></div>`, (el) => el.innerHTML,
            '<b>Server</b>', ['<i>A</i>', '<i>B</i>'], ['<i>A</i>', '<i>B</i>']],
        ['data-bind-attr', (s) => `<a class="x" title="Server" data-bind-attr="{ title: $${s}.v }">a</a>`, (el) => el.getAttribute('title'),
            'Server', ['A', 'B'], ['A', 'B']],
        // The server rendered the class the binding names. An object binding
        // removes a false key's class on its first write, so without the
        // late-store rule the missing store would clear it at activation.
        ['data-bind-class', (s) => `<div class="x on" data-bind-class="{ on: $${s}.v }">c</div>`, (el) => el.className,
            'x on', [false, true], ['x', 'x on']],
        ['data-bind-style', (s) => `<div class="x" style="color: red;" data-bind-style="{ color: $${s}.v }">s</div>`, (el) => el.style.color,
            'red', ['blue', 'green'], ['blue', 'green']],
        ['data-show', (s) => `<div class="x" data-show="$${s}.v">shown</div>`, visible,
            true, [false, true], [false, true]],
        // The same store, named the other two ways an expression can: the
        // long form external('name', 'path'), and $name inside a template
        // literal's ${ }.
        ['data-bind, the long form external()', (s) => `<span class="x" data-bind="external('${s}', 'v')">Server</span>`, (el) => el.textContent,
            'Server', ['A', 'B'], ['A', 'B']],
        ['data-show, the long form external()', (s) => `<div class="x" data-show="external('${s}', 'v')">shown</div>`, visible,
            true, [false, true], [false, true]],
        ['data-bind, a template literal', (s) => `<span class="x" data-bind="\`Hi \${$${s}.v}\`">Hi Server</span>`, (el) => el.textContent,
            'Hi Server', ['A', 'B'], ['Hi A', 'Hi B']],
    ]

    for (const [name, markup, read, server, values, shown] of cases) {
        it(`${name} keeps its server state until the store registers, then follows it`, async () => {
            const c = `slsb-${++seq}`; const s = `slsbstore${seq}`
            wildflower.component(c, { state: {} })
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">${markup(s)}</div>`
            const at = () => read(container.querySelector('.x'))
            wildflower.scan(container)
            await settle()
            expect(at()).toBe(server)
            wildflower.store(s, { state: { v: values[0] } })
            await settle()
            expect(at()).toBe(shown[0])
            wildflower.getStore(s).v = values[1]
            await settle()
            expect(at()).toBe(shown[1])
        })
    }

    it('data-render keeps its server element until the store registers, then follows it', async () => {
        const c = `slsb-${++seq}`; const s = `slsbstore${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="w"><div class="x" data-render="$${s}.v">rendered</div></div></div>`
        const present = () => !!container.querySelector('.x')
        const server = container.querySelector('.x')
        wildflower.scan(container)
        await settle()
        expect(present()).toBe(true)
        expect(container.querySelector('.x')).toBe(server)
        wildflower.store(s, { state: { v: false } })
        await settle()
        expect(present()).toBe(false)
        wildflower.getStore(s).v = true
        await settle()
        expect(present()).toBe(true)
    })

    // The scanner skips a component inside a false data-render section; a
    // section kept for a late store is not false, so its component starts.
    // (It was skipped, and the store arriving true found the section already
    // rendered, so nothing started it.)
    it('a component inside a kept data-render section initializes, and is destroyed if the store arrives false', async () => {
        for (const arrives of [true, false]) {
            const c = `slsb-${++seq}`; const inner = `slsbinner${seq}`; const s = `slsbstore${seq}`
            let inits = 0; let destroys = 0; let clicks = 0
            wildflower.component(c, { state: {} })
            wildflower.component(inner, { state: {}, init() { inits++ }, destroy() { destroys++ }, hit() { clicks++ } })
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="w"><div class="x" data-render="$${s}.v">` +
                `<div data-component="${inner}"><button class="b" data-action="hit">b</button></div></div></div></div>`
            wildflower.scan(container)
            await settle()
            expect(inits).toBe(1)
            container.querySelector('.b').click()
            expect(clicks).toBe(1)
            wildflower.store(s, { state: { v: arrives } })
            await settle()
            expect(!!container.querySelector('.x')).toBe(arrives)
            if (arrives) {
                container.querySelector('.b').click()
                expect(clicks).toBe(2)
                expect(inits).toBe(1)
            } else {
                expect(destroys).toBe(1)
            }
        }
    })

    it('a store name with a hyphen keeps its server state until it registers, then follows it', async () => {
        const c = `slsb-${++seq}`; const s = `slsb-store-${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="x" data-show="$${s}.v">shown</div><span class="t" data-bind="$${s}.t">Server</span></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.x').style.display).not.toBe('none')
        expect(container.querySelector('.t').textContent).toBe('Server')
        wildflower.store(s, { state: { v: false, t: 'Store' } })
        await settle()
        expect(container.querySelector('.x').style.display).toBe('none')
        expect(container.querySelector('.t').textContent).toBe('Store')
    })

    it('a binding over a store that is registered at scan writes as before (control)', async () => {
        const c = `slsb-${++seq}`; const s = `slsbstore${seq}`
        wildflower.store(s, { state: { v: false, t: 'Store' } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="x" data-show="$${s}.v">shown</div><span class="t" data-bind="$${s}.t">Server</span></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.x').style.display).toBe('none')
        expect(container.querySelector('.t').textContent).toBe('Store')
    })

    it('outside server-rendered markup a late store still writes at activation (control)', async () => {
        const c = `slsb-${++seq}`; const s = `slsbstore${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}"><div class="x" data-show="$${s}.v">shown</div></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.x').style.display).toBe('none')
        wildflower.store(s, { state: { v: true } })
        await settle()
        expect(container.querySelector('.x').style.display).not.toBe('none')
    })
})
