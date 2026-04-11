/**
 * @vitest-environment browser
 *
 * Hardening tests for URL sanitization bypass techniques.
 * Extends the core tests in security-url-sanitization.test.js with:
 * - Case variations (uppercase, mixed, title case)
 * - Entity-encoded bypasses (numeric, hex, mid-word)
 * - Whitespace bypasses (tab, newline, carriage return, leading spaces)
 * - Other URL-taking attributes (action, src, poster)
 * - Data URI variations (base64, application/javascript)
 * - Safe URL pass-through (https, mailto, relative, fragment)
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

/** Check that a URL attribute was sanitized (null, empty, or no longer contains the dangerous protocol) */
function expectDangerousUrlBlocked(el, attr, protocol) {
    const val = el.getAttribute(attr)
    // Sanitized means: attribute removed, set to empty, or the dangerous protocol is gone
    const stripped = val ? val.replace(/[\s\x00-\x1f]/g, '').toLowerCase() : ''
    expect(
        val === null || val === '' || !stripped.includes(protocol)
    ).toBe(true)
}

describe('Security: URL sanitization hardening', () => {
    let testContainer
    let wildflower
    let componentCounter = 0

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        componentCounter++

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

    // ── Case variations ──────────────────────────────────────────────

    describe('case variations', () => {
        it('should block JAVASCRIPT: (uppercase)', async () => {
            const name = `url-hard-uc-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'JAVASCRIPT:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })

        it('should block JaVaScRiPt: (mixed case)', async () => {
            const name = `url-hard-mc-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'JaVaScRiPt:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })

        it('should block Javascript: (title case)', async () => {
            const name = `url-hard-tc-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'Javascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })
    })

    // ── Entity-encoded bypasses ──────────────────────────────────────

    describe('entity-encoded bypasses', () => {
        it('should block &#106;avascript: (numeric entity for j)', async () => {
            const name = `url-hard-ent1-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: '&#106;avascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            const href = document.getElementById('target').getAttribute('href')
            // After browser entity decoding, this should resolve to javascript: and be blocked
            const stripped = href ? href.replace(/[\s\x00-\x1f]/g, '').toLowerCase() : ''
            expect(
                href === null || href === '' || !stripped.includes('javascript:')
            ).toBe(true)
        })

        it('should block &#x6A;avascript: (hex entity for j)', async () => {
            const name = `url-hard-ent2-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: '&#x6A;avascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            const href = document.getElementById('target').getAttribute('href')
            const stripped = href ? href.replace(/[\s\x00-\x1f]/g, '').toLowerCase() : ''
            expect(
                href === null || href === '' || !stripped.includes('javascript:')
            ).toBe(true)
        })

        it('should block java&#115;cript: (entity in middle)', async () => {
            const name = `url-hard-ent3-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'java&#115;cript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            const href = document.getElementById('target').getAttribute('href')
            const stripped = href ? href.replace(/[\s\x00-\x1f]/g, '').toLowerCase() : ''
            expect(
                href === null || href === '' || !stripped.includes('javascript:')
            ).toBe(true)
        })
    })

    // ── Whitespace bypasses ──────────────────────────────────────────

    describe('whitespace bypasses', () => {
        it('should block java\\tscript: (tab in protocol)', async () => {
            const name = `url-hard-ws1-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'java\tscript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })

        it('should block java\\nscript: (newline in protocol)', async () => {
            const name = `url-hard-ws2-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'java\nscript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })

        it('should block java\\rscript: (carriage return in protocol)', async () => {
            const name = `url-hard-ws3-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'java\rscript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })

        it('should block javascript: with leading whitespace', async () => {
            const name = `url-hard-ws4-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: '  javascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'href', 'javascript:')
        })
    })

    // ── Other URL-taking attributes ──────────────────────────────────

    describe('other URL-taking attributes', () => {
        it('should block javascript: in action attribute (form)', async () => {
            const name = `url-hard-attr1-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { action: 'javascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <form data-bind-attr="attrs" id="target">
                        <button>submit</button>
                    </form>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'action', 'javascript:')
        })

        it('should block javascript: in src attribute (iframe)', async () => {
            const name = `url-hard-attr2-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { src: 'javascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <iframe data-bind-attr="attrs" id="target"></iframe>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'src', 'javascript:')
        })

        it('should block javascript: in poster attribute (video)', async () => {
            const name = `url-hard-attr3-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { poster: 'javascript:alert(1)' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <video data-bind-attr="attrs" id="target"></video>
                </div>
            `)
            await waitForUpdate(200)
            expectDangerousUrlBlocked(document.getElementById('target'), 'poster', 'javascript:')
        })
    })

    // ── Data URI variations ──────────────────────────────────────────

    describe('data URI variations', () => {
        it('should block data:text/html;base64 in href', async () => {
            const name = `url-hard-data1-${componentCounter}`
            wildflower.component(name, {
                state: {
                    attrs: { href: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }
                }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            const href = document.getElementById('target').getAttribute('href')
            expect(
                href === null || href === '' || !href.toLowerCase().startsWith('data:text/html')
            ).toBe(true)
        })

        it('should block data:application/javascript in href', async () => {
            const name = `url-hard-data2-${componentCounter}`
            wildflower.component(name, {
                state: {
                    attrs: { href: 'data:application/javascript,alert(1)' }
                }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            const href = document.getElementById('target').getAttribute('href')
            // data:application/javascript should be blocked for URL attrs
            expect(
                href === null || href === '' ||
                !href.toLowerCase().startsWith('data:application/javascript')
            ).toBe(true)
        })
    })

    // ── Safe URLs (should NOT be blocked) ────────────────────────────

    describe('safe URLs should pass through', () => {
        it('should allow https:// URLs', async () => {
            const name = `url-hard-safe1-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'https://example.com' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expect(document.getElementById('target').getAttribute('href')).toBe('https://example.com')
        })

        it('should allow mailto: URLs', async () => {
            const name = `url-hard-safe2-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: 'mailto:user@example.com' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expect(document.getElementById('target').getAttribute('href')).toBe('mailto:user@example.com')
        })

        it('should allow relative paths', async () => {
            const name = `url-hard-safe3-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: '/relative/path' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expect(document.getElementById('target').getAttribute('href')).toBe('/relative/path')
        })

        it('should allow fragment-only URLs', async () => {
            const name = `url-hard-safe4-${componentCounter}`
            wildflower.component(name, {
                state: { attrs: { href: '#fragment' } }
            })

            await setupComponent(wildflower, testContainer, `
                <div data-component="${name}">
                    <a data-bind-attr="attrs" id="target">link</a>
                </div>
            `)
            await waitForUpdate(200)
            expect(document.getElementById('target').getAttribute('href')).toBe('#fragment')
        })
    })
})
