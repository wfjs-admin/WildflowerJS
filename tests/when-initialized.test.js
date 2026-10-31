/**
 * wildflower.whenInitialized(): a promise that resolves once no component has
 * a deferred init() sequence scheduled, waiting on its subscribed stores, or
 * running (through the afterInit hook). It resolves at once when none is
 * pending. A mount's init() runs in a later task than the mount, so code that
 * mounts components and then reads what their init() set (a video renderer
 * seeking a fresh scene, a test) awaits this. whenIdle() and the
 * wildflower:idle event keep their meaning (the scan and the chunked late
 * registrations); this is separate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, getFrameworkScripts } from './helpers/load-framework.js'

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

let n = 0
const uniq = (base) => base + '-' + (++n)

describe('wildflower.whenInitialized()', () => {
    let host

    beforeAll(async () => {
        await loadFramework()
        await wait(50)
    })

    beforeEach(() => {
        resetFramework()
        host = document.createElement('div')
        document.body.appendChild(host)
    })

    afterEach(() => { host.remove() })

    it('resolves at once when no init is pending', async () => {
        await wildflower.whenInitialized()
        let done = false
        const p = wildflower.whenInitialized()
        expect(p).toBeInstanceOf(Promise)
        p.then(() => { done = true })
        await Promise.resolve()
        expect(done).toBe(true)
    })

    it('a dynamic mount: init has not run when scan() returns, and has after the await', async () => {
        const name = uniq('wi-dyn')
        let inited = false
        wildflower.component(name, { state: {}, init() { inited = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        expect(inited).toBe(false)
        await wildflower.whenInitialized()
        expect(inited).toBe(true)
    })

    it('a mount by markup alone, with no scan(): counted before the await', async () => {
        const name = uniq('wi-auto')
        let inited = false
        wildflower.component(name, { state: {}, init() { inited = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        await wildflower.whenInitialized()
        expect(inited).toBe(true)
    })

    it('covers an init that mounts another component from inside its own init()', async () => {
        const parent = uniq('wi-parent'), child = uniq('wi-child')
        let childInited = false
        wildflower.component(child, { state: {}, init() { childInited = true } })
        wildflower.component(parent, {
            state: {},
            init() {
                host.querySelector('.slot').innerHTML = '<div data-component="' + child + '"></div>'
                wildflower.scan()
            }
        })
        host.innerHTML = '<div data-component="' + parent + '"></div><div class="slot"></div>'
        wildflower.scan()
        await wildflower.whenInitialized()
        expect(childInited).toBe(true)
    })

    it('waits for a subscribed store that becomes ready later', async () => {
        const store = uniq('wi-store'), name = uniq('wi-sub')
        let storeReady = false, seen = null
        wildflower.store(store, {
            state: { value: 'initial' },
            async init() {
                await wait(80)
                this.state.value = 'ready'
                storeReady = true
            }
        })
        wildflower.component(name, {
            subscribe: [store],
            state: {},
            init() { seen = wildflower.getStore(store).state.value }
        })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        await wildflower.whenInitialized()
        expect(storeReady).toBe(true)
        expect(seen).toBe('ready')
        wildflower.destroyStore && wildflower.destroyStore(store)
    })

    it('resolves when a component is destroyed before its init ran', async () => {
        const name = uniq('wi-gone')
        let inited = false
        wildflower.component(name, { state: {}, init() { inited = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        const el = host.querySelector('[data-component="' + name + '"]')
        el.remove()
        wildflower.destroyComponent(el.dataset.componentId)
        let done = false
        wildflower.whenInitialized().then(() => { done = true })
        await wait(50)
        expect(done).toBe(true)
        expect(inited).toBe(false)
    })

    it('resolves when a component is destroyed while it waits for a store that never becomes ready', async () => {
        const store = uniq('wi-never'), name = uniq('wi-gone-waiting')
        let inited = false
        wildflower.store(store, { state: { value: 0 }, init() { return new Promise(() => {}) } })
        wildflower.component(name, { subscribe: [store], subscribeTimeout: 0, state: {}, init() { inited = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        await wait(20)
        const el = host.querySelector('[data-component="' + name + '"]')
        el.remove()
        wildflower.destroyComponent(el.dataset.componentId)
        let done = false
        wildflower.whenInitialized().then(() => { done = true })
        await wait(50)
        expect(done).toBe(true)
        expect(inited).toBe(false)
        wildflower.destroyStore && wildflower.destroyStore(store)
    })

    it('waits for the work an async init() awaits', async () => {
        const name = uniq('wi-async')
        let finished = false
        wildflower.component(name, { state: {}, async init() { await wait(60); finished = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        await wildflower.whenInitialized()
        expect(finished).toBe(true)
    })

    it('resolves when an async init() rejects, and onError hears it', async () => {
        const name = uniq('wi-async-reject')
        let caught = null
        wildflower.component(name, {
            state: {},
            async init() { await wait(20); throw new Error('wi-async-boom') },
            onError(error) { caught = error.message; return true }
        })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        let done = false
        wildflower.whenInitialized().then(() => { done = true })
        await wait(100)
        expect(done).toBe(true)
        expect(caught).toBe('wi-async-boom')
    })

    it('resolves when init() throws', async () => {
        const name = uniq('wi-throw')
        let caught = null
        wildflower.component(name, {
            state: {},
            init() { throw new Error('wi-boom') },
            onError(error) { caught = error.message; return true }
        })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        let done = false
        wildflower.whenInitialized().then(() => { done = true })
        await wait(50)
        expect(done).toBe(true)
        expect(caught).toBe('wi-boom')
    })

    it('is separate from whenIdle(): whenIdle() does not wait for a pending init', async () => {
        const name = uniq('wi-idle')
        let inited = false
        wildflower.component(name, { state: {}, init() { inited = true } })
        host.innerHTML = '<div data-component="' + name + '"></div>'
        wildflower.scan()
        await wildflower.whenIdle()
        expect(inited).toBe(false)
        await wildflower.whenInitialized()
        expect(inited).toBe(true)
    })
})

// The page-load scan batches its init() calls into one later task. A real
// page in an iframe, loaded from this lane's bundle: after whenIdle() the
// inits may still be queued; after whenInitialized() they have all run.
describe('wildflower.whenInitialized() on a page load', () => {
    const frames = []
    afterEach(() => { while (frames.length) frames.pop().remove() })

    it('covers the page-load deferred inits', async () => {
        const src = getFrameworkScripts()[0]
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><script src="' + src + '"></script></head><body>' +
            '<div data-component="pl-a"></div><div data-component="pl-b"></div>' +
            '<script>' +
            'window.__inits = 0; window.__result = null;' +
            'wildflower.component("pl-a", { state: {}, init() { window.__inits++ } });' +
            'wildflower.component("pl-b", { state: {}, init() { window.__inits++ } });' +
            'wildflower.whenIdle().then(function () { return wildflower.whenInitialized() })' +
            '.then(function () { window.__result = window.__inits });' +
            '</script></body></html>'
        const iframe = document.createElement('iframe')
        iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:400px;height:300px'
        document.body.appendChild(iframe)
        frames.push(iframe)
        await new Promise((resolve) => { iframe.addEventListener('load', resolve, { once: true }); iframe.srcdoc = html })
        const win = iframe.contentWindow
        const start = performance.now()
        while (win.__result === null && performance.now() - start < 4000) await wait(20)
        expect(win.__result).toBe(2)
    })

    it('waits for the store of a page-load component with subscribe: and no init()', async () => {
        const src = getFrameworkScripts()[0]
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><script src="' + src + '"></script></head><body>' +
            '<div data-component="pl-sub"></div>' +
            '<script>' +
            'window.__storeReady = false; window.__result = null;' +
            'wildflower.store("pl-store", { state: { v: 0 }, init() { return new Promise(function (r) { setTimeout(function () { window.__storeReady = true; r() }, 80) }) } });' +
            'wildflower.component("pl-sub", { subscribe: ["pl-store"], state: {} });' +
            'wildflower.whenIdle().then(function () { return wildflower.whenInitialized() })' +
            '.then(function () { window.__result = window.__storeReady });' +
            '</script></body></html>'
        const iframe = document.createElement('iframe')
        iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:400px;height:300px'
        document.body.appendChild(iframe)
        frames.push(iframe)
        await new Promise((resolve) => { iframe.addEventListener('load', resolve, { once: true }); iframe.srcdoc = html })
        const win = iframe.contentWindow
        const start = performance.now()
        while (win.__result === null && performance.now() - start < 4000) await wait(20)
        expect(win.__result).toBe(true)
    })
})
