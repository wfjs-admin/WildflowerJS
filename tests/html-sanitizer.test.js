/**
 * HTML Sanitizer Hook Tests
 *
 * Tests for the data-bind-html sanitizer hook, dev-mode warning,
 * and DOMPurify integration.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('HTML Sanitizer Hook', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        // Reset sanitizer state between tests
        wildflower.setHtmlSanitizer(null)
        wildflower._htmlSanitizerWarned = false

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        // Always clear sanitizer after each test
        wildflower.setHtmlSanitizer(null)
        wildflower._htmlSanitizerWarned = false

        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    describe('Without sanitizer (default behavior)', () => {
        it('should render raw HTML when no sanitizer is configured', async () => {
            wildflower.component('html-no-sanitizer', {
                state: {
                    content: '<strong>Bold</strong> and <em>italic</em>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-no-sanitizer">
                    <div data-bind-html="content" class="output"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const output = testContainer.querySelector('.output')
            expect(output.innerHTML).toBe('<strong>Bold</strong> and <em>italic</em>')
            expect(output.querySelector('strong')).toBeTruthy()
            expect(output.querySelector('em')).toBeTruthy()
        })
    })

    describe('Dev-mode console warning', () => {
        it('should warn once on first data-bind-html use without sanitizer', async () => {
            // Only test in dev builds where console warnings are expected
            if (!hasConsoleWarnings()) return

            const warnSpy = vi.spyOn(console, 'warn')

            wildflower.component('html-warn-test', {
                state: {
                    content: '<p>Some HTML</p>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-warn-test">
                    <div data-bind-html="content" class="output1"></div>
                    <div data-bind-html="content" class="output2"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Should have warned about unsanitized HTML
            const sanitizerWarnings = warnSpy.mock.calls.filter(args =>
                args.some(arg => typeof arg === 'string' && arg.includes('sanitizer'))
            )
            expect(sanitizerWarnings.length).toBe(1) // Only once, not per element

            warnSpy.mockRestore()
        })

        it('should not warn when sanitizer is configured', async () => {
            if (!hasConsoleWarnings()) return

            const warnSpy = vi.spyOn(console, 'warn')

            wildflower.setHtmlSanitizer(html => html)

            wildflower.component('html-no-warn-test', {
                state: {
                    content: '<p>Some HTML</p>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-no-warn-test">
                    <div data-bind-html="content" class="output"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const sanitizerWarnings = warnSpy.mock.calls.filter(args =>
                args.some(arg => typeof arg === 'string' && arg.includes('sanitizer'))
            )
            expect(sanitizerWarnings.length).toBe(0)

            warnSpy.mockRestore()
        })
    })

    describe('setHtmlSanitizer() API', () => {
        it('should exist as a public method', () => {
            expect(typeof wildflower.setHtmlSanitizer).toBe('function')
        })

        it('should accept a function', () => {
            const sanitizer = html => html.replace(/<script>/g, '')
            wildflower.setHtmlSanitizer(sanitizer)
            expect(wildflower._htmlSanitizer).toBe(sanitizer)
        })

        it('should accept null to clear sanitizer', () => {
            wildflower.setHtmlSanitizer(html => html)
            expect(wildflower._htmlSanitizer).not.toBeNull()

            wildflower.setHtmlSanitizer(null)
            expect(wildflower._htmlSanitizer).toBeNull()
        })
    })

    describe('Sanitizer integration', () => {
        it('should pass content through sanitizer before rendering', async () => {
            wildflower.setHtmlSanitizer(html => `[clean]${html}[/clean]`)

            wildflower.component('html-sanitizer-passthrough', {
                state: {
                    content: '<p>hello</p>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-sanitizer-passthrough">
                    <div data-bind-html="content" class="output"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const output = testContainer.querySelector('.output')
            expect(output.innerHTML).toBe('[clean]<p>hello</p>[/clean]')
        })

        it('should strip XSS with DOMPurify', async () => {
            let DOMPurify
            try {
                const mod = await import('https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs')
                DOMPurify = mod.default
            } catch (e) {
                // Skip if CDN not available (offline environment)
                console.warn('Skipping DOMPurify test - CDN not available')
                return
            }

            wildflower.setHtmlSanitizer(html => DOMPurify.sanitize(html))

            wildflower.component('html-xss-test', {
                state: {
                    content: '<p>Safe text</p><img src=x onerror="alert(1)"><script>alert("xss")</script>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-xss-test">
                    <div data-bind-html="content" class="output"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const output = testContainer.querySelector('.output')
            // DOMPurify should strip the onerror and script
            expect(output.innerHTML).toContain('Safe text')
            expect(output.innerHTML).not.toContain('onerror')
            expect(output.innerHTML).not.toContain('<script>')
        })
    })

    describe('Sanitizer in list context', () => {
        it('should sanitize data-bind-html inside data-list templates', async () => {
            // Strip any tag that isn't <b> or <i> (simple allowlist sanitizer)
            wildflower.setHtmlSanitizer(html => html.replace(/<(?!\/?[bi]>)[^>]+>/gi, ''))

            wildflower.component('html-sanitizer-list', {
                state: {
                    items: [
                        { label: '<b>First</b><script>alert(1)</script>' },
                        { label: '<i>Second</i><img src=x onerror="steal()">' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-sanitizer-list">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind-html="label" class="html-item"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const htmlItems = testContainer.querySelectorAll('.html-item')
            expect(htmlItems.length).toBe(2)
            // Safe tags preserved, dangerous tags stripped
            expect(htmlItems[0].innerHTML).toContain('<b>First</b>')
            expect(htmlItems[0].innerHTML).not.toContain('<script>')
            expect(htmlItems[1].innerHTML).toContain('<i>Second</i>')
            expect(htmlItems[1].innerHTML).not.toContain('onerror')
        })
    })

    describe('Reactive updates with sanitizer', () => {
        it('should sanitize content on reactive updates', async () => {
            // Sanitizer that strips script tags and event handlers
            wildflower.setHtmlSanitizer(html =>
                html.replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/\s*on\w+="[^"]*"/gi, '')
            )

            wildflower.component('html-sanitizer-reactive', {
                state: {
                    content: '<p>initial</p><script>alert("xss")</script>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-sanitizer-reactive">
                    <div data-bind-html="content" class="output"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const output = testContainer.querySelector('.output')
            expect(output.innerHTML).toContain('<p>initial</p>')
            expect(output.innerHTML).not.toContain('<script>')

            // Update state with new malicious content
            const component = testContainer.querySelector('[data-component="html-sanitizer-reactive"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            instance.state.content = '<p>updated</p><script>document.title="hacked"</script>'
            await waitForCompleteRender()

            expect(output.innerHTML).toContain('<p>updated</p>')
            expect(output.innerHTML).not.toContain('<script>')
        })
    })
})
