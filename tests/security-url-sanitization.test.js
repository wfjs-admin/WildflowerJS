/**
 * @vitest-environment browser
 *
 * Security tests for URL sanitization in _sanitizeAttrValue.
 * Tests for javascript: bypass via control characters, vbscript:, and data:text/html in href.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan()
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('Security: URL sanitization in attribute bindings', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower

        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear()
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear()
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('should block javascript: with embedded tab character', async () => {
        wildflower.component('url-san-1', {
            state: {
                attrs: { href: 'java\tscript:alert(1)' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-1">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.replace(/\s/g, '').toLowerCase().includes('javascript:')).toBe(true)
    })

    it('should block javascript: with embedded newline', async () => {
        wildflower.component('url-san-2', {
            state: {
                attrs: { href: 'java\nscript:alert(1)' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-2">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.replace(/\s/g, '').toLowerCase().includes('javascript:')).toBe(true)
    })

    it('should block vbscript: in href', async () => {
        wildflower.component('url-san-3', {
            state: {
                attrs: { href: 'vbscript:MsgBox("xss")' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-3">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.toLowerCase().includes('vbscript:')).toBe(true)
    })

    it('should block data:text/html in href', async () => {
        wildflower.component('url-san-4', {
            state: {
                attrs: { href: 'data:text/html,<script>alert(1)</script>' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-4">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.toLowerCase().startsWith('data:text/html')).toBe(true)
    })

    it('should block data:text/html in formaction', async () => {
        wildflower.component('url-san-5', {
            state: {
                attrs: { formaction: 'data:text/html,<script>alert(1)</script>' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-5">
                <button data-bind-attr="attrs" id="target">submit</button>
            </div>
        `)

        await waitForUpdate(200)
        const fa = document.getElementById('target').getAttribute('formaction')
        expect(fa === null || !fa.toLowerCase().startsWith('data:text/html')).toBe(true)
    })

    // H1 — data:image/svg+xml is scripting-capable when loaded by <object>,
    // <iframe>, <embed>, or certain contexts via <img>. The previous
    // `(?!image\/)` allowlist permitted it. Fix: narrow the allowlist to
    // raster-only (png/jpeg/gif/webp/avif/bmp/ico/tiff).
    it('H1 — blocks data:image/svg+xml (scripting-capable)', async () => {
        wildflower.component('url-san-h1-svg', {
            state: {
                attrs: { href: 'data:image/svg+xml,<svg onload=alert(1)/>' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-h1-svg">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.toLowerCase().startsWith('data:image/svg')).toBe(true)
    })

    it('H1 — blocks data:image/xml variant', async () => {
        wildflower.component('url-san-h1-xml', {
            state: {
                attrs: { href: 'data:image/xml,<svg onload=alert(1)/>' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-h1-xml">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const href = document.getElementById('target').getAttribute('href')
        expect(href === null || !href.toLowerCase().startsWith('data:image/xml')).toBe(true)
    })

    it('H1 — preserves safe data:image/png URIs', async () => {
        // Control: raster images should still pass through
        wildflower.component('url-san-h1-png', {
            state: {
                attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }
            }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="url-san-h1-png">
                <img data-bind-attr="attrs" id="target">
            </div>
        `)

        await waitForUpdate(200)
        const src = document.getElementById('target').getAttribute('src')
        // Safe PNG should survive sanitization
        expect(src !== null && src.startsWith('data:image/png')).toBe(true)
    })
})
