/**
 * Item-level computed (parameterised: fn(item)) referenced from
 * data-bind-style / data-bind-attr / data-bind inside a list template
 * must update reactively when the underlying item state mutates.
 *
 * The PM tracker bug: assigning a previously-unassigned issue updated the
 * avatar's two-letter initials (text binding) immediately, but the circle's
 * background colour (style binding) only painted after a second/third
 * assignment caused mapArray to rebuild the row.
 *
 * Root cause: targeted-rebind filters compared `binding.path === changedProp`
 * (or `expression.includes(changedProp)`), which skipped DOM writes for any
 * binding whose path was a computed name (since the computed name isn't the
 * mutated prop). The fix is a per-binding bypass: when the binding refers to
 * a registered computed name, skip the targeted filter.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item-level computed reactivity in list template bindings', () => {
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

    it('store-backed list: data-bind-style on a parameterised computed reacts on item mutation', async () => {
        wildflower.store('repro', {
            state: {
                rows: [{ id: 'a', flag: false }, { id: 'b', flag: false }]
            },
            toggleRow(idx) {
                this.state.rows[idx].flag = !this.state.rows[idx].flag
            }
        })

        wildflower.component('repro-store-style', {
            subscribe: { repro: ['rows'] },
            computed: {
                rows() { return this.stores.repro.rows },
                circleStyle(row) {
                    return row.flag
                        ? { background: 'red', borderColor: 'red' }
                        : { background: 'gray', borderColor: 'gray' }
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="repro-store-style">
                <div data-list="rows" data-key="id">
                    <template>
                        <span class="circle" data-bind-style="circleStyle"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const circles = testContainer.querySelectorAll('.circle')
        expect(circles.length).toBe(2)
        expect(circles[0].style.background).toBe('gray')
        expect(circles[1].style.background).toBe('gray')

        wildflower.getStore('repro').toggleRow(0)
        await waitForCompleteRender()

        expect(circles[0].style.background).toBe('red')
        expect(circles[1].style.background).toBe('gray')

        wildflower.getStore('repro').toggleRow(0)
        await waitForCompleteRender()
        expect(circles[0].style.background).toBe('gray')
    })

    it('store-backed list: data-bind-style with object expression { color: parameterised(item) } reacts', async () => {
        wildflower.store('repro2', {
            state: {
                rows: [{ id: 'a', on: false }, { id: 'b', on: false }]
            },
            toggleRow(idx) { this.state.rows[idx].on = !this.state.rows[idx].on }
        })

        wildflower.component('repro-store-style-expr', {
            subscribe: { repro2: ['rows'] },
            computed: {
                rows() { return this.stores.repro2.rows },
                bgColor(row) { return row.on ? 'red' : 'gray' }
            }
        })

        testContainer.innerHTML = `
            <div data-component="repro-store-style-expr">
                <div data-list="rows" data-key="id">
                    <template>
                        <span class="circle" data-bind-style="{ background: bgColor }"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const circles = testContainer.querySelectorAll('.circle')
        expect(circles[0].style.background).toBe('gray')

        wildflower.getStore('repro2').toggleRow(0)
        await waitForCompleteRender()
        expect(circles[0].style.background).toBe('red')
        expect(circles[1].style.background).toBe('gray')
    })

    it('store-backed list: data-bind-attr on a parameterised computed reacts', async () => {
        wildflower.store('repro3', {
            state: {
                rows: [{ id: 'a', pressed: false }, { id: 'b', pressed: false }]
            },
            toggleRow(idx) { this.state.rows[idx].pressed = !this.state.rows[idx].pressed }
        })

        wildflower.component('repro-store-attr', {
            subscribe: { repro3: ['rows'] },
            computed: {
                rows() { return this.stores.repro3.rows },
                ariaState(row) { return { 'aria-pressed': row.pressed ? 'true' : 'false' } }
            }
        })

        testContainer.innerHTML = `
            <div data-component="repro-store-attr">
                <div data-list="rows" data-key="id">
                    <template>
                        <button class="b" data-bind-attr="ariaState"></button>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const buttons = testContainer.querySelectorAll('button.b')
        expect(buttons[0].getAttribute('aria-pressed')).toBe('false')

        wildflower.getStore('repro3').toggleRow(0)
        await waitForCompleteRender()
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
        expect(buttons[1].getAttribute('aria-pressed')).toBe('false')
    })

    // PM tracker shape: store-backed list with a parameterised item-level
    // computed that returns a style object whose values come through the
    // store. Mirrors www/demos/project-management/components/issue-list.js
    // assigneeStyle(item) exactly.
    it('PM tracker shape: avatar style binding paints on first assignment', async () => {
        wildflower.store('avatars', {
            state: {
                avatarsByUser: {
                    u1: { initials: 'AB', color: '#ff0000' },
                    u2: { initials: 'CD', color: '#00ff00' }
                },
                issues: [
                    { id: 'i1', ref: 'WEB-1', assignee: null },
                    { id: 'i2', ref: 'WEB-2', assignee: null }
                ]
            },
            assign(idx, userId) {
                this.state.issues[idx].assignee = userId
            },
            resolveAvatar(userId) {
                return this.state.avatarsByUser[userId] || { initials: '??', color: '#888' }
            }
        })

        wildflower.component('pm-shape', {
            subscribe: { avatars: ['issues'] },
            computed: {
                rows() { return this.stores.avatars.issues },
                assigneeInitials(issue) {
                    if (!issue || issue.ref === undefined) return ''
                    return issue.assignee
                        ? wildflower.getStore('avatars').resolveAvatar(issue.assignee).initials
                        : ''
                },
                assigneeStyle(issue) {
                    if (!issue || issue.ref === undefined) return {}
                    return issue.assignee
                        ? { background: wildflower.getStore('avatars').resolveAvatar(issue.assignee).color }
                        : {}
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="pm-shape">
                <div data-list="rows" data-key="id">
                    <template>
                        <span class="pm-assignee" data-bind-style="assigneeStyle" data-bind="assigneeInitials"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const avatars = testContainer.querySelectorAll('.pm-assignee')
        expect(avatars[0].textContent).toBe('')
        expect(avatars[0].style.background).toBe('')

        // Assign user u1 to issue 0 — both text AND style must paint immediately.
        wildflower.getStore('avatars').assign(0, 'u1')
        await waitForCompleteRender()

        expect(avatars[0].textContent).toBe('AB')
        const bg0 = avatars[0].style.background || avatars[0].style.backgroundColor
        expect(bg0).toMatch(/rgb\(255,\s*0,\s*0\)|#ff0000|red/i)

        // Other rows unaffected.
        expect(avatars[1].textContent).toBe('')
        expect(avatars[1].style.background).toBe('')
    })
})
