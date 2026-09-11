/**
 * Plain-page canaries.
 *
 * Every other test drives the framework from inside the test page, usually
 * through wildflower.scan(). None of them load a page the way a user does:
 * a <script src> tag, an inline registration, and nothing else. That path
 * (DOMContentLoaded, requestAnimationFrame, _scanForComponentsAsync) shipped
 * with data-wf-component broken in 1.4.1 while 5,000 tests were green.
 *
 * Each canary here is a literal HTML document rendered in an iframe from the
 * lane's real bundle. Nothing is scanned by hand. Every page runs once with
 * the data-* prefix and once with data-wf-*, and the iframe's console.warn,
 * console.error, window errors, and unhandled rejections are captured: a
 * dev-build WF- warning or any error fails the page, whatever it renders.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { getFrameworkScripts, hasFeature, getDistMode } from './helpers/load-framework.js'

const SCRIPT_SRC = getFrameworkScripts()[0]
const IS_DEV = /-(dev|raw)$/.test(getDistMode()) || getDistMode() === 'source'
const PREFIXES = ['data-', 'data-wf-']
const TIMEOUT = 10000

const CAPTURE = `<script>
window.__canary = { warns: [], errors: [] };
(function () {
    var w = console.warn.bind(console), e = console.error.bind(console);
    console.warn = function () { var a = Array.prototype.slice.call(arguments); window.__canary.warns.push(a.map(String).join(' ')); w.apply(console, a); };
    console.error = function () { var a = Array.prototype.slice.call(arguments); window.__canary.errors.push(a.map(String).join(' ')); e.apply(console, a); };
    window.addEventListener('error', function (ev) { window.__canary.errors.push('error: ' + ev.message); });
    window.addEventListener('unhandledrejection', function (ev) { window.__canary.errors.push('rejection: ' + (ev.reason && ev.reason.message || ev.reason)); });
})();
</script>`

/**
 * Build a document. `framework` places the bundle: 'head' (the default a
 * user writes), 'bottom' (end of body, before the inline script), 'defer'
 * (deferred head script), or 'none' (the page loads it itself).
 */
function pageHtml({ head = '', body = '', script = '', framework = 'head', scriptAttrs = '' }) {
    const attrs = scriptAttrs ? ' ' + scriptAttrs : ''
    const fw = `<script src="${SCRIPT_SRC}"${attrs}></script>`
    const fwDefer = `<script defer src="${SCRIPT_SRC}"${attrs}></script>`
    const headFw = framework === 'head' ? fw : framework === 'defer' ? fwDefer : ''
    const bodyFw = framework === 'bottom' ? fw : ''
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${CAPTURE}${headFw}${head}</head>` +
        `<body>${body}${bodyFw}<script>${script}</script></body></html>`
}

const frames = []

async function mount(html) {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;height:400px'
    document.body.appendChild(iframe)
    frames.push(iframe)
    await new Promise(resolve => {
        iframe.addEventListener('load', resolve, { once: true })
        iframe.srcdoc = html
    })
    return { win: iframe.contentWindow, doc: iframe.contentDocument }
}

async function waitFor(cond, timeout = 4000) {
    const start = performance.now()
    for (;;) {
        let ok = false
        try { ok = !!cond() } catch { ok = false }
        if (ok) return true
        if (performance.now() - start > timeout) return false
        await new Promise(r => setTimeout(r, 20))
    }
}

function expectClean(win, label) {
    const { warns, errors } = win.__canary
    expect(errors, `${label}: page errors`).toEqual([])
    if (IS_DEV) {
        expect(warns.filter(w => /WF-\d+/.test(w)), `${label}: framework warnings`).toEqual([])
    }
}

function setInput(doc, selector, value) {
    const el = doc.querySelector(selector)
    el.value = value
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
}

afterEach(() => {
    for (const f of frames) f.remove()
    frames.length = 0
})

// Each canary is a function of the attribute prefix. `a('bind')` becomes
// data-bind or data-wf-bind.
const canaries = [
    {
        name: 'counter: component, bind, action',
        page: a => ({
            body: `<div ${a('component')}="counter"><span id="count" ${a('bind')}="count"></span><button id="inc" ${a('action')}="increment">+</button></div>`,
            script: `wildflower.component('counter', { state: { count: 0 }, increment() { this.count++ } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#count').textContent === '0'), 'initial bind').toBe(true)
            doc.querySelector('#inc').click()
            expect(await waitFor(() => doc.querySelector('#count').textContent === '1'), 'action').toBe(true)
        }
    },
    {
        name: 'two-way model feeding a computed',
        page: a => ({
            body: `<div ${a('component')}="greeter"><input id="name" ${a('model')}="name"><span id="shout" ${a('bind')}="shout"></span></div>`,
            script: `wildflower.component('greeter', { state: { name: 'ada' }, computed: { shout() { return this.name.toUpperCase() } } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#shout').textContent === 'ADA'), 'computed').toBe(true)
            expect(doc.querySelector('#name').value).toBe('ada')
            setInput(doc, '#name', 'bob')
            expect(await waitFor(() => doc.querySelector('#shout').textContent === 'BOB'), 'model to computed').toBe(true)
        }
    },
    {
        name: 'show, render, class, style, and attr bindings',
        page: a => ({
            body: `<div ${a('component')}="flags">
                <p id="s" ${a('show')}="on">shown</p>
                <p id="r" ${a('render')}="on">rendered</p>
                <div id="c" ${a('bind-class')}="on ? 'is-on' : 'is-off'"></div>
                <div id="st" ${a('bind-style')}="{ width: size + 'px' }"></div>
                <a id="l" ${a('bind-attr')}="{ href: link, title: on ? 'yes' : null }">link</a>
                <button id="t" ${a('action')}="toggle">t</button>
            </div>`,
            script: `wildflower.component('flags', { state: { on: true, size: 42, link: '/docs' }, toggle() { this.on = !this.on } })`
        }),
        check: async ({ doc, win }) => {
            expect(await waitFor(() => doc.querySelector('#c').classList.contains('is-on')), 'class').toBe(true)
            expect(win.getComputedStyle(doc.querySelector('#s')).display).not.toBe('none')
            expect(doc.querySelector('#r')).not.toBeNull()
            expect(doc.querySelector('#st').style.width).toBe('42px')
            expect(doc.querySelector('#l').getAttribute('href')).toBe('/docs')
            expect(doc.querySelector('#l').getAttribute('title')).toBe('yes')
            doc.querySelector('#t').click()
            expect(await waitFor(() => doc.querySelector('#c').classList.contains('is-off')), 'class after toggle').toBe(true)
            expect(await waitFor(() => win.getComputedStyle(doc.querySelector('#s')).display === 'none'), 'show off').toBe(true)
            expect(await waitFor(() => doc.querySelector('#r') === null), 'render off').toBe(true)
            expect(doc.querySelector('#l').hasAttribute('title')).toBe(false)
        }
    },
    {
        name: 'store read through $store and written through an action',
        page: a => ({
            body: `<div ${a('component')}="cart-view"><span id="total" ${a('bind')}="$cart.total"></span><button id="add" ${a('action')}="add">add</button></div>`,
            script: `wildflower.store('cart', { state: { total: 0 }, add(n) { this.total += n } });
                wildflower.component('cart-view', { add() { wildflower.getStore('cart').add(5) } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#total').textContent === '0'), 'store bind').toBe(true)
            doc.querySelector('#add').click()
            expect(await waitFor(() => doc.querySelector('#total').textContent === '5'), 'store write').toBe(true)
        }
    },
    {
        name: 'props from parent to child, single and object forms',
        page: a => ({
            body: `<div ${a('component')}="parent">
                <div ${a('component')}="child" ${a('prop-title')}="heading" ${a('props')}="{ color: accent }">
                    <span id="pt" ${a('bind')}="props.title"></span><span id="pc" ${a('bind')}="props.color"></span>
                </div>
            </div>`,
            script: `wildflower.component('parent', { state: { heading: 'Hello', accent: 'teal' } });
                wildflower.component('child', { props: { title: { type: 'string' }, color: { type: 'string' } } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#pt').textContent === 'Hello'), 'data-prop-*').toBe(true)
            expect(await waitFor(() => doc.querySelector('#pc').textContent === 'teal'), 'data-props').toBe(true)
        }
    },
    {
        name: 'emit from a child to its parent',
        page: a => ({
            body: `<div ${a('component')}="outer"><span id="got" ${a('bind')}="got"></span>
                <div ${a('component')}="inner"><button id="send" ${a('action')}="send">send</button></div></div>`,
            script: `wildflower.component('outer', { state: { got: '' }, onPing(d) { this.got = d.msg } });
                wildflower.component('inner', { send() { this.emit('ping', { msg: 'hi' }) } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('[data-component-id]').length === 2), 'both initialized').toBe(true)
            doc.querySelector('#send').click()
            expect(await waitFor(() => doc.querySelector('#got').textContent === 'hi'), 'emit').toBe(true)
        }
    },
    {
        name: 'data-cloak lifts after the first render',
        page: a => ({
            head: `<style>[data-cloak],[data-wf-cloak]{display:none !important}</style>`,
            body: `<div id="root" ${a('component')}="cl" ${a('cloak')}><span id="v" ${a('bind')}="v"></span></div>`,
            script: `wildflower.component('cl', { state: { v: 'visible' } })`
        }),
        check: async ({ doc, win }, a) => {
            expect(await waitFor(() => doc.querySelector('#v').textContent === 'visible'), 'bind').toBe(true)
            expect(await waitFor(() => !doc.querySelector('#root').hasAttribute(a('cloak'))), 'cloak removed').toBe(true)
            expect(win.getComputedStyle(doc.querySelector('#root')).display).not.toBe('none')
        }
    },
    {
        name: 'component registered after the framework initialized',
        page: a => ({
            body: `<div ${a('component')}="late"><span id="count" ${a('bind')}="count"></span></div>`,
            script: `window.addEventListener('load', function () {
                requestAnimationFrame(function () { requestAnimationFrame(function () {
                    wildflower.component('late', { state: { count: 7 } })
                }) })
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#count').textContent === '7'), 'late registration').toBe(true)
        }
    },
    {
        name: 'component markup added to the page after load',
        page: a => ({
            body: `<div id="slot"></div>`,
            script: `wildflower.component('dyn', { state: { count: 9 } });
                window.addEventListener('load', function () {
                    setTimeout(function () {
                        document.getElementById('slot').innerHTML = '<div ${a('component')}="dyn"><span id="count" ${a('bind')}="count"></span></div>'
                    }, 80)
                })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#count') && doc.querySelector('#count').textContent === '9'), 'observer init').toBe(true)
        }
    },
    {
        feature: 'lists',
        name: 'list with keyed rows and a row action',
        page: a => ({
            body: `<div ${a('component')}="todo">
                <ul id="items" ${a('list')}="items" ${a('key')}="id"><template><li><span class="t" ${a('bind')}="text"></span><button class="rm" ${a('action')}="remove">x</button></li></template></ul>
                <span id="n" ${a('bind')}="count"></span>
            </div>`,
            script: `wildflower.component('todo', {
                state: { items: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }, { id: 3, text: 'three' }] },
                computed: { count() { return this.items.length } },
                // The immutable idiom on purpose: elements read through the proxy are
                // written back as a new array, and the page must stay warning-free.
                remove(event, el, details) { this.items = this.items.filter(i => i.id !== details.item.id) }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#items li').length === 3), 'rows').toBe(true)
            expect([...doc.querySelectorAll('.t')].map(e => e.textContent)).toEqual(['one', 'two', 'three'])
            expect(doc.querySelector('#n').textContent).toBe('3')
            doc.querySelectorAll('.rm')[1].click()
            expect(await waitFor(() => doc.querySelectorAll('#items li').length === 2), 'row action').toBe(true)
            expect([...doc.querySelectorAll('.t')].map(e => e.textContent)).toEqual(['one', 'three'])
            expect(await waitFor(() => doc.querySelector('#n').textContent === '2'), 'count').toBe(true)
        }
    },
    {
        feature: 'portals',
        name: 'portal with bindings and an action inside the teleported content',
        page: a => ({
            body: `<div ${a('component')}="host"><div ${a('portal')}="#target"><span id="pm" ${a('bind')}="msg"></span><button id="pb" ${a('action')}="bump">b</button></div></div><div id="target"></div>`,
            script: `wildflower.component('host', { state: { msg: 'in portal' }, bump() { this.msg = 'bumped' } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#target #pm') && doc.querySelector('#target #pm').textContent === 'in portal'), 'teleported bind').toBe(true)
            doc.querySelector('#target #pb').click()
            expect(await waitFor(() => doc.querySelector('#target #pm').textContent === 'bumped'), 'teleported action').toBe(true)
        }
    },
    {
        feature: 'pools',
        name: 'pool filled in init',
        page: a => ({
            body: `<div ${a('component')}="dots"><div id="pool" ${a('pool')}="dots" ${a('key')}="id"><template><span class="dot" ${a('bind')}="label"></span></template></div></div>`,
            script: `wildflower.component('dots', {
                pools: { dots: {} },
                init() { this.pools.dots.push([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]) }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('.dot').length === 3), 'entities').toBe(true)
            expect(await waitFor(() => [...doc.querySelectorAll('.dot')].map(e => e.textContent).join('') === 'abc'), 'entity binds').toBe(true)
        }
    },
    {
        feature: 'query',
        name: 'query from a function source rendering a list',
        page: a => ({
            body: `<div ${a('component')}="prod"><span id="qn" ${a('bind')}="$products.count"></span><ul id="rows" ${a('query')}="products"><template><li ${a('bind')}="name"></li></template></ul></div>`,
            script: `wildflower.query('products', { from: () => Promise.resolve([{ id: 1, name: 'pen' }, { id: 2, name: 'ink' }]), key: 'id', refresh: ['once'] });
                wildflower.component('prod', {})`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 2), 'rows').toBe(true)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent)).toEqual(['pen', 'ink'])
            expect(await waitFor(() => doc.querySelector('#qn').textContent === '2'), '$query.count').toBe(true)
        }
    },
    // Binding OWNERSHIP across the prefix. `_isOwnedBindingElement` excludes
    // elements inside a list, because the list renderer owns row bindings and
    // the component pass must not touch them. That exclusion walked
    // `closest('[data-list]')`, so on a data-wf-* page it found nothing and the
    // component claimed its own rows. It stays invisible until the component
    // and the row bind the SAME NAME, which is why `title` exists on both here:
    // the component's value then lands in every row on the next component-level
    // flush. No SSR involved; this is the general engine, and the SSR canaries
    // below are the same defect where the overwritten text is the server's.
    {
        feature: 'lists',
        name: 'a component re-bind does not claim its own list rows',
        page: a => ({
            body: `<div ${a('component')}="owner">
                <span id="n" ${a('bind')}="n"></span>
                <ul id="rows" ${a('list')}="items"><template><li ${a('bind')}="title"></li></template></ul>
                <button id="b" ${a('action')}="bump">b</button>
            </div>`,
            script: `wildflower.component('owner', {
                state: { n: 0, title: 'COMPONENT', items: [{ id: 1, title: 'row-a' }, { id: 2, title: 'row-b' }] },
                bump() { this.n++ }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 2), 'rows render').toBe(true)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent), 'rows bind the ITEM title').toEqual(['row-a', 'row-b'])
            doc.querySelector('#b').click()
            expect(await waitFor(() => doc.querySelector('#n').textContent === '1'), 'the component-level flush ran').toBe(true)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent),
                'and it must not write the component title over the rows').toEqual(['row-a', 'row-b'])
        }
    },
    // The same ownership question with the rows ALREADY IN THE MARKUP, which is
    // what the component's first binding scan actually walks. Rows built from
    // state never exist during that scan, so they cannot be misclaimed; rows an
    // author (or a server) wrote into the page can.
    {
        feature: 'lists',
        name: 'a pre-rendered row is not claimed by the component that contains it',
        page: a => ({
            body: `<div ${a('component')}="pre">
                <span id="n" ${a('bind')}="n"></span>
                <ul id="rows" ${a('list')}="items">
                    <template><li ${a('bind')}="title"></li></template>
                    <li ${a('bind')}="title">row-a</li>
                    <li ${a('bind')}="title">row-b</li>
                </ul>
                <button id="b" ${a('action')}="bump">b</button>
            </div>`,
            script: `wildflower.component('pre', {
                state: { n: 0, title: 'COMPONENT', items: [{ id: 1, title: 'row-a' }, { id: 2, title: 'row-b' }] },
                bump() { this.n++ }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 2), 'rows').toBe(true)
            doc.querySelector('#b').click()
            expect(await waitFor(() => doc.querySelector('#n').textContent === '1'), 'the component-level flush ran').toBe(true)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent),
                'the component title must not reach a row it merely contains').toEqual(['row-a', 'row-b'])
        }
    },
    // One canary per remaining bare-only selector found in the 2026-09-08 audit.
    // Each drives the specific path whose selector reads `[data-list]` or
    // `[data-component]` with no prefixed alternative, so a failure here names
    // the site rather than merely suggesting the area.

    // EntitySystem 692/770/825: a store update walks the dependent instance's
    // lists with querySelectorAll('[data-list]').
    {
        feature: 'lists',
        name: 'a store update repaints a list in a subscribing component',
        page: a => ({
            body: `<div ${a('component')}="shopper">
                <ul id="rows" ${a('list')}="$cart.items"><template><li ${a('bind')}="name"></li></template></ul>
                <button id="add" ${a('action')}="add">+</button>
            </div>`,
            script: `wildflower.store('cart', { state: { items: [{ id: 1, name: 'apple' }] },
                push() { this.items = [...this.items, { id: 2, name: 'pear' }] } });
                wildflower.component('shopper', { subscribe: ['cart'], add() { this.stores.cart.push() } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 1), 'seed row').toBe(true)
            doc.querySelector('#add').click()
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 2), 'store push reaches the list').toBe(true)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent)).toEqual(['apple', 'pear'])
        }
    },

    // The documented composition pattern (the Composition patterns page):
    // `data-prop-card="."` hands the whole row item to a child component, which
    // derives its own view of it through computed properties. Two doc examples
    // use this and NOTHING in test-new covered it, in either prefix. It routes
    // through PropsSystem._getListItemData, whose three resolution branches
    // (the _itemData fast path, the list context, and the parent-state
    // fallback) were likewise untested.
    {
        feature: 'lists',
        name: 'data-prop-"." hands the row item to a child component',
        page: a => ({
            body: `<div ${a('component')}="cards">
                <ul id="rows" ${a('list')}="items" ${a('key')}="id"><template>
                    <li><div class="card" ${a('component')}="info-card" ${a('prop-card')}=".">
                        <strong class="t" ${a('bind')}="title"></strong><em class="b" ${a('bind')}="body"></em>
                    </div></li>
                </template></ul>
                <button id="rename" ${a('action')}="rename">r</button>
            </div>`,
            script: `wildflower.component('info-card', {
                props: { card: { type: 'object' } },
                computed: {
                    title() { return this.props.card.cardTitle || '' },
                    body() { return this.props.card.cardBody || '' }
                }
            });
            wildflower.component('cards', {
                state: { items: [
                    { id: 1, cardTitle: 'first', cardBody: 'one' },
                    { id: 2, cardTitle: 'second', cardBody: 'two' }
                ] },
                rename() { this.items[1].cardTitle = 'renamed' }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('.card .t').length === 2), 'a child per row').toBe(true)
            expect(await waitFor(() => [...doc.querySelectorAll('.t')].map(e => e.textContent).join(',') === 'first,second'),
                'each child receives its OWN row item, not the first').toBe(true)
            expect([...doc.querySelectorAll('.b')].map(e => e.textContent), 'a second field off the same item').toEqual(['one', 'two'])
            // The prop is a live view of the row, not a copy taken at mount.
            doc.querySelector('#rename').click()
            expect(await waitFor(() => doc.querySelectorAll('.t')[1].textContent === 'renamed'), 'writing the row updates the child').toBe(true)
            expect(doc.querySelectorAll('.t')[0].textContent, 'and only that row').toBe('first')
        }
    },


    // The composition pattern on an SSR-ADOPTED list: server-rendered cards are
    // exactly the shape the Composition patterns page documents.
    {
        feature: 'ssr',
        name: 'ssr: data-prop-"." resolves on an adopted row',
        page: a => ({
            body: `<div ${a('component')}="ssrcards" ${a('ssr')}="true">
                <ul id="rows" ${a('list')}="items" ${a('key')}="id">
                    <template><li><div class="card" ${a('component')}="ssr-card" ${a('prop-card')}="."><strong class="t" ${a('bind')}="title"></strong></div></li></template>
                    <li ${a('seed')}='{"id":1,"cardTitle":"alpha"}'><div class="card" ${a('component')}="ssr-card" ${a('prop-card')}="."><strong class="t" ${a('bind')}="title">alpha</strong></div></li>
                    <li ${a('seed')}='{"id":2,"cardTitle":"beta"}'><div class="card" ${a('component')}="ssr-card" ${a('prop-card')}="."><strong class="t" ${a('bind')}="title">beta</strong></div></li>
                </ul>
            </div>`,
            script: `wildflower.component('ssr-card', {
                props: { card: { type: 'object' } },
                computed: { title() { return (this.props.card && this.props.card.cardTitle) || '' } }
            });
            wildflower.component('ssrcards', { state: { items: [] } })`
        }),
        check: async ({ doc }) => {
            await new Promise(r => setTimeout(r, 200))
            expect(doc.querySelectorAll('.card .t').length, 'both adopted rows kept').toBe(2)
            expect([...doc.querySelectorAll('.t')].map(e => e.textContent),
                'each adopted row resolves its own item through data-prop-"."').toEqual(['alpha', 'beta'])
        }
    },

    // NO SSR. The child is declared BEFORE its parent, and both elements are
    // already in the page, so registering the child late-initializes it while
    // the parent has no instance yet. Declaration order in a script is not
    // something an author reasons about, so this must not decide whether props
    // arrive.
    {
        name: 'a child declared before its parent still receives props',
        page: a => ({
            body: `<div ${a('component')}="ordhost">
                <div id="kid" ${a('component')}="ord-kid" ${a('prop-label')}="heading"><em class="kl" ${a('bind')}="props.label"></em></div>
            </div>`,
            script: `wildflower.component('ord-kid', { props: { label: { type: 'string' } } });
                wildflower.component('ordhost', { state: { heading: 'Hello' } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('.kl').textContent === 'Hello'),
                'declaration order must not decide whether the prop resolves').toBe(true)
        }
    },

    // A binding written on a child component's ROOT element sits in the parent's
    // template, so the parent owns it (root-bindings commit 40af7106). The
    // child's own binding scan excludes its root only when it can see a parent
    // owner, and that check (RenderingCore._querySelfAndDescendants) reads the
    // bare component attribute plus data-component-id. With the child declared
    // first, the parent has no id yet, so a data-wf-component parent is
    // invisible to it: the child claims the binding in its own scope, where the
    // path does not exist, and every later child render fights the parent's.
    {
        name: 'a binding on a child root belongs to the parent, even when the child is declared first',
        page: a => ({
            body: `<div ${a('component')}="rooth">
                <div id="kid" ${a('component')}="root-kid" ${a('bind-class')}="tone">
                    <span class="n" ${a('bind')}="n"></span>
                    <button id="bump" ${a('action')}="bump">+</button>
                </div>
            </div>`,
            script: `wildflower.component('root-kid', { state: { n: 0 }, bump() { this.n++ } });
                wildflower.component('rooth', { state: { tone: 'warm' } })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelector('#kid').classList.contains('warm')),
                'the parent paints the binding it wrote on the child root').toBe(true)
            doc.querySelector('#bump').click()
            expect(await waitFor(() => doc.querySelector('.n').textContent === '1'), 'child state change renders').toBe(true)
            await new Promise(r => setTimeout(r, 100))
            expect(doc.querySelector('#kid').classList.contains('warm'),
                'a child render must not evaluate the root binding in child scope').toBe(true)
        }
    },

    // Isolates the same question with NO list involved: does a component nested
    // inside an SSR component receive a plain prop from its parent's state?
    {
        feature: 'ssr',
        name: 'ssr: a nested component receives a plain prop from its parent',
        page: a => ({
            body: `<div ${a('component')}="ssrhost" ${a('ssr')}="true">
                <span id="own" ${a('bind')}="heading">Hello</span>
                <div id="kid" ${a('component')}="ssr-kid" ${a('prop-label')}="heading"><em class="kl" ${a('bind')}="props.label"></em></div>
            </div>`,
            script: `wildflower.component('ssr-kid', { props: { label: { type: 'string' } } });
                wildflower.component('ssrhost', { state: { heading: '' } })`
        }),
        check: async ({ doc }) => {
            await new Promise(r => setTimeout(r, 200))
            expect(doc.querySelector('#own').textContent, 'the SSR parent adopts its own text').toBe('Hello')
            expect(doc.querySelector('.kl').textContent, 'and the nested child receives the prop').toBe('Hello')
        }
    },

    // ListItemBinding 585 + EventSystem 1463: an action fired from inside a row,
    // where the handler needs the row's item and the owning component.
    {
        feature: 'lists',
        name: 'a row action resolves its own item',
        page: a => ({
            body: `<div ${a('component')}="picker">
                <span id="picked" ${a('bind')}="picked"></span>
                <ul id="rows" ${a('list')}="items"><template><li ${a('bind')}="name" ${a('action')}="pick"></li></template></ul>
            </div>`,
            script: `wildflower.component('picker', {
                state: { picked: '', items: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] },
                pick(event, el, detail) { this.picked = detail.item.name }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('#rows li').length === 2), 'rows').toBe(true)
            doc.querySelectorAll('#rows li')[1].click()
            expect(await waitFor(() => doc.querySelector('#picked').textContent === 'two'), 'the SECOND row, not the first').toBe(true)
        }
    },

    // A nested component inside every row becomes a LIVE INSTANCE, which is
    // what tests/list-observer-skip-nested-components.test.js pins for the
    // bare prefix. Deliberately NOT asserting that data-prop-* resolves against
    // the row's item: that failed here in BOTH prefix arms, so it is not a
    // prefix question, and no existing test claims it works. Raised separately.
    {
        feature: 'lists',
        name: 'a component inside every row becomes a live instance',
        page: a => ({
            body: `<div ${a('component')}="outer">
                <ul id="rows" ${a('list')}="items" ${a('key')}="id"><template>
                    <li><span ${a('bind')}="name"></span><div class="badge" ${a('component')}="badge"></div></li>
                </template></ul>
            </div>`,
            script: `window.__inits = 0;
                wildflower.component('badge', { state: {}, init() { window.__inits++ } });
                wildflower.component('outer', { state: { items: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }] } })`
        }),
        check: async ({ doc, win }) => {
            expect(await waitFor(() => doc.querySelectorAll('.badge').length === 2), 'a badge per row').toBe(true)
            expect(await waitFor(() => doc.querySelectorAll('.badge[data-component-id]').length === 2),
                'live instances, not inert markup').toBe(true)
            expect(await waitFor(() => win.__inits === 2), 'init ran once per row').toBe(true)
        }
    },

    // EventSystem 1463 again, via the nested shape: the walk records each
    // ancestor list by name, so a nested row action needs both levels.
    {
        feature: 'lists',
        name: 'an action inside a nested list resolves the inner item',
        page: a => ({
            body: `<div ${a('component')}="tree">
                <span id="hit" ${a('bind')}="hit"></span>
                <ul id="outer" ${a('list')}="groups"><template>
                    <li><ul class="inner" ${a('list')}="children"><template>
                        <li class="leaf" ${a('bind')}="label" ${a('action')}="tap"></li>
                    </template></ul></li>
                </template></ul>
            </div>`,
            script: `wildflower.component('tree', {
                state: { hit: '', groups: [{ id: 1, children: [{ id: 11, label: 'a1' }, { id: 12, label: 'a2' }] }] },
                tap(event, el, detail) { this.hit = detail.item.label }
            })`
        }),
        check: async ({ doc }) => {
            expect(await waitFor(() => doc.querySelectorAll('.leaf').length === 2), 'nested rows').toBe(true)
            doc.querySelectorAll('.leaf')[1].click()
            expect(await waitFor(() => doc.querySelector('#hit').textContent === 'a2'), 'inner item, not outer').toBe(true)
        }
    },
    // SSR adoption is the one arrival path these canaries had not covered,
    // and it is the path a server-rendered page actually takes. The tell is
    // that the component's declared state is EMPTY: everything on screen came
    // from the server, so if adoption does not happen the binding overwrites
    // the rendered text with nothing. A page that renders 'Ada' and then
    // blanks it is the exact failure a user reports as "it flashes and goes
    // empty", and no amount of scanning coverage catches it.
    {
        feature: 'ssr',
        name: 'ssr: adopted bindings survive and stay reactive',
        page: a => ({
            body: `<div ${a('component')}="profile" ${a('ssr')}="true">
                <h1 id="n" ${a('bind')}="name">Ada</h1>
                <span id="e" ${a('bind')}="email">ada@example.com</span>
                <button id="r" ${a('action')}="rename">r</button>
            </div>`,
            script: `wildflower.component('profile', { state: { name: '', email: '' }, rename() { this.name = 'Grace' } })`
        }),
        check: async ({ doc }) => {
            // Held for a beat: the failure is a wipe that happens on the
            // first flush, so asserting too early passes for the wrong reason.
            await new Promise(r => setTimeout(r, 150))
            expect(doc.querySelector('#n').textContent, 'server text adopted, not overwritten').toBe('Ada')
            expect(doc.querySelector('#e').textContent, 'second binding adopted').toBe('ada@example.com')
            doc.querySelector('#r').click()
            expect(await waitFor(() => doc.querySelector('#n').textContent === 'Grace'), 'adopted binding is still reactive').toBe(true)
        }
    },
    {
        feature: 'ssr',
        name: 'ssr: adopted list keeps its server rows',
        page: a => ({
            body: `<div ${a('component')}="feed" ${a('ssr')}="true">
                <ul id="rows" ${a('list')}="posts">
                    <template><li ${a('bind')}="title"></li></template>
                    <li ${a('bind')}="title">First</li>
                    <li ${a('bind')}="title">Second</li>
                </ul>
            </div>`,
            script: `wildflower.component('feed', { state: { posts: [] } })`
        }),
        check: async ({ doc }) => {
            await new Promise(r => setTimeout(r, 150))
            expect(doc.querySelectorAll('#rows li').length, 'server rows kept, not cleared to the empty array').toBe(2)
            expect([...doc.querySelectorAll('#rows li')].map(e => e.textContent),
                'adopted rows keep their server text').toEqual(['First', 'Second'])
        }
    }
]

describe('plain page canaries', () => {
    for (const c of canaries) {
        for (const prefix of PREFIXES) {
            const a = name => prefix + name
            const label = `${c.name} [${prefix}*]`
            const run = async () => {
                const { win, doc } = await mount(pageHtml(c.page(a)))
                await c.check({ win, doc }, a)
                expectClean(win, label)
            }
            if (c.feature && !hasFeature(c.feature)) {
                it.skip(label, run)
            } else {
                it(label, run, TIMEOUT)
            }
        }
    }

    it('exclusive prefix mode: data-wf-prefix="true" on the script tag ignores bare data-*', async () => {
        const { win, doc } = await mount(pageHtml({
            scriptAttrs: 'data-wf-prefix="true"',
            body: `<div data-wf-component="x"><span id="w" data-wf-bind="count"></span><span id="b" data-bind="count">untouched</span></div>`,
            script: `wildflower.component('x', { state: { count: 3 } })`
        }))
        expect(await waitFor(() => doc.querySelector('#w').textContent === '3'), 'prefixed bind').toBe(true)
        await new Promise(r => setTimeout(r, 100))
        expect(doc.querySelector('#b').textContent, 'bare attribute must be ignored').toBe('untouched')
        expectClean(win, 'exclusive prefix mode')
    }, TIMEOUT)

    // Exclusive mode beyond a single component bind. The 2026-09-08 audit found
    // ~50 HAND-WRITTEN both-prefix selectors ('[data-list],[data-wf-list]' and
    // friends) across ListItemBinding, QuerySystem, EventSystem,
    // ListExpressionEval, RenderingCore, FormHandling and others. Every one of
    // them matches a BARE attribute even when the author asked the framework to
    // ignore bare attributes, which is the entire purpose of the mode: it exists
    // so WildflowerJS can sit beside Bootstrap or Alpine without fighting over
    // data-action and data-target. `_attrSelector` honors the mode; a literal
    // cannot. These pages put a bare attribute where such a selector looks.
    const exclusive = (body, script) => pageHtml({ scriptAttrs: 'data-wf-prefix="true"', body, script })

    it.skipIf(!hasFeature('lists'))('exclusive mode: a bare data-list beside a prefixed one is not rendered into', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex1">
                <ul id="mine" data-wf-list="items"><template><li data-wf-bind="name"></li></template></ul>
                <ul id="theirs" data-list="items"><li>third-party markup</li></ul>
            </div>`,
            `wildflower.component('ex1', { state: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } })`
        ))
        expect(await waitFor(() => doc.querySelectorAll('#mine li').length === 2), 'the prefixed list renders').toBe(true)
        expect(doc.querySelector('#theirs').innerHTML, 'the bare list is another library\'s and must be untouched')
            .toContain('third-party markup')
        expect(doc.querySelectorAll('#theirs li').length, 'and must not be rendered into').toBe(1)
        expectClean(win, 'exclusive bare list')
    }, TIMEOUT)

    it.skipIf(!hasFeature('lists'))('exclusive mode: a bare data-action inside a prefixed row does not fire', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex2">
                <span id="fired" data-wf-bind="fired"></span>
                <ul id="rows" data-wf-list="items"><template>
                    <li><button class="bare" data-action="boom">x</button></li>
                </template></ul>
            </div>`,
            `wildflower.component('ex2', { state: { fired: 'no', items: [{ id: 1 }] }, boom() { this.fired = 'yes' } })`
        ))
        expect(await waitFor(() => doc.querySelectorAll('#rows .bare').length === 1), 'row rendered').toBe(true)
        doc.querySelector('#rows .bare').click()
        await new Promise(r => setTimeout(r, 120))
        expect(doc.querySelector('#fired').textContent, 'a bare data-action belongs to the other library').toBe('no')
        expectClean(win, 'exclusive bare row action')
    }, TIMEOUT)

    it.skipIf(!hasFeature('lists'))('exclusive mode: a bare data-bind inside a prefixed row is left alone', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex3">
                <ul id="rows" data-wf-list="items"><template>
                    <li><span class="ours" data-wf-bind="name"></span><span class="theirs" data-bind="name">keep me</span></li>
                </template></ul>
            </div>`,
            `wildflower.component('ex3', { state: { items: [{ id: 1, name: 'alpha' }] } })`
        ))
        expect(await waitFor(() => doc.querySelector('#rows .ours')?.textContent === 'alpha'), 'prefixed row bind').toBe(true)
        expect(doc.querySelector('#rows .theirs').textContent, 'the bare bind is not ours to write').toBe('keep me')
        expectClean(win, 'exclusive bare row bind')
    }, TIMEOUT)

    // The remaining both-prefix literals, by feature area rather than by site,
    // since one page exercises many at once. ListItemBinding alone carries ~17
    // of them across every row binding family.
    it.skipIf(!hasFeature('lists'))('exclusive mode: every row binding family ignores its bare twin', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex4">
                <ul id="rows" data-wf-list="items" data-wf-key="id"><template>
                    <li>
                        <span class="ours" data-wf-bind="name"></span>
                        <span class="cls" data-wf-bind-class="flag ? 'on' : 'off'"></span>
                        <span class="sty" data-wf-bind-style="{ width: size + 'px' }"></span>
                        <a class="att" data-wf-bind-attr="{ title: name }">x</a>
                        <span class="shown" data-wf-show="flag">vis</span>
                        <span class="t-bind" data-bind="name">A</span>
                        <span class="t-cls" data-bind-class="flag ? 'on' : 'off'" class="static">B</span>
                        <span class="t-sty" data-bind-style="{ width: size + 'px' }">C</span>
                        <a class="t-att" data-bind-attr="{ title: name }">D</a>
                        <span class="t-show" data-show="flag">E</span>
                    </li>
                </template></ul>
            </div>`,
            `wildflower.component('ex4', { state: { items: [{ id: 1, name: 'alpha', flag: true, size: 40 }] } })`
        ))
        expect(await waitFor(() => doc.querySelector('#rows .ours')?.textContent === 'alpha'), 'prefixed row bind').toBe(true)
        expect(doc.querySelector('.cls').classList.contains('on'), 'prefixed class binding').toBe(true)
        expect(doc.querySelector('.sty').style.width, 'prefixed style binding').toBe('40px')
        expect(doc.querySelector('.att').getAttribute('title'), 'prefixed attr binding').toBe('alpha')
        // None of the bare twins are ours to touch.
        expect(doc.querySelector('.t-bind').textContent, 'bare bind').toBe('A')
        expect(doc.querySelector('.t-sty').style.width, 'bare style').toBe('')
        expect(doc.querySelector('.t-att').hasAttribute('title'), 'bare attr').toBe(false)
        expect(win.getComputedStyle(doc.querySelector('.t-show')).display, 'bare show must not be evaluated').not.toBe('none')
        expectClean(win, 'exclusive row binding families')
    }, TIMEOUT)

    it('exclusive mode: component-level bindings ignore their bare twins', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex5">
                <span id="ours" data-wf-bind="label"></span>
                <div id="ocls" data-wf-bind-class="flag ? 'on' : 'off'"></div>
                <p id="orender" data-wf-render="flag">kept</p>
                <span id="theirs" data-bind="label">A</span>
                <div id="tcls" data-bind-class="flag ? 'on' : 'off'"></div>
                <p id="trender" data-render="flag">also kept</p>
            </div>`,
            `wildflower.component('ex5', { state: { label: 'hi', flag: true } })`
        ))
        expect(await waitFor(() => doc.querySelector('#ours').textContent === 'hi'), 'prefixed bind').toBe(true)
        expect(doc.querySelector('#ocls').classList.contains('on'), 'prefixed class').toBe(true)
        expect(doc.querySelector('#theirs').textContent, 'bare bind untouched').toBe('A')
        expect(doc.querySelector('#tcls').classList.contains('on'), 'bare class not evaluated').toBe(false)
        expect(doc.querySelector('#trender'), 'a bare data-render must not be managed').not.toBeNull()
        expectClean(win, 'exclusive component bindings')
    }, TIMEOUT)

    it.skipIf(!hasFeature('query'))('exclusive mode: a bare data-query is not activated', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex6">
                <ul id="ours" data-wf-query="things"><template><li data-wf-bind="name"></li></template></ul>
                <ul id="theirs" data-query="things"><li>third-party</li></ul>
            </div>`,
            `wildflower.query('things', { from: () => Promise.resolve([{ id: 1, name: 'one' }]), key: 'id', refresh: ['once'] });
             wildflower.component('ex6', {})`
        ))
        expect(await waitFor(() => doc.querySelectorAll('#ours li').length === 1), 'the prefixed query renders').toBe(true)
        expect(doc.querySelector('#theirs').innerHTML, 'a bare data-query belongs to another library').toContain('third-party')
        expect(doc.querySelectorAll('#theirs li').length, 'and must not be rendered into').toBe(1)
        expectClean(win, 'exclusive bare query')
    }, TIMEOUT)

    it.skipIf(!hasFeature('lists'))('exclusive mode: a bare nested list inside a prefixed row is left alone', async () => {
        const { win, doc } = await mount(exclusive(
            `<div data-wf-component="ex7">
                <ul id="outer" data-wf-list="groups"><template>
                    <li>
                        <ul class="inner" data-wf-list="children"><template><li class="leaf" data-wf-bind="label"></li></template></ul>
                        <ul class="theirs" data-list="children"><li>theirs</li></ul>
                    </li>
                </template></ul>
            </div>`,
            `wildflower.component('ex7', { state: { groups: [{ id: 1, children: [{ id: 11, label: 'a1' }] }] } })`
        ))
        expect(await waitFor(() => doc.querySelectorAll('.leaf').length === 1), 'the prefixed nested list renders').toBe(true)
        expect(doc.querySelector('.leaf').textContent, 'and binds the inner item').toBe('a1')
        expect(doc.querySelectorAll('.theirs li').length, 'the bare nested list is untouched').toBe(1)
        expect(doc.querySelector('.theirs').textContent, 'and keeps its own markup').toContain('theirs')
        expectClean(win, 'exclusive bare nested list')
    }, TIMEOUT)

    it('framework at the end of body, registration after it', async () => {
        const { win, doc } = await mount(pageHtml({
            framework: 'bottom',
            body: `<div data-component="counter"><span id="count" data-bind="count"></span></div>`,
            script: `wildflower.component('counter', { state: { count: 2 } })`
        }))
        expect(await waitFor(() => doc.querySelector('#count').textContent === '2')).toBe(true)
        expectClean(win, 'bottom script')
    }, TIMEOUT)

    it('deferred framework script with registration in a DOMContentLoaded handler', async () => {
        const { win, doc } = await mount(pageHtml({
            framework: 'defer',
            body: `<div data-component="counter"><span id="count" data-bind="count"></span></div>`,
            script: `document.addEventListener('DOMContentLoaded', function () { wildflower.component('counter', { state: { count: 6 } }) })`
        }))
        expect(await waitFor(() => doc.querySelector('#count').textContent === '6')).toBe(true)
        expectClean(win, 'deferred script')
    }, TIMEOUT)

    it('framework loaded after window load, when the document is already complete', async () => {
        const { win, doc } = await mount(pageHtml({
            framework: 'none',
            body: `<div data-component="counter"><span id="count" data-bind="count"></span></div>`,
            script: `window.addEventListener('load', function () {
                var s = document.createElement('script');
                s.src = '${SCRIPT_SRC}';
                s.onload = function () { wildflower.component('counter', { state: { count: 4 } }) };
                document.head.appendChild(s);
            })`
        }))
        expect(await waitFor(() => doc.querySelector('#count').textContent === '4', 6000)).toBe(true)
        expectClean(win, 'lazy-loaded framework')
    }, TIMEOUT)
})
