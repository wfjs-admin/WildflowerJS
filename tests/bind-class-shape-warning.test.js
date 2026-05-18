/**
 * Friendly dev-mode warning for data-bind-class shape mismatches.
 *
 * Background: returning an object from a computed used in data-bind-class
 * historically threw `TypeError: t.split is not a function` deep in the
 * framework, with no clear hint about what was wrong. Now we coerce
 * `{className: truthy}` to a class string and emit a one-time dev warning.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-bind-class shape warning', () => {
    let testContainer
    let wildflower
    let warnSpy

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        warnSpy.mockRestore()
    })

    // The warning is __DEV__-gated, so on min builds the entire if-block
    // (including the string literal) is dead-code-eliminated. Skip the
    // warning assertion on min builds; coercion still works there and is
    // tested separately below.
    it.skipIf(isMinifiedBuild())('warns and coerces when a computed returns an object', async () => {
        wildflower.component('class-shape-object', {
            state: { active: true, loading: false },
            computed: {
                btnClass() {
                    return { 'is-active': this.state.active, 'is-loading': this.state.loading }
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="class-shape-object">
                <button class="btn" data-bind-class="btnClass">Click</button>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(80)

        const btn = testContainer.querySelector('button')
        // Coerced: 'is-active' present, 'is-loading' absent (false in object)
        expect(btn.classList.contains('is-active')).toBe(true)
        expect(btn.classList.contains('is-loading')).toBe(false)
        expect(btn.classList.contains('btn')).toBe(true)  // static class preserved

        // The WF-505 warning is now emitted via wfError; output starts with
        // `[WF WF-505] Class binding shape mismatch...`. Assert on the code
        // rather than the prose so future wording tweaks don't break this.
        const allWarns = warnSpy.mock.calls.map(c => c.join(' '))
        const codeWarn = allWarns.find(s => s.includes('WF-505'))
        expect(codeWarn).toBeDefined()
        expect(codeWarn).toContain('shape mismatch')
    })

    it('passes strings through cleanly without warning', async () => {
        wildflower.component('class-shape-string', {
            state: { active: true },
            computed: {
                btnClass() {
                    return this.state.active ? 'is-active' : ''
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="class-shape-string">
                <button class="btn" data-bind-class="btnClass">Click</button>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(80)

        const btn = testContainer.querySelector('button')
        expect(btn.classList.contains('is-active')).toBe(true)
        expect(btn.classList.contains('btn')).toBe(true)

        const warnings = warnSpy.mock.calls.map(c => c.join(' ')).filter(s => s.includes('data-bind-class'))
        expect(warnings.length).toBe(0)
    })

    it('updates correctly when the object reference changes', async () => {
        wildflower.component('class-shape-update', {
            state: { active: false },
            computed: {
                btnClass() {
                    return { 'is-active': this.state.active, 'is-disabled': !this.state.active }
                }
            },
            toggle() { this.state.active = !this.state.active }
        })

        testContainer.innerHTML = `
            <div data-component="class-shape-update">
                <button class="btn" data-bind-class="btnClass">Click</button>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(80)

        const componentEl = testContainer.querySelector('[data-component="class-shape-update"]')
        const inst = wildflower.componentInstances.get(componentEl.dataset.componentId)
        const btn = testContainer.querySelector('button')

        expect(btn.classList.contains('is-disabled')).toBe(true)
        expect(btn.classList.contains('is-active')).toBe(false)

        inst.toggle()
        await waitForUpdate(80)

        expect(btn.classList.contains('is-active')).toBe(true)
        expect(btn.classList.contains('is-disabled')).toBe(false)
    })
})
