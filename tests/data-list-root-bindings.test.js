/**
 * Bindings on the data-list root element itself.
 *
 * Covers `data-bind-style`, `data-bind-class`, `data-bind-attr`, `data-model`
 * on the same element that carries `data-list`. Previously these were
 * silently filtered out because `_isOwnedBindingElement` treated the list
 * root as "inside a list" and skipped it. Common pattern: animating a list
 * container's transform/opacity/class while its children render.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Bindings on data-list root element', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('data-bind-style on the data-list element applies and updates reactively', async () => {
        wildflower.component('carousel-style', {
            state: {
                items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                offset: 0
            },
            computed: {
                transform() { return 'translateX(' + this.state.offset + 'px)' }
            }
        })

        testContainer.innerHTML = `
            <div data-component="carousel-style">
                <ul class="track" data-list="items" data-key="id"
                    data-bind-style="{transform: transform}">
                    <template><li data-bind="id"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const track = testContainer.querySelector('.track')
        expect(track.style.transform).toBe('translateX(0px)')
        expect(track.querySelectorAll('li').length).toBe(3)

        const inst = wildflower.getComponent('carousel-style')
        inst.state.offset = 240
        await waitForCompleteRender()

        expect(track.style.transform).toBe('translateX(240px)')
    })

    it('data-bind-class on the data-list element applies and updates reactively', async () => {
        wildflower.component('list-class-on-root', {
            state: {
                items: [{ id: 1 }, { id: 2 }],
                loading: true
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-class-on-root">
                <ul class="track" data-list="items" data-key="id"
                    data-bind-class="{'is-loading': loading}">
                    <template><li data-bind="id"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const track = testContainer.querySelector('.track')
        expect(track.classList.contains('is-loading')).toBe(true)

        const inst = wildflower.getComponent('list-class-on-root')
        inst.state.loading = false
        await waitForCompleteRender()

        expect(track.classList.contains('is-loading')).toBe(false)
    })

    it('data-bind-attr on the data-list element applies and updates reactively', async () => {
        wildflower.component('list-attr-on-root', {
            state: {
                rows: [{ id: 'r1' }, { id: 'r2' }],
                groupName: 'group-a'
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-attr-on-root">
                <ul class="track" data-list="rows" data-key="id"
                    data-bind-attr="{'data-group': groupName}">
                    <template><li data-bind="id"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const track = testContainer.querySelector('.track')
        expect(track.getAttribute('data-group')).toBe('group-a')

        const inst = wildflower.getComponent('list-attr-on-root')
        inst.state.groupName = 'group-b'
        await waitForCompleteRender()

        expect(track.getAttribute('data-group')).toBe('group-b')
    })
})
