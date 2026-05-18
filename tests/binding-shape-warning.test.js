/**
 * Dev-mode warning when data-bind-style / data-bind-attr receive a value
 * of the wrong shape (CSS string instead of object, etc.).
 *
 * Background: silent failure was a real production footgun. The pm-demo
 * passed CSS strings like 'background:#abc' to data-bind-style throughout,
 * which the framework silently no-ops on, leaving every avatar / label
 * chip / project icon with no color until the bug was spotted by eye.
 * The warning lights up that mistake the moment it happens in dev.
 *
 * The warning is __DEV__-gated — verified absent from wildflower.full.min.js
 * via build-output grep — so it costs nothing in production.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

// The whole suite asserts console.warn output that's __DEV__-gated and
// dead-code-eliminated in min builds (by design — warnings cost zero
// bytes in production). Skip on min variants; runs on dev/raw/source.
describe.skipIf(isMinifiedBuild())('Dev-mode binding-shape warnings', () => {
    let testContainer
    let warnings
    let originalWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)

        // Capture console.warn output
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => {
            warnings.push(args.join(' '))
            // Don't forward — keep test output clean
        }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function shapeWarnings() {
        return warnings.filter(w => /data-bind-(style|attr) expected an object/.test(w))
    }

    it('warns when data-bind-style receives a CSS string', async () => {
        window.wildflower.component('shape-style-string', {
            state: { badStyle: 'background:red', label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="shape-style-string">
                <span data-bind-style="badStyle" data-bind="label"></span>
            </div>
        `
        window.wildflower.scan()
        await new Promise(r => setTimeout(r, 50))

        const found = shapeWarnings()
        expect(found.length).toBeGreaterThan(0)
        expect(found[0]).toContain('data-bind-style')
        expect(found[0]).toContain('got string')
        expect(found[0]).toContain('Use object form')
    })

    it('does NOT warn when data-bind-style receives a valid object', async () => {
        window.wildflower.component('shape-style-object', {
            state: { goodStyle: { background: 'red' }, label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="shape-style-object">
                <span data-bind-style="goodStyle" data-bind="label"></span>
            </div>
        `
        window.wildflower.scan()
        await new Promise(r => setTimeout(r, 50))

        expect(shapeWarnings()).toEqual([])
    })

    it('does NOT warn when the value is null or undefined (intentional no-op)', async () => {
        window.wildflower.component('shape-style-null', {
            state: { nullStyle: null, label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="shape-style-null">
                <span data-bind-style="nullStyle" data-bind="label"></span>
            </div>
        `
        window.wildflower.scan()
        await new Promise(r => setTimeout(r, 50))

        expect(shapeWarnings()).toEqual([])
    })

    it('warns once per element even when the binding re-evaluates', async () => {
        window.wildflower.component('shape-style-rerun', {
            state: { count: 0, badStyle: 'background:red', label: 'x' },
            tickIt() { this.state.count++; }
        })
        testContainer.innerHTML = `
            <div data-component="shape-style-rerun">
                <span data-bind-style="badStyle" data-bind="label"></span>
                <button data-action="tickIt">tick</button>
            </div>
        `
        window.wildflower.scan()
        await new Promise(r => setTimeout(r, 50))
        // Trigger several re-renders by mutating unrelated state
        const inst = testContainer.querySelector('[data-component]')
        for (let i = 0; i < 5; i++) {
            const btn = inst.querySelector('button')
            btn.click()
            await new Promise(r => setTimeout(r, 10))
        }
        await new Promise(r => setTimeout(r, 50))

        // Same element + same binding type => one warning, even with multiple
        // re-renders. Avoids spamming the console in list-rendering hot paths.
        expect(shapeWarnings().length).toBe(1)
    })

    it('warns when data-bind-attr receives a string instead of an object', async () => {
        window.wildflower.component('shape-attr-string', {
            state: { badAttr: 'data-id=42', label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="shape-attr-string">
                <span data-bind-attr="badAttr" data-bind="label"></span>
            </div>
        `
        window.wildflower.scan()
        await new Promise(r => setTimeout(r, 50))

        const found = shapeWarnings()
        expect(found.length).toBeGreaterThan(0)
        expect(found[0]).toContain('data-bind-attr')
    })
})
